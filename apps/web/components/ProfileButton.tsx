'use client';

import { usePollar } from '@pollar/react';
import { useState } from 'react';

import { pollarEnabled } from '../lib/pollar.ts';
import { PROFILE } from '../lib/profile-copy.ts';
import { ProfileModal } from './ProfileModal';

/**
 * The way into the account, in the masthead beside the wordmark.
 *
 * In the flow and not `position: fixed`, for the reason HistoryToggle's header
 * records at length: a fixed 44px button in the top-left corner lands exactly
 * on the brand mark at every width below the wide breakpoint. `.brand` is a
 * flex row with a 10px gap and the wordmark already shrinks at narrow widths,
 * so two icon buttons fit beside it.
 *
 * It comes after `<HistoryToggle />` because a keyboard should reach the way
 * into the conversation before the way into the account — the conversation is
 * what the page is for.
 *
 * `aria-label` is "Tu cuenta", and HistoryToggle's was renamed to "Tus
 * conversaciones" in the same change. It used to say "Tus compras", which is
 * now the name of a tab *inside this dialog*: two controls a few pixels apart
 * with one accessible name, pointing at different things, is exactly the bug
 * a profile is supposed to fix.
 *
 * The provider split is WalletWidget's, for WalletWidget's reason: the key is
 * a build constant, so `usePollar()` only ever runs under a provider that
 * exists and hook order cannot change under it. With no key nobody can ever
 * sign in, so there is no account and no button.
 */
export function ProfileButton() {
  return pollarEnabled ? <WithWallet /> : null;
}

function WithWallet() {
  const { wallet, isAuthenticated } = usePollar();
  const [open, setOpen] = useState(false);
  const address = isAuthenticated ? (wallet?.address ?? null) : null;

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost wallet-icon-btn"
        data-testid="open-profile"
        aria-label={PROFILE.title}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <ProfileIcon />
      </button>
      {open ? <ProfileModal address={address} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/**
 * Inline rather than in `icons.tsx`, which is the local convention for an icon
 * with one caller — `RefreshIcon` and `LogoutIcon` sit in WalletWidget.tsx and
 * `HistoryIcon` in HistoryToggle.tsx. `icons.tsx` is for the ones shared.
 */
function ProfileIcon() {
  return (
    <svg className="wallet-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5" />
    </svg>
  );
}
