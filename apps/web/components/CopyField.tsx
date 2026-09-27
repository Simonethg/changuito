'use client';

import { useState } from 'react';

import { uiCopy } from '../lib/ui-copy.ts';
import { useLang } from './LangProvider';

/**
 * A label, a value the shopper has to retype somewhere else, and a button that
 * saves them from retyping it.
 *
 * Its own module because both halves of the checkout dialog need it — the
 * deposit step for the address and the código, the card panel for the número
 * and the CVV — and importing one from the other would make a cycle out of a
 * twenty-line component.
 *
 * The copy state lives here rather than in either parent: "Copiado" is about
 * this field and nothing else, and hoisting it produced a parent that had to
 * remember which of five fields was briefly green.
 */
export function CopyField({
  label,
  value,
  /** What actually reaches the clipboard, when that is not what is shown —
   *  a PAN is displayed in groups of four and pasted without them. */
  copyValue,
  testid,
  mono,
}: {
  label: string;
  value: string;
  copyValue?: string;
  testid: string;
  mono?: boolean;
}) {
  const copy = uiCopy(useLang()).field;
  const [copied, setCopied] = useState(false);

  async function run() {
    try {
      await navigator.clipboard.writeText(copyValue ?? value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    } catch {
      // Clipboard access is a permission some browsers withhold, and in an
      // insecure context it does not exist at all. The value is on screen and
      // selectable, so there is nothing to recover from.
    }
  }

  return (
    <div className="ck-field">
      <dt>{label}</dt>
      <dd>
        <span className={mono ? 'ck-value ck-mono' : 'ck-value'} data-testid={testid}>
          {value}
        </span>
        <button
          type="button"
          className="ck-copy"
          onClick={() => void run()}
          aria-label={copy.copyAria(label.toLowerCase())}
        >
          {copied ? copy.copied : copy.copy}
        </button>
      </dd>
    </div>
  );
}
