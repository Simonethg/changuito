'use client';

import { usePollar } from '@pollar/react';
import { useEffect, useRef, useState } from 'react';

import type { Cart } from '@changuito/mcp/types';

import { track, trackLoginStart } from '../lib/analytics';
import type { QuoteResponse } from '../app/api/quote/route.ts';
import { deployment } from '../lib/deployments.ts';
import { modeCopy, trustlineCopy } from '../lib/mode-copy.ts';
import { basketHash, newOrderId, openArgs, toHex, type OpenedOrder } from '../lib/order.ts';
import { pollarEnabledOn, shortAddress } from '../lib/pollar.ts';
import { usdcAsset } from '../lib/trustline.ts';
import { useBalances } from '../lib/use-balances.ts';
import { useFaucetAccess } from '../lib/use-faucet-access.ts';
import { uiCopy } from '../lib/ui-copy.ts';
import { useLang } from './LangProvider';
import { useNetwork } from './NetworkProvider';

/**
 * Step 4 of the flow: the last screen before money moves.
 *
 * It shows the basket, the peso total the store quoted, the USDC that converts
 * to, and the wallet's balance — and then asks. Everything the contract is
 * about to commit to is on this screen, because `basket_hash` is only a
 * meaningful promise if the user saw the basket it hashes.
 */
export function PaymentModal(props: Props) {
  // Same split as WalletWidget, and the same condition as WalletProvider, so
  // `usePollar()` never runs outside a provider that exists.
  const { network } = useNetwork();
  return pollarEnabledOn(network) ? <PayWithPollar {...props} /> : null;
}

interface Props {
  cart: Cart;
  handoffUrl?: string;
  onClose: () => void;
  onOpened: (order: OpenedOrder) => void;
}

type Phase = 'review' | 'signing' | 'failed';

function PayWithPollar({ cart, handoffUrl, onClose, onOpened }: Props) {
  const { wallet, isAuthenticated, verified, openLoginModal, runTx, setTrustline } = usePollar();
  const { network } = useNetwork();
  const address = isAuthenticated ? (wallet?.address ?? null) : null;
  const { data: balance, refresh } = useBalances(address, network);
  // Point at "Cargar USDC" only for wallets that actually have the button.
  const canFund = useFaucetAccess(address, network)?.allowed === true;
  const lang = useLang();
  const copy = uiCopy(lang).payment;
  const mode = modeCopy(network, lang);
  const trustlineText = trustlineCopy(lang);

  // The one-time step before the first real payment. `not-needed` in modo
  // prueba, always — the demo token has no issuer, so there is nothing to
  // open. See lib/trustline.ts.
  const needsTrustline = balance?.trustline === 'needed';
  const [opening, setOpening] = useState(false);
  const [trustlineError, setTrustlineError] = useState<string | null>(null);

  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('review');
  const [failure, setFailure] = useState<string | null>(null);
  const confirm = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/quote?centavos=${cart.total.centavos}`)
      .then(async (res) => {
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(json.error ?? `quote failed (${res.status})`);
        setQuote(json as QuoteResponse);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        track('payment_fail', { flow: 'checkout', code: 'quote' });
        setQuoteError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [cart.total.centavos]);

  // Escape closes — but not mid-signature, where closing would leave the user
  // unsure whether their money moved.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && phase !== 'signing') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, phase]);

  useEffect(() => {
    confirm.current?.focus();
  }, [quote]);

  /**
   * Opens the line, once, before the first real payment.
   *
   * It happens here rather than at login because it costs a signature and a
   * reserve, and asking for either before the user has decided to buy
   * anything is asking them to pay for a maybe. `refresh()` is what clears
   * the gate: the state comes back from the ledger, not from this call's
   * return value, so a "success" that did not land cannot unlock the button.
   */
  async function openTrustline() {
    const asset = usdcAsset(network);
    if (!asset) return;
    setOpening(true);
    setTrustlineError(null);
    try {
      const outcome = await setTrustline(asset);
      if (outcome.status === 'error') throw new Error(outcome.details ?? trustlineText.failed);
      refresh();
    } catch (err) {
      track('payment_fail', { flow: 'checkout', code: 'trustline' });
      setTrustlineError(err instanceof Error ? err.message : String(err));
    } finally {
      setOpening(false);
    }
  }

  const amountUnits = quote ? BigInt(quote.units) : 0n;
  const held = balance ? BigInt(balance.usdc) : 0n;
  // Only a balance we actually read can be short. Without a wallet the balance
  // is unknown, not zero, and "no te alcanza" would be a lie under a button
  // that says "Empezá a comprar".
  const short = balance !== null && quote !== null && held < amountUnits;

  async function pay() {
    if (!address || !quote) return;
    setPhase('signing');
    setFailure(null);
    try {
      const orderId = newOrderId();
      const basket = await basketHash(cart);
      const outcome = await runTx('invoke_contract', {
        contractId: deployment(network).escrowId,
        method: 'open',
        args: openArgs({ buyer: address, orderId, amountUnits, basketHash: basket }),
      });

      if (outcome.status === 'error') {
        // resultCode is the ledger's own verdict and the only part worth
        // pasting into a search; message is for the human.
        throw new Error(
          outcome.message ??
            outcome.details ??
            outcome.resultCode ??
            copy.networkRefused,
        );
      }

      track('payment_success', { flow: 'checkout' });
      refresh();
      // The modal's job ends here. What comes next — finishing the basket at
      // the store, then settling — happens on the page, not behind a dialog.
      onOpened({
        orderId: toHex(orderId),
        buyer: address,
        basketHash: toHex(basket),
        amountUnits: amountUnits.toString(),
        hash: outcome.hash,
        retailer: cart.retailer,
        cartId: cart.cartId,
        totalDisplay: cart.total.display,
        handoffUrl,
        // Pinned to the order, not read live: an order exists on one chain
        // for good, and closing it has to name that chain however the toggle
        // has moved since.
        network,
      });
      onClose();
    } catch (err) {
      track('payment_fail', { flow: 'checkout', code: 'rejected' });
      setFailure(err instanceof Error ? err.message : String(err));
      setPhase('failed');
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => phase !== 'signing' && onClose()}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={copy.aria}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2>{copy.title}</h2>
          <button
            type="button"
            className="modal-x"
            onClick={onClose}
            disabled={phase === 'signing'}
            aria-label={copy.close}
          >
            ×
          </button>
        </header>

        <ul className="pay-lines">
          {cart.lines
            .filter((l) => l.available)
            .map((l) => (
              <li key={l.index}>
                <span className="cart-qty">{l.quantity}×</span>
                <span>{l.name}</span>
                <span className="cart-amount">{l.lineTotal.display}</span>
              </li>
            ))}
        </ul>

        <dl className="pay-rows">
          <div>
            <dt>{copy.storeTotal}</dt>
            <dd>{cart.total.display}</dd>
          </div>
          <div className="pay-total">
            <dt>A pagar</dt>
            <dd>{quote ? `${quote.display} USDC` : quoteError ? '-' : 'cotizando…'}</dd>
          </div>
          {quote ? (
            <div className="pay-fine">
              <dt>{copy.rate}</dt>
              <dd>{quote.arsPerUsd.toFixed(2)} ARS/USD</dd>
            </div>
          ) : null}
          <div className="pay-fine">
            <dt>{copy.balance}</dt>
            <dd>{balance ? `${balance.usdcDisplay} ${mode.balanceUnit}` : '-'}</dd>
          </div>
        </dl>

        {quoteError ? <p className="pay-error">{quoteError}</p> : null}
        {failure ? <p className="pay-error">{failure}</p> : null}
        {short ? (
          <p className="pay-warn">
            {canFund ? copy.shortFundable : copy.short}
          </p>
        ) : null}
        {needsTrustline ? (
          <div className="pay-step">
            <strong>{trustlineText.title}</strong>
            <p>{trustlineText.body}</p>
            {trustlineError ? <p className="pay-error">{trustlineText.failed}</p> : null}
          </div>
        ) : null}
        <p className="pay-note">
          {mode.payNote ? <strong>{mode.payNote} </strong> : null}
          {copy.note}
        </p>

        <div className="modal-actions">
          {!address ? (
            <button type="button" className="btn" onClick={() => trackLoginStart(openLoginModal)}>
              {copy.startCta}
            </button>
          ) : needsTrustline ? (
            <button
              ref={confirm}
              type="button"
              className="btn"
              data-testid="pay-trustline"
              onClick={() => void openTrustline()}
              disabled={opening || !verified}
            >
              {opening ? trustlineText.working : trustlineText.action}
            </button>
          ) : (
            <button
              ref={confirm}
              type="button"
              className="btn"
              onClick={() => void pay()}
              disabled={!quote || !verified || short || phase === 'signing'}
            >
              {phase === 'signing'
                ? copy.signing
                : !verified
                  ? copy.verifying
                  : mode.payLabel(quote ? quote.display : '')}
            </button>
          )}
          {/* A refusal must not be a dead end. It used to offer modo prueba,
              which is no longer somewhere a signed-in visitor can go — the
              mode is the session now (lib/app-mode.ts), so that button would
              have had to sign them out to keep its promise. Closing gets them
              back to the basket, which is what they actually wanted. */}
          {needsTrustline ? (
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              {trustlineText.back}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            disabled={phase === 'signing'}
          >
            {copy.cancel}
          </button>
        </div>

        {address ? (
          <p className="pay-fine-line">{copy.from(shortAddress(address))}</p>
        ) : null}
      </section>
    </div>
  );
}
