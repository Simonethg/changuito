'use client';

import type { IssuedCard } from '../app/api/card/route.ts';
import { CopyField } from './CopyField';

/**
 * The three fields a shopper copies into the súper's form.
 *
 * Lifted out of `CardPanel` because three surfaces now show the same card —
 * checkout, the card dialog in the balance section, and the profile — and
 * three hand-written copies of "which field is monospace, which one strips its
 * spaces for the clipboard" is three chances to get the PAN subtly wrong.
 *
 * **The testids are props, not constants.** `e2e/app-frame-checkout.spec.ts`
 * drives checkout by `checkout-card-pan` / `-expiry` / `-cvv`, and two dialogs
 * on one page answering to the same id would make that selector ambiguous the
 * first time both are open. Each caller names its own.
 *
 * Nothing here persists. The card arrives as a prop, lives in the caller's
 * state while its dialog is open, and goes with the unmount — `card-store.ts`
 * has an allow-list so four digits and an id are the most that can outlive it.
 */
export function CardFace({
  card,
  labels,
  idPrefix,
}: {
  card: Pick<IssuedCard, 'pan' | 'cvv' | 'expiryMonth' | 'expiryYear'>;
  labels: { number: string; expiry: string; cvv: string };
  /** `checkout-card` → `checkout-card-pan`, and so on. */
  idPrefix: string;
}) {
  return (
    <dl className="ck-fields">
      <CopyField
        label={labels.number}
        // Grouped to be read off a screen and typed into a form; the
        // clipboard gets the digits, because most forms reject the spaces.
        value={groups(card.pan)}
        copyValue={card.pan}
        testid={`${idPrefix}-pan`}
        mono
      />
      <CopyField
        label={labels.expiry}
        value={`${card.expiryMonth}/${card.expiryYear}`}
        testid={`${idPrefix}-expiry`}
        mono
      />
      <CopyField label={labels.cvv} value={card.cvv} testid={`${idPrefix}-cvv`} mono />
    </dl>
  );
}

function groups(pan: string): string {
  return pan.replace(/\D/g, '').replace(/(.{4})/g, '$1 ').trim();
}
