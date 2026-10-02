/**
 * Free client analytics for the landing site.
 *
 * GA4, Meta Pixel and Clarity stay off unless the matching public id is set
 * and matches its expected shape. A bad value is treated as unset so it cannot
 * be interpolated into a script. Props are an allowlist: email, phone, name
 * and free text never leave the browser through this helper.
 */

export type AnalyticsEvent =
  | 'cta_probar_click'
  | 'whitelist_view'
  | 'whitelist_submit_attempt'
  | 'whitelist_submit_success'
  | 'whitelist_submit_error'
  | 'whitelist_group_optin'
  | 'bug_report_view'
  | 'bug_report_success'
  | 'outbound_click';

export type OutboundLabel = 'simoneth_linkedin' | 'fabio_linkedin' | 'x' | 'instagram' | 'linkedin';

export type TrackProps = {
  page_path?: string;
  error_type?: 'field' | 'server';
  value?: 'yes' | 'no';
  cta_id?: string;
  label?: OutboundLabel;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
};

const GA_ID = /^G-[A-Z0-9]{4,}$/i;
const META_ID = /^\d{5,20}$/;
const CLARITY_ID = /^[a-z0-9]{4,32}$/i;

type AnalyticsWindow = Window & {
  gtag?: (...args: unknown[]) => void;
  fbq?: (...args: unknown[]) => void;
};

export function publicId(raw: string | undefined, pattern: RegExp): string | undefined {
  const value = raw?.trim() ?? '';
  if (!value || !pattern.test(value)) return undefined;
  return value;
}

export function gaMeasurementId(): string | undefined {
  return publicId(process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID, GA_ID);
}

export function metaPixelId(): string | undefined {
  return publicId(process.env.NEXT_PUBLIC_META_PIXEL_ID, META_ID);
}

export function clarityProjectId(): string | undefined {
  return publicId(process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID, CLARITY_ID);
}

export function analyticsCspSources(): { script: string[]; connect: string[]; img: string[] } {
  const script: string[] = [];
  const connect: string[] = [];
  const img: string[] = [];

  if (gaMeasurementId()) {
    script.push('https://www.googletagmanager.com', 'https://www.google-analytics.com');
    connect.push(
      'https://www.google-analytics.com',
      'https://*.google-analytics.com',
      'https://analytics.google.com',
      'https://*.analytics.google.com',
      'https://www.googletagmanager.com',
      'https://stats.g.doubleclick.net',
    );
    img.push('https://www.google-analytics.com', 'https://www.googletagmanager.com');
  }

  if (metaPixelId()) {
    script.push('https://connect.facebook.net');
    connect.push('https://www.facebook.com', 'https://connect.facebook.net');
    img.push('https://www.facebook.com');
  }

  if (clarityProjectId()) {
    script.push('https://www.clarity.ms', 'https://scripts.clarity.ms');
    connect.push('https://www.clarity.ms', 'https://*.clarity.ms');
    img.push('https://www.clarity.ms', 'https://c.clarity.ms');
  }

  return { script, connect, img };
}

export function gaBootstrap(id: string): string {
  return [
    'window.dataLayer=window.dataLayer||[];',
    'function gtag(){dataLayer.push(arguments);}',
    "gtag('js',new Date());",
    `gtag('config','${id}');`,
  ].join('');
}

export function metaBootstrap(id: string): string {
  return [
    '!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?',
    'n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;',
    "n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;",
    "t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script',",
    `'https://connect.facebook.net/en_US/fbevents.js');fbq('init','${id}');fbq('track','PageView');`,
  ].join('');
}

export function clarityBootstrap(id: string): string {
  return [
    '(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};',
    't=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;',
    'y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})',
    `(window,document,"clarity","script","${id}");`,
  ].join('');
}

export function sanitizeProps(props?: TrackProps): Record<string, string> {
  if (!props) return {};
  const out: Record<string, string> = {};
  const page = props.page_path?.trim();
  if (page && /^\/[A-Za-z0-9/_-]{0,80}$/.test(page)) out.page_path = page;
  if (props.error_type === 'field' || props.error_type === 'server') out.error_type = props.error_type;
  if (props.value === 'yes' || props.value === 'no') out.value = props.value;
  const cta = props.cta_id?.trim();
  if (cta && /^landing-cta-[a-z0-9-]{1,40}$/.test(cta)) out.cta_id = cta;
  if (
    props.label === 'simoneth_linkedin' ||
    props.label === 'fabio_linkedin' ||
    props.label === 'x' ||
    props.label === 'instagram' ||
    props.label === 'linkedin'
  ) {
    out.label = props.label;
  }
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const) {
    const value = props[key]?.trim();
    if (value && value.length <= 80 && !/[\s@<>]/.test(value)) out[key] = value;
  }
  return out;
}

export function ctaIdFrom(testId: string | null): string | undefined {
  if (!testId) return undefined;
  const safe = sanitizeProps({ cta_id: testId });
  return safe.cta_id;
}

export function outboundLabel(href: string): OutboundLabel | undefined {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return undefined;
  }
  const host = url.hostname.replace(/^www\./, '');
  const path = url.pathname.replace(/\/$/, '');
  if (host === 'x.com' && path === '/appchanguito') return 'x';
  if (host === 'instagram.com' && path === '/appchanguito') return 'instagram';
  if (host === 'linkedin.com' && path === '/in/simonethg') return 'simoneth_linkedin';
  if (host === 'linkedin.com' && path === '/in/fabio-laura-yavi') return 'fabio_linkedin';
  if (host === 'linkedin.com' && path === '/company/appchanguito' && url.search === '') return 'linkedin';
  return undefined;
}

function browser(): AnalyticsWindow | undefined {
  if (typeof window === 'undefined') return undefined;
  return window as AnalyticsWindow;
}

/** Named events. Meta receives CompleteRegistration only for a saved signup. */
export function track(event: AnalyticsEvent, props?: TrackProps): void {
  try {
    const w = browser();
    if (!w) return;
    const payload = sanitizeProps(props);
    if (gaMeasurementId() && typeof w.gtag === 'function') w.gtag('event', event, payload);
    if (event === 'whitelist_submit_success' && metaPixelId() && typeof w.fbq === 'function') {
      w.fbq('track', 'CompleteRegistration');
    }
  } catch {
    // A broken tag must not break the page.
  }
}

/** Later client navigations. The first view is the vendor snippet itself. */
export function trackPageView(pagePath: string): void {
  try {
    const w = browser();
    if (!w) return;
    const safe = sanitizeProps({ page_path: pagePath }).page_path;
    if (!safe) return;
    if (gaMeasurementId() && typeof w.gtag === 'function') w.gtag('event', 'page_view', { page_path: safe });
    if (metaPixelId() && typeof w.fbq === 'function') w.fbq('track', 'PageView');
  } catch {
    // A broken tag must not break the page.
  }
}
