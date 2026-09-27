/**
 * What this wallet has bought here.
 *
 * The record behind the Mis compras tab of the profile modal: one line per
 * order, newest first, read back
 * from the `orders` table rather than from anything the browser kept. That is
 * the point of it — localStorage holds the conversation and the card hint, and
 * both of those are per-device, so a shopper who paid on their phone and opens
 * the laptop has no history at all until this answers.
 *
 * ## POST for a read, again
 *
 * The plan called this `GET /api/orders`, and `POST /api/card/mine` already
 * made this argument: a GET would have to carry the address and the signature
 * in the query string, where they land in access logs, proxy caches and
 * `Referer` headers. A credential belongs in a body, so the verb follows the
 * credential rather than the semantics. Two routes reading with POST for the
 * same reason is a convention; one would have been an oddity.
 *
 * ## Why it takes a credential at all
 *
 * A Stellar address is public. Without one, anyone who has ever been paid by
 * this shopper — or who read the ledger — could list what they buy, how much
 * they spend and how often. The `chat` table is narrowed by address in the
 * WHERE clause for exactly that reason, and an order is the same fact with the
 * groceries taken out.
 *
 * ## Two credentials, and why the cookie is one of them
 *
 * The session comes first: `chg_user` is an HttpOnly cookie signed with
 * `CHG_SESSION_SECRET` over an expiry and the address, minted at login by
 * `ensureUserCookie` from a SEP-53 signature the customer has already given.
 * Reading your own receipts is a thing you do often, and demanding a fresh
 * wallet popup each time was asking twice for the same proof — it taught
 * people to click through signing prompts, which is a worse security outcome
 * than anything below.
 *
 * What we give up, plainly: a five-minute proof is replayable for five
 * minutes, and this cookie is replayable for thirty days. Script cannot read
 * it, and a cross-origin POST cannot forge one — `SameSite=Lax` withholds it,
 * and the `application/json` content type makes the request non-simple, so it
 * is preflighted and CORS refuses it. But any XSS on this origin can call this
 * route with the browser's own cookie attached. That is the MVP trade, made
 * deliberately; a real fix is a shorter TTL with a refresh, not a popup.
 *
 * Without a session the wallet proof is unchanged, and `orders` is still its
 * own intent: a signature for reading a card cannot list purchases, and one
 * for listing purchases cannot read a card.
 *
 * ## What comes back, and what does not
 *
 * Not the row. `card_id` is left out on purpose — the page has no use for it,
 * `POST /api/card/mine` looks the card up from the wallet it authenticated and
 * never takes an id as input, and a value on the wire that nothing consumes is only
 * somewhere for it to leak from. `hasCard` answers the question the page
 * actually asks, which is whether this order ended in a card.
 */
import { hasDatabase, ordersOf, type OrderRow, type OrderStatus } from '../../../lib/db.ts';
import { DEFAULT_NETWORK, type NetworkId } from '../../../lib/deployments.ts';
import { requireHuman } from '../../../lib/human-gate.ts';
import { readLoggedInUser } from '../../../lib/login-gate.ts';
import { networkAccess } from '../../../lib/network-access.ts';
import { proofFromBody, verifyWalletProof } from '../../../lib/wallet-proof-verify.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** One purchase, as the page reads it. */
export interface OrderLine {
  memo: string;
  network: NetworkId;
  status: OrderStatus;
  /** US cents — the basket plus the FX buffer, which is what was sent. */
  amountCents: number;
  /** The pesos the shopper actually saw, kept because the rate moves. */
  arsQuoted: number | null;
  txHash: string | null;
  cartId: string | null;
  handoffUrl: string | null;
  /** Whether a card was ever issued against it. Never the card's id. */
  hasCard: boolean;
  createdAt: string;
}

const line = (o: OrderRow): OrderLine => ({
  memo: o.memo,
  network: o.network,
  status: o.status,
  amountCents: o.amountCents,
  arsQuoted: o.arsQuoted,
  txHash: o.txHash,
  cartId: o.cartId,
  handoffUrl: o.handoffUrl,
  hasCard: Boolean(o.cardId),
  createdAt: o.createdAt.toISOString(),
});

function networkFrom(value: unknown): NetworkId {
  return value === 'mainnet' || value === 'testnet' ? value : DEFAULT_NETWORK;
}

export async function POST(req: Request): Promise<Response> {
  const gated = await requireHuman(req);
  if (gated) return gated;

  // Answered before the shopper is asked to sign anything. Preview keeps no
  // records at all, so on a deployment with no database this is not a failure
  // to report — it is the shape of the thing — and making somebody approve a
  // signature in their wallet first, to then be told there is nothing to
  // read, would be the rudest possible ordering.
  if (!hasDatabase()) return json({ error: 'las compras guardadas no están habilitadas acá' }, 503);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'body must be JSON' }, 400);
  }
  const input = (body ?? {}) as { address?: unknown; network?: unknown };

  // The session, if there is one. `chg_user` is minted at login by
  // `ensureUserCookie` and until now only /api/chat read it; the signature it
  // is made of is the one the customer already gave, so asking for a second
  // one to look at their own receipts was asking twice for the same thing.
  //
  // Shape-checked here, and not only by `verifyUserToken`: that one asks for
  // `length >= 8` and nothing more, so a token minted for something that is
  // not a Stellar address would otherwise reach `ordersOf` unexamined.
  const session = await readLoggedInUser(req);
  const signedIn = session.ok && /^G[A-Z2-7]{55}$/.test(session.address) ? session.address : '';

  // The cookie wins. A body that names somebody else's address is not an
  // error to report — it is simply not what gets read, because the only
  // address this request has proven is the one in the signed cookie.
  const claimed = typeof input.address === 'string' ? input.address.trim().toUpperCase() : '';
  const address = signedIn || claimed;
  if (!/^G[A-Z2-7]{55}$/.test(address)) return json({ error: 'dirección inválida' }, 400);
  const network = networkFrom(input.network);

  // Same gate the deposit route puts in front of a real network, and asked
  // before the proof is checked, so a wallet that may not use this network
  // learns that and nothing about whether it has bought anything here.
  if (!networkAccess(address, network).allowed) {
    return json({ error: 'Esta cuenta no tiene habilitado el modo real.' }, 403);
  }

  // Without a session, nothing changes: the wallet proof is still the only way
  // in, and every refusal below is the one it always was.
  if (!signedIn) {
    const verdict = verifyWalletProof({
      intent: 'orders',
      address,
      proof: proofFromBody(body),
      now: Date.now(),
    });
    if (!verdict.ok) {
      return json(
        {
          error: verdict.error,
          message:
            verdict.error === 'proof_expired'
              ? 'La firma venció. Probá de nuevo.'
              : 'Necesitamos que firmes con tu cuenta para mostrarte tus compras.',
        },
        401,
      );
    }
  }

  try {
    const rows = await ordersOf(network, address);
    return json({ orders: rows.map(line) }, 200);
  } catch (err) {
    console.error('[orders] could not read them:', err instanceof Error ? err.message : String(err));
    return json({ error: 'no pudimos leer tus compras en este momento' }, 502);
  }
}

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, private' },
  });
}
