import { FounderTrust } from '@changuito/trust/ui';

import { FOOTER, NAV, SOCIAL } from '../../lib/copy';
import { BrandLockup } from './brand-lockup';
import { InstagramIcon, LinkedInIcon } from './icons';

import styles from './landing.module.css';

/**
 * Site footer shared by the home and /whitelist.
 * navBase prefixes the in-page anchors so they resolve to the home from
 * other routes. trust=false skips the founder line on pages that already
 * show it above the fold.
 */
export function SiteFooter({ navBase = '', trust = true }: { navBase?: string; trust?: boolean }) {
  return (
    <footer className={styles.footer} data-testid="landing-footer">
      <div className={styles.footerInner}>
        <a className={styles.logoLink} href="/">
          <BrandLockup className={styles.footerBrand} />
        </a>
        <div className={styles.footerMeta}>
          <nav aria-label="Pie" className={styles.footerNavWrap}>
            <ul className={styles.footerNav}>
              {NAV.map((link) => (
                <li key={link.href}>
                  <a className={styles.footerLink} href={`${navBase}${link.href}`}>
                    {link.label}
                  </a>
                </li>
              ))}
              <li>
                <a className={styles.footerLink} href="/reportarbug" data-testid="landing-report-bug">
                  Reportar un bug
                </a>
              </li>
              <li>
                <a className={styles.footerLink} href="/">
                  {FOOTER.siteLabel}
                </a>
              </li>
            </ul>
          </nav>
          <ul className={styles.footerSocial} data-testid="landing-social">
            {SOCIAL.map((link) => {
              // The X glyph sits before the label "X" and reads as a second link.
              const textOnly = link.icon === 'x';
              return (
                <li key={link.href}>
                  <a
                    className={textOnly ? `${styles.socialLink} ${styles.socialText}` : styles.socialLink}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={link.ariaLabel}
                    data-testid={`landing-social-${link.icon}`}
                  >
                    {link.icon === 'instagram' ? <InstagramIcon className={styles.socialIcon} /> : null}
                    {link.icon === 'linkedin' ? <LinkedInIcon className={styles.socialIcon} /> : null}
                    <span>{link.label}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <p className={styles.fine}>{FOOTER.legal}</p>
      {trust ? <FounderTrust className={styles.fine} /> : null}
    </footer>
  );
}
