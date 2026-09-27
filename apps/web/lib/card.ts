/**
 * The card the shopper types into the súper's own payment form.
 *
 * The shopper can always pay with their own card — the frame is the store's
 * real checkout and nothing here is required. This is the other option, and
 * it comes in two shapes, for the two products this bundle is: in preview a
 * card funded with exactly this basket, usable once, terminated after; in
 * production one card per customer, topped up by each deposit and kept.
 * `keepsOneCard` below is the line between them, and the long version is in
 * app/api/card/route.ts.
 *
 * ## What stops anyone minting one
 *
 * Nothing the browser says. `POST /api/card` takes a código, re-reads the
 * ledger for a payment carrying it, and derives the amount **from the payment
 * that actually landed** — never from the request body. A figure sent by a
 * client is a figure a client chose.
 *
 * Then it is claimed exactly once. A deposit that already bought a card cannot
 * buy a second, and the claim is a conditional UPDATE — `where card_id is null`
 * — rather than a read followed by a write, because two tabs pressing the
 * button together is the ordinary case and not the adversarial one. It was a
 * Redis SETNX until the card became something the shopper keeps; see the note
 * above `rememberDepositor` for why a latch with an expiry was the wrong shape
 * for money.
 *
 * ## What is never written down
 *
 * The PAN and CVV go from Vyrion to the shopper's screen and stop there. Not
 * a log line, not localStorage, not a Playwright trace — `e2e/app-auth.spec.ts`
 * already turns traces off for this repo because it is public, and this is the
 * reason that matters most. `VyrionClient.cardDetails` registers both with the
 * redactor on arrival, so even a careless `log()` elsewhere cannot print them.
 */
import { CARD_MAX_CENTS, CARD_MIN_CENTS, VyrionClient } from '@changuito/mcp/pay';

import { modeKeepsRecords } from './app-mode.ts';
import { bindCard, claimOrder, hasDatabase, openOrder, orderByMemo } from './db.ts';
import { depositAsset } from './deposit.ts';
import { findDeposit } from './deposit-watch.ts';
import type { NetworkId } from './deployments.ts';

/** Vyrion's own docs put this at 30s; leave room and fail rather than hang. */
const TIMEOUT_MS = 45_000;
const RETRIES = 2;

/**
 * `packages/mcp/src/util/http.ts` has a timeout and a backoff, and the plan
 * was to route these calls through it. Reading it decided otherwise: it is
 * VTEX's client — it throws `RetailerError`, sends `Accept-Language: es-AR`,
 * and refuses any body that does not start with a brace because Coto answers
 * 200 with an Angular shell. None of that is true of a card API. So the
 * wrapper is here, it is the two behaviours that were actually missing, and
 * `VyrionClient` takes it as its `fetchImpl` without knowing.
 */
export function timeoutFetch(inner: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    let last: unknown;
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        const res = await inner(input, { ...init, signal: ctrl.signal });
        // 429 and 5xx are worth another go; a 4xx is an answer.
        if ((res.status === 429 || res.status >= 500) && attempt < RETRIES) {
          await sleep(2 ** attempt * 500);
          continue;
        }
        return res;
      } catch (e) {
        last = e;
        if (attempt >= RETRIES) break;
        await sleep(2 ** attempt * 500);
      } finally {
        clearTimeout(timer);
      }
    }
    throw last instanceof Error ? last : new Error(String(last));
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** False means the button is not offered at all, rather than offered and broken. */
export function canIssueCard(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean((env.VYRION_API_KEY ?? '').trim());
}

export function cardClient(env: NodeJS.ProcessEnv = process.env): VyrionClient {
  return new VyrionClient({
    apiKey: (env.VYRION_API_KEY ?? '').trim(),
    // The guard in vyrion.ts refuses an sk_live_ key without this. It stays
    // an explicit opt-in: four characters in an env var are the only thing
    // between the sandbox and somebody's money.
    allowLive: env.ALLOW_LIVE === '1',
    fetchImpl: timeoutFetch(),
  });
}

/**
 * What the deposit is worth, read from the ledger rather than from the caller.
 *
 * The asset is USDC on both networks now — testnet's is one we issued, see
 * scripts/setup-demo-asset.mjs — so one unit is one dollar either way and this
 * is a plain conversion. The arithmetic is "what arrived", not "what was asked
 * for": a shopper who sent more gets a card for more, and one who sent less
 * does not get a card for the difference.
 */
export function centsFromAmount(amount: string): number | null {
  if (!/^\d+(\.\d{1,7})?$/.test(amount)) return null;
  const [whole, frac = ''] = amount.split('.');
  // Cents by string, not by float: 0.1 + 0.2 is the reason deposit-watch.ts
  // counts stroops, and the same reason applies to a figure that buys a card.
  const cents = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  return Number.isSafeInteger(cents) ? cents : null;
}

export interface FundedDeposit {
  txHash: string;
  cents: number;
  /**
   * The account that sent it, off the ledger. `POST /api/card` uses this when
   * the depositor record is missing — the one case that used to refuse a
   * shopper who had already paid. Empty string means Horizon did not say.
   */
  from: string;
}

/**
 * The deposit that pays for this card, or a reason there is not one. Never
 * throws for "no deposit" — the caller has to tell those two apart to answer
 * honestly, and Horizon being unreachable is not a shopper who has not paid.
 */
export async function fundingFor(
  net: NetworkId,
  memo: string,
  address: string,
): Promise<FundedDeposit | null> {
  const hit = await findDeposit(net, {
    to: address,
    asset: depositAsset(net),
    memo,
    // Any amount: the quote is not known here, and the card is funded with
    // whatever landed. The bounds below are what keeps that sane.
    minAmount: '0',
  });
  if (!hit) return null;
  const cents = centsFromAmount(hit.amount);
  if (cents === null) return null;
  return { txHash: hit.txHash, cents, from: hit.from };
}

/**
 * Whether this deposit tops up a card the customer keeps, or mints one that
 * dies with the basket.
 *
 * Three terms, and each rules out a different way of getting it wrong.
 *
 * `owner` is the wallet the gate proved at deposit time. Without one there is
 * nobody to bind a card *to*, so there is nothing to keep.
 *
 * `modeKeepsRecords` is asked out loud rather than inferred from `owner`,
 * because the allowlist can put a proven wallet on testnet and preview must
 * never write a row. It is the same explicit check `archiveChat` makes, for
 * the same reason: an invariant that holds by coincidence is one refactor
 * from not holding.
 *
 * `hasDatabase` is here because `card_owner` is the binding. With no database
 * the fallback in this file keeps claims in a per-instance Map and
 * deliberately binds nothing — a binding a restart forgets would mint a second
 * card for somebody who already has one, which is the single outcome the
 * persistent path exists to prevent.
 */
export function keepsOneCard(
  net: NetworkId,
  owner: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(owner) && modeKeepsRecords(net) && hasDatabase(env);
}

export type FundingRefusal = 'too-small' | 'too-large';

export function refuseFunding(cents: number): FundingRefusal | null {
  if (cents < CARD_MIN_CENTS) return 'too-small';
  if (cents > CARD_MAX_CENTS) return 'too-large';
  return null;
}

/* ---- the deposit's record ------------------------------------------------ */

/**
 * All of this used to be two Redis keys with a 24h expiry, and the expiry was
 * the bug. `chg:depositor:*` recorded who the gate let open a memo; a deposit
 * that confirmed slowly outlived it and became an unowned memo, which is a 403
 * to somebody who has already sent real money. `chg:card:*` was the claim
 * latch; Redis can evict under memory pressure, and an evicted latch mints a
 * second card against a deposit that already bought one.
 *
 * Both are columns on `orders` now. The once-only guarantee that `SET NX` gave
 * becomes `where card_id is null` in an UPDATE — the same atomicity, because
 * the first transaction's commit makes the second's predicate false — and it
 * leaves a row behind, so "which deposit paid for which card" is answerable a
 * month later rather than a day.
 *
 * **The in-process fallback stays.** Not as a second-class path: it is what
 * lets a fresh clone with no DATABASE_URL still run the demo, the same degrade
 * turn-store.ts makes, and it is what the unit tests exercise since they run
 * with no database reachable. A single instance still refuses a second card for
 * the same deposit; what it cannot do is survive a restart, which is why it is
 * not what production uses.
 */
const localClaims = new Map<string, string>();
const localOwners = new Map<string, string>();
const localKey = (net: NetworkId, memo: string) => `${net}:${memo}`;

/**
 * Record that this memo was issued, and to whom.
 *
 * `address` is optional and omitted in `realModeMode() === 'open'`, where
 * nothing was proven — writing a claimed address down would be recording a
 * guess and then trusting it later. NULL there means "nobody was checked",
 * which is precisely what `depositorOf` returning undefined already means.
 *
 * `amountCents` is new to this signature and is not negotiable: an order row
 * without the figure that was quoted is a record of nothing. The deposit route
 * has it as `usdCents` at the moment it mints the memo.
 *
 * **This is not authentication of the caller.** `POST /api/card` still takes
 * nothing but the memo, because a proof lives five minutes and a deposit can
 * take longer than that to confirm — refusing a shopper who has already paid is
 * the worst moment available to fail. What this is: evidence that the memo was
 * issued to somebody the gate let in. It narrows "anyone who knows a memo can
 * mint its card" to "anyone who knows a memo an allowed wallet opened", and no
 * further. The memo's own unguessability carries the rest, which is why
 * `mintMemo` draws from the CSPRNG.
 */
export async function rememberDepositor(
  net: NetworkId,
  memo: string,
  o: {
    /** Omitted in `open` mode, where no address was proven. */
    address?: string;
    /** What the deposit was quoted at, in US cents. */
    amountCents: number;
    /** The centavos figure the shopper actually read on screen. */
    arsQuoted?: number;
    cartId?: string;
  },
): Promise<void> {
  if (!hasDatabase()) {
    if (o.address) localOwners.set(localKey(net, memo), o.address);
    return;
  }
  await openOrder({
    network: net,
    memo,
    address: o.address ?? null,
    amountCents: o.amountCents,
    arsQuoted: o.arsQuoted ?? null,
    cartId: o.cartId ?? null,
  });
}

/** The wallet that opened this deposit, or undefined if nothing recorded one. */
export async function depositorOf(net: NetworkId, memo: string): Promise<string | undefined> {
  if (!hasDatabase()) return localOwners.get(localKey(net, memo));
  return (await orderByMemo(net, memo))?.address ?? undefined;
}

/**
 * Take the deposit, or find out who already did.
 *
 * Returns the card id on success and the existing one on a second attempt, so
 * a shopper who refreshed sees the card they already have rather than an error
 * about a card they do not remember asking for.
 *
 * `cents` is here so the claim can stand up its own row. Normally the deposit
 * route opened one already, but a database write that failed at quote time must
 * not become a lost claim at card time — and by this point the funded figure is
 * known exactly, read off the ledger, which makes it the better number anyway.
 */
export async function claimDeposit(
  net: NetworkId,
  memo: string,
  cardId: string,
  cents: number,
): Promise<{ claimed: boolean; existing?: string }> {
  if (!hasDatabase()) {
    const key = localKey(net, memo);
    const held = localClaims.get(key);
    if (held) return { claimed: false, existing: held };
    localClaims.set(key, cardId);
    return { claimed: true };
  }
  // Idempotent, and it never overwrites a claim: openOrder coalesces rather
  // than clobbering, and card_id is not one of the columns it touches.
  await openOrder({ network: net, memo, amountCents: cents });
  return claimOrder(net, memo, cardId);
}

/** Who holds this deposit's card, if anyone. Read-only; never claims. */
export async function heldCard(net: NetworkId, memo: string): Promise<string | undefined> {
  if (!hasDatabase()) return localClaims.get(localKey(net, memo));
  return (await orderByMemo(net, memo))?.cardId ?? undefined;
}

/* ---- issuing ------------------------------------------------------------- */

/** The categories a grocery order can legitimately land in. Same default as
 *  packages/mcp/src/config.ts, and the same env var, so the two cannot drift.
 *
 *  Here rather than in a route file because `allowed_categories` is fixed at
 *  creation and can never be changed: two routes reading two copies of this
 *  list would mean a card minted from the stale one accepts the wrong
 *  merchants for the whole of its life. */
export const GROCERY_MCC = (process.env.ALLOWED_MCC ?? '5411,5499,5311')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * The best BIN, or nothing. `bins()` has already dropped anything without 3DS
 * and sorted by acceptance rate; an empty list is an account problem rather
 * than a shopper one, so it is logged here and read as a 502 by the caller.
 */
export async function firstBin(client: VyrionClient) {
  const bin = (await client.bins())[0];
  if (!bin) console.error('[card] no 3DS-capable BIN available on this Vyrion account');
  return bin ?? null;
}

/** Give back a card we should not be holding. The balance returns at once. */
export async function handBack(client: VyrionClient, cardId: string): Promise<void> {
  await client.terminateCard(cardId).catch((e) => {
    console.error(
      `[card] could not terminate the losing card ${cardId}:`,
      e instanceof Error ? e.message : String(e),
    );
  });
}

export type KeptMint =
  | { ok: false; reason: 'no-bin' }
  /** We created it and the binding is ours. */
  | { ok: true; won: true; cardId: string; last4: string; brand: string }
  /** Another lambda got there first; ours is already handed back. */
  | { ok: true; won: false; cardId: string };

/**
 * Create the one card a customer keeps, and bind it — resolving the race.
 *
 * Two lambdas can reach `createCard` for the same wallet at once (the deposit
 * watcher and a refreshed tab, say) and both come away holding a real card.
 * `bindCard`'s `on conflict do nothing` lets exactly one row win; the loser
 * learns it lost by getting back an id that is not its own, and **must** hand
 * its card in or the customer is charged for two.
 *
 * That sequence is subtle enough that having it twice is how a second card
 * eventually gets issued, so it lives here and both callers — the deposit that
 * tops a card up, and the customer who asks for one outright — go through it.
 *
 * No `spendingLimitCents`, deliberately: a limit set at creation can never be
 * raised (Vyrion has no update-limit endpoint), so it would become the ceiling
 * the card silently stops working at on some future shop.
 */
export async function mintKeptCard(
  client: VyrionClient,
  {
    net,
    owner,
    cents,
    metadata,
  }: { net: NetworkId; owner: string; cents: number; metadata?: Record<string, unknown> },
): Promise<KeptMint> {
  const bin = await firstBin(client);
  if (!bin) return { ok: false, reason: 'no-bin' };

  const card = await client.createCard({
    binId: bin.id,
    amountCents: cents,
    label: `changuito ${owner.slice(-6)}`,
    allowedCategories: GROCERY_MCC,
    metadata: { owner, network: net, ...metadata },
  });

  let winner: string;
  try {
    winner = await bindCard(net, owner, card.id, {
      last4: card.last4,
      brand: card.network,
    });
  } catch (err) {
    await handBack(client, card.id);
    throw err;
  }
  if (winner !== card.id) {
    await handBack(client, card.id);
    return { ok: true, won: false, cardId: winner };
  }
  return { ok: true, won: true, cardId: card.id, last4: card.last4, brand: card.network };
}
