import { HERO } from '../../lib/copy';

import styles from './landing.module.css';

/** Beta: try CTAs stay on this site. APP_URL is not a navigation target. */
export function TryLink({ testId, label = HERO.cta }: { testId: string; label?: string }) {
  return (
    <a className={styles.cta} href="/whitelist" data-testid={testId}>
      {label}
      {/* Decorative stand-in for the old arrow. The link name stays the CTA text. */}
      <img
        className={styles.ctaMascot}
        src="/brand/mascota-corriendo.png"
        alt=""
        aria-hidden="true"
        width={630}
        height={560}
        decoding="async"
      />
    </a>
  );
}
