'use client';

import { usePollar } from '@pollar/react';
import { useCallback, useState } from 'react';

import type { OrderLine } from '../app/api/orders/route.ts';
import { track, trackLoginStart } from '../lib/analytics';
import { DEFAULT_LANG, type Lang } from '../lib/lang.ts';
import { dollars, orderStatus, pesos, purchaseDate, purchasesCopy } from '../lib/orders-copy.ts';
import { pollarEnabled } from '../lib/pollar.ts';
import { useWalletSigner } from '../lib/use-wallet-signer.ts';
import { signWalletProof } from '../lib/wallet-proof.ts';
import { uiCopy } from '../lib/ui-copy.ts';
import { useLang } from './LangProvider';
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
 * It used to be the page at /mis-compras. It is `OrdersModal`'s body now,
 * which is what `embedded` is for: inside a dialog the heading and the way
 * back are the dialog's, and repeating them would be two titles and two exits
 * in one box.
 *
 * The card used to sit at the top of this, with the button that gives it back.
 * It does not any more — this is a record of what was bought, and a card is
 * not a purchase. It has its own dialog, `CardModal`, opened from its own icon
 * beside the one that opens this.
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
  const lang = useLang();
  const ui = uiCopy(lang);
  return (
    <section className="purchases">
      {embedded ? null : <h2 className="purchases-title">{purchasesCopy(lang).title}</h2>}
      <p className="purchases-lead">{ui.purchasesUnconfigured}</p>
    </section>
  );
}

function WithWallet({ embedded }: { embedded: boolean }) {
  const lang = useLang();
  const copy = purchasesCopy(lang);
  const status = orderStatus(lang);
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
          setError(copy.signRefused);
          return;
        }
        res = await ask(proof);
      }
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(said(body, lang) ?? copy.error);
        return;
      }
      const list = Array.isArray(body?.orders) ? (body.orders as OrderLine[]) : [];
      setOrders(list);
      track('purchases_read', { count: String(list.length) });
    } catch {
      setError(copy.error);
    } finally {
      setLoading(false);
    }
  }, [address, copy, lang, loading, network, sign]);

  return (
    <section className="purchases" data-testid="purchases">
      {embedded ? null : <h2 className="purchases-title">{copy.title}</h2>}

      {!address ? (
        <div className="purchases-empty" data-testid="purchases-guest">
          <h3 className="purchases-sub">{copy.guestTitle}</h3>
          <p className="purchases-lead">{copy.guestBody}</p>
          <button type="button" className="btn" onClick={() => trackLoginStart(openLoginModal)}>
            {copy.guestAction}
          </button>
        </div>
      ) : (
        <>
          <p className="purchases-lead">{copy.lead}</p>
          {orders === null ? (
            <div className="purchases-empty">
              <p className="purchases-lead">{copy.signLead}</p>
              <button
                type="button"
                className="btn"
                data-testid="purchases-load"
                onClick={() => void load()}
                disabled={loading}
              >
                {loading ? copy.loading : copy.loadCta}
              </button>
            </div>
          ) : orders.length === 0 ? (
            <p className="purchases-lead" data-testid="purchases-none">
              {copy.empty}
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
                      {o.arsQuoted === null ? dollars(o.amountCents, lang) : pesos(o.arsQuoted, lang)}
                    </strong>
                    <span className="purchase-status" data-status={o.status}>
                      {status[o.status]}
                    </span>
                  </div>
                  <p className="purchase-meta">
                    <span>{purchaseDate(o.createdAt, lang)}</span>
                    <span className="purchase-code">
                      {copy.codeLabel} <code>{o.memo}</code>
                    </span>
                  </p>
                  {o.hasCard ? <p className="purchase-note">{copy.cardNote}</p> : null}
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


/**
 * What a failed route said, if it said anything a person can read. `message`
 * first, then `error`: the routes write the code for the logs in one and the
 * sentence for a person in the other, and the ones without a `message` are
 * already sentences.
 *
 * Except in English, where it says nothing. The API routes answer in Spanish
 * and always will — they are shared with the MCP server and with the agent,
 * and neither of those reads a cookie from this browser. Preferring the
 * server's sentence would hand a Spanish paragraph to the one reader who
 * cannot parse it, so the caller's own fallback wins instead: less specific,
 * and readable. The day a route learns to answer in two languages this
 * parameter goes away.
 */
function said(body: unknown, lang: Lang = DEFAULT_LANG): string | null {
  if (lang === 'en') return null;
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
