'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { IssuedCard } from '../app/api/card/route.ts';
import type { ThreeDsCode } from '../app/api/card/3ds/route.ts';
import { track } from '../lib/analytics';
import { type CardHint, recallCard, rememberCard } from '../lib/card-store.ts';
import type { CheckoutCopy } from '../lib/checkout-copy.ts';
import type { NetworkId } from '../lib/deployments.ts';
import { DEFAULT_LANG, type Lang } from '../lib/lang.ts';
import { CardFace } from './CardFace';
import { CopyField } from './CopyField';
import { useLang } from './LangProvider';

/**
 * The card the shopper does not have to own.
 *
 * Strictly the second option. The frame is the súper's own checkout and takes
 * anybody's card for free, so this is for the shopper who would rather not put
 * their real one into a page they reached through a chat — and for a
 * deployment with no card provider it does not exist at all, which is why the
 * button is behind `intent.cardAvailable` rather than behind an error.
 *
 * ## Where the numbers live
 *
 * In this component's state, for as long as the dialog is open, and nowhere
 * else. Not localStorage — chat-store.ts has an allow-list precisely so a PAN
 * cannot arrive there by accident. Not a log. Not a Playwright trace, which is
 * why e2e/app-auth.spec.ts turns traces off for this repo. When the dialog
 * closes the card is terminated and the state goes with the unmount.
 *
 * The one thing that does outlive the dialog is four digits and a card id, in
 * `lib/card-store.ts`, and it exists to fix a sentence rather than to save a
 * round trip. In production there is one card per customer, so the second
 * deposit tops up the first — and a returning shopper shown "Generar una
 * tarjeta" would reasonably conclude they are about to be given a second one.
 * The hint changes the words. It decides nothing: the server reads
 * `card_owner` against the wallet the deposit proved, so clearing the key
 * changes the sentence and not the card.
 *
 * ## The code the bank sends to a card with no phone
 *
 * A 3DS challenge normally goes to the cardholder's mobile. This cardholder is
 * a server, so the code lands at the card provider and has about three minutes
 * to reach the shopper. Hence the poll and the countdown: a code shown without
 * one is a code somebody types just after it stops working.
 */

/** The same cadence ephemeral-card.ts polls at — the code has ~3 minutes to live. */
const OTP_POLL_MS = 3_000;
/** Stop after ~2.5 minutes of nothing, matching OTP_TIMEOUT_MS there. */
const OTP_MAX_POLLS = 50;

interface Props {
  /** The order's name. Also its credential: the server looks up which card
   *  this deposit bought rather than trusting a card id from the browser. */
  memo: string;
  network: NetworkId;
  copy: CheckoutCopy;
  /** Fired when a card starts existing, so the dialog knows it owes one back. */
  onIssued: () => void;
}

export function CardPanel({ memo, network, copy, onIssued }: Props) {
  const lang = useLang();
  const [card, setCard] = useState<IssuedCard | null>(null);
  const [minting, setMinting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read once, after mount. Never during render: the server has no
  // localStorage, so reading it in the render body would make the first
  // browser paint disagree with the HTML it is hydrating. Only where the copy
  // for it exists, which is the mode where a card is actually kept.
  const [hint, setHint] = useState<CardHint | null>(null);
  useEffect(() => {
    if (copy.cardAgainCta) setHint(recallCard(network));
  }, [network, copy.cardAgainCta]);

  // Ask before offering. In this mode the card belongs to the customer and
  // outlives the basket, so the one this checkout needs may already exist —
  // and "Generar mi tarjeta" in front of somebody who has one is a button
  // that cannot do what it says. The server would refuse it, `card_owner` is
  // unique per wallet, but they would still have pressed it and watched it
  // fail.
  //
  // `copy.cardAgainCta` is the production marker, the same one the hint read
  // above uses: in preview the card is per basket, nothing is bound, and
  // there is nothing to find.
  //
  // No address and no signature. The route takes the session cookie and reads
  // the card of whoever it belongs to; a body address would be ignored in
  // favour of the cookie anyway. Without a session this 400s and the mint
  // button below is the whole of the flow, exactly as before.
  useEffect(() => {
    if (!copy.cardAgainCta) return;
    let live = true;
    void (async () => {
      try {
        const res = await fetch('/api/card/mine', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ network }),
        });
        if (!res.ok || !live) return;
        const body = (await res.json()) as { card?: IssuedCard | null };
        if (!live || !body?.card) return;
        setCard(body.card);
      } catch {
        // Silent on purpose. Nothing was asked for, so a failure is not news:
        // the mint button is still there and still works, and an error about
        // a read the shopper did not request would sit in front of the thing
        // they did.
      }
    })();
    return () => {
      live = false;
    };
  }, [network, copy.cardAgainCta]);

  const [otp, setOtp] = useState<ThreeDsCode | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [polls, setPolls] = useState(0);
  // Ids already put in front of the shopper. `pickChallenge` in
  // packages/mcp/src/pay/ephemeral-card.ts keeps the same set for the same
  // reason: showing a stale code twice sends someone back to a form that will
  // reject it. A ref, not state — changing it must not restart the poll.
  const seen = useRef<string[]>([]);

  const issue = useCallback(async () => {
    if (minting || card) return;
    setMinting(true);
    setError(null);
    try {
      const res = await fetch('/api/card', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ memo, network }),
      });
      const body = await res.json();
      if (!res.ok) {
        // The server's own sentence when it has one worth reading — "el
        // importe supera el máximo" tells the shopper something they can act
        // on, where a generic failure does not. The routes write theirs as
        // lowercase fragments, so it is punctuated here rather than there:
        // it is about to be followed by another sentence.
        setError(said(body, lang) ?? copy.cardError);
        return;
      }
      const issued = body as IssuedCard;
      setCard(issued);
      // Four digits and an id, and only in the mode that keeps a card. In
      // preview this would be a note about a card that no longer exists by
      // the time anyone reads it.
      if (copy.cardAgainCta) {
        rememberCard(network, { cardId: issued.cardId, last4: issued.last4, brand: issued.brand });
      }
      onIssued();
      track('card_issued', { network, again: Boolean(hint) });
    } catch {
      setError(copy.cardError);
    } finally {
      setMinting(false);
    }
  }, [minting, card, lang, memo, network, copy.cardError, copy.cardAgainCta, hint, onIssued]);

  // Watch for a challenge for as long as there is a card to challenge. A
  // failed poll is a poll, not a verdict — the route answers `code: null` for
  // an unreachable provider too, and the next tick asks again.
  useEffect(() => {
    if (!card || polls >= OTP_MAX_POLLS) return;
    let live = true;
    const id = setTimeout(async () => {
      try {
        const q = new URLSearchParams({ memo, network, seen: seen.current.join(',') });
        const res = await fetch(`/api/card/3ds?${q}`);
        if (!res.ok || !live) return;
        const body = (await res.json()) as { code: ThreeDsCode | null };
        if (!live || !body.code) return;
        // The route already filters by `seen`, and this list is what it
        // filters by — so a repeat means the provider re-sent a code we have
        // shown. Adding it twice would grow the query string on every poll
        // and restart the countdown on a code that is already running out.
        if (seen.current.includes(body.code.id)) return;
        seen.current = [...seen.current, body.code.id];
        setOtp(body.code);
        track('card_3ds', { network });
      } catch {
        /* ask again */
      } finally {
        if (live) setPolls((n) => n + 1);
      }
    }, OTP_POLL_MS);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [card, polls, memo, network]);

  // One second at a time, and only while there is something counting down.
  //
  // `now` is read straight away rather than left at whatever it was: it was
  // last set when the panel mounted, which may be a minute before a code
  // arrives, and the first frame of a countdown would otherwise show a figure
  // that is too high by exactly that long before correcting itself.
  useEffect(() => {
    if (!otp?.expiresAt) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [otp?.expiresAt]);

  const left = otp?.expiresAt ? Math.max(0, Math.floor((otp.expiresAt - now) / 1000)) : null;
  const expired = left === 0;

  if (!card) {
    // The same button either way — `POST /api/card` works out for itself
    // whether this deposit mints a card or tops one up, and it is the only
    // thing that can. All that changes here is what the shopper is told is
    // about to happen.
    return (
      <div className="ck-card" data-testid="checkout-card">
        <h4 className="ck-card-title">{copy.cardTitle}</h4>
        <p className="ck-note">{hint ? copy.cardAgainLead : copy.cardLead}</p>
        {error ? (
          <p className="pay-warn" role="status" data-testid="checkout-card-error">
            {error} {copy.cardFallback}
          </p>
        ) : null}
        <button
          type="button"
          className="btn btn-ghost"
          data-testid="checkout-card-issue"
          onClick={() => void issue()}
          disabled={minting}
        >
          {minting ? copy.cardMinting : hint ? `${copy.cardAgainCta} ····${hint.last4}` : copy.cardCta}
        </button>
      </div>
    );
  }

  return (
    <div className="ck-card ck-card-live" data-testid="checkout-card">
      <h4 className="ck-card-title">
        {copy.cardTitle} <span className="ck-brand">{card.brand}</span>
      </h4>
      <CardFace
        card={card}
        labels={{
          number: copy.cardNumberLabel,
          expiry: copy.cardExpiryLabel,
          cvv: copy.cardCvvLabel,
        }}
        idPrefix="checkout-card"
      />
      {/* The figure first: it is the fact, and the sentence is the reassurance. */}
      <p className="ck-note">
        {card.fundedDisplay}. {copy.cardFunded}
      </p>
      <p className="ck-note">{copy.cardNote}</p>

      <div className="ck-otp" data-testid="checkout-otp">
        <h4 className="ck-card-title">{copy.otpTitle}</h4>
        {!otp ? (
          <p className="ck-waiting" role="status">
            {copy.otpWaiting}
          </p>
        ) : expired ? (
          <p className="pay-warn" role="status" data-testid="checkout-otp-expired">
            {copy.otpExpired}
          </p>
        ) : (
          <>
            <dl className="ck-fields">
              <CopyField label={copy.otpLabel} value={otp.otp} testid="checkout-otp-code" mono />
            </dl>
            <p className="ck-note" role="status">
              {copy.otpLead}
              {left === null ? null : <span className="ck-countdown"> {clock(left)}</span>}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * What a failed route said, if it said anything this reader can parse.
 *
 * Nothing, in English. The API routes answer in Spanish and always will — they
 * are shared with the MCP server and with the agent, and neither of those
 * reads a cookie from this browser. Handing over the server's sentence would
 * put a Spanish fragment in front of the one reader who cannot use it, so the
 * caller's own fallback wins instead: less specific, and readable. Purchases
 * has the same helper, for the same reason.
 */
function said(body: unknown, lang: Lang = DEFAULT_LANG): string | null {
  if (lang === 'en') return null;
  const b = (body ?? {}) as { error?: unknown };
  return typeof b.error === 'string' ? sentence(b.error) : null;
}

/** A fragment from an API turned into something that can sit in a paragraph. */
function sentence(text: string): string {
  const t = text.trim();
  if (!t) return '';
  const capped = t[0].toUpperCase() + t.slice(1);
  return /[.!?]$/.test(capped) ? capped : `${capped}.`;
}

/** 4111111111111111 -> 4111 1111 1111 1111. Display only. */
function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
