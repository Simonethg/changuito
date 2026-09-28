'use client';

import type { SendPaymentParams, SubmitOutcome } from '@pollar/core';
import { usePollar } from '@pollar/react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { formatARS } from '@changuito/mcp/money';
import type { Cart } from '@changuito/mcp/types';

import type { DepositIntent, DepositStatus } from '../app/api/deposit/route.ts';
import type { VerifyResponse } from '../app/api/order/verify/route.ts';
import { track } from '../lib/analytics';
import { appMode } from '../lib/app-mode.ts';
import type { Receipt } from '../lib/chat-store.ts';
import { checkoutCopy } from '../lib/checkout-copy.ts';
import { DEFAULT_NETWORK } from '../lib/deployments.ts';
import { pollarEnabled, pollarEnabledOn } from '../lib/pollar.ts';
import { realModeNeedsProof } from '../lib/real-mode.ts';
import { isFramableCheckout, STOREFRONT_HOSTS } from '../lib/storefront.ts';
import { uiCopy } from '../lib/ui-copy.ts';
import { stroops } from '../lib/units.ts';
import { useBalances } from '../lib/use-balances.ts';
import { useNetworkAccess } from '../lib/use-network-access.ts';
import { useWalletSigner } from '../lib/use-wallet-signer.ts';
import { signWalletProof, type WalletProof, type WalletSigner } from '../lib/wallet-proof.ts';
import { CardPanel } from './CardPanel';
import { CopyField } from './CopyField';
import { useLang } from './LangProvider';
import { useNetwork } from './NetworkProvider';

/**
 * From a full basket to a receipt, in the order the money actually allows:
 * sign in at the store, pick a delivery, and only then send the importe.
 *
 * ## Why the frame comes first
 *
 * It ran the other way round — importe, then frame — and that quoted the
 * wrong number. `cart.total` is the goods subtotal by design (`toCart` in
 * @changuito/mcp says so: it is the figure the search and price tools mean),
 * so the shopper was charged before a delivery slot existed and for an amount
 * with no envío in it. The only thing absorbing the difference was the 15% FX
 * buffer in `POST /api/deposit`, which is sized for card-network rate drift
 * and not for flete.
 *
 * So the frame is mounted on the first render and never unmounted —
 * re-mounting reloads the store's checkout and loses whatever the shopper has
 * typed into it — and what changes is the panel above it. `Stage` below is
 * **derived**, never set: there is no state machine to get out of step with
 * what the store says.
 *
 * The importe is quoted the moment the store reports a chosen delivery, from
 * `payableTotal()` read server-side off the store's own cart. Reading is
 * automatic; **taking the money never is.** `payWithMyWallet` is reachable
 * only from a press, and the address-and-código path stays for the shopper
 * who would rather send it themselves.
 *
 * ## Why the login is not in the frame
 *
 * A login form inside someone else's chrome is the exact shape of a phishing
 * page, and a shopper has no way to tell ours from a real one. So the frame
 * only ever shows checkout, and "entrar a mi cuenta" opens a top-level tab on
 * the store's own origin — real URL bar, real certificate, and the only place
 * a password manager will offer to fill.
 *
 * ## Why there is always a tab
 *
 * The store's checkout sets a `samesite=none` cookie. Safari blocks those in a
 * third-party frame by default, Firefox partitions them, and Chrome's tracking
 * protection covers a share of users. Neither `requestStorageAccess()` (called
 * by the embedded page) nor `requestStorageAccessFor()` (needs the embedded
 * origin's Permissions-Policy) is ours to grant, so this cannot be fixed from
 * here. "Abrir en una pestaña" is therefore a co-primary path, worded as an
 * equal, not a fallback the shopper reaches after something breaks.
 *
 * ## Why a button says the payment happened
 *
 * The frame is cross-origin. We cannot read its DOM, its URL, or an
 * `orderPlaced` event — that is the browser working correctly. So the shopper
 * tells us, and the server corroborates by re-reading the cart at the store:
 * lib/order-check.ts explains what that can and cannot establish. It is never
 * treated as proof, and a store that disagrees never becomes an accusation —
 * the shopper is the one who was there.
 *
 * ## Why the card is optional
 *
 * The frame is the store's real checkout, so a shopper's own card already
 * works and costs us nothing. The card we provide is for the one who would
 * rather not put theirs into a page they reached through a chat. It is offered
 * only where the deployment can actually mint one — `intent.cardAvailable`.
 *
 * What happens to it afterwards depends on which of the two cards it is. A
 * preview card is per basket and is given back when this dialog closes,
 * because a card left alive is money sitting somewhere nobody is watching. A
 * production card belongs to the customer and is kept — `release()` below is
 * the one that knows the difference.
 *
 * ## Why preview pays with one button
 *
 * A visitor with no session has no wallet, so "send this importe to this
 * address" is an instruction they cannot follow. `POST /api/deposit/demo`
 * signs for them out of the demo wallet, and this dialog offers it as a single
 * button instead of the address-and-memo fields. Nothing after it changes: the
 * same 4s poll sees the same payment land on the same ledger.
 *
 * The button is behind `intent.demoPayable` rather than behind the mode alone,
 * so a deployment with no `DEMO_WALLET_SECRET` falls back to showing the
 * address and the memo. That path is not a demo any more — it is an operator
 * paying by hand — but it works, which is better than a button that 503s.
 *
 * ## Why it signs in modo real
 *
 * On a real network `POST /api/deposit` is a door onto actual USDC, so
 * `lib/deposit-gate.ts` asks the wallet to prove itself before it will hand out
 * an address to pay into. The dialog asks for that signature up front rather
 * than letting the server refuse: `realModeNeedsProof` is shared with the gate
 * so the two cannot disagree about when one is wanted. In modo prueba nothing
 * signs and a guest with no wallet at all shops exactly as before.
 */

interface Props {
  cart: Cart;
  handoffUrl?: string;
  /**
   * The conversation this basket came out of, when it has one and the server
   * could have filed it. One chat is one order, and the server is where that
   * is actually held — ShopProvider refuses to let a shopper *type* a second
   * basket into a paid chat, and `POST /api/deposit` refuses to quote one.
   * Absent in preview, where nothing is recorded at all.
   */
  chatId?: string;
  onClose: () => void;
  onPaid: (receipt: Receipt) => void;
}

/**
 * ## Why production pays with one button too
 *
 * The shopper is signed in, their dollars are in the account they signed in
 * to, and the importe has to reach an address we control. Asking them to copy
 * that address and a código into some other app to move money between two
 * accounts *we* can both see was work the browser could do — and it was the
 * step the flow lost people on, because it is four copies and a network
 * picker before anything happens.
 *
 * So `sendPayment` sends it, with the código attached as MEMO_TEXT, and
 * nothing downstream changes: the same 4s poll reads the same classic payment
 * off the same ledger. `matchDeposit` never asks who sent it.
 *
 * Three things hold this up, and all three are load-bearing:
 *
 * - **The memo.** `options.memo` is the only reason this settles at all. A
 *   payment without it arrives, costs the shopper real money and is never
 *   matched — the código is what ties an importe to this basket and not
 *   another. It is asserted on in lib/test/checkout-modal.test.ts because a
 *   silent regression here is unrecoverable money.
 * - **A `G…` account.** On a passkey smart wallet `sendPayment` becomes a SAC
 *   transfer, which leaves a contract event and no classic payment record, so
 *   the poll would wait for ever. Such a session cannot reach this step anyway
 *   — the deposit gate wants a SEP-53 signature a C-address cannot give — but
 *   the failure would be invisible, so it is guarded here as well.
 * - **The balance, read first.** A short balance is a sentence before the
 *   press rather than `op_underfunded` after it.
 *
 * The address and the código stay on screen, below the button. Somebody whose
 * dollars sit on an exchange still needs them, and that is a different shopper
 * rather than an earlier step in this one's journey — so it is demoted, not
 * deleted, and it disappears once the wallet has actually paid.
 *
 * ## Why `usePollar()` is not called here
 *
 * It throws outside a provider, and there are two places without
 * one: a deployment with no Pollar key, and app/dev/ui, which renders this
 * dialog on its own. The same split WalletWidget and PaymentModal make — but
 * ending in the dialog either way rather than in `null`, because checkout in
 * modo prueba has never needed a wallet and must not start now.
 *
 * **Both halves of the gate, and the first one is the one that bites.**
 * `pollarEnabled` is the question `WalletProvider` answered when it decided
 * whether to mount — it asks about LOGIN_NETWORK, i.e. the mainnet key — and a
 * consumer that asks a *different* question can find itself inside the branch
 * with no provider above it. That is not hypothetical: a build with a testnet
 * key and no mainnet key has `pollarEnabledOn('testnet')` true and no provider,
 * which is `usePollar must be used inside <PollarProvider>` on the first render
 * of this dialog. So: is there a provider, *and* can a wallet pay on the
 * network being shown. `PaymentModal` gates on the second alone and has the
 * same hole.
 */
export function CheckoutModal(props: Props) {
  const { network } = useNetwork();
  return pollarEnabled && pollarEnabledOn(network) ? (
    <CheckoutWithWallet {...props} />
  ) : (
    <CheckoutDialog {...props} address={null} sign={null} pay={null} />
  );
}

function CheckoutWithWallet(props: Props) {
  const { wallet, isAuthenticated, sendPayment } = usePollar();
  const sign = useWalletSigner();
  const address = isAuthenticated ? (wallet?.address ?? null) : null;
  // Only handed down with a session. `sendPayment` exists on the context
  // either way and would throw on a wallet that is not there; passing null
  // instead is what lets the dialog decide by asking whether it *has* a way to
  // pay rather than by re-deriving who is signed in.
  return (
    <CheckoutDialog {...props} address={address} sign={sign} pay={isAuthenticated ? sendPayment : null} />
  );
}

/** Just the part of Pollar's `sendPayment` this dialog uses. */
export type WalletPay = (params: SendPaymentParams) => Promise<SubmitOutcome>;

interface DialogProps extends Props {
  /** The logged-in wallet, or null when there is none to sign with. */
  address: string | null;
  sign: WalletSigner | null;
  /** Sends the importe from the shopper's own balance, or null when nothing can. */
  pay: WalletPay | null;
}

/**
 * Which of the four things the shopper is doing, derived from what the store
 * and the ledger say — never assigned.
 *
 * `intent` is the latch between `delivery` and `pay`: once an importe has been
 * quoted the panel does not slide backwards because the store changed its
 * mind. That case is the drift warning at `card`, not a second quote.
 */
type Stage = 'login' | 'delivery' | 'pay' | 'card';

/** 4s: fast enough to feel live, slow enough that a long wait is not a flood. */
const DEPOSIT_POLL_MS = 4_000;
/** 5s against the store, which is someone else's server. */
const IDENTIFY_POLL_MS = 5_000;
/** ~20s before the tab is promoted. Past that the frame is probably blocked. */
const IDENTIFY_PATIENCE = 4;
/** After the first minute, ask less often: the shopper is filling in a form. */
const WATCH_POLL_MS = 10_000;
/** 5s for the first minute, then 10s — about ten minutes of watching in all. */
const IDENTIFY_MAX = 12;
const WATCH_MAX = IDENTIFY_MAX + 54;
/**
 * How long a signed-in shopper may sit with no delivery slot before the
 * escape hatch appears.
 *
 * The automatic path depends on the store handing `shippingData.logisticsInfo`
 * to a reader with no session. It did when this was probed against Día on
 * 2026-09-27, and that is a fact about someone else's CDN rather than a
 * contract — so after a minute and a half the shopper is offered a button that
 * says they have already chosen. It only ever skips the *wait*: the figure is
 * still read from the store, server-side. See `settled` in POST /api/deposit.
 */
const SLOT_PATIENCE_MS = 90_000;

function CheckoutDialog({ cart, handoffUrl, chatId, onClose, onPaid, address, sign, pay }: DialogProps) {
  const { network } = useNetwork();
  const lang = useLang();
  const copy = checkoutCopy(network, lang);
  const ui = uiCopy(lang).checkout;

  // Null until the server answers, and null forever for a guest with no
  // address — which is right, because a guest cannot be in a gated mode.
  const mode = useNetworkAccess(address)?.[network].mode ?? null;

  const [intent, setIntent] = useState<DepositIntent | null>(null);
  const [mintError, setMintError] = useState<string | null>(null);
  const [deposit, setDeposit] = useState<DepositStatus | null>(null);

  // Preview's one-button payment. `demoSent` outlives the request: once the
  // payment is submitted the button must stay down until the poll confirms,
  // or an impatient second press pays the same memo twice.
  const [demoPaying, setDemoPaying] = useState(false);
  const [demoSent, setDemoSent] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);

  // Production's one-button payment, and `walletSent` outlives the request for
  // exactly the reason `demoSent` does — except here the second press would
  // spend the shopper's own money twice on one basket, and only the first of
  // the two would ever be matched to it.
  const [walletPaying, setWalletPaying] = useState(false);
  const [walletSent, setWalletSent] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);

  // One read, no polling: the number only matters at the moment of the press,
  // and `useBalances` does nothing at all without an address, which is every
  // preview checkout.
  const { data: balance } = useBalances(address, network);

  // What the store says about the shopper's own cart, read server-side by
  // cart id. Every one of these is set by the watcher below and by nothing
  // else — the browser observes the store, it never asserts anything about it.
  const [identified, setIdentified] = useState(false);
  const [slotChosen, setSlotChosen] = useState(false);
  /** Items / Envío / Descuentos as the store names them, frozen at quote time. */
  const [breakdown, setBreakdown] = useState<VerifyResponse['breakdown']>([]);
  /** The store's live payable total. Kept fresh *after* the quote, for drift. */
  const [payable, setPayable] = useState(0);
  /** The order's own id once it exists, for the receipt's link. */
  const [orderRef, setOrderRef] = useState<string | null>(null);
  /** The shopper saying they picked a delivery the store did not report. */
  const [slotForced, setSlotForced] = useState(false);
  const [polls, setPolls] = useState(0);
  const [verifying, setVerifying] = useState(false);
  const [verdict, setVerdict] = useState<VerifyResponse | null>(null);

  // The fixture stands in for the store only where it exists. app/dev/checkout
  // notFound()s in production, and modo prueba is reachable there too — framing
  // a 404 would be a worse rehearsal than framing the real checkout, which is
  // safe either way because the importe in modo prueba is play money.
  const rehearsal = network !== 'mainnet' && process.env.NODE_ENV !== 'production';
  const framable = Boolean(handoffUrl) && isFramableCheckout(handoffUrl!);
  const frameSrc = rehearsal
    ? `/dev/checkout?retailer=${encodeURIComponent(cart.retailer)}&total=${encodeURIComponent(cart.total.display)}`
    : framable
      ? handoffUrl!
      : null;

  const storeUrl = STOREFRONT_HOSTS[cart.retailer]
    ? `https://${STOREFRONT_HOSTS[cart.retailer]}`
    : null;

  const itemsAtHandoff = cart.lines.filter((l) => l.available).length;

  // Whether there is a real store cart behind this checkout for the server to
  // read. False in the rehearsal, whose fixture has no orderForm at all, and
  // false for a basket that never got a handoff link.
  const storeReadable = !rehearsal && Boolean(handoffUrl);
  // Whether there is a store to sign into at all — a real one, or the fixture
  // standing in for it. Against a real cart `identified` comes from the
  // watcher; against the fixture, which carries no profile to read, "Ya
  // ingresé" is the whole mechanism and always was.
  const hasStore = storeReadable || frameSrc !== null;
  const signedIn = !hasStore || identified;
  // Only a real cart has a delivery for the store to report one way or the
  // other. The rehearsal skips this step rather than faking a slot it has no
  // way to have: see the note it prints beside the importe.
  const slotReady = !storeReadable || slotChosen || slotForced;
  /** The one gate on quoting: the store knows who they are and where it goes. */
  const quoteReady = signedIn && slotReady;

  // When the store first recognised the shopper, so the escape hatch can be
  // offered a minute and a half later. A ref because it is written once and
  // the watcher's ticks are what re-render this; see SLOT_PATIENCE_MS.
  const identifiedAt = useRef<number | null>(null);
  useEffect(() => {
    if (identified && identifiedAt.current === null) identifiedAt.current = Date.now();
  }, [identified]);

  // Read by the watcher, which must not tear its timer down when a quote
  // lands. It stops refreshing the breakdown at that point: the split the
  // shopper approved is the one that was true when they were asked.
  const intentRef = useRef<DepositIntent | null>(null);
  intentRef.current = intent;

  // A ref because giving the card back is not a render, and because the
  // pagehide listener below has to read the latest value without being torn
  // down and rebuilt every time something else in this dialog changes.
  const cardLive = useRef(false);
  // Settling is now reached from two places — the shopper's button and the
  // watcher below — and it files a receipt and closes the chat. Once.
  const done = useRef(false);
  const release = useCallback(() => {
    // Preview only, and the flag is left standing so that reads plainly: in
    // production the card is the customer's, it survives this basket, and
    // closing a dialog is not a request to destroy it. `POST /api/card/terminate`
    // refuses a kept card anyway — that guard is the load-bearing one, because
    // it holds whatever any browser asks for. This is here so the browser does
    // not ask, and so the next person reading `release` sees which of the two
    // cards it is about.
    if (appMode(network) !== 'preview') return;
    if (!cardLive.current || !intent) return;
    cardLive.current = false;
    // `keepalive` so it survives the unload this is sometimes called during.
    // Nothing waits for the answer: the server logs a card it could not
    // terminate loudly enough that a person will find it, and there is
    // nothing useful to tell the shopper about it either way.
    void fetch('/api/card/terminate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ memo: intent.memo, network }),
      keepalive: true,
    }).catch(() => {});
  }, [intent, network]);

  // The tab closing is the one exit that does not go through a button of ours.
  useEffect(() => {
    const go = () => release();
    window.addEventListener('pagehide', go);
    return () => window.removeEventListener('pagehide', go);
  }, [release]);

  const close = useCallback(() => {
    release();
    onClose();
  }, [release, onClose]);

  // Quote once, and only once the store can be asked what the quote is.
  //
  // This used to run on mount, which is the bug at the top of this file: it
  // priced the basket before a delivery slot existed. `quoteReady` is the
  // whole change — the store has to say it knows the shopper and knows where
  // the order is going, and then the server reads the figure off the store's
  // own cart. Quoting is not charging: nothing leaves the shopper's balance
  // until they press the button.
  //
  // A second mint would hand the shopper a second código for the
  // same basket, and the código is the one thing that has to stay stable — it
  // is what makes the importe land on this order rather than somewhere else.
  //
  // The ref is the whole guard, and deliberately **not** a `live` flag in a
  // cleanup. StrictMode unmounts and remounts every effect in dev: a cleanup
  // would cancel the first mint's response while the remount declined to fire
  // a second, so the dialog sat on "Preparando…" for ever and only in dev.
  // Settling state after an unmount is a no-op in React 18, so there is
  // nothing here for a cleanup to protect against.
  const minted = useRef(false);
  useEffect(() => {
    if (minted.current) return;
    if (!quoteReady) return;

    // A gated network waits for the server's answer about this wallet. `null`
    // is "not yet", not "no" — minting now would ask without a signature and
    // spend the one mint on a refusal.
    const gated = network !== DEFAULT_NETWORK;
    if (gated && mode === null) return;
    const needsProof = gated && mode !== null && realModeNeedsProof(mode);

    // Deliberately before `minted.current`: the shopper may still log in, and
    // when they do this effect runs again with an address and mints properly.
    // The ref is what makes that safe — one mint, however many times we get here.
    if (needsProof && (!address || !sign)) {
      setMintError(ui.signInToPay);
      return;
    }

    minted.current = true;
    setMintError(null);
    (async () => {
      try {
        let proof: WalletProof | undefined;
        if (needsProof) {
          const signed = await signWalletProof(sign!, 'deposit', address!);
          if (!signed) {
            // A passkey smart wallet (C…) lands here: it cannot sign SEP-53 at
            // all, so this is the end of the road rather than a retry.
            setMintError(ui.sessionFailed);
            return;
          }
          proof = signed;
        }
        const res = await fetch('/api/deposit', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // `retailer` and `handoffUrl` are what let the server read the
          // exact importe — items plus envío — off the store's own cart and
          // throw away the figure below it. `centavos` stays because it is
          // still the fallback for a checkout with no store cart to read:
          // the rehearsal fixture, and a basket that never got a link.
          //
          // `settled` is the escape hatch and nothing more. It says the
          // shopper told us they chose a delivery; it cannot name a price,
          // and the price is still read server-side either way.
          body: JSON.stringify({
            centavos: cart.total.centavos,
            network,
            address,
            proof,
            chatId,
            ...(storeReadable ? { retailer: cart.retailer, handoffUrl } : null),
            ...(storeReadable && slotForced && !slotChosen ? { settled: true } : null),
          }),
        });
        const body = await res.json();
        if (!res.ok) {
          // `message` first: the gate's `error` is a code for the logs, and
          // its `message` is the sentence written for the shopper. In Spanish
          // only — the routes answer in Spanish and always will, since the MCP
          // server and the agent share them and neither reads this browser's
          // cookie. An English reader gets the sentence below instead: less
          // specific, and one they can read. Purchases and CardPanel do the
          // same, and explain it at more length.
          const said = lang === 'en' ? null : typeof body?.message === 'string' ? body.message : body?.error;
          setMintError(typeof said === 'string' ? said : ui.prepareFailed);
          return;
        }
        setIntent(body as DepositIntent);
      } catch {
        setMintError(ui.prepareOffline);
      }
    })();
    // `quoteReady` flips false→true once and stays, and `slotChosen` /
    // `slotForced` only ever set to true, so this list settles rather than
    // churning. A refused quote leaves its sentence on screen and does not
    // retry — the same as every other mint failure here, and for the same
    // reason: a retry loop against a route that spends money is worse than a
    // dialog the shopper reopens.
  }, [
    quoteReady,
    storeReadable,
    slotForced,
    slotChosen,
    cart.total.centavos,
    cart.retailer,
    handoffUrl,
    lang,
    network,
    mode,
    address,
    sign,
    chatId,
    ui,
  ]);

  // Poll until it lands. A 502 is the network being unreadable, not a missing
  // importe, so it leaves the screen saying "esperando" rather than "no llegó".
  useEffect(() => {
    if (!intent || deposit?.status === 'confirmed') return;
    let live = true;
    const tick = async () => {
      try {
        const q = new URLSearchParams({
          memo: intent.memo,
          amount: intent.amount,
          network: intent.network,
        });
        const res = await fetch(`/api/deposit?${q}`);
        if (!res.ok || !live) return;
        const body = (await res.json()) as DepositStatus;
        if (!live || body.status !== 'confirmed') return;
        setDeposit(body);
        track('deposit_confirmed', { network: intent.network });
      } catch {
        /* keep waiting */
      }
    };
    void tick();
    const id = setInterval(tick, DEPOSIT_POLL_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [intent, deposit?.status]);

  const payWithDemoWallet = useCallback(async () => {
    if (!intent || demoPaying || demoSent) return;
    setDemoPaying(true);
    setDemoError(null);
    try {
      const res = await fetch('/api/deposit/demo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ memo: intent.memo, amount: intent.amount, network: intent.network }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        // `message` first, same order as the mint above: the route's `error`
        // is a code for the logs and `message` is the sentence for a person.
        const said = typeof body?.message === 'string' ? body.message : null;
        setDemoError(said ?? copy.demoPayError);
        return;
      }
      // Nothing to do with the hash. The poll that was already running finds
      // the payment the same way it would find one the shopper sent, which is
      // the point — preview settles through production's code.
      setDemoSent(true);
      track('demo_pay', { network: intent.network });
    } catch {
      setDemoError(copy.demoPayError);
    } finally {
      setDemoPaying(false);
    }
  }, [intent, demoPaying, demoSent, copy.demoPayError]);

  const payWithMyWallet = useCallback(async () => {
    if (!intent || !pay || walletPaying || walletSent) return;
    setWalletPaying(true);
    setWalletError(null);
    try {
      const outcome = await pay({
        destination: intent.address,
        amount: intent.amount,
        asset:
          intent.asset.issuer === null
            ? { type: 'native' }
            : {
                // Four characters or fewer is `credit_alphanum4` and the ledger
                // treats the two as different assets, so guessing one would
                // build a payment in an asset nobody holds.
                type: intent.asset.code.length > 4 ? 'credit_alphanum12' : 'credit_alphanum4',
                code: intent.asset.code,
                issuer: intent.asset.issuer,
              },
        // The código, as MEMO_TEXT, and the single line that makes this settle.
        // `matchDeposit` rejects every payment whose `memo_type` is not `text`
        // or whose memo is not this exact string — so a send without it lands
        // on the ledger, takes the shopper's money and is never found.
        options: { memo: { type: 'text', value: intent.memo } },
      });
      if (outcome.status === 'error') {
        // `details` and `resultCode` are the ledger's verdict: English at best,
        // `tx_bad_seq` at worst. The console is where they help somebody; the
        // shopper gets the sentence written for them.
        console.error('deposit payment failed', outcome);
        track('payment_fail', { flow: 'deposit', code: outcome.resultCode ?? outcome.code ?? 'unknown' });
        setWalletError(copy.walletPayError);
        return;
      }
      // `pending` counts as sent. Horizon has the transaction either way, and
      // the poll is looking for it on the ledger rather than in this response —
      // a button that came back up here would invite a second payment for a
      // código that can only ever be credited once.
      setWalletSent(true);
      track('deposit_pay', { network: intent.network });
    } catch {
      setWalletError(copy.walletPayError);
    } finally {
      setWalletPaying(false);
    }
  }, [intent, pay, walletPaying, walletSent, copy.walletPayError]);

  /**
   * File the receipt and close the order. Once.
   *
   * `ref` is the store's own order id when the reading that triggered this
   * carried one — passed in rather than read from state because the watcher
   * calls through `settleRef`, which holds the previous render's closure, and
   * the id usually arrives in the very response that settles.
   */
  const settle = useCallback((ref?: string | null) => {
    if (!intent || done.current) return;
    done.current = true;
    // Before the receipt, not after: the order is over, and the residual goes
    // back to the wallet the moment the card dies.
    release();
    // And the record stops saying the shop is in flight. Fire-and-forget with
    // `keepalive` for the same reason `release` is: this is the end of a
    // checkout the shopper is about to walk away from, and nothing on screen
    // waits for the answer. In preview the route is a no-op — there is no row
    // to close — which is why this is not conditioned on the mode here.
    void fetch('/api/order/done', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ memo: intent.memo, network: intent.network }),
      keepalive: true,
    }).catch(() => {});
    onPaid({
      // The código is the order's name everywhere: it is what tied the importe
      // to this basket on the ledger, so it is what a person chasing it later
      // has to quote. Minting a second id here would give them two.
      orderId: intent.memo,
      // The store's own id for the order, when it gave us one. Optional all
      // the way down: without it the receipt links to the orders list, which
      // is one tap further and always true.
      ...(ref ?? orderRef ? { orderRef: (ref ?? orderRef) as string } : null),
      retailer: cart.retailer,
      paidDisplay: `${intent.amount} ${intent.asset.code}`,
      paidAt: Date.now(),
      lines: cart.lines
        .filter((l) => l.available)
        .map((l) => ({ name: l.name, quantity: l.quantity, lineTotal: l.lineTotal.display })),
      total: cart.total.display,
    });
  }, [intent, cart, onPaid, release, orderRef]);

  async function confirmPaid() {
    if (verifying) return;
    setVerifying(true);
    try {
      const res = await fetch('/api/order/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ retailer: cart.retailer, handoffUrl: handoffUrl ?? '', itemsAtHandoff }),
      });
      const body: VerifyResponse = res.ok ? await res.json() : unreadable(itemsAtHandoff);
      setVerdict(body);
      track('order_verify', { verified: String(body.verified), unknown: String(body.unknown) });
      if (body.verified) settle(body.orderRef);
    } catch {
      setVerdict(unreadable(itemsAtHandoff));
    } finally {
      setVerifying(false);
    }
  }

  // Held in a ref so the watcher below does not tear its timer down and start
  // it again every time something above this dialog re-renders. `onPaid` is an
  // inline arrow in Chat, so `settle`'s identity changes on every render of the
  // page — and a ten-second timeout that restarts that often never fires.
  const settleRef = useRef(settle);
  settleRef.current = settle;

  // What the store says about the cart, asked of the store rather than of the
  // frame — the one reading that routes around the cross-origin wall. Only for
  // a real storefront: the fixture has no orderForm to carry a profile, so
  // there "Ya ingresé" is the whole mechanism.
  //
  // ## It used to stop at the wrong moment
  //
  // This loop ended as soon as the store recognised the shopper, which is
  // exactly when the interesting question starts. So it keeps going and what it
  // is waiting for changes instead: a profile on the cart, then a chosen
  // delivery, then an empty cart. Same endpoint, same request, one loop.
  //
  // ## It is also the thing that quotes, and the thing that re-checks
  //
  // The middle of those three is what moved the importe to the end of the
  // flow: `slotChosen` arriving is what lets the mint effect above ask the
  // server for a price, and `payable` keeps arriving afterwards so the panel
  // beside the card can say the total moved. That is why there is no separate
  // re-check fetch on the way into `card` — this loop is already asking the
  // same question of the same endpoint every five to ten seconds, so the
  // figure drawn next to the card is at most one tick old.
  //
  // The reason it matters is the end of a successful checkout. VTEX sends the
  // order confirmation page with `x-frame-options: SAMEORIGIN` — the checkout
  // page it follows has no such header, which is why the frame works at all —
  // so the shopper finishes paying and the frame turns into the browser's
  // refusal to draw it. It looks like the purchase broke. It did not; the app
  // simply had no way to know it had finished, and sat there waiting for a
  // button press in front of a grey box with a sad face in it.
  //
  // Now the store is asked, and `looksPaid` closes the dialog and files the
  // receipt without anybody pressing anything.
  //
  // **This settles on the same evidence the button settles on**, which is
  // circumstantial and is described at length in lib/order-check.ts: a cart
  // that had items, has none, and carries a profile. A shopper who emptied
  // their own basket by hand looks identical. That was already true of
  // `confirmPaid` — the difference is only that nobody asserted it first, and
  // by this point the importe has already been paid and a card already issued,
  // so an abandoned basket and a placed order are not equally likely readings.
  // `release()` is preview-only, so nothing here can destroy a kept card.
  useEffect(() => {
    if (!storeReadable || done.current) return;
    if (polls >= WATCH_MAX) return;
    let live = true;
    const id = setTimeout(
      async () => {
        try {
          const res = await fetch('/api/order/verify', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ retailer: cart.retailer, handoffUrl, itemsAtHandoff }),
          });
          if (!res.ok || !live) return;
          const body = (await res.json()) as VerifyResponse;
          if (!live) return;
          if (body.identified) setIdentified(true);
          if (body.slotChosen) setSlotChosen(true);
          // Live, always: this is the figure the drift warning compares
          // against the one the shopper was quoted.
          if (body.payable > 0) setPayable(body.payable);
          // Frozen once quoted: the split on screen beside a paid importe is
          // the split that was true when the importe was named.
          if (body.breakdown.length > 0 && !intentRef.current) setBreakdown(body.breakdown);
          if (body.orderRef) setOrderRef(body.orderRef);
          if (body.verified) {
            setVerdict(body);
            track('order_verify', { verified: 'true', auto: 'true' });
            settleRef.current(body.orderRef);
          }
        } catch {
          /* the manual button covers this */
        } finally {
          if (live) setPolls((n) => n + 1);
        }
      },
      polls < IDENTIFY_MAX ? IDENTIFY_POLL_MS : WATCH_POLL_MS,
    );
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [storeReadable, polls, handoffUrl, cart.retailer, itemsAtHandoff]);

  const confirmed = deposit?.status === 'confirmed';
  // `delivery` exists only where there is a delivery to wait for. The
  // rehearsal has no orderForm and so no slot to report, and standing on a
  // step that says "esperando que elijas el envío" while nothing can ever
  // answer would be a lie told for the sake of symmetry.
  const stage: Stage = confirmed ? 'card' : intent ? 'pay' : !signedIn ? 'login' : !slotReady ? 'delivery' : 'pay';
  /** login · envío · importe. `pay` and `card` are both the third. */
  const railAt = stage === 'login' ? 0 : stage === 'delivery' ? 1 : 2;

  // Offered only after the store has had a minute and a half to report a
  // delivery and has not. See SLOT_PATIENCE_MS; the ticks that re-render this
  // are the watcher's.
  const slotLate =
    stage === 'delivery' && identifiedAt.current !== null && Date.now() - identifiedAt.current >= SLOT_PATIENCE_MS;

  // The store's total has moved since the shopper was quoted. Not an error and
  // not a second charge — it is a sentence naming both numbers, and the card
  // is still shown, because refusing it would strand somebody who has already
  // paid. `intent.centavos` is the server's own reading at quote time, so this
  // compares two figures that both came from the store.
  const drift = intent !== null && payable > 0 && payable !== intent.centavos;

  // Productos / Envío / Descuentos, in our words where we recognise the line
  // and in the store's where we do not. Zero rows are dropped, and a split
  // that is only one line is no split at all — it would print the total
  // twice, once under a label the shopper did not ask for.
  const totalLines = breakdown
    .filter((l) => l.centavos !== 0)
    .map((l) => ({
      id: l.id,
      label: l.id === 'Items' ? copy.itemsLabel : l.id === 'Shipping' ? copy.shippingLabel : l.name,
      centavos: l.centavos,
    }));
  const showSplit = totalLines.length >= 2;
  // Preview *and* a deployment that can actually sign. Both, because the mode
  // alone would render a button that 503s on a checkout with no secret set.
  const demoPays = Boolean(intent) && appMode(network) === 'preview' && intent!.demoPayable;
  // Production's equivalent. `address.startsWith('G')` is the smart-wallet
  // guard described in the header: a C-address pays by SAC transfer, which
  // leaves no classic payment for the poll to find.
  const walletPays =
    intent !== null && appMode(network) === 'production' && pay !== null && Boolean(address?.startsWith('G'));
  // Only comparable when the importe is in the asset the balance is of. A
  // network with no USDC issuer quotes native XLM (lib/deposit.ts) and
  // `balance.usdc` is not that number, so there this abstains rather than
  // guessing — and an unread balance is unknown, never zero, which is why
  // "no te alcanza" needs `balance` to be non-null before it is allowed to say
  // anything. Same rule as PaymentModal's `short`.
  const owed = intent && intent.asset.issuer !== null ? stroops(intent.amount) : null;
  const short = balance !== null && owed !== null && BigInt(balance.usdc) < owed;
  // The address and the código, for a shopper who is going to send it
  // themselves. Unchanged wherever one-click is not on offer; gone once the
  // wallet has paid, because from there a manual send is a second payment.
  const showManual = !demoPays && !(walletPays && (walletSent || confirmed));
  // The store has had four chances to say it knows this shopper and has not.
  // Most likely the frame's cookies are being blocked, which we cannot fix
  // from here — so the tab stops being the quiet option and becomes the loud
  // one, before the shopper spends another minute staring at a logged-out cart.
  const blocked = storeReadable && !identified && polls >= IDENTIFY_PATIENCE;

  return (
    <div className="modal-backdrop" onClick={close}>
      <section
        className="modal modal-wide"
        role="dialog"
        aria-modal="true"
        aria-label={copy.title}
        data-testid="checkout-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2>{copy.title}</h2>
          <button type="button" className="modal-x" onClick={close} aria-label={ui.close}>
            ×
          </button>
        </header>

        <div className="ck-step" data-testid="checkout-store">
          {/* Three things, in order, and which one they are on. The whole UX
              of the reorder is here: before it, a shopper was asked for money
              first and then discovered there were two more steps. */}
          <ol className="ck-rail" data-testid="checkout-rail">
            {[copy.stepLogin, copy.stepDelivery, copy.stepPay].map((label, i) => (
              <li
                key={label}
                className={
                  i === railAt ? 'ck-rail-step ck-rail-now' : i < railAt ? 'ck-rail-step ck-rail-done' : 'ck-rail-step'
                }
                aria-current={i === railAt ? 'step' : undefined}
              >
                <span className="ck-rail-n" aria-hidden="true">
                  {i + 1}
                </span>
                {label}
              </li>
            ))}
          </ol>

          {/* Outside the panels below, because a quote that was refused has no
              panel: `intent` is what creates one. */}
          {mintError ? (
            <p className="pay-error" data-testid="checkout-mint-error">
              {mintError}
            </p>
          ) : quoteReady && !intent ? (
            <p className="ck-lead">{ui.preparing}</p>
          ) : null}

          {stage === 'login' ? (
            <div className="ck-login" data-testid="checkout-login-step">
              <p className="ck-lead">{copy.loginLead}</p>
              {/* It does not matter which of the two they finish in. A browser
                  that blocks third-party cookies may not show the session
                  inside the frame, and it makes no difference: the cart is
                  read server-side by its own id, so both are the same cart. */}
              <p className="ck-note">{copy.loginReturn}</p>
              <div className="ck-login-actions">
                {/* On a press and never from an effect: `window.open` with no
                    user gesture is eaten by every popup blocker there is. */}
                {storeUrl ? (
                  <button
                    type="button"
                    className="btn"
                    data-testid="checkout-login"
                    onClick={() => window.open(storeUrl, '_blank', 'noopener,noreferrer')}
                  >
                    {copy.loginCta}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn-ghost"
                  data-testid="checkout-logged-in"
                  onClick={() => setIdentified(true)}
                  disabled={identified}
                >
                  {ui.loggedIn}
                </button>
              </div>
            </div>
          ) : null}

          {stage === 'delivery' ? (
            <div className="ck-delivery" data-testid="checkout-delivery">
              {identified ? (
                <p className="ck-ok" role="status" data-testid="checkout-identified">
                  {copy.identified}
                </p>
              ) : null}
              <p className="ck-lead">{copy.deliveryLead}</p>
              <p className="ck-waiting" role="status">
                {copy.deliveryWaiting}
              </p>
              {/* The escape hatch, and only after the store has had its minute
                  and a half. It skips the wait, not the reading: the server
                  still prices the basket off the store's own cart. */}
              {slotLate ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  data-testid="checkout-slot-done"
                  onClick={() => setSlotForced(true)}
                >
                  {copy.deliveryDoneCta}
                </button>
              ) : null}
            </div>
          ) : null}

          {intent ? (
            <div className="ck-pay" data-testid="checkout-pay">
              <p className="ck-lead">{copy.payLead}</p>
              {rehearsal && copy.rehearsalNote ? (
                <p className="ck-note" data-testid="checkout-rehearsal">
                  {copy.rehearsalNote}
                </p>
              ) : null}

              {/* The line this whole change exists for: envío is a row of its
                  own, and the total under it is the one the súper will charge.
                  `intent.centavos` is the server's reading, never the
                  browser's — see POST /api/deposit. */}
              <dl className="ck-totals" data-testid="checkout-totals">
                {showSplit
                  ? totalLines.map((l) => (
                      <div key={l.id} className="ck-total-line">
                        <dt>{l.label}</dt>
                        <dd>{formatARS(l.centavos)}</dd>
                      </div>
                    ))
                  : null}
                <div className="ck-total-line ck-total-sum">
                  <dt>{copy.totalLabel}</dt>
                  <dd data-testid="checkout-total">{formatARS(intent.centavos)}</dd>
                </div>
              </dl>

              <dl className="ck-fields">
                <CopyField
                  label={copy.amountLabel}
                  value={`${intent.amount} ${intent.asset.code}`}
                  copyValue={intent.amount}
                  testid="checkout-amount"
                />
              </dl>

              {/* Before the address, because it is the way this is meant to
                  go. Hidden once the importe has landed — a paid basket has
                  nothing left to pay. Always a press: nobody's balance is
                  touched by the store being read. */}
              {walletPays && !confirmed ? (
                <>
                  <p className="ck-note">{copy.walletPayLead}</p>
                  <button
                    type="button"
                    className="btn"
                    data-testid="checkout-wallet-pay"
                    disabled={walletPaying || walletSent || short}
                    onClick={() => void payWithMyWallet()}
                  >
                    {walletPaying ? copy.walletPayWorking : copy.walletPayCta}
                  </button>
                  {short ? (
                    <p className="pay-warn" data-testid="checkout-wallet-short">
                      {copy.walletPayShort}
                    </p>
                  ) : null}
                  {walletError ? (
                    <p className="pay-error" data-testid="checkout-wallet-error">
                      {walletError}
                    </p>
                  ) : null}
                </>
              ) : null}

              {/* Nothing to copy in preview: there is no wallet to paste it
                  into, and an address nobody can pay from is noise. In
                  production it is the second way rather than the only one, so
                  it is introduced as such — and it is the way out for anyone
                  who would rather not pay from their balance in one press. */}
              {showManual ? (
                <>
                  {walletPays ? <p className="ck-note">{copy.walletPayNote}</p> : null}
                  <dl className="ck-fields">
                    <CopyField label={copy.addressLabel} value={intent.address} testid="checkout-address" mono />
                    <CopyField label={copy.memoLabel} value={intent.memo} testid="checkout-memo" mono />
                  </dl>
                  <p className="ck-note">{copy.memoNote}</p>
                </>
              ) : null}
              <p className="ck-note">{copy.refundNote}</p>

              {demoPays && !confirmed ? (
                <>
                  <button
                    type="button"
                    className="btn"
                    data-testid="checkout-demo-pay"
                    disabled={demoPaying || demoSent}
                    onClick={() => void payWithDemoWallet()}
                  >
                    {demoPaying ? copy.demoPayWorking : copy.demoPayCta}
                  </button>
                  {demoError ? (
                    <p className="pay-error" data-testid="checkout-demo-error">
                      {demoError}
                    </p>
                  ) : null}
                </>
              ) : null}

              {/* Hidden until there is something to wait for. In preview
                  "esperando que llegue" before the button is pressed would
                  be waiting on the shopper, phrased as waiting on the
                  network. */}
              {demoPays && !demoSent && !confirmed ? null : (
                <p
                  className={confirmed ? 'ck-ok' : 'ck-waiting'}
                  role="status"
                  data-testid="checkout-deposit-status"
                >
                  {confirmed ? copy.confirmed : copy.waiting}
                </p>
              )}
            </div>
          ) : null}

          {/* The card, and the warning that has to come before it. The store
              moved its own total after the shopper was quoted: both numbers,
              named plainly, and no second charge and no automatic refund. The
              card is still shown — refusing it would strand somebody who has
              already sent the money. */}
          {stage === 'card' && drift && intent ? (
            <div className="ck-drift" role="status" data-testid="checkout-drift">
              <p className="pay-warn">{copy.driftTitle}</p>
              <dl className="ck-totals">
                <div className="ck-total-line">
                  <dt>{copy.driftPaid}</dt>
                  <dd>{`${intent.amount} ${intent.asset.code} · ${formatARS(intent.centavos)}`}</dd>
                </div>
                <div className="ck-total-line">
                  <dt>{copy.driftNow}</dt>
                  <dd data-testid="checkout-drift-now">{formatARS(payable)}</dd>
                </div>
              </dl>
              <p className="ck-note">{copy.driftLead}</p>
            </div>
          ) : null}

          {/* Only once the importe has landed. It is the moment the numbers
              are wanted and not a second before — and the copy says what to
              do with the card, never that anything was loaded onto it: the
              funding here is simulated, and lib/shared-card.ts says why. */}
          {stage === 'card' && intent?.cardAvailable ? (
            <>
              <p className="ck-note">{copy.cardReadyLead}</p>
              <CardPanel
                memo={intent.memo}
                network={network}
                copy={copy}
                onIssued={() => {
                  cardLive.current = true;
                }}
              />
            </>
          ) : null}

          <div className={blocked ? 'ck-tab ck-tab-up' : 'ck-tab'}>
            {handoffUrl ? (
              <a
                className={blocked ? 'btn' : 'btn btn-ghost'}
                data-testid="checkout-tab"
                href={handoffUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {copy.openTab}
              </a>
            ) : null}
            <span className="ck-note">{copy.openTabNote}</span>
          </div>

          {verdict ? (
            <p
              className={verdict.verified ? 'ck-ok' : 'pay-warn'}
              role="status"
              data-testid="checkout-verdict"
            >
              {verdict.verified ? copy.verified : verdict.unknown ? copy.unreachable : copy.unverified}
            </p>
          ) : null}

          <div className="modal-actions">
            {/* Not before the card stage: until the importe has landed there
                is nothing for the shopper to have paid with, and a press here
                would file a receipt for a purchase that has not happened. */}
            <button
              type="button"
              className="btn"
              data-testid="checkout-paid"
              onClick={() => void confirmPaid()}
              disabled={verifying || stage !== 'card'}
            >
              {verifying ? copy.checking : copy.paidCta}
            </button>
            {/* Only after the store has been asked and did not agree. The
                shopper was there and we were not, so the flow continues on
                their word — but not before we have tried to corroborate it. */}
            {verdict && !verdict.verified ? (
              <button
                type="button"
                className="btn btn-ghost"
                data-testid="checkout-anyway"
                onClick={() => settle()}
              >
                {ui.anyway}
              </button>
            ) : null}
            <button type="button" className="btn btn-ghost" onClick={close}>
              {ui.close}
            </button>
          </div>

          {/* Last, and that is the layout decision. Everything a shopper
              operates — log in, take a card, open a tab, say they paid — is
              chrome around the store's page, and while it sat *below* the
              frame the frame had to stay short enough that "Ya lo pagué" was
              still reachable: 42dvh of a súper's checkout, which is about one
              form field and a scrollbar. With the controls gathered above it,
              nothing is waiting underneath and the frame gets the rest of the
              dialog. See .ck-frame in globals.css.

              Mounted here from the first render and never unmounted. It is
              the store's own checkout: re-mounting it reloads the page and
              throws away whatever the shopper has typed into it, which is
              exactly what a step change used to do. */}
          {frameSrc ? (
            <iframe
              className="ck-frame"
              data-testid="checkout-frame"
              src={frameSrc}
              title={copy.checkoutTitle}
              // Payment needs scripts, forms and its own cookies; the rest
              // stays off. `allow-same-origin` is what lets the store keep a
              // session at all — without it every request is an opaque
              // origin and checkout cannot work.
              sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-top-navigation-by-user-activation"
              referrerPolicy="no-referrer"
            />
          ) : null}
        </div>
      </section>
    </div>
  );
}

/**
 * The verdict when the store could not be asked.
 *
 * `unknown` is the field that matters: it is what stops the copy saying the
 * store disagreed when what actually happened is that we could not reach it.
 * The money fields are zero and empty rather than absent, so nothing
 * downstream has to test for a half-built answer — see VerifyResponse.
 */
function unreadable(items: number): VerifyResponse {
  return {
    verified: false,
    identified: false,
    items,
    unknown: true,
    payable: 0,
    breakdown: [],
    slotChosen: false,
    orderRef: null,
  };
}
