/**
 * The card this wallet keeps, read back with the numbers on it.
 *
 * `POST /api/card` mints or tops up against a deposit and asks for no
 * signature, for a reason its own header sets out at length: a proof lives five
 * minutes, a deposit can take longer than that to confirm, and refusing a
 * shopper who has already sent real money is the worst available moment to
 * fail. That reasoning is sound, and it is sound *only for a card tied to a
 * deposit that just landed*.
 *
 * A card the customer keeps breaks it. It is read days later, from a device
 * that never paid, with no deposit in flight to vouch for the request — so if
 * the card id were enough, the card id would be a bearer token for somebody's
 * PAN, sitting in localStorage, for as long as the card lives. It is not
 * enough, and it is not an input: the card id never crosses the wire inbound,
 * and the server looks up which card the authenticated wallet owns. Guessing
 * an id gets you nothing because there is nowhere to put it.
 *
 * ## What authenticates the wallet
 *
 * Either of two things, checked in that order.
 *
 * **The session.** `chg_user` is an HttpOnly cookie signed with
 * `CHG_SESSION_SECRET` over an expiry and the address, minted at login by
 * `ensureUserCookie` out of a SEP-53 signature the customer already gave. It
 * is the credential behind the profile and the card modal, both of which are
 * opened casually and often; a wallet popup in front of each one would have
 * trained people to approve signing prompts without reading them.
 *
 * The trade, stated rather than glossed: the proof below lives five minutes,
 * this cookie lives thirty days, so a stolen one is replayable for thirty
 * days. Script cannot read it, and a cross-origin POST cannot forge one —
 * `SameSite=Lax` withholds it, and the `application/json` content type makes
 * the request non-simple, so it is preflighted and CORS refuses it. What is
 * left is that **any XSS on this origin can call this route with the browser's
 * own cookie and read the PAN and CVV below.** That is the MVP position, taken
 * knowingly; the fix is a short-lived session with a refresh, not a popup.
 *
 * The cookie's address is authoritative when it is present — a body naming
 * somebody else's address does not get an error, it simply is not what gets
 * read. And it is re-checked against the Stellar address shape here, because
 * `verifyUserToken` asks only that the address be at least eight characters.
 *
 * **The wallet proof.** Unchanged, and the only way in without a session: a
 * fresh SEP-53 signature over the `card` intent, which a signature for listing
 * purchases cannot stand in for.
 *
 * `POST /api/card/retire` deliberately did *not* move to the cookie. Looking at
 * your card is a session act; destroying it is not.
 *
 * ## Why POST for a read
 *
 * The plan called this GET. A GET would have to carry the signature and the
 * address in the query string, where they land in access logs, proxy caches and
 * `Referer` headers. A body is the only place a credential belongs, so the verb
 * follows the credential rather than the semantics.
 *
 * ## What comes back
 *
 * The PAN and the CVV, because the shopper has to type them into the súper's
 * form and there is no other way for them to arrive — the same payload
 * `POST /api/card` returns, built by the same helper, `no-store`, never logged.
 * They are fetched from Vyrion per request and held nowhere: that is what makes
 * the localStorage mirror safe to be only a hint.
 */
import { formatUsd } from '@changuito/mcp/pay';

import { canIssueCard, cardClient } from '../../../../lib/card.ts';
import { cardOf, hasDatabase, unbindCard } from '../../../../lib/db.ts';
import { DEFAULT_NETWORK, type NetworkId } from '../../../../lib/deployments.ts';
import { requireHuman } from '../../../../lib/human-gate.ts';
import { readLoggedInUser } from '../../../../lib/login-gate.ts';
import { networkAccess } from '../../../../lib/network-access.ts';
import { proofFromBody, verifyWalletProof } from '../../../../lib/wallet-proof-verify.ts';

import type { IssuedCard } from '../route.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function networkFrom(value: unknown): NetworkId {
  return value === 'mainnet' || value === 'testnet' ? value : DEFAULT_NETWORK;
}

export async function POST(req: Request): Promise<Response> {
  const gated = await requireHuman(req);
  if (gated) return gated;

  if (!canIssueCard()) return json({ error: 'las tarjetas no están habilitadas en este entorno' }, 503);

  // Without a database there are no persistent cards to read: lib/card.ts's
  // fallback keeps claims in a per-instance Map and deliberately never binds a
  // card to a wallet, because a binding that a restart forgets would let a
  // second card be minted for somebody who already has one.
  if (!hasDatabase()) return json({ error: 'las tarjetas guardadas no están habilitadas acá' }, 503);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'body must be JSON' }, 400);
  }
  const input = (body ?? {}) as { address?: unknown; network?: unknown };

  // See the header: the session wins over the body when there is one, and the
  // shape check here is the one `verifyUserToken` does not do.
  const session = await readLoggedInUser(req);
  const signedIn = session.ok && /^G[A-Z2-7]{55}$/.test(session.address) ? session.address : '';

  const claimed = typeof input.address === 'string' ? input.address.trim().toUpperCase() : '';
  const address = signedIn || claimed;
  if (!/^G[A-Z2-7]{55}$/.test(address)) return json({ error: 'dirección inválida' }, 400);
  const network = networkFrom(input.network);

  // Same gate the deposit route puts in front of a real network, and asked
  // before the credential is checked, so a wallet that may not use this
  // network learns that and nothing about whether it has a card here.
  if (!networkAccess(address, network).allowed) {
    return json({ error: 'Esta cuenta no tiene habilitado el modo real.' }, 403);
  }

  if (!signedIn) {
    const verdict = verifyWalletProof({
      intent: 'card',
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
              : 'Necesitamos que firmes con tu cuenta para mostrarte la tarjeta.',
        },
        401,
      );
    }
  }

  const cardId = await cardOf(network, address).catch(() => undefined);
  // Not an error: most wallets have never been issued one, and saying "no"
  // plainly is what lets the panel offer to create one.
  if (!cardId) return json({ card: null }, 200);

  const client = cardClient();
  try {
    const card = await client.getCard(cardId);
    if (card.status === 'terminated') {
      // The binding outlived the card. Drop it so the next deposit creates a
      // fresh one rather than trying to fund a card that cannot be funded.
      await unbindCard(network, address, cardId).catch(() => {});
      return json({ card: null }, 200);
    }
    const d = await client.cardDetails(cardId);
    const card_: IssuedCard = {
      cardId,
      last4: card.last4,
      brand: card.network,
      pan: d.pan,
      cvv: d.cvv,
      expiryMonth: d.expiry_month,
      expiryYear: d.expiry_year.slice(-2),
      holder: d.cardholder_name ?? 'CHANGUITO',
      // `balance`, not `spending_limit`. On a card the customer keeps the limit
      // is not set at all — see the note in POST /api/card about there being no
      // update-limit endpoint — so what is spendable is the balance, and it
      // moves with every shop. This is the number the panel should show.
      fundedDisplay: formatUsd(Math.round((card.balance ?? 0) * 100)),
    };
    return json({ card: card_, frozen: card.status === 'frozen' }, 200);
  } catch (err) {
    // Deliberately not the upstream message: a card API's errors can quote the
    // request back, and the request had a card in it.
    console.error('[card/mine] could not read the card:', err instanceof Error ? err.message : String(err));
    return json({ error: 'no pudimos leer tu tarjeta en este momento' }, 502);
  }
}

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, private' },
  });
}
