/**
 * POST /api/card — HTTP for `issueCard`.
 *
 * The PAN and the CVV ride on the response because the shopper has to type
 * them into the súper's form. They are `no-store`. The issuance, the ledger
 * read and the once-only claim live in `lib/pay/issue-card.ts`.
 */
import { requireHuman } from '../../../lib/human-gate.ts';
import { issueCard, type IssuedCard } from '../../../lib/pay/issue-card.ts';

export type { IssuedCard };

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const gated = await requireHuman(req);
  if (gated) return gated;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'body must be JSON' }, 400);
  }

  const result = await issueCard(body);
  return json(result.body, result.status);
}

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    // Not a cache, not a proxy, not a back button.
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, private' },
  });
}
