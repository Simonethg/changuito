/**
 * Public locators for www.changuito.me.
 *
 * Titles, descriptions and JSON-LD are built from the marketing copy.
 * Nothing here adds a rating, a price, or a claim the page does not make.
 * There is no site search, so there is no SearchAction.
 */
import type { Metadata, MetadataRoute } from 'next';

import {
  APP_URL,
  FAQ,
  FOOTER,
  SITE_URL,
  SOCIAL,
  STEPS,
} from './copy.ts';

export const TITLE_SUFFIX = ' · Changuito';

export const HOME_DESCRIPTION =
  'En Argentina, Changuito compara precios entre supermercados y te deja el carrito listo para pagar con tarjeta o USDC.';

export const OG_IMAGE = {
  url: '/og.jpg',
  width: 1280,
  height: 720,
  alt: 'Mascota de Changuito, un carrito sonriente con el súper',
  type: 'image/jpeg',
} as const;

export const INDEXABLE_ROBOTS: Metadata['robots'] = {
  index: true,
  follow: true,
  googleBot: {
    index: true,
    follow: true,
    'max-image-preview': 'large',
    'max-snippet': -1,
    'max-video-preview': -1,
  },
};

export const PUBLIC_PAGES = [
  {
    path: '/',
    title: 'Decile qué querés cocinar',
    description: HOME_DESCRIPTION,
    changeFrequency: 'weekly',
    priority: 1,
    navLabel: 'Inicio',
  },
  {
    path: '/whitelist',
    title: 'Súmate a la lista para beta testear',
    description: 'Te bonificaremos algo de tu compra del mercado a cambio del feedback.',
    changeFrequency: 'monthly',
    priority: 0.6,
    navLabel: 'Súmate a la lista',
  },
  {
    path: '/reportarbug',
    title: 'Reportar un bug',
    description: 'Contanos qué pasó en Changuito. Si algo no anduvo, dejalo acá.',
    changeFrequency: 'yearly',
    priority: 0.3,
    navLabel: 'Reportar un bug',
  },
] as const;

export type PublicPage = (typeof PUBLIC_PAGES)[number];

/** Bots the shopper blocks. Here they may read the marketing pages. */
const CRAWLERS = [
  '*',
  'Googlebot',
  'Bingbot',
  'Applebot',
  'DuckDuckBot',
  'GPTBot',
  'ChatGPT-User',
  'OAI-SearchBot',
  'Google-Extended',
  'ClaudeBot',
  'anthropic-ai',
  'PerplexityBot',
  'Amazonbot',
  'CCBot',
  'Bytespider',
  'FacebookBot',
  'meta-externalagent',
  'cohere-ai',
] as const;

const ORG_ID = `${SITE_URL}/#organization`;
const SITE_ID = `${SITE_URL}/#website`;
const APP_ID = `${APP_URL}/#software`;

export function documentTitle(shortTitle: string): string {
  return `${shortTitle}${TITLE_SUFFIX}`;
}

export function canonicalUrl(path: string): string {
  if (path === '/') return SITE_URL;
  return `${SITE_URL}${path}`;
}

export function publicPage(path: PublicPage['path']): PublicPage {
  const found = PUBLIC_PAGES.find((page) => page.path === path);
  if (!found) throw new Error(`unknown public page: ${path}`);
  return found;
}

export function pageMetadata(page: PublicPage, opts?: { noindex?: boolean }): Metadata {
  const url = canonicalUrl(page.path);
  const title = documentTitle(page.title);
  return {
    title: page.path === '/' ? { absolute: title } : page.title,
    description: page.description,
    alternates: {
      canonical: url,
      languages: {
        'es-AR': url,
        'x-default': url,
      },
    },
    robots: opts?.noindex ? { index: false, follow: true } : INDEXABLE_ROBOTS,
    openGraph: {
      title,
      description: page.description,
      url,
      siteName: 'Changuito',
      locale: 'es_AR',
      type: 'website',
      images: [OG_IMAGE],
    },
    twitter: {
      card: 'summary_large_image',
      site: '@appchanguito',
      title,
      description: page.description,
      images: [OG_IMAGE.url],
    },
  };
}

export function robotsConfig(): MetadataRoute.Robots {
  return {
    rules: CRAWLERS.map((userAgent) => ({
      userAgent,
      allow: '/',
      disallow: ['/api/'],
    })),
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}

export function sitemapEntries(): MetadataRoute.Sitemap {
  return PUBLIC_PAGES.map((page) => ({
    url: canonicalUrl(page.path),
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }));
}

function organizationNode() {
  return {
    '@type': 'Organization',
    '@id': ORG_ID,
    name: 'Changuito',
    url: SITE_URL,
    description: HOME_DESCRIPTION,
    logo: {
      '@type': 'ImageObject',
      url: `${SITE_URL}/brand/isotipo-mascota.png`,
      width: 337,
      height: 467,
    },
    sameAs: SOCIAL.map((link) => link.href),
    areaServed: {
      '@type': 'Country',
      name: 'Argentina',
    },
  };
}

function websiteNode() {
  return {
    '@type': 'WebSite',
    '@id': SITE_ID,
    name: 'Changuito',
    url: SITE_URL,
    inLanguage: 'es-AR',
    description: HOME_DESCRIPTION,
    publisher: { '@id': ORG_ID },
  };
}

function webPageNode(page: PublicPage) {
  const url = canonicalUrl(page.path);
  return {
    '@type': 'WebPage',
    '@id': `${url}#webpage`,
    url,
    name: documentTitle(page.title),
    description: page.description,
    inLanguage: 'es-AR',
    isPartOf: { '@id': SITE_ID },
    publisher: { '@id': ORG_ID },
    primaryImageOfPage: {
      '@type': 'ImageObject',
      url: `${SITE_URL}/og.jpg`,
      width: OG_IMAGE.width,
      height: OG_IMAGE.height,
    },
  };
}

export function homeJsonLd() {
  const home = publicPage('/');
  return {
    '@context': 'https://schema.org',
    '@graph': [
      organizationNode(),
      websiteNode(),
      { ...webPageNode(home), about: { '@id': APP_ID } },
      {
        '@type': 'SoftwareApplication',
        '@id': APP_ID,
        name: 'Changuito',
        url: APP_URL,
        applicationCategory: 'ShoppingApplication',
        operatingSystem: 'Web',
        inLanguage: 'es-AR',
        description: HOME_DESCRIPTION,
        image: `${SITE_URL}/og.jpg`,
        featureList: STEPS.map((step) => `${step.title}. ${step.body}`),
        publisher: { '@id': ORG_ID },
      },
      {
        '@type': 'FAQPage',
        '@id': `${SITE_URL}/#faq`,
        url: `${SITE_URL}/#faq`,
        inLanguage: 'es-AR',
        isPartOf: { '@id': `${canonicalUrl('/')}#webpage` },
        mainEntity: FAQ.map((item) => ({
          '@type': 'Question',
          name: item.q,
          acceptedAnswer: {
            '@type': 'Answer',
            text: item.a,
          },
        })),
      },
    ],
  };
}

export function subpageJsonLd(page: PublicPage) {
  const url = canonicalUrl(page.path);
  return {
    '@context': 'https://schema.org',
    '@graph': [
      organizationNode(),
      websiteNode(),
      webPageNode(page),
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: 'Inicio',
            item: SITE_URL,
          },
          {
            '@type': 'ListItem',
            position: 2,
            name: page.title,
            item: url,
          },
        ],
      },
    ],
  };
}

export function llmsTxt(): string {
  const pages = [
    ...PUBLIC_PAGES.map((page) => {
      return `- [${page.navLabel}](${canonicalUrl(page.path)}): ${page.description}`;
    }),
    `- [App](${APP_URL}): el shopper, en otro dominio.`,
  ].join('\n');
  const steps = STEPS.map((step) => `- ${step.title}. ${step.body}`).join('\n');
  const faq = FAQ.map((item) => `### ${item.q}\n\n${item.a}`).join('\n\n');
  const social = SOCIAL.map((link) => `- ${link.ariaLabel}: ${link.href}`).join('\n');

  return [
    '# Changuito',
    '',
    `> ${HOME_DESCRIPTION}`,
    '',
    FOOTER.legal,
    `Sitio de marketing: ${SITE_URL}. App para comprar: ${APP_URL}.`,
    'Idioma: español rioplatense (es-AR).',
    'Público: quien hace el súper en Argentina.',
    '',
    '## Qué hace',
    '',
    steps,
    '',
    '## Preguntas frecuentes',
    '',
    faq,
    '',
    '## Páginas',
    '',
    pages,
    '',
    '## Perfiles',
    '',
    social,
    '',
  ].join('\n');
}
