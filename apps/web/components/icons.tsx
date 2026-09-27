/**
 * The shopper's inline icons.
 *
 * Conventions come from apps/landing/components/landing/icons.tsx so the two
 * apps draw one family: currentColor stroke, width 2, round cap and join, no
 * fill, aria-hidden. The 24-unit box at 16px matches that file's social icons
 * rather than its 32px feature icons — this one sits inline with 12px button
 * text, not in a card. Footer marks use the same box: Instagram is the
 * landing stroke glyph, and X is filled so it does not read as a close icon.
 */
export function RetryIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}

/** Same 24-unit social box as the landing footer glyphs. */
function socialGlyph(className: string | undefined, size: number) {
  return {
    className,
    viewBox: '0 0 24 24',
    width: size,
    height: size,
    fill: 'none' as const,
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  };
}

/** Camera mark. Path matches apps/landing/components/landing/icons.tsx. */
export function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg {...socialGlyph(className, 18)}>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * X mark. The landing prints the word "X" instead of a glyph, because the
 * glyph next to that word reads as a second link. Here the control is the
 * icon alone, so the mark is the logo, slightly smaller than the stroked
 * camera so the two weights match.
 */
export function XIcon({ className }: { className?: string }) {
  return (
    <svg {...socialGlyph(className, 16)} fill="currentColor" stroke="none">
      <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
    </svg>
  );
}

/**
 * Globe, for the language switch. Same social box, because it sits in the
 * footer row beside those two and a different weight would read as a
 * different kind of control. Meridian and equator only: a globe with
 * coastlines at 18px is a smudge, and the coastlines of *which* continent is
 * a question a language switch should not be answering.
 */
export function GlobeIcon({ className }: { className?: string }) {
  return (
    <svg {...socialGlyph(className, 16)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18" />
    </svg>
  );
}
