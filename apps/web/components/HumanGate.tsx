'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { track } from '../lib/analytics';
import {
  clientGateDecision,
  HUMAN_REQUIRED_EVENT,
  type ClientGateDecision,
} from '../lib/human-gate-ui';
import { uiCopy } from '../lib/ui-copy.ts';
import { ReportBug } from './ReportBug';
import { useLang } from './LangProvider';

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          callback: (token: string) => void;
          'error-callback'?: (code?: string) => void;
          'expired-callback'?: () => void;
          'timeout-callback'?: () => void;
          appearance?: 'always' | 'execute' | 'interaction-only';
          theme?: 'light' | 'dark' | 'auto';
          size?: 'normal' | 'compact' | 'flexible';
          retry?: 'auto' | 'never';
        },
      ) => string;
      reset: (id: string) => void;
      remove: (id: string) => void;
    };
  }
}

type HumanStatus = { ok?: boolean; mode?: string; siteKey?: string };

/**
 * Literal member read so Next inlines the public site key into this bundle.
 * Without it the browser only had whatever the prerender baked in, which was
 * empty, and Turnstile never mounted.
 */
const BUNDLED_SITE_KEY = (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '').trim();


async function fetchStatus(): Promise<HumanStatus> {
  const res = await fetch('/api/human', {
    method: 'GET',
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
  });
  return (await res.json()) as HumanStatus;
}

/**
 * The cookie is httpOnly, so the only proof it stuck is a follow-up GET.
 * One short retry covers browsers that apply Set-Cookie a tick late.
 */
async function cookieIsDurable(): Promise<boolean> {
  for (const delayMs of [0, 300]) {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    try {
      const status = await fetchStatus();
      if (status.mode === 'open' || status.ok === true) return true;
    } catch {
      /* try the second read */
    }
  }
  return false;
}

/**
 * Wraps the shopper UI. Turnstile runs once, /api/human sets the httpOnly
 * cookie, and chat stays hidden until that cookie reads back as valid.
 * Local/dev without keys: the server says mode=open and the chat unlocks.
 * Production never unlocks just because the site key is missing from the bundle.
 */
export function HumanGate({
  children,
  siteKey = '',
}: {
  children: ReactNode;
  siteKey?: string;
}) {
  // Was a module constant. It follows the language now, and every use of it is
  // inside this component, so a local of the same name is the whole change.
  const COPY = uiCopy(useLang()).gate;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needWidget, setNeedWidget] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activeKey, setActiveKey] = useState((siteKey || BUNDLED_SITE_KEY).trim());
  const [mountId, setMountId] = useState(0);
  const [slow, setSlow] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const activeKeyRef = useRef(activeKey);
  activeKeyRef.current = activeKey;

  const applyStatus = useCallback((status: HumanStatus) => {
    const key = (status.siteKey || siteKey || BUNDLED_SITE_KEY || activeKeyRef.current).trim();
    if (key) setActiveKey(key);
    const decision: ClientGateDecision = clientGateDecision({
      mode: status.mode,
      ok: status.ok,
      siteKey: key,
    });
    if (decision.action === 'unlock') {
      setReady(true);
      setNeedWidget(false);
      setBlocked(false);
      setError(null);
      track('human_gate_pass', { mode: status.mode === 'open' ? 'open' : 'cookie' });
      if (status.mode === 'open') {
        console.warn(
          '[changuito] human-gate abierto en local (sin Turnstile). En producción hace falta NEXT_PUBLIC_TURNSTILE_SITE_KEY + TURNSTILE_SECRET_KEY.',
        );
        // Best-effort cookie so later hops look the same. Chat does not wait on it.
        void fetch('/api/human', {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({}),
          credentials: 'same-origin',
          cache: 'no-store',
        }).catch((err: unknown) => {
          console.warn('[changuito] human-gate cookie mint falló (chat igual abierto):', err);
        });
      }
      return;
    }
    setReady(false);
    if (decision.action === 'widget') {
      setActiveKey(decision.siteKey);
      setNeedWidget(true);
      setBlocked(false);
      setError(null);
      return;
    }
    setNeedWidget(false);
    setBlocked(true);
    setError(decision.reason === 'unconfigured' ? COPY.startFailed : null);
    track('human_gate_fail', { code: decision.reason });
  }, [siteKey]);

  const refresh = useCallback(async () => {
    const status = await fetchStatus();
    applyStatus(status);
  }, [applyStatus]);

  const exchange = useCallback(async (token: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/human', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ token }),
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(json.message ?? COPY.verifyFailed);
      }
      const stored = await cookieIsDurable();
      if (!stored) throw new Error(COPY.cookieMissing);
      setReady(true);
      setNeedWidget(false);
      setBlocked(false);
      setError(null);
      track('human_gate_pass', { mode: 'turnstile' });
    } catch (err: unknown) {
      track('human_gate_fail', { code: 'verify' });
      setError(err instanceof Error ? err.message : COPY.widgetFailed);
      if (widgetId.current && window.turnstile) {
        try {
          window.turnstile.reset(widgetId.current);
        } catch {
          /* widget already gone */
        }
      }
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const status = await fetchStatus();
        if (!cancelled) applyStatus(status);
      } catch {
        if (cancelled) return;
        // A down API is not a pass. Local without keys still unlocks when
        // the server answers mode=open. Production stays on this screen.
        setReady(false);
        setNeedWidget(false);
        setBlocked(true);
        setError(COPY.startFailed);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyStatus, mountId]);

  useEffect(() => {
    if (ready || needWidget || blocked) return;
    const timer = window.setTimeout(() => setSlow(true), 8000);
    return () => window.clearTimeout(timer);
  }, [ready, needWidget, blocked, mountId]);

  useEffect(() => {
    const onNeed = () => {
      setReady(false);
      setError(COPY.stillNeeded);
      void refresh().catch(() => {
        setBlocked(true);
        setNeedWidget(false);
        setError(COPY.startFailed);
      });
    };
    window.addEventListener(HUMAN_REQUIRED_EVENT, onNeed);
    return () => window.removeEventListener(HUMAN_REQUIRED_EVENT, onNeed);
  }, [refresh]);

  useEffect(() => {
    if (!needWidget || !activeKey || !host.current) return;

    let cancelled = false;

    const mount = () => {
      if (cancelled || !host.current || !window.turnstile) return;
      if (widgetId.current) {
        try {
          window.turnstile.remove(widgetId.current);
        } catch {
          /* ignore */
        }
        widgetId.current = null;
      }
      widgetId.current = window.turnstile.render(host.current, {
        sitekey: activeKey,
        // Managed mode. `always` keeps the widget on screen so a phone that
        // needs a tap is not left with an invisible challenge and no callback.
        appearance: 'always',
        size: 'flexible',
        theme: 'light',
        retry: 'auto',
        callback: (token) => {
          void exchange(token);
        },
        'error-callback': () => {
          track('human_gate_fail', { code: 'widget' });
          setError(COPY.widgetFailed);
        },
        'expired-callback': () => {
          track('human_gate_fail', { code: 'expired' });
          setError(COPY.widgetExpired);
        },
        'timeout-callback': () => {
          track('human_gate_fail', { code: 'timeout' });
          setError(COPY.widgetFailed);
        },
      });
    };

    if (window.turnstile) {
      mount();
    } else {
      const existing = document.querySelector<HTMLScriptElement>('script[data-chg-turnstile]');
      // A failed script never fires load again. Drop it so Reintentar can fetch a new one.
      if (existing && existing.dataset.chgFailed !== '1') {
        existing.addEventListener('load', mount);
      } else {
        existing?.remove();
        const script = document.createElement('script');
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.dataset.chgTurnstile = '1';
        script.onload = mount;
        script.onerror = () => {
          script.dataset.chgFailed = '1';
          setError(COPY.startFailed);
        };
        document.head.appendChild(script);
      }
    }

    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetId.current);
        } catch {
          /* ignore */
        }
        widgetId.current = null;
      }
    };
  }, [needWidget, activeKey, exchange, mountId]);

  const onRetry = () => {
    setError(null);
    setSlow(false);
    setMountId((n) => n + 1);
  };

  if (ready) return <>{children}</>;

  const title = needWidget ? COPY.widgetTitle : blocked ? COPY.blockedTitle : COPY.checkingTitle;
  const body = needWidget ? COPY.widgetBody : blocked ? COPY.blockedBody : COPY.checkingBody;

  return (
    <section className="human-gate" data-testid="human-gate" aria-labelledby="human-gate-title" aria-busy={busy || (!needWidget && !blocked)}>
      <img
        className="human-gate-mascot"
        src="/brand/mascot-idle.png"
        alt=""
        aria-hidden="true"
        width={120}
        height={120}
      />
      <h2 id="human-gate-title">{title}</h2>
      <p>{body}</p>
      {error ? (
        <p className="human-gate-error" role="alert" data-testid="human-gate-error">
          {error}
        </p>
      ) : null}
      <div ref={host} className="human-gate-widget" data-testid="human-gate-widget" />
      {needWidget || blocked || error || slow ? (
        <button
          type="button"
          className="btn human-gate-retry"
          data-testid="human-gate-retry"
          onClick={onRetry}
          disabled={busy}
        >
          {COPY.retry}
        </button>
      ) : null}
      <ReportBug />
    </section>
  );
}
