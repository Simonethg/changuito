'use client';

import { useEffect, useId, useRef } from 'react';

import { faucetConfirmCopy } from '../lib/faucet-copy.ts';
import { useLang } from './LangProvider';

/**
 * Asks before the faucet mints.
 *
 * A real dialog rather than `window.confirm`: that one is English chrome on
 * some browsers, cannot be styled to the brand, and iOS in-app browsers
 * sometimes suppress it — which would silently turn the button back into a
 * one-tap mint.
 *
 * Focus goes to the primary action on open, Tab stays inside, Escape and the
 * backdrop cancel, and the caller gets focus back on close.
 */
export function FaucetConfirm({
  balanceUnits,
  onConfirm,
  onClose,
}: {
  /** Current demo USDC, or null when the balance has not been read. */
  balanceUnits: bigint | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const copy = faucetConfirmCopy(balanceUnits, useLang());
  const titleId = useId();
  const bodyId = useId();
  const dialog = useRef<HTMLElement>(null);
  const primary = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    primary.current?.focus();
  }, []);

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
        className="modal faucet-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        data-testid="faucet-confirm"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2 id={titleId}>{copy.title}</h2>
        </header>
        <p id={bodyId} className="pay-note">
          {copy.body}
        </p>
        <div className="modal-actions">
          {copy.confirm ? (
            <button
              ref={primary}
              type="button"
              className="btn"
              data-testid="faucet-confirm-ok"
              onClick={onConfirm}
            >
              {copy.confirm}
            </button>
          ) : null}
          <button
            ref={copy.confirm ? undefined : primary}
            type="button"
            className="btn btn-ghost"
            data-testid="faucet-confirm-cancel"
            onClick={onClose}
          >
            {copy.dismiss}
          </button>
        </div>
      </section>
    </div>
  );
}
