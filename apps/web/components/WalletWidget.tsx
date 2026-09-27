'use client';

import { usePollar } from '@pollar/react';
import { useEffect, useRef, useState } from 'react';

import { track, trackLoginStart } from '../lib/analytics';
import { GRANT_UNITS } from '../lib/faucet-policy.ts';
import { usdcAmount } from '../lib/faucet-copy.ts';
import { modeCopy, previewMasthead, trustlineCopy } from '../lib/mode-copy.ts';
import { pollarEnabled, shortAddress } from '../lib/pollar.ts';
import { ensureUserCookie, forgetUserCookie } from '../lib/session-login.ts';
import { usdcAsset } from '../lib/trustline.ts';
import type { FaucetProof } from '../lib/faucet-proof.ts';
import { useBalances } from '../lib/use-balances.ts';
import { useFaucetAccess } from '../lib/use-faucet-access.ts';
import { useWalletSigner } from '../lib/use-wallet-signer.ts';
import { signWalletProof } from '../lib/wallet-proof.ts';
import { uiCopy } from '../lib/ui-copy.ts';
import { useLang } from './LangProvider';
import { CardModal } from './CardModal';
import { FaucetConfirm } from './FaucetConfirm';
import { ModeBadge } from './ModeBadge';
import { OrdersModal } from './OrdersModal';
import { useNetwork } from './NetworkProvider';
import { ReceiveModal } from './ReceiveModal';

/**
 * The balance widget in the masthead.
 *
 * Two components rather than one with a conditional hook: the key is a build
 * constant, so `usePollar()` only ever runs inside a provider that exists.
 * The condition has to be *the same one* WalletProvider uses, or this mounts
 * a component that calls `usePollar()` with no provider above it. It asks
 * `pollarEnabled` — is there a wallet at all — and not which network we are
 * on, because the network follows the session and this is the thing the
 * session is started from.
 *
 * `NoWallet` is now only the misconfiguration: a build with no key, where
 * nobody can ever sign in. It is *not* what a signed-out visitor sees — that
 * is preview, it works, and it is handled in `ConnectedWallet` below.
 */
export function WalletWidget() {
  return pollarEnabled ? <ConnectedWallet /> : <NoWallet />;
}

function NoWallet() {
  // The title is for whoever deployed this, not for a shopper, so it stays in
  // one language: it names an environment variable and a file in the repo.
  const copy = uiCopy(useLang()).wallet;
  useEffect(() => {
    track('payment_view', { state: 'unconfigured' });
  }, []);
  return (
    <div className="wallet wallet-off" title="Falta NEXT_PUBLIC_POLLAR_API_KEY_MAINNET. Ver DEPLOY.md">
      <span className="wallet-label">{copy.label}</span>
      <span className="wallet-muted">{copy.unconfigured}</span>
    </div>
  );
}

function ConnectedWallet() {
  const { wallet, isAuthenticated, verified, openLoginModal, logout, setTrustline } = usePollar();
  const { network } = useNetwork();
  const sign = useWalletSigner();
  const address = isAuthenticated ? (wallet?.address ?? null) : null;
  const { data, loading, error, refresh } = useBalances(address, network);
  // Only testers on the server's allowlist get the faucet. Everyone else never
  // sees the button: the route would refuse them anyway. On a network with no
  // friendbot the answer is always no, so the button leaves by itself.
  const faucet = useFaucetAccess(address, network);
  const lang = useLang();
  const copy = uiCopy(lang).wallet;
  const mode = modeCopy(network, lang);
  const trustline = trustlineCopy(lang);
  const masthead = previewMasthead(lang);

  // There is no "put them back in the safe mode" correction any more, and
  // there must not be one. The mode is the session (lib/app-mode.ts), so
  // moving a signed-in visitor to testnet would contradict `ModeSync`, which
  // would move them straight back — a loop, on every render, forever. A
  // wallet that is signed in but not allowed on the real rail is refused by
  // `authorizeRealMode` at the moment it tries to pay, in words, which is
  // both later and honest.

  const [funding, setFunding] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const fundButton = useRef<HTMLButtonElement>(null);

  const closeConfirm = () => {
    setConfirming(false);
    // The dialog took focus from this button; keyboard users land back on it.
    requestAnimationFrame(() => fundButton.current?.focus());
  };

  const [receiving, setReceiving] = useState(false);
  const [showingCard, setShowingCard] = useState(false);
  const [showingOrders, setShowingOrders] = useState(false);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const receiveButton = useRef<HTMLButtonElement>(null);

  const closeReceive = () => {
    setReceiving(false);
    requestAnimationFrame(() => receiveButton.current?.focus());
  };

  /**
   * Opens the USDC line from the receive dialog.
   *
   * The same call PaymentModal makes, deliberately duplicated rather than
   * hoisted, because *when* is the whole difference: there it is the last step
   * before paying, here it is before the money is sent at all. A classic asset
   * cannot reach an account that has not opted in — the transfer fails after
   * the sender pressed send — so the one screen that hands out the address is
   * the right place to notice.
   *
   * `refresh()` is what clears the warning, not this function's return value:
   * the state comes back from the ledger, so a success that did not land
   * cannot make the dialog say the line is open.
   */
  async function openLine() {
    const asset = usdcAsset(network);
    if (!asset) return;
    setOpening(true);
    setOpenError(null);
    try {
      const outcome = await setTrustline(asset);
      if (outcome.status === 'error') throw new Error(outcome.details ?? trustline.failed);
      refresh();
    } catch (err) {
      track('payment_fail', { flow: 'receive', code: 'trustline' });
      setOpenError(err instanceof Error ? err.message : String(err));
    } finally {
      setOpening(false);
    }
  }

  // After Pollar login, set httpOnly chg_user so /api/chat skips the guest turn
  // limit. Shared with the chat, which awaits the same promise before it
  // re-sends a message the gate rejected — see lib/session-login.ts.
  const wasAuthed = useRef(isAuthenticated);
  useEffect(() => {
    if (!wasAuthed.current && isAuthenticated) track('login_success');
    wasAuthed.current = isAuthenticated;
  }, [isAuthenticated]);

  useEffect(() => {
    if (!address) return;
    track('payment_view', { state: 'ready' });
  }, [address]);

  useEffect(() => {
    if (!isAuthenticated || !address) return;
    let cancelled = false;
    void ensureUserCookie(address, sign).then((ok) => {
      if (!cancelled && !ok) track('login_fail', { code: 'session' });
    });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, address, sign]);


  async function fund() {
    if (!address) return;
    track('payment_start', { flow: 'faucet' });
    setFunding(true);
    setNote(null);
    try {
      // The address is only a claim. Both gated modes want the wallet to sign
      // for it (SEP-53), which Pollar does only for a live session. 'public'
      // waived the allowlist, not the signature — see lib/faucet-auth.ts.
      let proof: FaucetProof | undefined;
      if (faucet?.mode === 'allowlist' || faucet?.mode === 'public') {
        const signed = await signWalletProof(sign, 'faucet', address);
        if (!signed) throw new Error(copy.fundProofFailed);
        proof = signed;
      }
      const res = await fetch('/api/faucet', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address, proof, network }),
      });
      const json = await res.json();
      // 429 carries a real answer ("you already have enough"), not a failure.
      if (!res.ok && res.status !== 429) {
        throw new Error(json.message ?? json.error ?? `faucet failed (${res.status})`);
      }
      track('payment_success', { flow: 'faucet', code: res.status === 429 ? 'enough' : 'ok' });
      setNote(
        json.note ?? (json.created ? copy.funded : copy.fundedAmount(usdcAmount(GRANT_UNITS, lang))),
      );
      refresh();
    } catch (err) {
      track('payment_fail', { flow: 'faucet', code: 'error' });
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setFunding(false);
    }
  }

  // Preview: nobody is signed in, and that is a working state rather than a
  // waiting one. The badge is the same one the other mode gets, because the
  // qualifier on a number is the whole point of it — and the button is the
  // door out, labelled with what is on the far side. See PREVIEW_MASTHEAD.
  if (!address) {
    return (
      <div className="wallet">
        <ModeBadge network={network} />
        <span className="wallet-muted">{masthead.hint}</span>
        <button type="button" className="btn" onClick={() => trackLoginStart(openLoginModal)}>
          {masthead.action}
        </button>
      </div>
    );
  }

  return (
    <div className="wallet">
      <div className="wallet-head">
        <span className="wallet-label">{copy.label}</span>
        {/* It used to copy the address on click, silently: no confirmation,
            no way to see the whole thing, and nothing for somebody holding a
            phone. It opens the dialog that does all three. */}
        <button
          ref={receiveButton}
          type="button"
          className="wallet-addr"
          data-testid="wallet-receive"
          aria-haspopup="dialog"
          onClick={() => {
            setOpenError(null);
            setReceiving(true);
          }}
          title={copy.addressTitle(address)}
        >
          {shortAddress(address)}
        </button>
      </div>

      <div className="wallet-balance">
        <strong>{data ? data.usdcDisplay : '-'}</strong>
        {/* The qualifier is part of the number, not a footnote somewhere
            else: this is the line that says whether the money is real. */}
        <span className="wallet-unit">{mode.balanceUnit}</span>
        {loading && <span className="wallet-muted">{copy.refreshing}</span>}
      </div>

      <ModeBadge network={network} />

      <div className="wallet-sub">
        {/* No fee warning here. Pollar sponsors the fee — see the note on
            BalanceResponse — so a shopper holding 0 XLM is the normal, working
            state rather than something to act on. */}
        {!verified && <span className="wallet-muted">{copy.verifying}</span>}
      </div>

      {error && <p className="wallet-error">{error}</p>}
      {note && <p className="wallet-note">{note}</p>}

      <div className="wallet-actions">
        {faucet?.allowed ? (
          <button
            ref={fundButton}
            type="button"
            className="btn btn-sm"
            data-testid="wallet-fund"
            aria-haspopup="dialog"
            onClick={() => {
              setNote(null);
              setConfirming(true);
            }}
            disabled={funding || confirming}
          >
            {funding ? copy.funding : copy.fundCta}
          </button>
        ) : null}
        {/* The card, one press from the balance, because that is where
            somebody standing in the súper's payment form looks for it. What
            used to be here was a link to /mis-compras; the record moved into
            the profile, which is where a thing you consult belongs, and this
            is a thing you use.

            An icon and not a word: `.wallet-actions` is `flex-wrap: nowrap`
            and has to hold at phone width, so the row can afford a 44px box
            and not a fourth label. */}
        <button
          type="button"
          className="btn btn-ghost wallet-icon-btn"
          data-testid="wallet-card"
          aria-label={copy.cardAria}
          aria-haspopup="dialog"
          onClick={() => setShowingCard(true)}
        >
          <CardIcon />
        </button>
        {/* What was bought, which the rail beside the chat is not: that lists
            the conversations this browser kept, and this lists what was
            actually paid for, on any device.

            It replaced the refresh button, which is why `useBalances` polls
            now — see its header. A button whose whole job was "ask again"
            was asking the shopper to do the polling by hand, and it was
            occupying the one slot in this row that the record needed. */}
        <button
          type="button"
          className="btn btn-ghost wallet-icon-btn"
          data-testid="wallet-orders"
          aria-label={copy.purchasesAria}
          aria-haspopup="dialog"
          onClick={() => setShowingOrders(true)}
        >
          <BagIcon />
        </button>
        <button
          type="button"
          className="btn btn-ghost wallet-icon-btn"
          data-testid="wallet-logout"
          aria-label={copy.signOutAria}
          onClick={() => {
            track('logout');
            forgetUserCookie();
            void fetch('/api/session/logout', { method: 'POST', credentials: 'same-origin' }).finally(() => logout());
          }}
        >
          <LogoutIcon />
        </button>
      </div>

      {showingCard && address ? (
        <CardModal address={address} network={network} sign={sign} onClose={() => setShowingCard(false)} />
      ) : null}

      {showingOrders ? <OrdersModal onClose={() => setShowingOrders(false)} /> : null}

      {receiving ? (
        <ReceiveModal
          address={address}
          trustline={data?.trustline ?? 'not-needed'}
          enabling={opening}
          enableError={openError}
          onEnable={() => void openLine()}
          onClose={closeReceive}
        />
      ) : null}

      {confirming && faucet?.allowed ? (
        <FaucetConfirm
          balanceUnits={data ? BigInt(data.usdc) : null}
          onClose={closeConfirm}
          onConfirm={() => {
            closeConfirm();
            void fund();
          }}
        />
      ) : null}
    </div>
  );
}

/** Inline, like the ones below: one caller each. `icons.tsx` is for the shared ones. */
function BagIcon() {
  return (
    <svg className="wallet-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 8h16l-1.2 11.2a1.5 1.5 0 0 1-1.5 1.3H6.7a1.5 1.5 0 0 1-1.5-1.3Z" />
      <path d="M8.5 8V6.2a3.5 3.5 0 0 1 7 0V8" />
    </svg>
  );
}

function CardIcon() {
  return (
    <svg className="wallet-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <line x1="2.5" y1="10" x2="21.5" y2="10" />
      <line x1="6" y1="15" x2="10" y2="15" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg className="wallet-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
