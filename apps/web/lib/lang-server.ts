/**
 * The shopper's language, read on the server.
 *
 * Separate from `lib/lang.ts` because that file is imported by the browser
 * bundle and this one imports `next/headers`, which is server-only. Keeping the
 * import out of the shared module is what lets a client component call
 * `langFrom` without dragging a server API into the bundle.
 *
 * `cookies()` opts the caller into dynamic rendering. `app/page.tsx` is already
 * `force-dynamic` for the Turnstile site key, so this costs it nothing.
 */
import { cookies } from 'next/headers';

import { DEFAULT_LANG, LANG_COOKIE, type Lang, langFrom } from './lang.ts';

export async function langFromCookie(): Promise<Lang> {
  try {
    const jar = await cookies();
    return langFrom(jar.get(LANG_COOKIE)?.value);
  } catch {
    // A context with no request — a static pass, a build-time probe — has no
    // preference to honour, and the default is the right answer rather than a
    // crash on a page that renders perfectly well in Spanish.
    return DEFAULT_LANG;
  }
}
