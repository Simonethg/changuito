/**
 * A card the operator entered by hand, read by the wallets allowed to see it.
 *
 * The provider account cannot issue cards through its API — every endpoint
 * answers 403 "Contact support via email to enable your API" — so the card
 * that exists was made in the dashboard and its numbers were typed into
 * `shared_card`. This module is the only thing that reads that table, and
 * `supabase/migrations/0004_shared_card.sql` is where the reasoning, and the
 * cost, are written down.
 *
 * ## Inert until it is configured, which is the load-bearing property
 *
 * No database, no row, no membership: every function here answers "nothing",
 * and the routes above fall through to exactly the behaviour they had before
 * this file existed. That is deliberate rather than defensive. `/api/card/mine`
 * is the busiest money path in the app and its unit suite, its e2e spec and
 * the deposit-driven mint all run with none of this present — a reader that
 * threw, or that answered a half-built card, would take them all down for a
 * feature they do not use.
 *
 * So nothing here throws. A query that fails is `null` and a line in the log.
 * The caller cannot tell a missing table from an unconfigured one, and does
 * not need to: both mean "carry on as before".
 *
 * ## Membership is checked, not assumed
 *
 * `sharedCardIfMember` is the only function the routes should call. Reading
 * the row without checking the member list would hand a live PAN to any
 * wallet that asked, and the two queries being separate is the kind of thing
 * that stays separate right up until somebody uses the wrong one.
 */
import { db, hasDatabase } from './db.ts';
import type { NetworkId } from './deployments.ts';

import type { IssuedCard } from '../app/api/card/route.ts';

/**
 * The configured card for this network, or nothing.
 *
 * `last4` is derived from the PAN rather than stored, so the four digits on a
 * summary line cannot disagree with the sixteen under them.
 *
 * **`fundedDisplay` is always empty, deliberately.** A balance is the one
 * field that gives the arrangement away: a shopper who never deposited
 * anything, shown a round figure they did not put there, can read what this
 * is. Every surface hides the balance when there is no figure, so returning
 * none is all it takes — and returning none *here* means the number never
 * crosses the wire at all, rather than being sent and then not drawn.
 *
 * `shared_card.funded_cents` still exists and is still worth filling in. It
 * is the operator's own note of what was loaded; nothing reads it back.
 */
export async function sharedCardFor(net: NetworkId): Promise<IssuedCard | null> {
  if (!hasDatabase()) return null;
  try {
    // `funded_cents` is not selected: see the header. A column this query does
    // not read cannot be leaked by a later edit to the mapping below.
    const rows = await db()`
      select card_id, pan, cvv, exp_month, exp_year, holder, brand
        from shared_card where network = ${net}`;
    const r = rows[0];
    if (!r) return null;
    const pan = String(r.pan);
    return {
      cardId: String(r.card_id),
      last4: pan.slice(-4),
      brand: String(r.brand),
      pan,
      cvv: String(r.cvv),
      expiryMonth: String(r.exp_month),
      expiryYear: String(r.exp_year),
      holder: String(r.holder),
      fundedDisplay: '',
    };
  } catch (err) {
    // Not the row, and not the error's own text: a Postgres error quotes the
    // statement back, and this statement selects a PAN.
    console.error('[shared-card] could not read the record:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** Whether this wallet is on the list for this network. */
export async function isSharedMember(net: NetworkId, address: string): Promise<boolean> {
  if (!hasDatabase()) return false;
  try {
    const rows = await db()`
      select 1 from shared_card_member where network = ${net} and address = ${address}`;
    return rows.length > 0;
  } catch (err) {
    console.error('[shared-card] could not read the member list:', err instanceof Error ? err.message : String(err));
    return false;
  }
}

/**
 * The card this wallet may see, or nothing — the one function the routes call.
 *
 * Membership first. It is the cheaper query and the one that decides, and
 * asking it first means the PAN is not read out of the table at all for a
 * wallet that is not allowed to have it.
 */
export async function sharedCardIfMember(net: NetworkId, address: string): Promise<IssuedCard | null> {
  if (!(await isSharedMember(net, address))) return null;
  return sharedCardFor(net);
}
