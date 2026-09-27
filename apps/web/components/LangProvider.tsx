'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import { HTML_LANG, type Lang, langCookie } from '../lib/lang.ts';

/**
 * Which language everything below here is written in.
 *
 * The initial value comes down as a prop rather than being read here, and that
 * is the whole reason this provider is shaped the way it is: the server already
 * knows the answer from the `chg_lang` cookie, so the first HTML is in the right
 * language and there is nothing to correct on hydration. A provider that read
 * the cookie itself in an effect would render Spanish, then flip — which is the
 * flash of the wrong language, shown to exactly the person who cannot read it.
 *
 * Compare `NetworkProvider`, which holds a *derived* value pushed up from below.
 * This one holds a *choice*, made in one place (`LangToggle`) and written
 * through to the cookie so the next request agrees with this one.
 */

interface LangState {
  lang: Lang;
  /** Writes the cookie as well as the state. There is no read-only setter. */
  setLang: (next: Lang) => void;
}

const Ctx = createContext<LangState>({ lang: 'es', setLang: () => {} });

export function useLang(): Lang {
  return useContext(Ctx).lang;
}

export function useSetLang(): (next: Lang) => void {
  return useContext(Ctx).setLang;
}

export function LangProvider({ initial, children }: { initial: Lang; children: React.ReactNode }) {
  const [lang, setStored] = useState<Lang>(initial);

  const setLang = useCallback((next: Lang) => {
    setStored((current) => {
      if (current === next) return current;
      if (typeof document !== 'undefined') {
        // Both halves matter. The cookie is what the *server* reads on the next
        // navigation; `documentElement.lang` is what a screen reader and the
        // browser's own translation prompt read right now, and `app/layout.tsx`
        // set it from the cookie that was current when this page was served.
        document.cookie = langCookie(next);
        document.documentElement.lang = HTML_LANG[next];
      }
      return next;
    });
  }, []);

  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
