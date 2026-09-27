'use client';

import {
  COPYRIGHT_LINE,
  FOUNDER_END,
  founderJoin,
  founderPrefix,
  FOUNDERS,
  newTabHint,
  TRUST_SEPARATOR,
} from '../lib/founder-trust-copy';
import type { Lang } from '../lib/lang.ts';
import { useLang } from './LangProvider';

type Props = {
  className?: string;
};

/**
 * Quiet trust line. Wide footers are one sentence, copyright first.
 * Narrow footers stack the founder sentence above the copyright line.
 * The registered mark is printed once either way.
 *
 * The accessible name of each link starts with the visible name.
 * Reading order stays copyright, then the names.
 *
 * `'use client'` for one reason: the prefix, the join and the new-tab hint
 * follow the language, and the language is on a context. The copyright line and
 * the separator do not follow it — a year and a middle dot read the same in
 * both, and printing one mark once is the rule this component exists to keep.
 * The two names are never translated either. They are people.
 */
export function FounderTrust({ className }: Props) {
  const lang = useLang();
  const [simoneth, fabio] = FOUNDERS;
  const classes = className ? `chg-trust ${className}` : 'chg-trust';

  return (
    <div className={classes} data-testid="founder-trust">
      <p className="chg-trust-line">
        <span className="chg-trust-copy">{COPYRIGHT_LINE}</span>
        <span className="chg-trust-sep" aria-hidden="true">
          {TRUST_SEPARATOR}
        </span>
        <span className="chg-trust-made">
          {founderPrefix(lang)}
          <FounderLink href={simoneth.href} name={simoneth.name} lang={lang} />
          {founderJoin(lang)}
          <FounderLink href={fabio.href} name={fabio.name} lang={lang} />
          {FOUNDER_END}
        </span>
      </p>
    </div>
  );
}

function FounderLink({ href, name, lang }: { href: string; name: string; lang: Lang }) {
  return (
    <a className="chg-trust-link" href={href} target="_blank" rel="noopener noreferrer">
      {name}
      <span className="chg-trust-sr"> ({newTabHint(lang)})</span>
    </a>
  );
}
