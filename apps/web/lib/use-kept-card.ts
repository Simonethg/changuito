'use client';

import { useCallback, useRef, useState } from 'react';

import type { IssuedCard } from '../app/api/card/route.ts';
import { track } from './analytics';
import { forgetCard } from './card-store.ts';
import type { NetworkId } from './deployments.ts';
import { DEFAULT_LANG, type Lang } from './lang.ts';
import { keptCardCopy, purchasesCopy } from './orders-copy.ts';
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
 * ## One caller, and why the other is not it
 *
 * `CardModal` uses this — it is the card's only home now, so reading, making
 * and giving back all live here together. `CardPanel` does its own read
 * because it must never open a wallet: it runs inside a checkout, where a
 * signing popup over the súper's frame would be the worst possible moment for
 * one, so it has no signature fallback to share.
 *
 * ## Retire is the exception that still signs
 *
 * Reading the card takes the session cookie. Destroying it does not, and
 * `/api/card/retire` was deliberately left on the wallet proof — the card
 * holds money, the act is irreversible, and thirty days of replayable cookie
 * is the wrong credential for that. So `retire` below always signs, and it
 * signs over `retire` rather than `card`, because the message the shopper
 * approves should say which of the two they are agreeing to.
 *
 * A card that comes back `shared` is not the wallet's own and `retire` must
 * not be offered for it — `CardModal` hides the control, and the route refuses
 * as well, because hiding a button is a layout decision.
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
 *
 * ## The server's sentence is not always the one to show
 *
 * The route answers in Spanish and always will: it is shared with the MCP
 * server and with the agent, and neither reads a cookie from this browser. So
 * `said` is given the language and hands back nothing in English, leaving the
 * copy below — less specific, and readable. CheckoutModal, CardPanel,
 * Purchases and use-chat all do the same thing for the same reason.
 *
 * `lang` arrives as an argument rather than from `useLang()`, the way
 * `use-chat` takes it, so that nothing under `lib/` has to import a component.
 * The caller is already inside `LangProvider` and already holds it.
 */
export interface KeptCard {
  /** `undefined` is "not asked yet"; `null` is "asked, and there is none". */
  card: IssuedCard | null | undefined;
  frozen: boolean;
  /** True when the card came from an operator-entered record rather than from
   *  the provider. It is not this wallet's alone and cannot be given back, so
   *  the dialog does not offer to. See app/api/card/mine/route.ts. */
  shared: boolean;
  busy: boolean;
  error: string | null;
  /** Read what is there. */
  load: () => Promise<void>;
  /** Read, and if there is nothing, make one. */
  create: () => Promise<void>;
  /** Give it back. Always signs; see the header. */
  retire: () => Promise<void>;
  /** True once a retire went through, so the empty state can say which empty it is. */
  gone: boolean;
}

export function useKeptCard(
  address: string | null,
  network: NetworkId,
  sign: WalletSigner,
  lang: Lang = DEFAULT_LANG,
): KeptCard {
  const [card, setCard] = useState<IssuedCard | null | undefined>(undefined);
  const [frozen, setFrozen] = useState(false);
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  // Both selectors hand back a module-level constant, so these are stable for
  // a given `lang` and safe in the dependency lists below — which matters,
  // because `CardModal` loads from a `useEffect` keyed on `load`.
  const copy = keptCardCopy(lang);
  const signRefused = purchasesCopy(lang).signRefused;
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
            setError(signRefused);
            return;
          }
          res = await post(proof);
        }
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          setError(said(body, lang) ?? (create ? copy.createError : copy.error));
          return;
        }
        setCard((body?.card ?? null) as IssuedCard | null);
        setFrozen(body?.frozen === true);
        setShared(body?.shared === true);
      } catch {
        setError(create ? copy.createError : copy.error);
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [address, network, sign, lang, copy, signRefused],
  );

  const load = useCallback(() => ask(false), [ask]);
  const create = useCallback(() => ask(true), [ask]);

  const retire = useCallback(async () => {
    if (!address || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const proof = await signWalletProof(sign, 'retire', address);
      if (!proof) {
        setError(signRefused);
        return;
      }
      const res = await fetch('/api/card/retire', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ address, network, proof }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(said(body, lang) ?? copy.retireError);
        return;
      }
      // The localStorage hint is the one thing the server cannot clear, and
      // leaving it would greet the next basket with "ya tenés una, termina en
      // 4242" about a card that no longer exists.
      forgetCard(network);
      setCard(null);
      setFrozen(false);
      setShared(false);
      setGone(true);
      track('card_retired', { network });
    } catch {
      setError(copy.retireError);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [address, network, sign, lang, copy, signRefused]);
  return { card, frozen, shared, busy, error, load, create, retire, gone };
}

/**
 * The server's sentence when it has one this reader can use. Its refusals are
 * written for the person reading them — "no podemos emitir tarjetas nuevas en
 * este momento" says more than a generic failure — and anything else is
 * dropped rather than shown, because an upstream error can quote the request
 * back. In English nothing comes through at all; see the header.
 */
function said(body: unknown, lang: Lang = DEFAULT_LANG): string | null {
  if (lang === 'en') return null;
  const b = (body ?? {}) as { error?: unknown; message?: unknown };
  const text = typeof b.message === 'string' ? b.message : typeof b.error === 'string' ? b.error : '';
  return text && text.length <= 160 && !/[{}<>]/.test(text) ? text : null;
}
