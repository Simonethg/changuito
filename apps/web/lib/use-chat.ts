'use client';

import { useCallback, useRef, useState } from 'react';

import { track } from './analytics';
import {
  applyEvent,
  endTurn,
  failTurn,
  idNumber,
  initialState,
  omitErrorMessage,
  retryUser,
  seedIds,
  sendUser,
  type ChatState,
  type SendFailure,
} from './chat-state';
import type { StoredChat } from './chat-store.ts';
import type { NetworkId } from './deployments.ts';
import { notifyHumanRequired, SOLO_HUMANOS } from './human-gate-ui';
import { LOGIN_REQUIRED, LOGIN_REQUIRED_MESSAGE } from './login-constants';
import { parseEvents, type ChatRequest } from './protocol';
import { ensureUserCookie } from './session-login';
import type { WalletSigner } from './wallet-proof.ts';

/**
 * One turn at a time against /api/chat, decoded from SSE.
 *
 * `fetch` rather than EventSource: the turn is a POST with a body, and
 * EventSource can only GET. The cost is doing the frame splitting ourselves,
 * which `parseEvents` handles — a frame can be cut anywhere, including inside
 * a JSON string, so the leftover has to survive to the next chunk.
 *
 * Only one in-flight turn is allowed. A second send is ignored until the user
 * hits Parar (abort) or the stream ends — a second turn racing the first would
 * interleave two sets of tool results into one transcript.
 */
export interface UseChatAuth {
  isAuthenticated?: boolean;
  /**
   * Which mode the shopper is in. Sent with every turn because the server
   * cannot infer it — the choice lives in NetworkProvider — and it is what
   * keeps a prueba conversation out of a real one's archived history.
   */
  network?: NetworkId;
  /** Stellar address once Pollar has a session. Used to mint `chg_user`. */
  address?: string | null;
  /** Signs the login proof `chg_user` needs. Absent without Pollar. */
  sign?: WalletSigner;
}

const SESSION_SAVE_FAILED = 'No pude guardar la sesión. Probá de nuevo.';

export function useChat(auth?: UseChatAuth) {
  const [state, setState] = useState<ChatState>(initialState);
  const [loginRequired, setLoginRequired] = useState(false);
  // A ref, not state: the snapshot is read inside the send closure and must be
  // the one from the turn that just finished, not the one React rendered with.
  const snapshot = useRef<ChatState['snapshot']>(undefined);
  const sessionId = useRef<string>('');
  const abort = useRef<AbortController | null>(null);
  /** Sync lock — React state alone still lets a double-Enter race a second fetch. */
  const inFlight = useRef(false);
  // Read at send time so a login that landed this render is visible before the
  // latch effect has cleared `loginRequired`.
  const authRef = useRef<UseChatAuth>({});
  authRef.current = auth ?? {};

  const clearLoginRequired = useCallback(() => {
    setLoginRequired(false);
    setState((s) => omitErrorMessage(s, LOGIN_REQUIRED_MESSAGE));
  }, []);

  /**
   * The network half of a turn.
   *
   * Deliberately without the `loginRequired` guard: that guard exists to stop
   * the composer sending into a closed gate, and a retry is the one send that
   * has to get past it. Keeping it in `send` alone means the retry path cannot
   * be swallowed by a flag that has not been cleared yet. The caller owns
   * `inFlight`.
   */
  const run = useCallback(async (text: string) => {
    const controller = new AbortController();
    abort.current = controller;

    const post = () => {
      const body: ChatRequest = {
        sessionId: sessionId.current,
        message: text,
        snapshot: snapshot.current,
        ...(authRef.current.network ? { network: authRef.current.network } : {}),
      };
      return fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
        credentials: 'same-origin',
      });
    };

    const stopped = () => {
      setState((s) => omitErrorMessage(endTurn(s), LOGIN_REQUIRED_MESSAGE));
    };

    try {
      let res = await post();
      let minted = false;

      while (!res.ok || !res.body) {
        // Not a throw: the catch below would then handle this a second time.
        // Nothing was received either way — every one of these checks runs
        // before the route opens an MCP session or writes history — so the
        // message is still the user's to re-send.
        let message = `El servidor respondió ${res.status}.`;
        let reason: SendFailure['reason'] = 'network';
        try {
          const json = (await res.json()) as { error?: string; message?: string };
          if (json.error === SOLO_HUMANOS) {
            // The gate unmounts the whole chat, transcript included, so there
            // is nothing left to mark undelivered.
            notifyHumanRequired();
            setState((s) => endTurn(s));
            return;
          }
          if (json.error === LOGIN_REQUIRED) {
            if (authRef.current.isAuthenticated) {
              // Pollar can flip before `chg_user` is stored. Mint the cookie
              // and retry once. Do not latch the guest gate or paint its copy.
              const { address, sign } = authRef.current;
              if (controller.signal.aborted) {
                stopped();
                return;
              }
              if (!minted && address && sign) {
                minted = true;
                const ok = await ensureUserCookie(address, sign, { force: true });
                if (controller.signal.aborted) {
                  stopped();
                  return;
                }
                if (ok) {
                  res = await post();
                  continue;
                }
              }
              track('login_fail', { code: 'session' });
              setState((s) =>
                omitErrorMessage(failTurn(s, { reason: 'network', message: SESSION_SAVE_FAILED }), LOGIN_REQUIRED_MESSAGE),
              );
              return;
            }
            setLoginRequired(true);
            reason = 'login';
            message = json.message ?? LOGIN_REQUIRED_MESSAGE;
          } else if (json.message) {
            message = json.message;
          }
        } catch {
          /* not JSON */
        }
        setState((s) => failTurn(s, { reason, message }));
        return;
      }

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let rest = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const parsed = parseEvents(rest + value);
        rest = parsed.rest;
        for (const e of parsed.events) {
          if (e.t === 'done') snapshot.current = e.snapshot;
          setState((s) => applyEvent(s, e));
        }
      }
      // The stream ended without a `done`: the route died mid-turn. Whether
      // that message counts as sent depends on how far it got, which is what
      // failTurn reads off the transcript.
      setState((s) =>
        failTurn(s, { reason: 'network', message: 'Se cortó la conexión antes de terminar. Probá de nuevo.' }),
      );
    } catch (err) {
      if (controller.signal.aborted) {
        // The user pressed Parar. The server did receive the message and may
        // have half-run it, so calling it undelivered would be wrong — and
        // offering a retry would argue with what they just asked for.
        setState((s) => endTurn(s));
        return;
      }
      // The browser's own text ("Failed to fetch", "Load failed") is English
      // and names nothing the user can do. The console keeps it for a report.
      console.warn('[chat] request failed:', err);
      setState((s) =>
        failTurn(s, { reason: 'network', message: 'No pudimos hablar con el servidor. Revisá tu conexión y reintentá.' }),
      );
    }
  }, []);

  const begin = useCallback(
    async (text: string, prepare: () => void) => {
      if (inFlight.current) return;
      inFlight.current = true;
      if (authRef.current.isAuthenticated) setLoginRequired(false);
      prepare();
      try {
        await run(text);
      } finally {
        abort.current = null;
        inFlight.current = false;
      }
    },
    [run],
  );

  const send = useCallback(
    async (message: string) => {
      const text = message.trim();
      if (!text) return;
      // The latch blocks guests only. A signed-in shopper keeps sending.
      if (loginRequired && !authRef.current.isAuthenticated) return;

      sessionId.current ||= crypto.randomUUID();
      await begin(text, () => {
        setState((s) => {
          const base = authRef.current.isAuthenticated ? omitErrorMessage(s, LOGIN_REQUIRED_MESSAGE) : s;
          return base.streaming ? base : sendUser(base, text);
        });
      });
    },
    [loginRequired, begin],
  );

  /**
   * Send a message that never reached the server.
   *
   * Safe by construction: /api/chat writes history only after a clean return,
   * and the guest counter only increments on a request it allowed — so the
   * failed turn left nothing to duplicate and cost nothing to burn. The
   * session id and snapshot are untouched by a failure, so this lands on the
   * same conversation.
   *
   * The text is passed in rather than kept in a ref: the block is on screen,
   * so the caller has it fresh, and the transcript stays the only record of
   * what was said.
   */
  const retry = useCallback(
    async (id: string, text: string) => {
      if (inFlight.current) return;
      setLoginRequired(false);
      sessionId.current ||= crypto.randomUUID();
      await begin(text, () => {
        setState((s) => retryUser(s, id));
      });
    },
    [begin],
  );

  const stop = useCallback(() => {
    abort.current?.abort();
  }, []);

  /**
   * Put a stored chat back on screen, transcript and session id together.
   *
   * CLAUDE.md §4 is explicit that restoring one without the other is worse
   * than restoring neither, so this takes both or nothing: a chat the store
   * says is no longer resumable arrives here with `sessionId: null` and the
   * conversation comes back as a record the shopper can read but not continue.
   *
   * Seeding the id counter is not optional. The restored blocks are named
   * `b1`…`bN` while the module counter is still at 0, so the next block minted
   * would reuse `b1`. React keys off it and would paint a new message into an
   * old bubble.
   */
  const resume = useCallback((chat: StoredChat) => {
    if (inFlight.current) return;
    abort.current?.abort();
    seedIds(chat.blocks.reduce((hi, b) => Math.max(hi, idNumber(b.id)), 0));
    sessionId.current = chat.sessionId ?? '';
    snapshot.current = chat.snapshot ?? undefined;
    setLoginRequired(false);
    setState({
      blocks: chat.blocks,
      streaming: false,
      ...(chat.snapshot ? { snapshot: chat.snapshot } : {}),
      ...(chat.cart ? { cart: { cart: chat.cart, ...(chat.handoffUrl ? { handoffUrl: chat.handoffUrl } : {}) } } : {}),
    });
  }, []);

  /** A blank conversation the server has never heard of. */
  const reset = useCallback(() => {
    if (inFlight.current) abort.current?.abort();
    sessionId.current = '';
    snapshot.current = undefined;
    setLoginRequired(false);
    setState(initialState);
  }, []);

  /**
   * The agent's session id, or null before the first send mints one. A getter
   * rather than a value: it lives in a ref precisely because it must not
   * trigger a render, and the saver needs the one from the turn that just
   * finished.
   */
  const currentSessionId = useCallback(() => sessionId.current || null, []);

  return { state, send, retry, stop, loginRequired, clearLoginRequired, resume, reset, currentSessionId };
}
