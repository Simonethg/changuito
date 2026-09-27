/**
 * Give back a card that dies with the basket.
 *
 * ## The card this destroys, and the card it must not
 *
 * There are two kinds of card in this app and only one of them belongs to
 * this route. In preview a card is minted per memo, spent once and given back
 * — Vyrion returns any residual to the wallet the moment it dies, and a card
 * left alive is money sitting where nobody is watching it. So the dialog
 * calls this when the shopper says the order is done, when they say it
 * failed, and when they close the tab: the same `finally` shape
 * `ephemeral-card.ts` puts around every payment.
 *
 * In production the card is the customer's. One per wallet, topped up by each
 * deposit, carried between baskets — the whole promise of `keepsOneCard`. And
 * `claimDeposit` writes *that* card's id onto the order, so `heldCard` hands
 * it back here exactly like an ephemeral one. Called unguarded, this route
 * destroyed the kept card every time a checkout dialog closed.
 *
 * Hence `keepsOneCard`, asked before anything is looked up. **Termination of
 * a kept card is never a side effect of leaving a screen.** It is an act the
 * shopper takes deliberately, in the profile, and it costs a signature —
 * `POST /api/card/retire`.
 *
 * ## Why a failed termination freezes
 *
 * Terminating can fail, and what is left behind is a live card with money on
 * it that no part of this app will ever mention again. Freezing it is the
 * strictly better end state: the balance is still returned when somebody
 * terminates it by hand from the dashboard, and in the meantime it cannot be
 * spent. There is nothing to un-freeze it *for* — this card was being
 * destroyed — which is what makes the one-way door acceptable here and not on
 * a card the customer keeps.
 *
 * Safe to call twice, and answers the same way both times. "Already gone" is
 * the outcome the caller wanted, so it is not an error.
 */
import { canIssueCard, cardClient, depositorOf, heldCard, keepsOneCard } from '../../../../lib/card.ts';
import { isMemo } from '../../../../lib/deposit.ts';
import { DEFAULT_NETWORK, type NetworkId } from '../../../../lib/deployments.ts';
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
    return json({ error: 'body must be JSON' }, 400);
  }
  const input = (body ?? {}) as { memo?: unknown; network?: unknown };
  if (!isMemo(input.memo)) return json({ error: 'código inválido' }, 400);
  const network = networkFrom(input.network);

  if (!canIssueCard()) return json({ terminated: false }, 200);

  // Before the card id, because the answer does not depend on the card. The
  // three terms are `keepsOneCard`'s, asked here for the same reason they are
  // asked in `POST /api/card`: whichever branch minted this card is the
  // branch that decides whether it may be destroyed, and reading the two in
  // different ways is how they come to disagree.
  //
  // And it fails closed. A lookup that reached nothing is not the same fact
  // as "there is no owner", and collapsing the two would mean a database
  // blip destroying a card somebody keeps. Declining costs at most one
  // ephemeral card left alive for a few minutes — which the log below already
  // shouts about, and which the shopper can do nothing with, because its
  // memo is spent. The other direction does not come back.
  let owner: string | undefined;
  try {
    owner = await depositorOf(network, input.memo);
  } catch (err) {
    console.error(
      '[card] could not tell whose card this is, so it stays:',
      err instanceof Error ? err.message : String(err),
    );
    return json({ terminated: false, kept: true }, 200);
  }
  if (keepsOneCard(network, owner)) return json({ terminated: false, kept: true }, 200);

  const cardId = await heldCard(network, input.memo).catch(() => undefined);
  if (!cardId) return json({ terminated: false }, 200);

  const client = cardClient();
  try {
    await client.terminateCard(cardId);
    return json({ terminated: true }, 200);
  } catch (err) {
    // Worth shouting about in the server log: an un-terminated card still
    // holds money, and nothing else is going to notice.
    console.error(
      `[card] COULD NOT TERMINATE ${cardId} — terminate it by hand in the Vyrion dashboard:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  try {
    await client.freezeCard(cardId);
    return json({ terminated: false, frozen: true }, 200);
  } catch (err) {
    console.error(
      `[card] AND COULD NOT FREEZE ${cardId} — it is live with a balance on it:`,
      err instanceof Error ? err.message : String(err),
    );
    return json({ terminated: false }, 200);
  }
}

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}
