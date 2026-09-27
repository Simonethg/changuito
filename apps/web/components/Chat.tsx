'use client';

import { usePollar } from '@pollar/react';
import { useEffect, useRef, useState } from 'react';

import type { Cart } from '@changuito/mcp/types';

import { starters } from '../lib/agent/prompt';
import { errorCode, track, trackLoginStart } from '../lib/analytics';
import { canRetry, type Block, type ChatState } from '../lib/chat-state';
import type { Receipt } from '../lib/chat-store.ts';
import { INTL_LOCALE, type Lang } from '../lib/lang.ts';
import {
  FREE_TURNS,
  loginCta,
  LOGIN_REQUIRED_MESSAGE,
  loginGateBannerText,
  loginRequiredMessage,
} from '../lib/login-constants';
import { pollarEnabled } from '../lib/pollar';
import { ensureUserCookie } from '../lib/session-login';
import { storeOrdersUrl } from '../lib/storefront.ts';
import { progressCopy } from '../lib/turn-progress.ts';
import { uiCopy } from '../lib/ui-copy.ts';
import { useChat } from '../lib/use-chat';
import { useWalletSigner } from '../lib/use-wallet-signer.ts';
import type { WalletSigner } from '../lib/wallet-proof.ts';
import { CartCard } from './CartCard';
import { useLang } from './LangProvider';
import { useNetwork } from './NetworkProvider';
import { RetryIcon } from './icons';
import { CheckoutModal } from './CheckoutModal';
import { ProductGrid } from './ProductGrid';
import { useShop } from './ShopProvider';
import { MarkdownText } from './MarkdownText';
import { ReportBug } from './ReportBug';
import { ToolTrail } from './ToolTrail';

/** Same breakpoint as the phone layout in globals.css. */
const NARROW = '(max-width: 560px)';

/**
 * The placeholder for this screen.
 *
 * The server renders the first one; the random pick and the phone variant
 * happen after mount. Picking at random during render gave the server and the
 * browser different attributes, which React reports and does not repair.
 *
 * Each prompt has a short twin for phones. The long ones run four lines in a
 * 390px field, which is past the height cap, so an empty box showed a
 * scrollbar and a sentence cut in half. The short ones fit two lines at 360px.
 * Both halves live in `ui-copy.ts`, in both languages.
 */
function useComposerPlaceholder(lang: Lang): string {
  const pairs = uiCopy(lang).chat.placeholders;
  const [text, setText] = useState<string>(pairs[0]!.long);
  useEffect(() => {
    const pick = pairs[Math.floor(Math.random() * pairs.length)]!;
    const narrow = window.matchMedia(NARROW);
    const apply = () => setText(narrow.matches ? pick.short : pick.long);
    apply();
    narrow.addEventListener('change', apply);
    return () => narrow.removeEventListener('change', apply);
  }, [pairs]);
  return text;
}

export function Chat() {
  // Same split as WalletWidget: usePollar only mounts inside a real provider.
  return pollarEnabled ? <ChatWithPollar /> : <ChatCore />;
}

function ChatWithPollar() {
  const { isAuthenticated, openLoginModal, wallet } = usePollar();
  const sign = useWalletSigner();
  const address = isAuthenticated ? (wallet?.address ?? null) : null;
  return <ChatCore isAuthenticated={isAuthenticated} openLoginModal={openLoginModal} address={address} sign={sign} />;
}

function ChatCore({
  isAuthenticated = false,
  address = null,
  openLoginModal,
  sign,
}: {
  isAuthenticated?: boolean;
  address?: string | null;
  openLoginModal?: () => void;
  /** The wallet's SEP-53 signer. Absent in a build without Pollar. */
  sign?: WalletSigner;
}) {
  const { network } = useNetwork();
  const lang = useLang();
  const copy = uiCopy(lang).chat;
  // `lang` rides along so the agent answers in the language the footer is set
  // to. Nothing else about the request changes with it.
  const { state, send, retry, stop, loginRequired, clearLoginRequired, resume, reset, currentSessionId } =
    useChat({ isAuthenticated, address, sign, network, lang });
  const [draft, setDraft] = useState('');
  const placeholder = useComposerPlaceholder(lang);
  // The basket the payment modal is open over. A cart, not a block id: the
  // user pays for what a card showed, and that object is the record of it.
  const [paying, setPaying] = useState<{ cart: Cart; handoffUrl?: string } | null>(null);
  const thread = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);

  // The rails are siblings in the layout, not children, so everything they
  // draw has to be handed up — and the same hand-up is what gets written to
  // storage. Published after each turn rather than on every delta: a save per
  // token would be one JSON.stringify of the whole transcript per character.
  const shop = useShop();
  const publish = shop?.publish;
  useEffect(() => {
    if (!publish || state.streaming) return;
    publish({ state, sessionId: currentSessionId() });
  }, [publish, state, currentSessionId]);

  // The provider asks, this answers. Both halves of a restore land together —
  // transcript and session id — which is the whole point of CLAUDE.md §4.
  const request = shop?.request;
  const ack = shop?.ack;
  useEffect(() => {
    if (!request || !ack) return;
    if (request.kind === 'new') reset();
    else resume(request.chat);
    setDraft('');
    setPaying(null);
    ack();
  }, [request, ack, resume, reset]);

  // One chat is one order. Re-checked at /api/deposit, because a rule about
  // money does not get to live in a browser — but refusing here is what stops
  // the shopper writing a second basket nobody will let them pay for.
  const readOnly = shop?.readOnly ?? false;
  const newChat = shop?.newChat;
  // Defaults to true with no provider at all — app/dev/ui renders the chat
  // bare, and a fixture page with a dead pay button would be worse than one
  // whose button opens a modal.
  const canOrder = shop?.canOrder ?? true;
  // The rail shows this too, on a wide window. Two views of one order rather
  // than two orders — same relationship the basket already has with CartCard.
  // It is in the thread because the thread is the only one of the two that
  // exists at 390px, and a receipt you cannot open on a phone is not one.
  const receipt = shop?.receipt ?? null;

  useEffect(() => {
    const el = thread.current;
    if (!el) return;
    // The page itself does not scroll. Jumping with scrollIntoView walks
    // ancestors and, on iOS, pans the visual viewport so the composer
    // disappears under the keyboard. Scroll the thread only.
    // The empty greeting is read from the top; pinning to the end would
    // hide "Hola" behind the fold of a short phone.
    if (state.blocks.length === 0) {
      el.scrollTop = 0;
      return;
    }
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [state.blocks]);

  // After Pollar login, drop the guest latch and any soft-limit line already
  // written into the transcript. The banner also keys off isAuthenticated, so
  // a signed-in shopper never keeps the red gate for this render.
  useEffect(() => {
    if (isAuthenticated) clearLoginRequired();
  }, [isAuthenticated, clearLoginRequired]);

  /** True once the server has the cookie, not merely once Pollar says hello. */
  const [sessionReady, setSessionReady] = useState(false);

  // The cookie is what /api/chat actually reads, and minting it is a round
  // trip. The banner can hide as soon as Pollar says the shopper is in, but
  // re-sending the rejected message has to wait until the mint resolved —
  // otherwise the retry POSTs into the same 401. Keyed on the address because
  // `wallet` can still be null when the flag flips.
  useEffect(() => {
    if (!isAuthenticated || !address || !sign) {
      setSessionReady(false);
      return;
    }
    let live = true;
    void ensureUserCookie(address, sign).then((ok) => {
      if (!live) return;
      clearLoginRequired();
      if (ok) setSessionReady(true);
    });
    return () => {
      live = false;
    };
  }, [isAuthenticated, address, sign, clearLoginRequired]);

  // Guests at the limit. Signed-in shoppers never match, even if the latch is
  // still true for this render or the free-turn count is already spent.
  const gateText = loginGateBannerText({ isAuthenticated, loginRequired }, lang);
  const gated = gateText !== null;
  const loginCopyVisible =
    loginGateBannerText({ isAuthenticated, loginRequired: true, turnsUsed: FREE_TURNS }) !== null;

  // `disabled` blurs the composer the moment a turn starts, and nothing gives
  // the focus back when it ends — so the obvious thing, typing the next
  // message, silently goes nowhere. Shopping is a conversation; the cursor
  // should be waiting where the next sentence goes.
  useEffect(() => {
    if (!state.streaming && !gated && !readOnly) composer.current?.focus();
  }, [state.streaming, gated, readOnly]);

  const last = state.blocks.at(-1);
  const undelivered = !state.streaming && last?.kind === 'user' && last.failed ? last : null;

  // The message the gate rejected goes on its own once the user is through it.
  // Once per message id: a second refusal re-marks the same block, and this
  // ref is what stops that becoming a loop against the network. The manual
  // button is still there when it does.
  const resumed = useRef<string | null>(null);
  useEffect(() => {
    if (!sessionReady || !undelivered || undelivered.failed?.reason !== 'login') return;
    if (resumed.current === undelivered.id) return;
    resumed.current = undelivered.id;
    void retry(undelivered.id, undelivered.text);
  }, [sessionReady, undelivered, retry]);

  const submit = (text: string) => {
    if (state.streaming || gated || readOnly || !text.trim()) return;
    setDraft('');
    track('search_submit');
    void send(text);
  };

  const sawGate = useRef(false);
  useEffect(() => {
    if (gated && !sawGate.current) track('search_limit_hit');
    sawGate.current = gated;
  }, [gated]);

  const seenError = useRef<string | null>(null);
  useEffect(() => {
    const lastError = [...state.blocks].reverse().find((b) => b.kind === 'error');
    if (!lastError || lastError.kind !== 'error' || seenError.current === lastError.id) return;
    seenError.current = lastError.id;
    track('error_shown', { code: errorCode(lastError.message) });
  }, [state.blocks]);

  return (
    // `is-empty` is the hook for the mobile first-screen layout. The class is
    // server-rendered with the initial state, so compact CSS applies before
    // hydration and the shell can target it with :has().
    <div className={state.blocks.length === 0 ? 'chat is-empty' : 'chat'}>
      <div
        ref={thread}
        className="thread"
        data-testid="chat-thread"
        role="log"
        aria-live="polite"
        aria-busy={state.streaming}
      >
        {state.blocks.length === 0 ? <Greeting onPick={submit} /> : null}

        {state.blocks.map((b) => {
          switch (b.kind) {
            case 'user':
              return (
                <UserBubble
                  key={b.id}
                  block={b}
                  canRetry={canRetry(state, b.id)}
                  onRetry={retry}
                />
              );
            case 'say':
              return (
                <div key={b.id} className="bubble is-agent">
                  <ToolTrail tools={b.tools} />
                  {b.thinking && !b.text ? <p className="thinking">{b.thinking}</p> : null}
                  {b.text ? <MarkdownText text={b.text} /> : null}
                </div>
              );
            case 'products':
              return <ProductGrid key={b.id} items={b.items} note={b.note} />;
            case 'cart':
              return (
                <CartCard
                  key={b.id}
                  cart={b.cart}
                  handoffUrl={b.handoffUrl}
                  // No longer gated on a wallet. The frame-checkout flow asks
                  // for an importe and a code, and the shopper pays the súper
                  // themselves — there is nothing here to sign, so requiring a
                  // session to sign with would shut the door on the people the
                  // flow was built for.
                  onPay={
                    // Not just disabled: a paid chat's card is a record of
                    // what was bought, and a Pagar on it invites paying twice.
                    canOrder
                      ? (cart) => {
                          track('payment_start', { flow: 'frame' });
                          setPaying({ cart, handoffUrl: b.handoffUrl });
                        }
                      : undefined
                  }
                />
              );
            case 'error':
              // The soft-limit line is guest copy. Once the shopper is signed
              // in it is not an error, and leaving it in the thread reads as
              // the gate still being shut.
              // Either language — the line was written in whichever the
              // footer was set to when the gate answered.
              if (
                (b.message === LOGIN_REQUIRED_MESSAGE || b.message === loginRequiredMessage('en')) &&
                !loginCopyVisible
              ) {
                return null;
              }
              return (
                <p key={b.id} className="bubble is-error" role="alert">
                  {b.message}
                </p>
              );
          }
        })}

        {state.streaming && state.blocks.at(-1)?.kind === 'user' ? (
          // Copy first, then the back-and-forth search GIF. The idle PNG is
          // only the reduced-motion fallback (hidden in CSS until then).
          <p className="bubble is-agent thinking" data-testid="search-loading">
            {/* The Spanish is written out rather than looked up:
                lib/test/search-loading.test.ts reads this file as text and
                asserts the sentence sits in this block, before the GIF. */}
            <span>{lang === 'en' ? copy.searching : 'Buscando en el súper…'}</span>
            <img
              className="thinking-mascot thinking-mascot-motion"
              src="/brand/animacion-busqueda.gif"
              alt=""
              aria-hidden="true"
              width={54}
              height={36}
            />
            <img
              className="thinking-mascot thinking-mascot-still"
              src="/brand/mascot-idle.png"
              alt=""
              aria-hidden="true"
              width={25}
              height={36}
            />
          </p>
        ) : null}
        {receipt ? <ReceiptCard receipt={receipt} /> : null}
        <ReportBug />
      </div>

      {gated && gateText ? (
        <div className="login-gate-banner" data-testid="login-gate-banner" role="status">
          <img
            className="login-gate-mascot"
            src="/brand/mascot-idle.png"
            alt=""
            aria-hidden="true"
            width={48}
            height={48}
          />
          <div className="login-gate-copy">
            <p className="login-gate-title">{copy.signInLead}</p>
            <p>{gateText}</p>
          </div>
          {openLoginModal ? (
            <button
              type="button"
              className="btn"
              onClick={() => {
                track('login_cta_from_limit');
                trackLoginStart(openLoginModal);
              }}
            >
              {loginCta(lang)}
            </button>
          ) : (
            <p className="login-gate-muted">{copy.loginUnconfigured}</p>
          )}
        </div>
      ) : null}

      {readOnly ? (
        <div className="composer composer-closed" data-testid="composer-closed" role="status">
          <p className="composer-closed-copy">{copy.closed}</p>
          <button type="button" className="btn" data-testid="composer-new-chat" onClick={() => newChat?.()}>
            {copy.newChat}
          </button>
        </div>
      ) : (
      <form
        className="composer"
        data-testid="composer"
        onSubmit={(e) => {
          e.preventDefault();
          submit(draft);
        }}
      >
        <textarea
          ref={composer}
          className="composer-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit(draft);
            }
          }}
          placeholder={placeholder}
          rows={2}
          enterKeyHint="send"
          disabled={state.streaming || gated}
          autoFocus
        />
        {state.streaming ? (
          <button type="button" className="btn btn-ghost" onClick={stop} aria-label={copy.stopAria}>
            {copy.stop}
          </button>
        ) : (
          <button type="submit" className="btn" data-testid="composer-send" disabled={!draft.trim() || gated}>
            {copy.send}
          </button>
        )}
        {state.streaming ? <TurnProgressLine state={state} /> : null}
      </form>
      )}

      {paying ? (
        <CheckoutModal
          cart={paying.cart}
          handoffUrl={paying.handoffUrl}
          // The chat the server knows, which is the one `archiveChat` wrote —
          // `publish` files the record under the agent's session id, so this
          // is the same uuid `orders.chat_id` references. Undefined until the
          // first turn lands, and in preview forever, which is correct: there
          // is no row to be one order of.
          chatId={shop?.activeChatId ?? undefined}
          onClose={() => setPaying(null)}
          // settle() closes the chat as well as filing the receipt: one chat
          // is one order, and this is the moment that becomes true.
          onPaid={(receipt) => {
            setPaying(null);
            shop?.settle(receipt);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * What the shopper paid, at the end of the chat that paid it.
 *
 * Every amount is the string that was on screen when the order was placed,
 * carried through storage untouched. Nothing here is recomputed from a number
 * now: a receipt that re-prices itself when a rate moves is not a receipt.
 */
function ReceiptCard({ receipt }: { receipt: Receipt }) {
  const lang = useLang();
  const copy = uiCopy(lang).chat;
  const ordersUrl = storeOrdersUrl(receipt.retailer);
  return (
    <section className="card receipt" data-testid="receipt" aria-label={copy.receiptAria}>
      <header className="receipt-head">
        <strong>{copy.receiptTitle}</strong>
        <time dateTime={new Date(receipt.paidAt).toISOString()}>{paidOn(receipt.paidAt, lang)}</time>
      </header>
      <ul className="receipt-lines">
        {receipt.lines.map((l, i) => (
          // Frozen list: no line can move under React, so the index is stable
          // here in a way it would not be in a basket still being edited.
          <li key={i}>
            <span className="receipt-qty">{l.quantity}×</span>
            <span className="receipt-name">{l.name}</span>
            <span className="receipt-amount">{l.lineTotal}</span>
          </li>
        ))}
      </ul>
      <footer className="receipt-foot">
        <div className="receipt-total">
          <span>{copy.total}</span>
          <strong>{receipt.total}</strong>
        </div>
        <p className="receipt-ref">{copy.paidRef(receipt.paidDisplay, receipt.orderId)}</p>
        {/* The store's own page, because that is where the delivery is, and
            because the confirmation page the shopper was on when they paid
            refuses to be framed — see lib/storefront.ts. The list rather than
            the order: the id is on the one page we cannot read. */}
        {ordersUrl ? (
          <a
            className="receipt-store"
            data-testid="receipt-store"
            href={ordersUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {copy.orderAtStore}
          </a>
        ) : null}
      </footer>
    </section>
  );
}

/** The date, in the reader's own words. Empty rather than throwing where Intl is odd. */
function paidOn(at: number, lang: Lang): string {
  try {
    return new Intl.DateTimeFormat(INTL_LOCALE[lang], {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(at));
  } catch {
    return '';
  }
}

/**
 * The user's own message, and whether it got there.
 *
 * The wrapper is present in both states so the bubble does not jump when the
 * mark clears on a retry.
 */
export function UserBubble({
  block,
  canRetry: retryable,
  onRetry,
}: {
  block: Extract<Block, { kind: 'user' }>;
  canRetry: boolean;
  onRetry: (id: string, text: string) => void;
}) {
  const copy = uiCopy(useLang()).chat;
  return (
    <div className="msg-user">
      <p className={block.failed ? 'bubble is-user is-undelivered' : 'bubble is-user'}>{block.text}</p>
      {block.failed ? (
        <div className="msg-failed">
          <span className="msg-failed-note" role="alert">
            {block.failed.reason === 'login'
              ? copy.undeliveredLogin
              : block.failed.reason === 'dropped'
                ? copy.dropped
                : copy.undelivered}
            {/* The why, so "no se envió" is something the user (and a bug
                report) can act on. The login copy already is the why. */}
            {block.failed.reason !== 'login' && block.failed.message ? (
              <span className="msg-failed-detail">{block.failed.message}</span>
            ) : null}
          </span>
          {retryable ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm msg-retry"
              data-testid="message-retry"
              aria-label={copy.retryAria}
              onClick={() => onRetry(block.id, block.text)}
            >
              <RetryIcon />
              {copy.retry}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * What the turn is doing and for how long, under the composer.
 *
 * Mounted only while a turn streams, so its first render is the turn's start.
 * The seconds are aria-hidden: announcing a counter every second would drown
 * the stage changes, which are the part worth hearing.
 */
export function TurnProgressLine({ state }: { state: ChatState }) {
  const lang = useLang();
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const copy = progressCopy(state, now - startedAt, lang);
  return (
    <div className="composer-hint turn-progress" data-testid="turn-progress">
      <p className="turn-progress-stage">
        <span role="status">{copy.stage}</span>
        <span className="turn-progress-time" aria-hidden="true">
          {copy.seconds} s
        </span>
      </p>
      <p className="turn-progress-hint" aria-live="polite">
        {copy.hint}
      </p>
    </div>
  );
}

function Greeting({ onPick }: { onPick: (text: string) => void }) {
  const lang = useLang();
  const copy = uiCopy(lang).chat;
  return (
    <div className="greeting" data-testid="greeting">
      <h2>{copy.hi}</h2>
      <p className="greeting-body" data-testid="greeting-body">{copy.greeting}</p>
      <p className="greeting-hint">{copy.starterLead}</p>
      <ul className="starters">
        {starters(lang).map((s) => (
          <li key={s}>
            <button type="button" className="starter" onClick={() => onPick(s)}>
              {s}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
