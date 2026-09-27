'use client';

import { uiCopy } from '../lib/ui-copy.ts';
import { useLang } from './LangProvider';

/** Footer link. Lives in the scrolling thread so the composer can own the bottom edge. */
export function ReportBug() {
  const lang = useLang();
  return (
    <p className="report-bug">
      <a href="https://www.changuito.me/reportarbug" target="_blank" rel="noopener noreferrer">
        {/* The Spanish is written out rather than looked up: lib/test/social.test.ts
            reads this file as text and asserts the label is in it. The URL stays
            Spanish in both languages — it is the landing site's real path. */}
        {lang === 'en' ? uiCopy(lang).reportBug : 'Reportar un bug'}
      </a>
    </p>
  );
}
