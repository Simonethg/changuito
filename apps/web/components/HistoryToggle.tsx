'use client';

import { uiCopy } from '../lib/ui-copy.ts';
import { useLang } from './LangProvider';
import { useShop } from './ShopProvider';

/**
 * Opens the history drawer. Lives in the masthead, beside the brand.
 *
 * It used to be `position: fixed` in the top-left corner, which put a 44px
 * button exactly on top of the brand mark at every width below the wide
 * breakpoint — measured at 390px and 768px, both a direct overlap. A floating
 * handle also has nowhere to go that the composer, the footer or the dev
 * overlay do not already occupy. In the masthead it is in the flow, it moves
 * with the 560px block, and it is the first thing after the skip link in tab
 * order, which is where a navigation control belongs.
 *
 * The name is "Tus conversaciones" and not "Tus compras", which is what it
 * said until the profile landed. This drawer lists the chats *this browser*
 * kept; Mis compras is a tab in the profile a few pixels away listing what
 * was actually bought, on any device. One accessible name for the two of them
 * was a promise the drawer could not keep.
 *
 * Hidden at the wide breakpoint: there the rail is a permanent column, and a
 * button that opens what is already open is a dead end.
 */
export function HistoryToggle() {
  const shop = useShop();
  // Null outside the provider — app/dev/ui renders the chrome without one.
  if (!shop) return null;
  return (
    <button
      type="button"
      className="btn btn-ghost deck-drawer-toggle"
      data-testid="open-history"
      aria-label={uiCopy(useLang()).history.toggleAria}
      aria-expanded={shop.historyOpen}
      onClick={() => shop.setHistoryOpen(true)}
    >
      <HistoryIcon />
    </button>
  );
}

function HistoryIcon() {
  return (
    <svg className="wallet-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}
