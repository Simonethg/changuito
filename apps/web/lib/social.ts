/**
 * Public profiles for the shopper footer.
 *
 * Same accounts as `SOCIAL` in `apps/landing/lib/copy.ts`. Copied here so
 * the shopper can ship without importing the landing app. Href and
 * accessible name stay in lockstep with that list.
 */
import type { Lang } from './lang.ts';

export const SOCIAL = [
  {
    id: 'instagram',
    href: 'https://instagram.com/appchanguito',
    ariaLabel: 'Changuito en Instagram',
  },
  {
    id: 'x',
    href: 'https://x.com/appchanguito',
    ariaLabel: 'Changuito en X',
  },
] as const;

export type SocialId = (typeof SOCIAL)[number]['id'];

/**
 * The same two accounts, with the accessible name in the reader's language.
 *
 * `SOCIAL` above is untouched and stays the Spanish original — the landing app
 * is compared against it verbatim, and "Changuito en Instagram" is the string
 * that comparison is about. This returns it as-is for Spanish and swaps only
 * the spoken label for English. The href never varies: the account is one
 * account.
 */
const ARIA_EN: Record<SocialId, string> = {
  instagram: 'Changuito on Instagram',
  x: 'Changuito on X',
};

export interface SocialLink {
  id: SocialId;
  href: string;
  ariaLabel: string;
}

export function socialLinks(lang: Lang): readonly SocialLink[] {
  if (lang === 'es') return SOCIAL;
  return SOCIAL.map((link) => ({ id: link.id, href: link.href, ariaLabel: ARIA_EN[link.id] }));
}
