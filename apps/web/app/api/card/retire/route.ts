/**
 * Give back the card you keep.
 *
 * The other half of `POST /api/card/terminate`, and the reason that route can
 * refuse a kept card at all: destroying the customer's card stops being a
 * side effect of closing a dialog and becomes a thing they ask for, once, on
 * the profile. Vyrion returns any residual balance to the wallet as it dies,
 * so this is how somebody gets their change back and walks away.
 *
 * ## Why this is not `terminate` with a flag
 *
 * `terminate` is keyed by a memo and takes no signature — a checkout dialog
 * closing during an unload has neither an address nor time to ask for one,
 * and it needs neither, because the worst it can do is destroy a card that
 * was minted for that one basket and is about to be abandoned.
 *
 * None of that is true here. The card is days old, the request comes from a
 * device that never paid for it, and it is irreversible. So this route is
 * shaped like `POST /api/card/mine` instead: the address and a fresh SEP-53
 * signature, and **the card id is never an input** — the server looks up
 * which card the proven wallet owns. There is nowhere to put a guessed id.
 *
 * The intent is `retire`, not `card`. Somebody who approved *"ver los datos
 * de mi tarjeta"* did not agree to destroy it, and a signature is only worth
 * asking for if it cannot be spent on something else — the same argument
 * `GET`-shaped `orders` makes against reusing `card`.
 *
 * ## Order of operations
 *
 * Vyrion first, the binding second. A termination that succeeded and a
 * binding that did not is already handled and needs no compensation here:
 * `POST /api/card/mine` reads the card back, sees `terminated`, and drops the
 * row itself. The reverse — unbinding a card that is still alive — would
 * strand a live card with money on it that nothing in this app can name
 * again, so it is the ordering that is load-bearing, not the error handling.
 */
import { canIssueCard, cardClient } from '../../../../lib/card.ts';
import { cardOf, hasDatabase, unbindCard } from '../../../../lib/db.ts';
import { DEFAULT_NETWORK, type NetworkId } from '../../../../lib/deployments.ts';
import { requireHuman } from '../../../../lib/human-gate.ts';
import { networkAccess } from '../../../../lib/network-access.ts';
import { isSharedMember } from '../../../../lib/shared-card.ts';
import { proofFromBody, verifyWalletProof } from '../../../../lib/wallet-proof-verify.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function networkFrom(value: unknown): NetworkId {
  return value === 'mainnet' || value === 'testnet' ? value : DEFAULT_NETWORK;
}

export async function POST(req: Request): Promise<Response> {
  const gated = await requireHuman(req);
  if (gated) return gated;

  if (!canIssueCard()) return json({ error: 'las tarjetas no están habilitadas en este entorno' }, 503);
  // Same 503 as `card/mine`, and the same reason: with no database nothing is
  // bound to a wallet, so there is no kept card here to give back.
  if (!hasDatabase()) return json({ error: 'las tarjetas guardadas no están habilitadas acá' }, 503);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'body must be JSON' }, 400);
  }
  const input = (body ?? {}) as { address?: unknown; network?: unknown };

  const address = typeof input.address === 'string' ? input.address.trim().toUpperCase() : '';
  if (!/^G[A-Z2-7]{55}$/.test(address)) return json({ error: 'dirección inválida' }, 400);
  const network = networkFrom(input.network);

  // Before the proof, so a wallet that may not use this network learns that
  // and nothing about whether it has a card here.
  if (!networkAccess(address, network).allowed) {
    return json({ error: 'Esta cuenta no tiene habilitado el modo real.' }, 403);
  }

  const verdict = verifyWalletProof({
    intent: 'retire',
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
            : 'Necesitamos que firmes con tu cuenta para dar de baja la tarjeta.',
      },
      401,
    );
  }

  // A hand-entered record is not this wallet's to destroy. Everyone on the
  // member list reads the same card, so one person pressing "dar de baja"
  // would take it away from all of them and there is no way to put it back —
  // `terminateCard` is final and the replacement has to be made by hand in the
  // provider's dashboard.
  //
  // The dialog hides the button for these, which is where the shopper meets
  // this. This is the part that actually enforces it: a hidden button is a
  // layout decision and anybody can POST.
  //
  // Below the proof rather than above it, so the refusals this route already
  // makes still come in the order they came in, and so nothing about who is on
  // the list leaks to a caller who has not proved their address.
  if (await isSharedMember(network, address)) {
    return json({ error: 'esta tarjeta no se puede dar de baja desde acá' }, 403);
  }

  const cardId = await cardOf(network, address).catch(() => undefined);
  // Nothing to give back is the outcome the caller wanted, so it is a 200 and
  // not a 404 — and pressing the button twice reads the same both times.
  if (!cardId) return json({ retired: false, card: null }, 200);

  try {
    await cardClient().terminateCard(cardId);
  } catch (err) {
    console.error(
      `[card/retire] could not terminate ${cardId}:`,
      err instanceof Error ? err.message : String(err),
    );
    // The binding stays. It points at a card that is still alive, which is
    // the true state of the world, and the shopper can press again.
    return json({ error: 'no pudimos dar de baja tu tarjeta ahora' }, 502);
  }

  await unbindCard(network, address, cardId).catch((err) => {
    // Not fatal, and not silent: `card/mine` heals this on the next read, but
    // until somebody looks the row claims a card that no longer exists.
    console.error(
      `[card/retire] terminated ${cardId} but could not unbind it:`,
      err instanceof Error ? err.message : String(err),
    );
  });

  return json({ retired: true, card: null }, 200);
}

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, private' },
  });
}
