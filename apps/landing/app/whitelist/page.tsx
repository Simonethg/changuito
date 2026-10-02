import type { Metadata, Viewport } from 'next';
import Image from 'next/image';

import { FounderTrust } from '@changuito/trust/ui';
import { AnalyticsView } from '../../components/analytics/analytics-view';
import { SiteFooter } from '../../components/landing/site-footer';
import { JsonLd } from '../../components/seo/json-ld';
import { WaitlistForm } from '../../components/waitlist/waitlist-form';
import { WhitelistViewport } from '../../components/waitlist/whitelist-viewport';
import styles from '../../components/waitlist/waitlist.module.css';
import { noticeFromQuery } from '../../lib/waitlist/messages.ts';
import { pageMetadata, publicPage, subpageJsonLd } from '../../lib/seo';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Chrome shrinks the layout viewport with the keyboard. iOS Safari
  // ignores this; the form scrolls the focused field itself.
  interactiveWidget: 'resizes-content',
};

const page = publicPage('/whitelist');

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string; campo?: string }>;
}): Promise<Metadata> {
  const { estado, campo } = await searchParams;
  return pageMetadata(page, { noindex: Boolean(estado || campo) });
}

export default async function WhitelistPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string; campo?: string }>;
}) {
  const { estado, campo } = await searchParams;
  const listed = estado === 'listo';

  return (
    <div className={styles.page} data-testid="whitelist-screen">
      <AnalyticsView event="whitelist_view" />
      {listed ? <AnalyticsView event="whitelist_submit_success" /> : null}
      <WhitelistViewport />
      <JsonLd data={subpageJsonLd(page)} />
      <a className={styles.skip} href="#lista">
        Saltar al formulario
      </a>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <a className={styles.brandLink} href="/" data-testid="whitelist-brand">
            <Image
              src="/brand/mascot-idle.png"
              alt=""
              width={397}
              height={583}
              priority
              className={styles.mark}
              data-testid="whitelist-mascot"
            />
            <Image
              src="/brand/wordmark.png"
              alt="Changuito"
              width={1097}
              height={249}
              priority
              className={styles.wordmark}
              data-testid="whitelist-wordmark"
            />
          </a>
        </div>
      </header>
      <main id="lista" className={styles.main} data-testid="whitelist-page">
        <h1 className={styles.title}>Súmate a la lista para beta testear.</h1>
        <p className={styles.availability} data-testid="whitelist-availability">
          Solo disponible en 🇦🇷
        </p>
        <p className={styles.lead}>Te bonificaremos algo de tu compra del mercado a cambio del feedback.</p>
        <div className={styles.card}>
          {listed ? (
            <div className={styles.success} data-testid="whitelist-success">
              <h2 className={styles.successTitle} tabIndex={-1}>
                Listo, te anotamos
              </h2>
              <p className={styles.successLead}>Te escribimos por WhatsApp cuando puedas probar Changuito.</p>
            </div>
          ) : (
            <WaitlistForm notice={noticeFromQuery(estado, campo)} />
          )}
        </div>
        <FounderTrust className={styles.fine} />
      </main>
      <div className={styles.footerWrap}>
        <SiteFooter navBase="/" trust={false} />
      </div>
    </div>
  );
}
