'use client';

import type { Cart } from '@changuito/mcp/types';

import type { Receipt } from '../lib/chat-store.ts';
import { INTL_LOCALE, type Lang } from '../lib/lang.ts';
import { RETAILER_NAMES } from '../lib/retailers.ts';
import { uiCopy } from '../lib/ui-copy.ts';
import { useLang } from './LangProvider';
import { useShop } from './ShopProvider';

/**
 * The basket, always on screen, on a wide window.
 *
 * It is a second view of the same data the CartCard in the thread shows, not
 * a second cart. The card is the record of what the basket was when the agent
 * reported it and stays where it was said; this is what it is *now*. On a
 * narrow window there is no room for both, and the card already scrolls into
 * view on its own, so the rail is wide-only — see globals.css.
 *
 * The mascot sits in the top-right corner, overlapping the panel's border.
 * `mascota-lleno` is the full-changuito pose and it has been in the brand
 * folder unused since the first drop.
 */
export function CartRail() {
  const copy = uiCopy(useLang()).rail;
  const shop = useShop();
  const cart = shop?.cart ?? null;
  const receipt = shop?.receipt ?? null;
  const store = receipt?.retailer ?? cart?.retailer ?? null;
  return (
    <aside className="rail rail-cart" aria-label={receipt ? copy.paidAria : copy.cartAria}>
      <div className={receipt ? 'rail-cart-panel is-paid' : 'rail-cart-panel'}>
        <img
          className="rail-mascot"
          src="/brand/mascota-lleno.png"
          alt=""
          aria-hidden="true"
          width={419}
          height={609}
        />
        <header className="rail-cart-head">
          <span className="rail-cart-title">{receipt ? copy.paidTitle : copy.cartTitle}</span>
          {store ? <span className="rail-cart-store">{RETAILER_NAMES[store] ?? store}</span> : null}
        </header>
        {receipt ? (
          <RailReceipt receipt={receipt} />
        ) : cart && cart.lines.length > 0 ? (
          <RailLines cart={cart} />
        ) : (
          <EmptyRail />
        )}
      </div>
    </aside>
  );
}

/**
 * What was bought, after it was bought — the thing the shopper comes back to
 * look at. It replaces the basket rather than sitting under it: once the order
 * is paid the live cart is a draft of something that already happened, and
 * showing both invites reading the wrong one.
 *
 * The amounts are the strings that were on screen at the time, not numbers
 * re-formatted now. A receipt that quietly re-prices itself is not a receipt.
 */
function RailReceipt({ receipt }: { receipt: Receipt }) {
  const lang = useLang();
  const copy = uiCopy(lang).rail;
  return (
    <>
      <p className="rail-cart-paid" data-testid="receipt-paid">
        <span className="rail-chip rail-chip-paid">{copy.paid}</span>
        <time dateTime={new Date(receipt.paidAt).toISOString()}>{paidOn(receipt.paidAt, lang)}</time>
      </p>
      <ul className="rail-cart-lines">
        {receipt.lines.map((l, i) => (
          // No stable id on a line of a finished order: it is frozen, so the
          // index cannot shift under React the way a live basket's would.
          <li key={i} className="rail-cart-line">
            <span className="rail-cart-qty">{l.quantity}×</span>
            <span className="rail-cart-name">{l.name}</span>
            <span className="rail-cart-amount">{l.lineTotal}</span>
          </li>
        ))}
      </ul>
      <footer className="rail-cart-foot">
        <div className="rail-cart-total">
          <span>{copy.total}</span>
          <strong>{receipt.total}</strong>
        </div>
        <p className="rail-cart-ref">{copy.ref(receipt.paidDisplay, receipt.orderId)}</p>
      </footer>
    </>
  );
}

function paidOn(at: number, lang: Lang): string {
  try {
    return new Intl.DateTimeFormat(INTL_LOCALE[lang], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      .format(new Date(at));
  } catch {
    return '';
  }
}

function EmptyRail() {
  return <p className="rail-cart-empty">{uiCopy(useLang()).rail.empty}</p>;
}

function RailLines({ cart }: { cart: Cart }) {
  const copy = uiCopy(useLang()).rail;
  const unavailable = cart.lines.filter((l) => !l.available).length;
  return (
    <>
      {/* The list is the scroller, not the panel: the total has to stay on
          screen under a long basket, the same way the composer does under a
          long thread. */}
      <ul className="rail-cart-lines">
        {cart.lines.map((l) => (
          <li key={l.index} className={l.available ? 'rail-cart-line' : 'rail-cart-line is-oos'}>
            <span className="rail-cart-qty">{l.quantity}×</span>
            <span className="rail-cart-name">{l.name}</span>
            <span className="rail-cart-amount">{l.lineTotal.display}</span>
          </li>
        ))}
      </ul>
      <footer className="rail-cart-foot">
        {unavailable > 0 ? (
          <p className="rail-cart-warn">
            {unavailable === 1 ? copy.oosOne : copy.oosMany(unavailable)}
          </p>
        ) : null}
        <div className="rail-cart-total">
          <span>{copy.total}</span>
          <strong>{cart.total.display}</strong>
        </div>
      </footer>
    </>
  );
}
