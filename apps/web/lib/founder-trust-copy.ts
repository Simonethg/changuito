/**
 * Shopper footer trust copy.
 *
 * The same words live in `@changuito/trust` for the landing. This file is a
 * copy so the shopper can ship without that package and without editing
 * `apps/landing`. Do not add a second copyright line next to `FounderTrust`.
 */
import type { Lang } from './lang.ts';

export const COPYRIGHT_YEAR = 2026;

/** Registered trademark, U+00AE. Not the letters "(R)". */
export const BRAND_MARK = 'Changuito\u00AE';

export const COPYRIGHT_LINE = `\u00A9 ${COPYRIGHT_YEAR} ${BRAND_MARK}`;

/**
 * Personal attribution for an early product. Not a registered company
 * and not a job title. Link text is the visible label.
 */
export const FOUNDERS = [
  { name: 'SimonethG', href: 'https://www.linkedin.com/in/simonethg/' },
  { name: 'Fabio', href: 'https://www.linkedin.com/in/fabio-laura-yavi/' },
] as const;

export const FOUNDER_PREFIX = 'Hecho en 🇦🇷 por ';
export const FOUNDER_JOIN = ' y ';
export const FOUNDER_END = '.';

export const FOUNDER_SENTENCE = `${FOUNDER_PREFIX}${FOUNDERS[0].name}${FOUNDER_JOIN}${FOUNDERS[1].name}${FOUNDER_END}`;

/** Middle dot, U+00B7. Not an em dash and not an en dash. */
export const TRUST_SEPARATOR = ' \u00B7 ';

/** One line when the footer is wide enough to hold it. */
export const TRUST_LINE = `${COPYRIGHT_LINE}${TRUST_SEPARATOR}${FOUNDER_SENTENCE}`;

/** Spoken after each name. The visible label stays the name itself. */
export const NEW_TAB_HINT = 'se abre en una pestaña nueva';

/**
 * The same line in English.
 *
 * Everything above is the Spanish original and is asserted character for
 * character by `lib/test/founder-trust.test.ts` — the registered mark, the
 * middle dot, the flag, the absence of dashes. None of that moves. What follows
 * selects between it and an English second copy built from the same parts, so
 * the two can never disagree about the year, the mark, or who made it.
 *
 * The names are not translated. They are people.
 */
const FOUNDER_PREFIX_EN = 'Made in 🇦🇷 by ';
const FOUNDER_JOIN_EN = ' and ';

const FOUNDER_SENTENCE_EN = `${FOUNDER_PREFIX_EN}${FOUNDERS[0].name}${FOUNDER_JOIN_EN}${FOUNDERS[1].name}${FOUNDER_END}`;

const TRUST_LINE_EN = `${COPYRIGHT_LINE}${TRUST_SEPARATOR}${FOUNDER_SENTENCE_EN}`;

const NEW_TAB_HINT_EN = 'opens in a new tab';

export function founderPrefix(lang: Lang): string {
  return lang === 'en' ? FOUNDER_PREFIX_EN : FOUNDER_PREFIX;
}

export function founderJoin(lang: Lang): string {
  return lang === 'en' ? FOUNDER_JOIN_EN : FOUNDER_JOIN;
}

export function founderSentence(lang: Lang): string {
  return lang === 'en' ? FOUNDER_SENTENCE_EN : FOUNDER_SENTENCE;
}

export function trustLine(lang: Lang): string {
  return lang === 'en' ? TRUST_LINE_EN : TRUST_LINE;
}

export function newTabHint(lang: Lang): string {
  return lang === 'en' ? NEW_TAB_HINT_EN : NEW_TAB_HINT;
}
