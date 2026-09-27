/**
 * POST /api/order/done — the shopper has their groceries.
 *
 * The last thing that happens to an order, and the only one the browser is
 * trusted to decide. `CheckoutModal`'s `settle()` already files a receipt at
 * exactly this moment; before this route that receipt lived only in
 * localStorage, so the purchases list — which reads the database — went on listing
 * a finished shop as in flight for ever.
 *
 * ## Why no signature
 *
 * Every other route that takes a memo either moves money or hands back
 * something a stranger would want: `POST /api/card` mints a funded card,
 * `POST /api/orders` lists what somebody buys. This one sets a status. It
 * cannot mark an order paid — `markDone` only moves `paid`/`carded` → `done`
 * and no code path anywhere lets a request choose a status — so the worst a
 * caller who guessed a memo achieves is closing a shop that was already over.
 *
 * Asking for a wallet signature here would cost more than it buys, and not in
 * comfort: a proof lives five minutes, this fires after a checkout that can
 * take longer than that, and the failure mode would be a wallet prompt on top
 * of a receipt. The memo carries what protection is warranted — `mintMemo`
 * draws from the CSPRNG — and `requireHuman` keeps the route off the open
 * internet, the same two things `POST /api/card` relies on for a much larger
 * effect.
 *
 * ## Why preview gets a 200
 *
 * There is no row. Preview never writes to Postgres (lib/app-mode.ts), so
 * "closed" and "there was never anything to close" are the same state, and
 * the browser calls this in both modes because `settle()` does not know which
 * one it is in — nor should it. An error here would be reporting a failure
 * that did not happen, on a request nothing is waiting for.
 */
import { modeKeepsRecords } from '../../../../lib/app-mode.ts';
import { hasDatabase, markDone } from '../../../../lib/db.ts';
import { DEFAULT_NETWORK, type NetworkId } from '../../../../lib/deployments.ts';
import { isMemo } from '../../../../lib/deposit.ts';
import { requireHuman } from '../../../../lib/human-gate.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function networkFrom(value: unknown): NetworkId {
  return value === 'mainnet' || value === 'testnet' ? value : DEFAULT_NETWORK;
}

export async function POST(req: Request): Promise<Response> {
  const gated = await requireHuman(req);
  if (gated) return gated;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'body must be JSON' }, { status: 400 });
  }
  const input = (body ?? {}) as { memo?: unknown; network?: unknown };

  if (!isMemo(input.memo)) return Response.json({ error: 'código inválido' }, { status: 400 });
  const network = networkFrom(input.network);
  const memo = input.memo;

  // Both terms, out loud, the same way `keepsOneCard` asks them. `hasDatabase`
  // alone would write a preview order into a deployment that happens to have
  // DATABASE_URL set, which is every deployment.
  if (!modeKeepsRecords(network) || !hasDatabase()) return ok();

  try {
    const closed = await markDone(network, memo);
    // Not an error and not reported as one: the usual cause is a second press
    // of the same button, and the next-most-usual is an order whose row was
    // never opened because the database was down at quote time.
    if (!closed) console.warn(`[order/done] ${network}:${memo} closed nothing`);
  } catch (err) {
    console.error('[order/done] could not close it:', err instanceof Error ? err.message : String(err));
    return Response.json({ error: 'no pudimos cerrar la compra' }, { status: 502 });
  }
  return ok();
}

/**
 * The same answer whether a row closed, stayed shut or never existed. Telling
 * the caller which would turn this into an oracle for "is this a real memo",
 * and the caller has no use for the distinction — `settle()` does not read it.
 */
function ok(): Response {
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
