'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

/**
 * The dialog chrome, once.
 *
 * Four dialogs in this app hand-rolled the same twenty lines — backdrop click,
 * Escape, a Tab trap, `role="dialog"` wired to its own heading — and the two
 * new ones would have made six. `ReceiveModal` says two call sites is not yet
 * a pattern, which was true when it was written; it is not true at six.
 *
 * `FaucetConfirm` is the version this is lifted from, because it is the only
 * one that traps Tab. Two things are fixed on the way across:
 *
 *  - **Focus really comes back.** FaucetConfirm's header promises the caller
 *    gets focus back on close and nothing in it does that; every caller has to
 *    remember a ref. Here the element that was focused at open is recorded and
 *    restored on unmount, so closing with Escape returns the keyboard to the
 *    button that opened the dialog rather than to the top of the document.
 *  - **The trap sees more than buttons.** A `button:not([disabled])` query was
 *    enough for a two-button confirm. These dialogs hold tabs, links and
 *    copyable fields, and a trap that cannot see them lets Tab escape to the
 *    page behind.
 *
 * The existing four are deliberately not migrated here. That is a refactor
 * with its own risk and it does not belong in a change about cards.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  title,
  onClose,
  className,
  testId,
  head,
  children,
}: {
  /** Rendered as the dialog's `<h2>` and wired to `aria-labelledby`. */
  title: string;
  onClose: () => void;
  /** Extra classes on the `.modal` box — `.modal-wide`, a per-dialog class. */
  className?: string;
  testId?: string;
  /** Anything that belongs beside the heading, such as a tab strip. */
  head?: ReactNode;
  children: ReactNode;
}) {
  const titleId = useId();
  const dialog = useRef<HTMLElement>(null);

  // Focus the first thing inside on open, and give it back on close. Recorded
  // before the move, because by the time the cleanup runs the opener may be
  // gone from the document and `document.activeElement` is the body.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !dialog.current) return;
      const focusable = dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE);
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
        className={className ? `modal ${className}` : 'modal'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={testId}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </header>
        {head}
        {children}
      </section>
    </div>
  );
}
