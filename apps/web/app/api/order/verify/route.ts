/**
 * POST /api/order/verify — does the store agree that something happened?
 *
 * The checkout runs in a cross-origin frame, so when the shopper presses "Ya
 * lo pagué" the app has no way to check that from the browser: it cannot read
 * the frame's DOM, its URL, or anything else about it. This route is the
 * second opinion, taken server-side from VTEX's public orderForm endpoint.
 *
 * ## What it is worth, stated plainly
 *
 * It is **not** proof of payment, and no copy built on it may say that it is.
 * VTEX's public API does not expose an order to an unauthenticated reader; the
 * only thing it shows is the cart, and a paid cart is an empty cart. A shopper
 * who deleted their own items by hand produces exactly the same answer.
 *
 * What it does buy is that the store agrees the basket is closed. Without it,
 * a receipt would be written purely because a button was pressed — the app
 * taking the browser's word for a purchase, which is the one thing the whole
 * cross-origin design is trying not to do. So: the button is necessary, this
 * is corroboration, and `verified` says which of the two we got.
 *
 * `orderRef` is the exception to all of the above. It is derived from
 * `orderGroup`, which only exists once the order does, so when it is present
 * the store is not corroborating anything — it is telling us the order was
 * placed. Copy may say so in that case and only in that case.
 *
 * ## It now carries a money figure, which it deliberately did not before
 *
 * This route used to hand back no amount at all, on the grounds that a
 * verification endpoint has no business naming one. That changed because the
 * checkout was reordered: the shopper is quoted **after** they pick a delivery
 * slot, so the exact payable total — items plus envío plus descuentos — has to
 * come from here, read server-side, rather than from a figure the browser
 * hands up about itself.
 *
 * `payable` is the shopper's own cart total, read from the cart id they are
 * already holding, and it is the number they are about to be asked to approve.
 * It is not a payment, a balance, or anything about an account. What still
 * does not cross this boundary is the profile: no email, no name, no DNI, and
 * no verdict text — see `lib/order-check.ts` for which fields are dropped and
 * why.
 */
import { orderFormIdFrom, readOrderForm, type TotalLine } from '../../../../lib/order-check.ts';
import { requireHuman } from '../../../../lib/human-gate.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface VerifyResponse {
  /** The store agrees the cart is no longer payable. */
  verified: boolean;
  /** A profile is attached to the cart — a hint that the shopper logged in. */
  identified: boolean;
  /** Lines left in the cart. Zero, after a purchase. */
  items: number;
  /** True when we could not reach the store at all, as opposed to reaching it and disagreeing. */
  unknown: boolean;
  /** Items + envío + descuentos, in centavos. What the súper will charge. 0 when unknown. */
  payable: number;
  /** `payable` as the store breaks it down. Empty when it sent no totalizers. */
  breakdown: TotalLine[];
  /** The shopper has chosen a delivery for every group, so the envío line is settled. */
  slotChosen: boolean;
  /** The placed order's id at the store, once it exists. Real evidence, unlike `verified`. */
  orderRef: string | null;
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
  const input = (body ?? {}) as { retailer?: unknown; handoffUrl?: unknown; itemsAtHandoff?: unknown };

  const retailer = typeof input.retailer === 'string' ? input.retailer : '';
  const handoffUrl = typeof input.handoffUrl === 'string' ? input.handoffUrl : '';
  const itemsAtHandoff = Number(input.itemsAtHandoff);
  const orderFormId = orderFormIdFrom(handoffUrl);

  if (!retailer || !orderFormId || !Number.isInteger(itemsAtHandoff) || itemsAtHandoff < 0) {
    return Response.json({ error: 'pedido inválido' }, { status: 400 });
  }

  const state = await readOrderForm({ retailer, orderFormId, itemsAtHandoff });
  if (!state) {
    // Unreachable is not "unpaid". The shopper is the one who knows, and the
    // flow continues on their word — this only failed to corroborate it.
    const body: VerifyResponse = {
      verified: false,
      identified: false,
      items: itemsAtHandoff,
      unknown: true,
      payable: 0,
      breakdown: [],
      slotChosen: false,
      orderRef: null,
    };
    return Response.json(body);
  }

  const out: VerifyResponse = {
    verified: state.looksPaid,
    identified: state.identified,
    items: state.items,
    unknown: false,
    payable: state.payable,
    breakdown: state.breakdown,
    slotChosen: state.slotChosen,
    orderRef: orderRefFrom(state.orderGroup),
  };
  return Response.json(out);
}

/**
 * The store's own order id, from the order group.
 *
 * VTEX names an order `{orderGroup}-{seller index}`, and a single-seller store
 * only ever produces `-01`. All four storefronts here are single seller, and
 * the one real example we have — an order placed by hand on Día — was
 * `1664787669574-01`. **The suffix is inferred, not verified against the API**,
 * which cannot name an order to an unauthenticated caller at all.
 *
 * That is survivable because it is only ever used to build a link, and the
 * caller falls back to the orders list when this is null. A wrong suffix costs
 * one tap, not a wrong order.
 */
function orderRefFrom(orderGroup: string | null): string | null {
  return orderGroup ? `${orderGroup}-01` : null;
}
