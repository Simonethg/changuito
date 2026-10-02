import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { APP_URL, FAQ, SITE_URL, SOCIAL, STEPS } from '../copy.ts';
import {
  HOME_DESCRIPTION,
  OG_IMAGE,
  PUBLIC_PAGES,
  canonicalUrl,
  documentTitle,
  homeJsonLd,
  llmsTxt,
  pageMetadata,
  publicPage,
  robotsConfig,
  sitemapEntries,
  subpageJsonLd,
} from '../seo.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function jpegSize(buf: Buffer): { w: number; h: number } {
  assert.equal(buf[0], 0xff);
  assert.equal(buf[1], 0xd8);
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = buf[i + 1];
    if (marker === 0xd8 || marker === 0xd9) {
      i += 2;
      continue;
    }
    const seglen = buf.readUInt16BE(i + 2);
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    i += 2 + seglen;
  }
  throw new Error('jpeg size not found');
}

test('each public route has a unique title, description and canonical', () => {
  assert.deepEqual(
    PUBLIC_PAGES.map((page) => page.path),
    ['/', '/whitelist', '/reportarbug'],
  );
  const titles = PUBLIC_PAGES.map((page) => documentTitle(page.title));
  const descriptions = PUBLIC_PAGES.map((page) => page.description);
  assert.equal(new Set(titles).size, titles.length);
  assert.equal(new Set(descriptions).size, descriptions.length);
  for (const page of PUBLIC_PAGES) {
    const title = documentTitle(page.title);
    const meta = pageMetadata(page);
    assert.equal(title.includes('\u2014'), false, title);
    assert.equal(page.description.includes('\u2014'), false);
    assert.ok(title.length <= 60, title);
    assert.ok(page.description.length >= 50 && page.description.length <= 160, page.description);
    assert.equal(canonicalUrl(page.path).startsWith('https://www.changuito.me'), true);
    assert.equal(meta.alternates?.canonical, canonicalUrl(page.path));
    assert.equal(meta.alternates?.languages?.['es-AR'], canonicalUrl(page.path));
    assert.equal(meta.alternates?.languages?.['x-default'], canonicalUrl(page.path));
    const og = meta.openGraph;
    assert.ok(og && 'url' in og);
    assert.equal(og.url, canonicalUrl(page.path));
    assert.equal(og.locale, 'es_AR');
    const twitter = meta.twitter;
    assert.ok(twitter && 'card' in twitter && 'site' in twitter);
    assert.equal(twitter.card, 'summary_large_image');
    assert.equal(twitter.site, '@appchanguito');
  }
  assert.equal(canonicalUrl('/'), SITE_URL);
  assert.equal(canonicalUrl('/whitelist'), `${SITE_URL}/whitelist`);
  assert.equal(canonicalUrl('/reportarbug'), `${SITE_URL}/reportarbug`);
  assert.equal(documentTitle(publicPage('/').title), 'Decile qué querés cocinar · Changuito');
  assert.match(HOME_DESCRIPTION, /Argentina/);
  assert.match(HOME_DESCRIPTION, /tarjeta o USDC/);
  assert.equal(HOME_DESCRIPTION.toLowerCase().includes('blockchain'), false);
});

test('robots allows marketing pages and only hides the api', () => {
  const robots = robotsConfig();
  assert.equal(robots.sitemap, `${SITE_URL}/sitemap.xml`);
  assert.equal(robots.host, SITE_URL);
  const rules = robots.rules;
  assert.ok(Array.isArray(rules));
  const list = Array.isArray(rules) ? rules : [rules];
  const agents = list.map((rule) => (typeof rule === 'string' ? rule : rule.userAgent));
  assert.ok(agents.includes('*'));
  assert.ok(agents.includes('Googlebot'));
  assert.ok(agents.includes('Bingbot'));
  assert.ok(agents.includes('GPTBot'));
  assert.ok(agents.includes('PerplexityBot'));
  assert.ok(agents.includes('ClaudeBot'));
  for (const rule of list) {
    assert.ok(typeof rule !== 'string');
    if (typeof rule === 'string') continue;
    assert.equal(rule.allow, '/');
    assert.deepEqual(rule.disallow, ['/api/']);
  }
  const src = readFileSync(join(root, 'app/robots.ts'), 'utf8');
  assert.equal(src.includes("disallow: '/'"), false);
  assert.match(src, /robotsConfig/);
});

test('sitemap lists only the public marketing routes', () => {
  const urls = sitemapEntries().map((entry) => entry.url);
  assert.deepEqual(urls, [
    'https://www.changuito.me',
    'https://www.changuito.me/whitelist',
    'https://www.changuito.me/reportarbug',
  ]);
  assert.equal(urls.some((url) => url.includes('/api/')), false);
  assert.equal(urls.some((url) => url.includes('app.changuito.me')), false);
  const src = readFileSync(join(root, 'app/sitemap.ts'), 'utf8');
  assert.match(src, /sitemapEntries/);
});

test('json-ld quotes the visible faq and does not invent ratings or a price', () => {
  const home = JSON.stringify(homeJsonLd());
  for (const item of FAQ) {
    assert.equal(home.includes(JSON.stringify(item.q).slice(1, -1)), true, item.q);
    assert.equal(home.includes(JSON.stringify(item.a).slice(1, -1)), true, item.a);
  }
  for (const step of STEPS) {
    assert.equal(home.includes(step.title), true);
  }
  for (const link of SOCIAL) {
    assert.equal(home.includes(link.href), true);
  }
  assert.equal(home.includes(APP_URL), true);
  assert.equal(home.includes('ShoppingApplication'), true);
  assert.equal(home.includes('"@type":"FAQPage"'), true);
  assert.equal(home.includes('"@type":"Organization"'), true);
  assert.equal(home.includes('"@type":"WebSite"'), true);
  for (const banned of ['aggregateRating', 'ratingValue', 'reviewCount', 'price', 'SearchAction', '"offers"']) {
    assert.equal(home.includes(banned), false, banned);
  }
  const app = homeJsonLd()['@graph'].find((node) => node['@type'] === 'SoftwareApplication');
  assert.ok(app);
  assert.equal('offers' in app, false);

  const whitelist = JSON.stringify(subpageJsonLd(publicPage('/whitelist')));
  assert.equal(whitelist.includes('FAQPage'), false);
  assert.equal(whitelist.includes(`${SITE_URL}/whitelist`), true);
  assert.equal(whitelist.includes('BreadcrumbList'), true);
  const bug = JSON.stringify(subpageJsonLd(publicPage('/reportarbug')));
  assert.equal(bug.includes(`${SITE_URL}/reportarbug`), true);
  assert.equal(bug.includes('FAQPage'), false);
});

test('llms.txt restates public pages and refuses ratings', () => {
  const text = llmsTxt();
  assert.match(text, /^# Changuito\n/);
  assert.equal(text.includes(HOME_DESCRIPTION), true);
  assert.equal(text.includes(`${SITE_URL}/whitelist`), true);
  assert.equal(text.includes(`${SITE_URL}/reportarbug`), true);
  assert.equal(text.includes(APP_URL), true);
  assert.equal(text.includes(FAQ[0].q), true);
  assert.equal(text.includes(FAQ[0].a), true);
  assert.equal(text.includes(FAQ[3].a), true);
  assert.equal(text.toLowerCase().includes('estrellas'), false);
  assert.equal(text.includes('aggregateRating'), false);
  const route = readFileSync(join(root, 'app/llms.txt/route.ts'), 'utf8');
  assert.match(route, /llmsTxt/);
});

test('the open graph image is a 1280x720 jpeg at /og.jpg', () => {
  assert.equal(existsSync(join(root, 'public/og.png')), false);
  const size = jpegSize(readFileSync(join(root, 'public/og.jpg')));
  assert.deepEqual(size, { w: OG_IMAGE.width, h: OG_IMAGE.height });
  assert.equal(OG_IMAGE.type, 'image/jpeg');
  assert.equal(OG_IMAGE.url, '/og.jpg');
});

test('public pages keep one h1 and key images have alt text', () => {
  const home = readFileSync(join(root, 'components/landing/landing-page.tsx'), 'utf8');
  const whitelist = readFileSync(join(root, 'app/whitelist/page.tsx'), 'utf8');
  const bug = readFileSync(join(root, 'app/reportarbug/page.tsx'), 'utf8');
  const bugPanel = readFileSync(join(root, 'components/bug-report/bug-report-panel.tsx'), 'utf8');
  assert.equal(home.match(/<h1[\s>]/g)?.length, 1);
  assert.equal(whitelist.match(/<h1[\s>]/g)?.length, 1);
  assert.equal(bug.match(/<h1[\s>]/g)?.length ?? 0, 0);
  assert.equal(bugPanel.match(/<h1[\s>]/g)?.length, 1);
  assert.equal(home.includes('<h4'), false);
  assert.match(home, /<HeroDemo \/>/);
  const demo = readFileSync(join(root, 'components/landing/hero-demo.tsx'), 'utf8');
  assert.match(demo, /<figcaption/);
  assert.equal(home.includes('animacion-cargando'), false);
  assert.match(bug, /src="\/brand\/mascot-error.png"/);
  assert.match(bug, /alt="Changuito"/);
  assert.equal(home.includes('mascot-error'), false);
  assert.match(readFileSync(join(root, 'app/layout.tsx'), 'utf8'), /lang="es-AR"/);
});
