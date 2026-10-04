/**
 * The card a deposit pays for — minted, or topped up.
 *
 * The chain of custody is the whole function: a código arrives, the ledger is
 * read for a payment carrying it, the amount comes from that payment, the
 * deposit is claimed exactly once, and a card ends up holding that amount and
 * no more. Nothing in the input reaches the card except the código — and the
 * código is checked against the ledger before it buys anything.
 *
 * Postgres is called directly. The once-only claim is `claimDeposit`, which is
 * a conditional update, and this file does not split that into a read and a
 * write.
 *
 * ## Two cards, because there are two products
 *
 * A preview shopper has no identity, so their card is per-basket: created for
 * this deposit, `spending_limit` equal to it, terminated when they are done.
 *
 * A production shopper has a wallet, and **one card per customer** is the
 * decision — so the second deposit does not mint a second card, it funds the
 * first. `card_owner` holds the binding, `cardOf` reads it, and a deposit that
 * finds a live card calls `fundCard` instead of `createCard`.
 *
 * **The card they keep is created with no `spending_limit`, and that is not a
 * relaxation — it is the only shape that works.** Vyrion sets the limit at
 * creation and exposes no endpoint to raise it, so a standing card born with
 * one could be topped up until the balance hit the limit and then never again:
 * a card that silently stops working on some future shop. The ceiling the
 * limit was carrying moves to the deposit instead, which is where it belongs —
 * `refuseFunding` still bounds every single top-up by `CARD_MAX_CENTS`, and a
 * card can only ever hold what somebody actually sent.
 *
 * `allowedCategories` matters more for the same reason. It is also fixed at
 * creation, and on a card that lives for months it is the one ceiling still
 * doing work every day: a standing balance stays locked to grocery MCCs.
 *
 * ## Claim first, spend second
 *
 * On the top-up path the deposit is claimed **before** `fundCard` is called,
 * which is the reverse of the mint path and deliberate. Funding first would
 * let two tabs both see an unclaimed deposit and both top up — one payment,
 * twice the money. Claiming first can only fail the other way: a deposit
 * marked spent against a card that was not topped up, which is loud in the log
 * and fixed by hand. On the mint path the order cannot be reversed, because
 * the card id does not exist until the card does, so a lost claim there hands
 * the card straight back.
 *
 * ## Why it answers twice with the same card
 *
 * A shopper who refreshes must see the card they already have, not an error
 * about a card they do not remember asking for. So the claim is checked before
 * anything is created, and if a second tab wins the race in between, the card
 * this request made is terminated at once — leaving it alive would strand the
 * money inside it — and the winner's card is returned instead.
 *
 * ## Why this asks for no signature
 *
 * On a gated network the quote already made the shopper sign, and this
 * establishes ownership from what it can see rather than asking again. It does
 * **not** want a second signature, and that is a decision rather than an
 * omission: a proof lives five minutes (`WALLET_PROOF_TTL_MS`) and a deposit
 * can take longer than that to confirm, so requiring one here would refuse a
 * shopper who has already sent real money — the worst available moment to
 * fail, and one that ends in a refund done by hand.
 *
 * So the memo is the credential at this step, which is exactly why `mintMemo`
 * draws from the CSPRNG. Three things have to be true before a card exists, and
 * none of them is a claim in the input: the código is unguessable, a payment
 * carrying it has actually landed at our address on the ledger, and the account
 * that sent that payment is allowed on this network.
 *
 * The depositor row is *preferred* evidence of who owns the card, not required
 * evidence — see the long comment at the ownership check for the shopper who
 * paid and was refused because it went missing.
 */
import { CARD_MAX_CENTS, CARD_MIN_CENTS, formatUsd } from '@changuito/mcp/pay';

import { modeKeepsRecords } from '../app-mode.ts';
import {
  canIssueCard,
  cardClient,
  claimDeposit,
  depositorOf,
  firstBin,
  type FundedDeposit,
  fundingFor,
  GROCERY_MCC,
  handBack,
  heldCard,
  keepsOneCard,
  mintKeptCard,
  refuseFunding,
} from '../card.ts';
import { cardOf, hasDatabase, unbindCard } from '../db.ts';
import { isMemo } from '../deposit.ts';
import { realModeFor, realModeNeedsProof } from '../deposit-gate.ts';
import { DEFAULT_NETWORK, type NetworkId } from '../deployments.ts';
import { activeLedger } from '../ledger/index.ts';
import { networkAccess } from '../network-access.ts';

export interface IssuedCard {
  cardId: string;
  last4: string;
  /** visa / mastercard — the logo the súper's form expects. */
  brand: string;
  pan: string;
  cvv: string;
  /** Two digits, as the form wants them. */
  expiryMonth: string;
  /** Two digits; Vyrion sends four. */
  expiryYear: string;
  holder: string;
  fundedDisplay: string;
}

export interface CardReply {
  status: number;
  body: IssuedCard | { error: string };
}

function networkFrom(value: unknown): NetworkId {
  return value === 'mainnet' || value === 'testnet' ? value : DEFAULT_NETWORK;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

const reply = (body: CardReply['body'], status: number): CardReply => ({ status, body });

export async function issueCard(body: unknown): Promise<CardReply> {
  if (!canIssueCard()) {
    // Not an error the shopper caused and not one they can act on. The UI does
    // not offer the button in this state; this is the second lock.
    return reply({ error: 'las tarjetas no están habilitadas en este entorno' }, 503);
  }

  const input = (body ?? {}) as { memo?: unknown; network?: unknown };

  if (!isMemo(input.memo)) return reply({ error: 'código inválido' }, 400);
  const memo = input.memo;
  const network = networkFrom(input.network);
  const address = activeLedger().receiveAddress(network);
  if (!address) return reply({ error: 'los pagos no están habilitados en este entorno' }, 503);

  const mode = realModeFor(network);
  const client = cardClient();

  // Already minted for this código — a refresh, a second tab, a back button.
  // Nothing below this line runs for that request, including the allowlist
  // re-read, and that is on purpose: the card exists and the shopper's money is
  // already on it, so an account that lost real-mode access in the meantime
  // still needs to be able to read the numbers and spend what it loaded.
  // Withholding them would strand the balance, not protect anything.
  const already = await heldCard(network, memo).catch(() => undefined);
  if (already) return describe(client, already, 200);

  // ## The ledger is read before the owner is decided, and that ordering is the fix
  //
  // This used to ask `depositorOf` first and refuse outright when it came back
  // empty. A shopper hit that with 12.44 USDC already sent, confirmed on chain,
  // memo and all: the deposit was real and the *row* naming who opened it was
  // not there. They got `no pudimos verificar este importe` and a refund by
  // hand — for a payment the ledger could see perfectly well.
  //
  // So the question is asked in the order the evidence exists. The ledger read
  // has to happen anyway to know what the card is worth, and the payment it
  // finds carries `from`: the account that actually moved the money. That is
  // strictly better proof of ownership than the row, which holds an address a
  // caller *claimed* and a signature vouched for some minutes earlier.
  //
  // `fundingFor` reads the port and converts the amount that landed. The input
  // has no amount, and none is applied.
  let funding;
  try {
    funding = await fundingFor(network, memo, address);
  } catch (err) {
    // An unreadable ledger is not "no deposit". Saying otherwise would tell a
    // shopper who has already paid that they have not — the same rule the
    // deposit keeps.
    console.error('[card] ledger read failed:', message(err));
    return reply({ error: 'no pudimos consultar la red en este momento' }, 502);
  }
  // No payment with this memo has landed. A forged código reaches here too and
  // gets the same answer, which is the honest one for both: there is nothing to
  // see yet. The dialog is polling and will ask again.
  if (!funding) return reply({ error: 'todavía no vemos el importe de esta compra' }, 409);

  // Skipped in mode 'open', where nothing was proven at deposit time either and
  // there is no play money worth binding.
  let owner: string | undefined;
  if (realModeNeedsProof(mode)) {
    // The row first, when it is there. It names the wallet that *signed*, and
    // that is the right binding when the two differ — a shopper whose dollars
    // sit on an exchange pays from the exchange's account, and a card bound to
    // that account would be bound to a stranger.
    const recorded = await depositorOf(network, memo).catch(() => undefined);
    owner = recorded ?? (funding.from || undefined);
    if (!owner) {
      // Both empty: no row, and the ledger named no sender. Nothing is left to
      // bind a card to, so refuse — but say which of the two is missing,
      // because `hasDatabase()` answers most of it and the operator reading
      // this log is the person who can set the variable.
      console.error(
        `[card] no owner for ${network}:${memo} — no row (database ${hasDatabase() ? 'configured' : 'NOT configured'}) and no sender on tx ${funding.txHash}`,
      );
      return reply({ error: 'no pudimos verificar este importe' }, 403);
    }
    if (!recorded) {
      // Worth a line every time. The card goes out, so this is not an incident;
      // it is the only signal that the deposit row is not being written, and
      // the *next* thing that breaks for want of it is quieter than this one.
      console.warn(
        `[card] ${network}:${memo} had no depositor row (database ${hasDatabase() ? 'configured' : 'NOT configured'}); using the payer off tx ${funding.txHash}`,
      );
    }
    // Re-read rather than trusted: an allowlist can shrink between the deposit
    // and the card, and the second question is the one being answered now.
    if (!networkAccess(owner, network).allowed) {
      return reply({ error: 'Esta cuenta no tiene habilitado el modo real.' }, 403);
    }
  }

  const refusal = refuseFunding(funding.cents);
  if (refusal) {
    return reply(
      {
        error:
          refusal === 'too-small'
            ? `el importe es menor al mínimo de una tarjeta (${formatUsd(CARD_MIN_CENTS)})`
            : `el importe supera el máximo de una tarjeta (${formatUsd(CARD_MAX_CENTS)})`,
      },
      409,
    );
  }

  // Which of the two cards this is, and why, is `keepsOneCard`'s doc comment.
  const keeps = keepsOneCard(network, owner);
  if (!keeps && modeKeepsRecords(network)) {
    // On a network that keeps records, the per-basket card is never a design
    // choice — it is the persistent path unavailable. The shopper still gets a
    // card and still pays, so nothing here fails; what stops holding is "one
    // card per customer", silently, and the way anybody finds out is their
    // *next* basket minting a second one. So it is said now, while the cause is
    // still on screen, rather than left to be inferred from two cards later.
    console.warn(
      `[card] ${network}:${memo} issuing a per-basket card: owner ${owner ? 'known' : 'UNKNOWN'}, database ${hasDatabase() ? 'configured' : 'NOT configured'} — no card_owner binding will be written`,
    );
  }
  try {
    return keeps
      ? await fundTheCardTheyKeep(client, { net: network, owner: owner!, memo, funding })
      : await mintOneForThisBasket(client, { net: network, memo, funding });
  } catch (err) {
    // Deliberately not the upstream message: a card API's errors can quote the
    // request back, and the request had a card in it.
    console.error('[card] issue failed:', message(err));
    return reply({ error: 'no pudimos emitir una tarjeta en este momento' }, 502);
  }
}

interface Issuance {
  net: NetworkId;
  memo: string;
  funding: FundedDeposit;
}

/**
 * Preview's card, and the one this path has always made: born for this
 * basket, dies with it. `spending_limit` equal to the funded amount because
 * the FX buffer is float rather than spend, and nothing here has to survive
 * a second deposit — so the limit costs nothing and closes a gap.
 */
async function mintOneForThisBasket(
  client: ReturnType<typeof cardClient>,
  { net, memo, funding }: Issuance,
): Promise<CardReply> {
  const bin = await firstBin(client);
  if (!bin) return reply({ error: 'no pudimos emitir una tarjeta en este momento' }, 502);

  const card = await client.createCard({
    binId: bin.id,
    amountCents: funding.cents,
    label: `changuito ${memo}`,
    spendingLimitCents: funding.cents,
    allowedCategories: GROCERY_MCC,
    metadata: { memo, network: net, tx: funding.txHash },
  });

  const claim = await claimDeposit(net, memo, card.id, funding.cents);
  if (!claim.claimed) {
    // Lost the race. This card is not the one the deposit owns, so it goes
    // back immediately; the winner's is what the shopper asked for.
    await handBack(client, card.id);
    if (claim.existing) return describe(client, claim.existing, 200);
    return reply({ error: 'este importe ya tiene una tarjeta' }, 409);
  }

  return reply(await issued(client, card.id, card.last4, card.network, funding.cents), 200);
}

/**
 * Production's card: one per customer, and this deposit tops it up.
 *
 * Reading the binding is allowed to fail the request. Treating an unreadable
 * `card_owner` as "no card" would mint a second one for a customer who has
 * one, which is the single thing this whole path exists to prevent — so the
 * read throws and the caller answers 502.
 */
async function fundTheCardTheyKeep(
  client: ReturnType<typeof cardClient>,
  { net, owner, memo, funding }: Issuance & { owner: string },
): Promise<CardReply> {
  let cardId = await cardOf(net, owner);

  if (cardId) {
    // The binding outlives the card, because terminating one is irreversible
    // and "ya terminé de comprar" does exactly that. A dead card cannot be
    // funded, so forget it and mint the next one.
    const held = await client.getCard(cardId);
    if (held.status === 'terminated') {
      await unbindCard(net, owner, cardId).catch((e) => {
        console.error(`[card] could not unbind the terminated card ${cardId}:`, message(e));
      });
      cardId = undefined;
    }
  }

  if (!cardId) {
    // Creation, binding, and the two-lambda race are `mintKeptCard`'s, because
    // the customer who asks for a card outright runs exactly the same sequence
    // and having it twice is how somebody ends up with two cards.
    const mint = await mintKeptCard(client, {
      net,
      owner,
      cents: funding.cents,
      metadata: { memo, tx: funding.txHash },
    });
    if (!mint.ok) return reply({ error: 'no pudimos emitir una tarjeta en este momento' }, 502);

    if (!mint.won) {
      // Somebody else's card is the one bound. Ours is already handed back;
      // fall through and top theirs up with this deposit.
      cardId = mint.cardId;
    } else {
      const card = { id: mint.cardId, last4: mint.last4, network: mint.brand };
      // Creation funded it, so the claim comes after — there was no id to
      // claim against before. Anything other than a clean win means this card
      // should not exist: it goes back, and the binding goes with it, so the
      // next attempt starts from nothing rather than from a card holding a
      // deposit that is already spent.
      let claim: Awaited<ReturnType<typeof claimDeposit>>;
      try {
        claim = await claimDeposit(net, memo, card.id, funding.cents);
      } catch (err) {
        await handBack(client, card.id);
        await unbindCard(net, owner, card.id).catch(() => {});
        throw err;
      }
      if (!claim.claimed) {
        await handBack(client, card.id);
        await unbindCard(net, owner, card.id).catch(() => {});
        if (claim.existing) return describe(client, claim.existing, 200);
        return reply({ error: 'este importe ya tiene una tarjeta' }, 409);
      }
      return reply(await issued(client, card.id, card.last4, card.network, funding.cents), 200);
    }
  }

  // Claimed before a cent moves. See the header: this order is the difference
  // between "the top-up did not happen" and "the top-up happened twice".
  const claim = await claimDeposit(net, memo, cardId, funding.cents);
  if (!claim.claimed) return describe(client, claim.existing ?? cardId, 200);

  let funded;
  try {
    funded = await client.fundCard(cardId, funding.cents);
  } catch (err) {
    // The deposit is now marked spent against a card that did not receive it.
    // Loud, and with everything needed to put it right by hand, because the
    // shopper cannot retry their way out of this one.
    console.error(
      `[card] ${net}:${memo} is claimed against ${cardId} but the top-up failed — fund it by hand:`,
      message(err),
    );
    throw err;
  }

  // What the card holds now, not what this deposit added: the shopper is
  // about to type it into a form and the spendable figure is the one that
  // matters. Their previous basket may have left change on it.
  const balance = Math.round((funded.balance ?? 0) * 100);
  return reply(
    await issued(client, cardId, funded.last4, funded.network, balance || funding.cents),
    200,
  );
}

/** The card a claim already points at, read back in full. */
async function describe(
  client: ReturnType<typeof cardClient>,
  cardId: string,
  status: number,
): Promise<CardReply> {
  try {
    const card = await client.getCard(cardId);
    if (card.status === 'terminated') {
      // The order is over. Re-minting would spend a deposit that is already
      // spent, so this is the end of the road rather than a retry.
      return reply({ error: 'la tarjeta de esta compra ya se cerró' }, 409);
    }
    // `spending_limit` first, `balance` second, and which one answers says
    // which card this is. A per-basket card has a limit equal to what it was
    // funded with — the figure that does not move while the súper authorises,
    // which is what that panel's sentence is about. A card the customer keeps
    // has no limit at all, so the balance is the only number there is, and on
    // a standing card it is also the more useful one: what is spendable today.
    const funded = Math.round((card.spending_limit ?? card.balance ?? 0) * 100);
    return reply(await issued(client, card.id, card.last4, card.network, funded), status);
  } catch (err) {
    console.error('[card] could not read back the held card:', message(err));
    return reply({ error: 'no pudimos leer la tarjeta de esta compra' }, 502);
  }
}

async function issued(
  client: ReturnType<typeof cardClient>,
  cardId: string,
  last4: string,
  brand: string,
  cents: number,
): Promise<IssuedCard> {
  const d = await client.cardDetails(cardId);
  return {
    cardId,
    last4,
    brand,
    pan: d.pan,
    cvv: d.cvv,
    expiryMonth: d.expiry_month,
    // Vyrion sends four digits; most forms want two.
    expiryYear: d.expiry_year.slice(-2),
    holder: d.cardholder_name ?? 'CHANGUITO',
    fundedDisplay: formatUsd(cents),
  };
}
