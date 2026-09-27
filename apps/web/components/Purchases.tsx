'use client';

import { usePollar } from '@pollar/react';
import { useCallback, useState } from 'react';

import type { IssuedCard } from '../app/api/card/route.ts';
import type { OrderLine } from '../app/api/orders/route.ts';
import { track, trackLoginStart } from '../lib/analytics';
import { forgetCard } from '../lib/card-store.ts';
import type { NetworkId } from '../lib/deployments.ts';
import {
  dollars,
  KEPT_CARD,
  ORDER_STATUS,
  pesos,
  purchaseDate,
  PURCHASES,
} from '../lib/orders-copy.ts';
import { pollarEnabled } from '../lib/pollar.ts';
import { useWalletSigner } from '../lib/use-wallet-signer.ts';
import { signWalletProof, type WalletSigner } from '../lib/wallet-proof.ts';
import { useNetwork } from './NetworkProvider';

/**
 * What this shopper has bought here, read from the record rather than the
 * browser.
 *
 * The chat keeps its own history in localStorage and the rail lists it, which
 * is enough right up until somebody shops on their phone and opens a laptop.
 * This is the other half: `POST /api/orders` answers from Postgres, so it is
 * the same list on every device and it survives a cleared browser.
 *
 * It used to be the page at /mis-compras. It is now the Mis compras tab of the
 * profile modal, which is what `embedded` is for: inside the dialog the
 * heading and the way back are the dialog's, and repeating them would be two
 * titles and two exits in one box.
 *
 * ## Nothing loads on its own
 *
 * The list is behind a button because the read used to cost a wallet
 * signature, and firing a wallet modal on mount is interrupting somebody for
 * permission before they have said what they came for.
 *
 * It usually costs nothing now: `POST /api/orders` accepts the `chg_user`
 * session cookie, which login already minted out of a signature this customer
 * gave once. So the first attempt carries no proof at all, and only a 401 —
 * cookie missing, or thirty days expired — falls back to signing. The button
 * stays for that case, and because a read that happens when you ask for it is
 * still the better shape.
 *
 * ## Preview is not an empty list
 *
 * A signed-out visitor has no purchases *because nothing was written down*,
 * not because they never shopped — they may well have shopped, on our money,
 * five minutes ago. An empty list would quietly tell them the wrong thing, so
 * that state says what preview is and offers the crossing instead. Same words
 * as the masthead, which is deliberate: one crossing, one sentence.
 *
 * The provider split is WalletWidget's, for WalletWidget's reason:
 * `usePollar()` throws outside a provider, `pollarEnabled` is a build
 * constant, so the branch is fixed for the life of the bundle and hook order
 * cannot change under it.
 */
export function Purchases({ embedded = false }: { embedded?: boolean } = {}) {
  return pollarEnabled ? <WithWallet embedded={embedded} /> : <NoWallet embedded={embedded} />;
}

function NoWallet({ embedded }: { embedded: boolean }) {
  return (
    <section className="purchases">
      {embedded ? null : <h2 className="purchases-title">{PURCHASES.title}</h2>}
      <p className="purchases-lead">Falta configurar el inicio de sesión en esta instalación.</p>
    </section>
  );
}

function WithWallet({ embedded }: { embedded: boolean }) {
  const { wallet, isAuthenticated, openLoginModal } = usePollar();
  const { network } = useNetwork();
  const sign = useWalletSigner();
  const address = isAuthenticated ? (wallet?.address ?? null) : null;

  const [orders, setOrders] = useState<OrderLine[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!address || loading) return;
    setLoading(true);
    setError(null);
    try {
      const ask = (proof?: unknown) =>
        fetch('/api/orders', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(proof ? { address, network, proof } : { address, network }),
        });

      // The session first. The server takes the cookie's address over the
      // body's, so sending ours is not a claim — it is what answers when there
      // is no cookie and we fall through to signing below.
      let res = await ask();
      if (res.status === 401) {
        // Refusing the wallet prompt is a decision, not a fault, so it gets
        // its own sentence rather than the generic failure.
        const proof = await signWalletProof(sign, 'orders', address);
        if (!proof) {
          setError(PURCHASES.signRefused);
          return;
        }
        res = await ask(proof);
      }
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(said(body) ?? PURCHASES.error);
        return;
      }
      const list = Array.isArray(body?.orders) ? (body.orders as OrderLine[]) : [];
      setOrders(list);
      track('purchases_read', { count: String(list.length) });
    } catch {
      setError(PURCHASES.error);
    } finally {
      setLoading(false);
    }
  }, [address, loading, network, sign]);

  return (
    <section className="purchases" data-testid="purchases">
      {embedded ? null : <h2 className="purchases-title">{PURCHASES.title}</h2>}

      {!address ? (
        <div className="purchases-empty" data-testid="purchases-guest">
          <h3 className="purchases-sub">{PURCHASES.guestTitle}</h3>
          <p className="purchases-lead">{PURCHASES.guestBody}</p>
          <button type="button" className="btn" onClick={() => trackLoginStart(openLoginModal)}>
            {PURCHASES.guestAction}
          </button>
        </div>
      ) : (
        <>
          <KeptCard address={address} network={network} sign={sign} />
          <p className="purchases-lead">{PURCHASES.lead}</p>
          {orders === null ? (
            <div className="purchases-empty">
              <p className="purchases-lead">{PURCHASES.signLead}</p>
              <button
                type="button"
                className="btn"
                data-testid="purchases-load"
                onClick={() => void load()}
                disabled={loading}
              >
                {loading ? PURCHASES.loading : PURCHASES.loadCta}
              </button>
            </div>
          ) : orders.length === 0 ? (
            <p className="purchases-lead" data-testid="purchases-none">
              {PURCHASES.empty}
            </p>
          ) : (
            <ul className="purchases-list" data-testid="purchases-list">
              {orders.map((o) => (
                <li className="purchase" key={`${o.network}:${o.memo}`}>
                  <div className="purchase-head">
                    {/* The pesos they read on screen, not the dollars that
                        were sent: the rate moves between the two, and the
                        figure a person remembers is the one they were shown. */}
                    <strong className="purchase-amount">
                      {o.arsQuoted === null ? dollars(o.amountCents) : pesos(o.arsQuoted)}
                    </strong>
                    <span className="purchase-status" data-status={o.status}>
                      {ORDER_STATUS[o.status]}
                    </span>
                  </div>
                  <p className="purchase-meta">
                    <span>{purchaseDate(o.createdAt)}</span>
                    <span className="purchase-code">
                      {PURCHASES.codeLabel} <code>{o.memo}</code>
                    </span>
                  </p>
                  {o.hasCard ? <p className="purchase-note">{PURCHASES.cardNote}</p> : null}
                </li>
              ))}
            </ul>
          )}
          {error ? (
            <p className="pay-warn" role="status" data-testid="purchases-error">
              {error}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

/** Just enough of the card to recognise it. See `KeptCard` for what is dropped. */
interface CardFace {
  last4: string;
  brand: string;
  balance: string;
}

/**
 * The card the customer keeps, and the only deliberate way to give it back.
 *
 * ## Why this is the page it is on
 *
 * `POST /api/card/terminate` used to be the only way a card died, and it was
 * fired by a checkout dialog closing — which in production destroyed the very
 * card "one card per customer" exists to keep. That route now refuses a kept
 * card outright, and this is where the refusal is made good: retiring the
 * card is something a person decides to do, on the page that lists what they
 * have, not something that happens to them on the way out of a basket.
 *
 * ## What is not shown
 *
 * `POST /api/card/mine` answers with the PAN and the CVV, because it is also
 * what CheckoutModal reads to put the numbers in front of somebody about to
 * type them into a súper's form. Nothing here needs them, so nothing here
 * keeps them: `face()` copies four digits, a brand and a balance out of the
 * reply and the rest is dropped on the floor. A page that holds a card number
 * in React state for as long as the tab is open should have a reason to, and
 * "it came back in the same object" is not one.
 *
 * ## Two presses, and a warning between them
 *
 * `retire` is irreversible and returns money, so the button does not do it —
 * it asks. The warning is the whole warning, before the second press rather
 * than after it, and it is a plain pair of buttons rather than `confirm()`,
 * which is a modal dialog the browser owns and Playwright cannot see.
 */
function KeptCard({
  address,
  network,
  sign,
}: {
  address: string;
  network: NetworkId;
  sign: WalletSigner;
}) {
  // `undefined` is "not asked yet", `null` is "asked, and there is none".
  const [card, setCard] = useState<CardFace | null | undefined>(undefined);
  const [frozen, setFrozen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const show = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const ask = (proof?: unknown) =>
        fetch('/api/card/mine', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(proof ? { address, network, proof } : { address, network }),
        });
      // The session answers this, the same as the order list above. Signing is
      // the fallback for a cookie that is missing or thirty days old.
      let res = await ask();
      if (res.status === 401) {
        const proof = await signWalletProof(sign, 'card', address);
        if (!proof) {
          setError(PURCHASES.signRefused);
          return;
        }
        res = await ask(proof);
      }
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(said(body) ?? KEPT_CARD.error);
        return;
      }
      setCard(body?.card ? face(body.card as IssuedCard) : null);
      setFrozen(body?.frozen === true);
    } catch {
      setError(KEPT_CARD.error);
    } finally {
      setBusy(false);
    }
  }, [address, busy, network, sign]);

  const retire = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // A second signature, over `retire` rather than `card`. Reading the
      // card and destroying it are not the same permission, and the message
      // the shopper approves says which one this is.
      const proof = await signWalletProof(sign, 'retire', address);
      if (!proof) {
        setError(PURCHASES.signRefused);
        return;
      }
      const res = await fetch('/api/card/retire', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address, network, proof }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(said(body) ?? KEPT_CARD.retireError);
        return;
      }
      // The localStorage hint is the one thing the server cannot clear, and
      // leaving it would greet the next basket with "ya tenés una, termina en
      // 4242" about a card that no longer exists.
      forgetCard(network);
      setCard(null);
      setFrozen(false);
      setConfirming(false);
      setGone(true);
      track('card_retired', { network });
    } catch {
      setError(KEPT_CARD.retireError);
    } finally {
      setBusy(false);
    }
  }, [address, busy, network, sign]);

  return (
    <section className="kept-card" data-testid="kept-card">
      <h3 className="purchases-sub">{KEPT_CARD.title}</h3>
      <p className="purchases-lead">{KEPT_CARD.lead}</p>

      {card === undefined ? (
        <button
          type="button"
          className="btn btn-sm"
          data-testid="kept-card-show"
          onClick={() => void show()}
          disabled={busy}
        >
          {busy ? KEPT_CARD.loading : KEPT_CARD.showCta}
        </button>
      ) : card === null ? (
        <p className="purchases-lead" data-testid="kept-card-none">
          {gone ? KEPT_CARD.retired : KEPT_CARD.none}
        </p>
      ) : (
        <>
          <p className="kept-card-face" data-testid="kept-card-face">
            <span className="kept-card-brand">{card.brand}</span>
            <code>•••• {card.last4}</code>
            <span className="kept-card-balance">
              {KEPT_CARD.balanceLabel} {card.balance}
            </span>
          </p>
          {frozen ? (
            <p className="pay-warn" role="status" data-testid="kept-card-frozen">
              {KEPT_CARD.frozen}
            </p>
          ) : null}
          {confirming ? (
            <div className="kept-card-confirm" data-testid="kept-card-confirm">
              <p className="pay-warn">{KEPT_CARD.retireWarn}</p>
              <button
                type="button"
                className="btn btn-sm btn-warn"
                data-testid="kept-card-retire-yes"
                onClick={() => void retire()}
                disabled={busy}
              >
                {busy ? KEPT_CARD.retiring : KEPT_CARD.retireConfirm}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setConfirming(false)}
                disabled={busy}
              >
                {KEPT_CARD.retireCancel}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              data-testid="kept-card-retire"
              onClick={() => setConfirming(true)}
            >
              {KEPT_CARD.retireCta}
            </button>
          )}
        </>
      )}

      {error ? (
        <p className="pay-warn" role="status" data-testid="kept-card-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** Four digits, a brand and a number. The PAN and the CVV are not copied. */
function face(card: IssuedCard): CardFace {
  return { last4: card.last4, brand: card.brand, balance: card.fundedDisplay };
}

/**
 * What a failed route said, if it said anything a person can read. `message`
 * first, then `error`: the routes write the code for the logs in one and the
 * sentence for a person in the other, and the ones without a `message` are
 * already sentences.
 */
function said(body: unknown): string | null {
  const b = (body ?? {}) as { message?: unknown; error?: unknown };
  if (typeof b.message === 'string') return b.message;
  if (typeof b.error === 'string') return sentence(b.error);
  return null;
}

/** A fragment from an API turned into something that can sit in a paragraph. CardPanel has the same one. */
function sentence(text: string): string {
  const t = text.trim();
  if (!t) return '';
  const capped = t[0]!.toUpperCase() + t.slice(1);
  return /[.!?]$/.test(capped) ? capped : `${capped}.`;
}
