/**
 * What a cart looks like from outside it.
 *
 * The checkout runs in a cross-origin frame, so the app cannot read a single
 * thing about it: not the DOM, not the URL, not whether the order went
 * through. This is the way around that wall — VTEX's *public* orderForm
 * endpoint, read server-side, which answers a few narrow questions about the
 * cart id we already hold.
 *
 * ## What it can and cannot tell us, verified by hand on 2026-09-25
 *
 * Against `diaonline.supermercadosdia.com.ar`, with no cookies:
 *
 * - `loggedIn` is **always false for us**, and it is not a bug. It describes
 *   the session making the request, not the cart, and our request has no
 *   session. Anything keyed on it would be keyed on a constant.
 * - `clientProfileData` **does** persist on the cart and **is** readable
 *   anonymously. A brand-new orderForm returns `null`; once a profile is
 *   attached it comes back populated. That is the usable signal, and it is
 *   what `identified` reports.
 * - It came back **unmasked** — a full email, and the same document that the
 *   shopper typed. So the cart id is a stronger bearer credential than the
 *   "anyone can edit this basket" we already knew about: anyone holding it can
 *   read the shopper's name, email and DNI once they have logged in.
 *
 * Two rules fall out of that last point, and they are the reason this module
 * exists rather than the route calling `fetch` itself:
 *
 * 1. **The profile never leaves this function.** `identified` is a boolean. The
 *    object is read, tested for null, and dropped. Nothing returns it, logs it
 *    or stores it, so there is no path by which a DNI reaches our logs.
 * 2. **`identified` is a hint, never proof.** The same endpoint accepts an
 *    anonymous *write* of `clientProfileData` — it answered 200 to one. So it
 *    is good enough to decide which button to emphasise and not good enough to
 *    decide that someone paid. Payment is `looksPaid`, and even that is
 *    circumstantial; see below.
 *
 * A third thing, found by asking for a cart id that was never issued: VTEX
 * answers 200 and hands back an empty cart bearing that id. There is no such
 * thing as a 404 here, so "the store does not know this cart" is not an answer
 * this endpoint can give, and nothing may be inferred from a cart being empty
 * on its own.
 *
 * A fourth, checked 2026-09-27: **the endpoint is not section-filtered.** A
 * plain GET with no `?sections=` returns the whole document — `totalizers`,
 * `shippingData`, `paymentData`, `messages` and all — to a caller with no
 * session. That is what makes `payable`, `breakdown` and `slotChosen` below
 * readable at all, and it is why this file now parses the document with the
 * MCP package's own `payableTotal` / `classifyOrderForm` instead of picking
 * three fields out of it by hand. (On an empty cart those sections come back
 * empty rather than absent, so every reader here treats empty as "not yet".)
 */
import {
  classifyOrderForm,
  payableTotal,
  totalizerBreakdown,
  type CheckoutState,
  type VtexOrderForm,
} from '@changuito/mcp/orderform';

import { STOREFRONT_HOSTS } from './storefront.ts';

/** One totalizer line, as the store names it: Productos, Envío, Descuentos. */
export interface TotalLine {
  id: string;
  name: string;
  centavos: number;
}

export interface OrderFormState {
  /** A profile is attached to this cart. A hint about login, never the profile. */
  identified: boolean;
  /** Lines in the cart right now. */
  items: number;
  /** What the cart is worth right now, in centavos, as VTEX reports it. */
  value: number;
  /**
   * The signature of a finished checkout: the cart had items, it has none
   * now, and a profile is attached to it. VTEX empties an orderForm when its
   * order is placed, and it will not take an order without a profile.
   *
   * All three conditions are needed, and the third one was learned the hard
   * way. Asking VTEX for an orderForm id that **never existed** returns 200,
   * with that same id, zero items and a zero value — it materialises any
   * 32-hex string as a fresh empty cart. So "had items, has none" alone calls
   * a fabricated id paid. `clientProfileData` is what tells the two apart: a
   * cart nobody ever used has none.
   *
   * It is still circumstantial and the copy must not pretend otherwise. A
   * shopper who logged in and then emptied their own basket by hand produces
   * exactly this. It is checked because the alternative — writing a receipt
   * purely because a button was pressed — takes the browser's word for a
   * purchase, and this at least makes the store agree that something happened
   * to a cart that a real person had been using.
   */
  looksPaid: boolean;
  /**
   * Items plus envío plus descuentos, in centavos. **The number the súper will
   * actually charge**, which is not the number `value` used to be read for and
   * not the goods subtotal `Cart.total` carries.
   *
   * This is the whole reason the rest of the document is now read. The deposit
   * used to be quoted before a delivery slot existed, so the shipping line was
   * not in it and the FX buffer was quietly absorbing the difference.
   */
  payable: number;
  /**
   * `payable` split the way the store splits it, ready to print. Empty when
   * the store sent no totalizers — an empty cart, or one it has not priced
   * yet — in which case the caller shows the total alone rather than a table
   * with nothing in it.
   */
  breakdown: TotalLine[];
  /**
   * Every delivery group has a `selectedSla`: the shopper has chosen how this
   * arrives, so the shipping line is settled and `payable` will not move for
   * that reason. False while any group is unchosen **and** while the store has
   * told us nothing about delivery at all, because "we do not know" and "not
   * yet" lead to the same place: do not quote.
   */
  slotChosen: boolean;
  /**
   * Present only once the order exists. The one unambiguous success signal in
   * the document — unlike `looksPaid`, this is not circumstantial.
   */
  orderGroup: string | null;
  /**
   * Which section the store is waiting on, from the checkout classifier.
   * `null` when the document says nothing conclusive.
   *
   * **Only the state crosses out of this function** — never the verdict's
   * `why`, which embeds the orderGroup, and never its `problems`, which carry
   * store-authored message text and item names. `CheckoutState` is a closed
   * union of literals and cannot carry anything it was not built from.
   */
  state: CheckoutState | null;
}

/** How many items the cart had when we handed it over, so `looksPaid` has a before. */
export interface OrderFormProbe {
  retailer: string;
  orderFormId: string;
  itemsAtHandoff: number;
}

const ORDER_FORM_ID = /^[0-9a-f]{32}$/i;

/**
 * Reads the cart. Returns null rather than throwing for every failure — an
 * unknown retailer, a malformed id, a store that is down, a body that is not
 * the shape we expect. The caller's answer to all four is the same: keep
 * showing "Ya lo pagué" and let the shopper tell us, which is the path that
 * has to work anyway.
 */
export async function readOrderForm(
  probe: OrderFormProbe,
  fetchImpl: typeof fetch = fetch,
): Promise<OrderFormState | null> {
  const host = STOREFRONT_HOSTS[probe.retailer];
  if (!host || !ORDER_FORM_ID.test(probe.orderFormId)) return null;

  let body: unknown;
  try {
    const res = await fetchImpl(
      `https://${host}/api/checkout/pub/orderForm/${probe.orderFormId}`,
      {
        // No cookies, deliberately and unavoidably. Sending any would mean
        // holding a shopper's session, which is the thing this whole design
        // exists to avoid.
        headers: { accept: 'application/json' },
        cache: 'no-store',
      },
    );
    if (!res.ok) return null;
    body = await res.json();
  } catch {
    return null;
  }

  if (!body || typeof body !== 'object') return null;
  const form = body as Record<string, unknown>;

  const of = form as VtexOrderForm;

  // Read, test, drop. The profile object is never bound to a name that leaves
  // this scope — see rule 1 in the header.
  //
  // `clientProfileData?.email` and not `clientProfileData !== null`: VTEX
  // creates the profile object before it is filled in, the same way it creates
  // the address object, so the old check read an empty shell as a signed-in
  // shopper. The email is what `classifyOrderForm` keys its `profile` state on
  // and it is the field that actually appears at login.
  const identified = Boolean(
    form.clientProfileData &&
      typeof form.clientProfileData === 'object' &&
      typeof (form.clientProfileData as { email?: unknown }).email === 'string' &&
      (form.clientProfileData as { email: string }).email.length > 0,
  );
  const items = Array.isArray(form.items) ? form.items.length : 0;
  const value = typeof form.value === 'number' ? form.value : 0;

  const orderGroup = typeof form.orderGroup === 'string' && form.orderGroup ? form.orderGroup : null;
  const verdict = classifyOrderForm(of);

  // Every group chosen, and at least one group to choose. An absent
  // `logisticsInfo` is "the store has not said", which must not read as done —
  // quoting there is exactly the bug this change exists to fix.
  const groups = of.shippingData?.logisticsInfo ?? [];
  const slotChosen = groups.length > 0 && groups.every((g) => Boolean(g.selectedSla));

  return {
    identified,
    items,
    value,
    // An order that exists is proof. The three-part heuristic below stays as
    // the fallback for a store that does not hand `orderGroup` to a reader
    // with no session.
    looksPaid: orderGroup !== null || (probe.itemsAtHandoff > 0 && items === 0 && identified),
    payable: payableTotal(of),
    breakdown: totalizerBreakdown(of),
    slotChosen,
    orderGroup,
    state: verdict?.state ?? null,
  };
}

/** The cart id inside a handoff URL, or null if there is not one. */
export function orderFormIdFrom(handoffUrl: string): string | null {
  try {
    const id = new URL(handoffUrl).searchParams.get('orderFormId') ?? '';
    return ORDER_FORM_ID.test(id) ? id : null;
  } catch {
    return null;
  }
}
