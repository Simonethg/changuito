'use client';

import type { NetworkId } from '../lib/deployments.ts';
import { modeCopy } from '../lib/mode-copy.ts';
import { useLang } from './LangProvider';

/**
 * Modo prueba / modo real, stated rather than offered.
 *
 * This was a radiogroup with two positions. It is a label now, because the
 * mode stopped being a choice: it follows the Pollar session
 * (lib/app-mode.ts), so a control here could only ever disagree with who the
 * visitor is. A button that cannot change anything is worse than no button —
 * it invites a click and then explains itself.
 *
 * What had to survive the demotion is the *qualifier*. The whole honesty fix
 * in mode-copy.ts is that the word "de prueba" sits next to the number, not
 * in a footnote, so somebody looking at a balance knows whether it is money.
 * That is why this renders at all rather than the element simply going away.
 *
 * Still a wrapper div and not a bare element: the phone block in globals.css
 * branches on `.wallet:has(> .btn)` to tell the logged-out masthead from the
 * connected one, and a new direct child of `.wallet` flips that selector.
 */
export function ModeBadge({ network }: { network: NetworkId }) {
  const mode = modeCopy(network, useLang());
  return (
    <div className="wallet-mode">
      <span className="mode-badge" data-mode={network} data-testid="mode-badge">
        {/* One label at two widths; CSS hides one. Both are aria-hidden and
            the span carries the name, so hiding either never costs it. */}
        <span className="mode-long" aria-hidden="true">
          {mode.label}
        </span>
        <span className="mode-short" aria-hidden="true">
          {mode.short}
        </span>
        <span className="sr-only">{mode.label}</span>
      </span>
    </div>
  );
}
