'use client';

import { useCallback, useRef, useState } from 'react';

import type { IssuedCard } from '../app/api/card/route.ts';
import type { NetworkId } from './deployments.ts';
import { KEPT_CARD, PURCHASES } from './orders-copy.ts';
import { signWalletProof, type WalletSigner } from './wallet-proof.ts';

/**
 * Reading — and, on request, creating — the card a wallet keeps.
 *
 * A hook and not code in the component because the fetch is the part with
 * teeth. `cardDetails` upstream is rate limited at **30 requests a minute
 * across the whole account**, not per customer, so an effect that fires twice
 * or a retry loop on a 502 is paid for by every other shopper. Having that in
 * one place, with the in-flight guard below, is worth the indirection.
 *
 * ## One caller today, and why the other two are not it
 *
 * `CardModal` uses this. `CardPanel` does its own read because it must never
 * open a wallet — it runs inside a checkout, where a signing popup over the
 * súper's frame would be the worst possible moment for one — so it has no
 * signature fallback to share. `Purchases`'s `KeptCard` keeps its own because
 * it shows four digits rather than a PAN and owns the retire flow, and the
 * shapes have nothing in common but the URL.
 *
 * Deliberately **not** memoised across mounts. The obvious next step is a
 * module-level cache keyed by address, and it would hold a PAN and a CVV in
 * page memory for as long as the tab is open rather than for as long as the
 * dialog is. The in-flight guard is what stops a burst; keeping the numbers
 * alive longer is not worth the round trip it saves.
 *
 * ## The signature is the fallback, not the path
 *
 * `POST /api/card/mine` takes the `chg_user` session cookie, which login
 * already minted. So the first attempt carries no proof and opens no wallet,
 * and only a 401 — no cookie, or thirty days gone — asks for a signature.
 */
export interface KeptCard {
  /** `undefined` is "not asked yet"; `null` is "asked, and there is none". */
  card: IssuedCard | null | undefined;
  frozen: boolean;
  busy: boolean;
  error: string | null;
  /** Read what is there. */
  load: () => Promise<void>;
  /** Read, and if there is nothing, make one. */
  create: () => Promise<void>;
}

export function useKeptCard(
  address: string | null,
  network: NetworkId,
  sign: WalletSigner,
): KeptCard {
  const [card, setCard] = useState<IssuedCard | null | undefined>(undefined);
  const [frozen, setFrozen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A ref and not `busy`, because two effects in the same tick both read the
  // old state and both fetch. This is set before the first await.
  const inFlight = useRef(false);

  const ask = useCallback(
    async (create: boolean) => {
      if (!address || inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      setError(null);
      try {
        const post = (proof?: unknown) =>
          fetch('/api/card/mine', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ address, network, ...(create ? { create: true } : null), ...(proof ? { proof } : null) }),
          });

        let res = await post();
        if (res.status === 401) {
          const proof = await signWalletProof(sign, 'card', address);
          if (!proof) {
            setError(PURCHASES.signRefused);
            return;
          }
          res = await post(proof);
        }
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          setError(said(body) ?? (create ? KEPT_CARD.createError : KEPT_CARD.error));
          return;
        }
        setCard((body?.card ?? null) as IssuedCard | null);
        setFrozen(body?.frozen === true);
      } catch {
        setError(create ? KEPT_CARD.createError : KEPT_CARD.error);
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [address, network, sign],
  );

  const load = useCallback(() => ask(false), [ask]);
  const create = useCallback(() => ask(true), [ask]);
  return { card, frozen, busy, error, load, create };
}

/**
 * The server's sentence when it has one. Its refusals are written for the
 * person reading them — "no podemos emitir tarjetas nuevas en este momento"
 * says more than a generic failure — and anything else is dropped rather than
 * shown, because an upstream error can quote the request back.
 */
function said(body: unknown): string | null {
  const b = (body ?? {}) as { error?: unknown; message?: unknown };
  const text = typeof b.message === 'string' ? b.message : typeof b.error === 'string' ? b.error : '';
  return text && text.length <= 160 && !/[{}<>]/.test(text) ? text : null;
}
