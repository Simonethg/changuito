'use client';

import { usePollar } from '@pollar/react';
import { useState } from 'react';

import { track, trackLoginStart } from '../lib/analytics';
import { PROFILE } from '../lib/profile-copy.ts';
import { shortAddress } from '../lib/pollar.ts';
import { forgetUserCookie } from '../lib/session-login.ts';
import { useBalances } from '../lib/use-balances.ts';
import { Modal } from './Modal';
import { ModeBadge } from './ModeBadge';
import { useNetwork } from './NetworkProvider';
import { Purchases } from './Purchases';

/**
 * Who you are here, and what you bought.
 *
 * Two tabs, and the split is between a fact and a record: General is the
 * account itself — the address, which mode it is in, what is on it, and the
 * way out — and Mis compras is the history that used to be its own page at
 * /mis-compras.
 *
 * ## Both tabs are mounted, one is hidden
 *
 * `hidden` rather than a conditional render, so switching back to Mis compras
 * does not re-run its read. The list is behind a button and the button is a
 * round trip; a tab strip that silently discarded the answer every time you
 * looked at your address would be a surprising amount of work for a person to
 * cause by accident.
 *
 * ## Logout lives here now
 *
 * The icon beside the balance keeps working and is unchanged. This one says
 * the words, because a dialog about the account is where somebody goes
 * looking for the way out of it, and an unlabelled icon is not findable by
 * somebody who is looking rather than glancing. Both do the same three
 * things: forget the cookie locally, tell the server, then drop the session.
 */
export function ProfileModal({ address, onClose }: { address: string | null; onClose: () => void }) {
  const [tab, setTab] = useState<'general' | 'orders'>('general');

  const strip = (
    <div className="profile-tabs" role="tablist" aria-label={PROFILE.title}>
      <button
        type="button"
        role="tab"
        id="profile-tab-general"
        aria-selected={tab === 'general'}
        aria-controls="profile-panel-general"
        className={tab === 'general' ? 'btn btn-sm' : 'btn btn-sm btn-ghost'}
        data-testid="profile-tab-general"
        onClick={() => setTab('general')}
      >
        {PROFILE.tabGeneral}
      </button>
      <button
        type="button"
        role="tab"
        id="profile-tab-orders"
        aria-selected={tab === 'orders'}
        aria-controls="profile-panel-orders"
        className={tab === 'orders' ? 'btn btn-sm' : 'btn btn-sm btn-ghost'}
        data-testid="profile-tab-orders"
        onClick={() => setTab('orders')}
      >
        {PROFILE.tabOrders}
      </button>
    </div>
  );

  return (
    <Modal title={PROFILE.title} onClose={onClose} className="modal-profile" testId="profile-modal" head={strip}>
      <div
        role="tabpanel"
        id="profile-panel-general"
        aria-labelledby="profile-tab-general"
        hidden={tab !== 'general'}
      >
        <General address={address} />
      </div>
      <div
        role="tabpanel"
        id="profile-panel-orders"
        aria-labelledby="profile-tab-orders"
        hidden={tab !== 'orders'}
      >
        <Purchases embedded />
      </div>
    </Modal>
  );
}

function General({ address }: { address: string | null }) {
  const { openLoginModal, logout } = usePollar();
  const { network } = useNetwork();
  const { data } = useBalances(address, network);

  // Signed out there is no account to describe, and an empty General tab
  // would read as a broken one. Same sentence and same crossing as the
  // masthead and the purchases list — one crossing, one wording.
  if (!address) {
    return (
      <div className="purchases-empty" data-testid="profile-guest">
        <h3 className="purchases-sub">{PROFILE.guestTitle}</h3>
        <p className="purchases-lead">{PROFILE.guestBody}</p>
        <button type="button" className="btn" onClick={() => trackLoginStart(openLoginModal)}>
          {PROFILE.guestAction}
        </button>
      </div>
    );
  }

  return (
    <div className="profile-general">
      <dl className="ck-fields">
        <div>
          <dt>{PROFILE.addressLabel}</dt>
          <dd className="mono" data-testid="profile-address" title={address}>
            {shortAddress(address)}
          </dd>
        </div>
        <div>
          <dt>{PROFILE.balanceLabel}</dt>
          <dd data-testid="profile-balance">{data ? data.usdcDisplay : '-'}</dd>
        </div>
      </dl>

      {/* The same badge the masthead draws, not a copy of it: contrast.test.ts
          sweeps globals.css for `.mode-badge` rules, and a second variant here
          would be a second thing to keep passing it. */}
      <ModeBadge network={network} />

      <button
        type="button"
        className="btn btn-ghost"
        data-testid="profile-logout"
        onClick={() => {
          track('logout');
          forgetUserCookie();
          void fetch('/api/session/logout', { method: 'POST', credentials: 'same-origin' }).finally(() => logout());
        }}
      >
        {PROFILE.logout}
      </button>
    </div>
  );
}
