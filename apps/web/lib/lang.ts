/**
 * Which language the shopper reads.
 *
 * changuito was written in Spanish first and the Spanish is the original: every
 * copy module still exports its Rioplatense strings under the names it always
 * had, and `lang: 'es'` returns exactly those objects. English is a second set
 * of the same keys, selected beside them. Nothing was replaced.
 *
 * That is not only politeness toward the tests that pin the Spanish word for
 * word. It is what keeps the voseo from being quietly flattened into neutral
 * Spanish by somebody translating three files at a time — the Spanish cannot
 * drift if translating never touches it.
 *
 * ## Why a cookie and not localStorage
 *
 * `app/page.tsx` renders on the server. A choice kept only in the browser
 * arrives one paint too late, so the first screen is Spanish and then snaps to
 * English — for an English speaker, the one moment where they have no idea what
 * they are looking at. A cookie rides the request, so the server renders the
 * language the shopper picked.
 *
 * It is deliberately **not** HttpOnly: the toggle writes it from script and the
 * value is a two-letter preference, not a credential. `SameSite=Lax` anyway, so
 * a third-party frame cannot set it, and nothing downstream trusts it for
 * anything but choosing words.
 */

export type Lang = 'es' | 'en';

export const LANGS: readonly Lang[] = ['es', 'en'];

/** Spanish. The app is Argentine and that is the default for everyone. */
export const DEFAULT_LANG: Lang = 'es';

export const LANG_COOKIE = 'chg_lang';

/** A year. A language preference is not a session. */
export const LANG_MAX_AGE = 60 * 60 * 24 * 365;

/** Anything that is not one of the two is Spanish, including undefined. */
export function langFrom(value: unknown): Lang {
  return value === 'en' ? 'en' : DEFAULT_LANG;
}

/**
 * For `<html lang>`. Spanish keeps its region because the voseo is Argentine
 * and a screen reader should pick an accent that matches it. English does not,
 * because this English is nobody's regional variety in particular.
 */
export const HTML_LANG: Record<Lang, string> = { es: 'es-AR', en: 'en' };

/**
 * For `Intl`. The currency stays ARS in both — the shopper is buying in
 * Argentina either way — but the grouping follows the reader, because
 * "$12.345,67" read as English is off by a factor of a hundred thousand.
 */
export const INTL_LOCALE: Record<Lang, string> = { es: 'es-AR', en: 'en-US' };

/** Picks one side of a bilingual pair. Every copy module's selector is this. */
export function inLang<T>(lang: Lang, both: Record<Lang, T>): T {
  return both[lang] ?? both[DEFAULT_LANG];
}

/**
 * The toggle's own words, which are the one place copy must not follow the
 * current language.
 *
 * The button offers the *other* language, so its label is written in that other
 * language: somebody who cannot read the page can still read the way out of it.
 * "English" is the affordance for a Spanish reader who does not read Spanish,
 * which sounds circular and is exactly the point.
 */
export const LANG_SWITCH: Record<Lang, { to: Lang; label: string; aria: string }> = {
  es: { to: 'en', label: 'English', aria: 'Switch to English' },
  en: { to: 'es', label: 'Español', aria: 'Cambiar a español' },
};

/** The cookie a browser should send back, as a `Set-Cookie`-shaped string. */
export function langCookie(lang: Lang): string {
  return `${LANG_COOKIE}=${lang}; Path=/; Max-Age=${LANG_MAX_AGE}; SameSite=Lax`;
}

/** The value of `chg_lang` in a `Cookie` header, if it carries one. */
export function langFromCookieHeader(header: string | null | undefined): Lang {
  if (!header) return DEFAULT_LANG;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.split('=');
    if (name?.trim() === LANG_COOKIE) return langFrom(rest.join('=').trim());
  }
  return DEFAULT_LANG;
}
