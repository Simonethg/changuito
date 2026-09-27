'use client';

import { useState } from 'react';

import type { SettleResponse } from '../app/api/settle/route.ts';
import { modeCopy } from '../lib/mode-copy.ts';
import type { OpenedOrder, SettleAction } from '../lib/order.ts';
import { explorer, formatUsdc } from '../lib/stellar.ts';
import { uiCopy } from '../lib/ui-copy.ts';
import { signWalletProof, type WalletSigner } from '../lib/wallet-proof.ts';
import { useLang } from './LangProvider';

/**
 * Steps 5 and 6: the money is locked, and this is what closes it out.
 *
 * It sits below the thread rather than in a modal on purpose — the user has to
 * leave the page to finish the basket at the store, and a dialog they must
 * dismiss to do that is a dialog they will dismiss and then not find again.
 */
// onDismiss is optional: a server-rendered page cannot pass a function prop,
// and the fixtures page mounts this panel without one.
// `sign` is the buyer's wallet. Closing an order needs its signature: the
// server will not move an escrow on anyone else's say-so.
export function OrderPanel({
  order,
  onDismiss,
  sign,
}: {
  order: OpenedOrder;
  onDismiss?: () => void;
  sign?: WalletSigner;
}) {
  const [closing, setClosing] = useState<SettleAction | null>(null);
  const [outcome, setOutcome] = useState<SettleResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const amount = formatUsdc(BigInt(order.amountUnits));
  // The order's own chain, not whatever the toggle says now. Everything here
  // — the settle, the refund, both explorer links — has to name the one the
  // money is actually on.
  const net = order.network;
  const lang = useLang();
  const copy = uiCopy(lang).order;
  const mode = modeCopy(net, lang);

  async function close(action: SettleAction) {
    setClosing(action);
    setError(null);
    try {
      const proof = sign ? await signWalletProof(sign, action, order.buyer, order.orderId) : null;
      if (!proof) throw new Error(copy.proofFailed);
      const res = await fetch('/api/settle', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action,
          orderId: order.orderId,
          basketHash: order.basketHash,
          address: order.buyer,
          network: net,
          proof,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? json.error ?? `settle failed (${res.status})`);
      setOutcome(json as SettleResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setClosing(null);
    }
  }

  if (outcome) {
    const settled = outcome.action === 'settle';
    return (
      <section className={settled ? 'order-panel is-done' : 'order-panel'} aria-live="polite">
        <header className="order-head">
          <strong>{settled ? copy.settled : copy.refunded}</strong>
          {onDismiss ? (
            <button type="button" className="modal-x" onClick={onDismiss} aria-label={copy.close}>
              ×
            </button>
          ) : null}
        </header>
        <p className="pay-note">
          {settled
            ? copy.settledNote(outcome.amountDisplay, mode.balanceUnit)
            : copy.refundedNote(outcome.amountDisplay, mode.balanceUnit)}
        </p>
        <ul className="tx-list">
          <li>
            <span>{copy.hold}</span>
            <a href={explorer.tx(order.hash, net)} target="_blank" rel="noopener noreferrer">
              {copy.viewTx}
            </a>
          </li>
          <li>
            <span>{settled ? copy.confirmation : copy.refund}</span>
            <a href={outcome.txUrl} target="_blank" rel="noopener noreferrer">
              {copy.viewTx}
            </a>
          </li>
        </ul>
        {outcome.receipt ? (
          // The preimage, not just the hash: 32 bytes on a block explorer prove
          // nothing unless you can see what was hashed into them.
          <details className="receipt">
            <summary>{copy.receipt}</summary>
            <pre>{outcome.receipt}</pre>
            <p className="pay-fine-line">sha256 = {outcome.receiptHash}</p>
          </details>
        ) : null}
        {settled && order.handoffUrl ? (
          <a className="btn" href={order.handoffUrl} target="_blank" rel="noopener noreferrer">
            {copy.openCart}
          </a>
        ) : null}
      </section>
    );
  }

  return (
    <section className="order-panel" aria-live="polite">
      <header className="order-head">
        <strong>{copy.held(amount, mode.balanceUnit)}</strong>
        <a href={explorer.tx(order.hash, net)} target="_blank" rel="noopener noreferrer">
          {copy.viewTx}
        </a>
      </header>
      <p className="pay-note">
        {mode.holdNote ? <strong>{mode.holdNote} </strong> : null}
        {copy.lead(order.totalDisplay)}
      </p>
      {error ? <p className="pay-error">{error}</p> : null}
      <div className="modal-actions">
        {order.handoffUrl ? (
          <a
            className="btn btn-ghost"
            href={order.handoffUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {copy.openCart}
          </a>
        ) : null}
        <button
          type="button"
          className="btn"
          onClick={() => void close('settle')}
          disabled={closing !== null}
        >
          {closing === 'settle' ? copy.confirming : copy.doneCta}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => void close('refund')}
          disabled={closing !== null}
        >
          {closing === 'refund' ? copy.refunding : copy.refundFailed}
        </button>
      </div>
    </section>
  );
}
