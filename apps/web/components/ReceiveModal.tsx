'use client';

import { useEffect, useId, useRef } from 'react';

import { receiveCopy, trustlineCopy } from '../lib/mode-copy.ts';
import { useLang } from './LangProvider';
import { qrPicture } from '../lib/qr.ts';
import type { TrustlineState } from '../lib/trustline.ts';
import { CopyField } from './CopyField';

/**
 * Where a shopper gets their own address, so somebody can send money to it.
 *
 * Both halves matter and they are for two different people in the same person.
 * The QR is for the one holding a phone with Lemon open, who would otherwise
 * type fifty-six base32 characters into a withdrawal form. The text is for the
 * one on a laptop, who cannot photograph their own screen — and it is the
 * **whole** address, not `GDVS…NEZK`, because a truncated address is a thing
 * you can read and not a thing you can use.
 *
 * The QR encodes the bare address and nothing else. A SEP-7 `web+stellar:`
 * URI carries more — the asset, an amount — and is understood by Stellar
 * wallets, but the scanner this is actually pointed at belongs to an exchange's
 * withdrawal form, which wants a destination and would paste the scheme and
 * the query string into it as if they were part of the account. Bare also means
 * the code and the text below it are the same value, so there is one thing to
 * be right about rather than two.
 *
 * Presentational, like FaucetConfirm: the trustline is opened by a signature
 * from `usePollar()`, and the caller owns that. This gets the state and a
 * callback.
 */
export function ReceiveModal({
  address,
  trustline,
  enabling,
  enableError,
  onEnable,
  onClose,
}: {
  address: string;
  /** From the balance read. `needed` means a transfer would bounce — see lib/trustline.ts. */
  trustline: TrustlineState;
  enabling: boolean;
  enableError: string | null;
  onEnable: () => void;
  onClose: () => void;
}) {
  const lang = useLang();
  const receive = receiveCopy(lang);
  // `trustline` is the prop above, so the copy for it needs a different name.
  const tl = trustlineCopy(lang);
  const titleId = useId();
  const leadId = useId();
  const dialog = useRef<HTMLElement>(null);
  const primary = useRef<HTMLButtonElement>(null);

  const needsTrustline = trustline === 'needed';
  const qr = qrPicture(address);

  useEffect(() => {
    primary.current?.focus();
  }, []);

  // Same trap as FaucetConfirm, for the same reasons. Kept as a copy rather
  // than hoisted: two call sites is not yet a pattern, and the day this needs
  // to differ is the day a shared one gets a flag.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !dialog.current) return;
      const focusable = dialog.current.querySelectorAll<HTMLElement>('button:not([disabled])');
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        ref={dialog}
        className="modal receive-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={leadId}
        data-testid="receive-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2 id={titleId}>{receive.title}</h2>
        </header>

        <p id={leadId} className="pay-note">
          {receive.lead}
        </p>

        {/* A white plate under the code regardless of the page's theme: a QR is
            dark-on-light by definition, and inverting it stops it scanning. */}
        <div className="receive-qr">
          <svg
            viewBox={`0 0 ${qr.size} ${qr.size}`}
            role="img"
            aria-label={receive.qrAlt}
            data-testid="receive-qr"
            shapeRendering="crispEdges"
          >
            <rect width={qr.size} height={qr.size} fill="#fff" />
            <path d={qr.d} fill="#000" />
          </svg>
        </div>

        <dl className="ck-fields">
          <CopyField label={receive.addressLabel} value={address} testid="receive-address" mono />
        </dl>

        <ul className="receive-facts">
          {receive.facts.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>

        <p className="pay-warn">{receive.warn}</p>

        {/* The other way this arrives as nothing, and the only one we can fix
            from here. PaymentModal opens the line too, but at pay time — which
            is after the money was supposed to have landed. */}
        {needsTrustline ? (
          <div className="pay-step">
            <strong>{tl.title}</strong>
            <p>{tl.body}</p>
            {enableError ? <p className="pay-error">{tl.failed}</p> : null}
          </div>
        ) : null}

        <div className="modal-actions">
          {needsTrustline ? (
            <button
              ref={primary}
              type="button"
              className="btn"
              data-testid="receive-trustline"
              onClick={onEnable}
              disabled={enabling}
            >
              {enabling ? tl.working : tl.action}
            </button>
          ) : null}
          <button
            ref={needsTrustline ? undefined : primary}
            type="button"
            className="btn btn-ghost"
            data-testid="receive-close"
            onClick={onClose}
          >
            {receive.dismiss}
          </button>
        </div>
      </section>
    </div>
  );
}
