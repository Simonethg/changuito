import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  COPYRIGHT_LINE,
  FOUNDER_SENTENCE,
  FOUNDERS,
  TRUST_LINE,
} from '../../../../packages/trust/src/copy.ts';
import {
  APP_URL,
  BOFU,
  COMPARE,
  DESCRIPTION,
  FAQ,
  FOOTER,
  HERO,
  NO_CHARGE,
  PAYMENTS,
  SITE_URL,
  SOCIAL,
  STEPS,
  STEPS_TITLE,
  USES,
  USES_TITLE,
} from '../copy.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

test('the only app handoff is https://app.changuito.me', () => {
  const url = new URL(APP_URL);
  assert.equal(url.protocol, 'https:');
  assert.equal(url.hostname, 'app.changuito.me');
  assert.equal(url.pathname, '/');
  assert.equal(url.search, '');
  assert.equal(url.hash, '');
  assert.equal(url.username, '');
  assert.equal(url.password, '');
  assert.equal(new URL(SITE_URL).hostname, 'www.changuito.me');
});

test('footer social profiles point at @appchanguito', () => {
  assert.deepEqual(
    SOCIAL.map((link) => ({ href: link.href, label: link.label, ariaLabel: link.ariaLabel })),
    [
      {
        href: 'https://x.com/appchanguito',
        label: 'X',
        ariaLabel: 'Changuito en X',
      },
      {
        href: 'https://instagram.com/appchanguito',
        label: 'Instagram',
        ariaLabel: 'Changuito en Instagram',
      },
      {
        href: 'https://www.linkedin.com/company/appchanguito/',
        label: 'LinkedIn',
        ariaLabel: 'Changuito en LinkedIn',
      },
    ],
  );
  assert.equal(SOCIAL.filter((link) => link.href === 'https://x.com/appchanguito').length, 1);
  assert.equal(SOCIAL.filter((link) => link.href.includes('twitter.com')).length, 0);
  assert.equal(SOCIAL.filter((link) => link.href.includes('viewAsMember')).length, 0);
  const page = readFileSync(join(root, 'components/landing/landing-page.tsx'), 'utf8');
  const footer = readFileSync(join(root, 'components/landing/site-footer.tsx'), 'utf8');
  assert.match(page, /<SiteFooter \/>/);
  assert.equal(footer.includes('SOCIAL'), true);
  assert.equal(footer.includes('landing-social'), true);
  assert.equal(footer.includes('target="_blank"'), true);
  assert.equal(footer.includes('noopener noreferrer'), true);
  assert.equal(footer.includes('aria-label={link.ariaLabel}'), true);
  assert.equal(footer.includes('LinkedInIcon'), true);
  assert.equal(footer.includes('XIcon'), false);
  assert.equal(footer.includes('https://x.com/appchanguito'), false);
  assert.equal(footer.includes('viewAsMember'), false);
  assert.equal(footer.split('SOCIAL.map').length - 1, 1);
  assert.equal(footer.includes('landing-footer-app'), false);
  assert.equal(footer.includes('FOOTER.appLabel'), false);
  assert.equal(page.includes('landing-footer-app'), false);
  assert.equal(page.includes('FOOTER.appLabel'), false);
  const css = readFileSync(join(root, 'components/landing/landing.module.css'), 'utf8');
  assert.equal(css.includes('.footerLabel'), false);
});

test('hero copy matches the locked brief', () => {
  assert.equal(
    `${HERO.h1Lead} ${HERO.h1Rest}`,
    'Decile qué querés cocinar. Changuito te arma el carrito.',
  );
  assert.equal(
    HERO.sub,
    'Compara precios entre supermercados y te deja el carrito listo para pagar con tarjeta o USDC.',
  );
  assert.equal('pay' in HERO, false);
  assert.equal(HERO.cta, 'Probar Changuito');
  assert.equal(BOFU.cta, 'Sumate a la beta');
  assert.equal('secondary' in HERO, false);
  assert.equal(PAYMENTS.title, 'Pagá con tarjeta o USDC');
  assert.equal(PAYMENTS.assurance, NO_CHARGE);
  const page = readFileSync(join(root, 'components/landing/landing-page.tsx'), 'utf8');
  const css = readFileSync(join(root, 'components/landing/landing.module.css'), 'utf8');
  assert.equal(page.includes('Ver cómo funciona'), false);
  assert.equal(page.includes('textLink'), false);
  assert.equal(css.includes('.textLink'), false);
  assert.equal(page.includes('id="como-funciona"'), true);
  assert.equal(page.includes('/brand/animacion-cargando.gif'), false);
  assert.equal(page.includes('<HeroDemo />'), true);
});

test('landing copy stays free of jargon and a refund promise', () => {
  const blob = JSON.stringify({
    HERO,
    STEPS,
    STEPS_TITLE,
    COMPARE,
    USES,
    USES_TITLE,
    PAYMENTS,
    FAQ,
    BOFU,
    FOOTER,
    TRUST_LINE,
    FOUNDER_SENTENCE,
    FOUNDERS,
    SOCIAL,
    DESCRIPTION,
  }).toLowerCase();
  for (const word of [
    'blockchain',
    'wallet',
    'crypto',
    'web3',
    'stellar',
    'soroban',
    'escrow',
    'mcp',
    'baloo',
    'devolvemos',
    'no inventados',
    'más simple',
    'aqueprecio',
  ]) {
    assert.equal(blob.includes(word), false, word);
  }
  const withoutNoCharge = blob.split(NO_CHARGE.toLowerCase()).join('');
  assert.equal(withoutNoCharge.includes('no se completa'), false);
  assert.equal(blob.split(NO_CHARGE.toLowerCase()).length - 1, 1);
  assert.equal(STEPS_TITLE, 'Le hablás como a alguien de tu casa');
  assert.equal(STEPS.length, 3);
  assert.deepEqual(
    STEPS.map((item) => item.title),
    ['Pedís en tus palabras', 'Compara precios en vivo', 'Confirmás y pagás'],
  );
  assert.equal(STEPS[1].body, 'Jumbo, Disco, Carrefour y Día, en el momento.');
  assert.equal(COMPARE.title, 'Compara entre súper y te muestra cuánto ahorrás');
  assert.equal(
    COMPARE.body,
    'El mismo producto no cuesta igual en cada cadena. Changuito los pone juntos y te muestra la diferencia.',
  );
  assert.equal(COMPARE.body.includes('%'), false);
  assert.equal(USES_TITLE, 'Para la semana, el asado o el plan de tu nutricionista');
  assert.deepEqual(
    USES.map((item) => item.title),
    ['Asado para 12', 'Plan del nutricionista', 'Presupuesto semanal $40.000', 'Viandas para los chicos'],
  );
  assert.equal(FAQ.length, 4);
  assert.equal(BOFU.title, 'Sumate a la beta');
  assert.equal(JSON.stringify(FAQ).includes(NO_CHARGE), false);
});

test('the hero is a coded product demo, not the loading GIF', () => {
  const page = readFileSync(join(root, 'components/landing/landing-page.tsx'), 'utf8');
  const demo = readFileSync(join(root, 'components/landing/hero-demo.tsx'), 'utf8');
  const css = readFileSync(join(root, 'components/landing/landing.module.css'), 'utf8');
  assert.equal(page.includes('/brand/animacion-cargando.gif'), false);
  assert.equal(page.includes('animacion-busqueda'), false);
  assert.equal(page.includes('mascot-exito'), false);
  assert.equal(page.includes('landing-benefits'), false);
  assert.equal(demo.includes('app.changuito.me'), false);
  assert.match(demo, /Asado para 12 el sábado/);
  assert.match(demo, /Buscando en Jumbo, Disco, Carrefour y Día…/);
  assert.match(demo, /Pagá con USDC/);
  assert.match(demo, /Pagar con tarjeta/);
  assert.match(demo, /\$19\.340/);
  assert.equal(demo.includes('<input'), false);
  assert.equal(demo.includes('<button'), false);
  const payments = page.slice(
    page.indexOf('data-testid="landing-payments"'),
    page.indexOf('data-testid="landing-faq"'),
  );
  assert.equal(payments.includes('<img'), false);
  assert.equal(payments.includes('animacion-'), false);
  assert.equal(payments.includes(NO_CHARGE), false);
  assert.match(payments, /\{PAYMENTS\.assurance\}/);
  assert.equal(existsSync(join(root, 'public/brand/animacion-busqueda.gif')), false);
  assert.equal(existsSync(join(root, 'public/brand/mascot-exito.png')), false);
  const motion = css.slice(css.indexOf('@media (prefers-reduced-motion: no-preference)'));
  assert.match(motion, /animation-duration:\s*20s/);
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /\.beatStatus\s*\{[^}]*display:\s*none/);
  assert.match(reduced, /\.beatHold[\s\S]*opacity:\s*1/);
  const headings = [
    'STEPS_TITLE',
    'COMPARE.title',
    'USES_TITLE',
    'PAYMENTS.title',
    'FAQ_TITLE',
    'BOFU.title',
  ];
  let at = page.indexOf('HERO.h1Lead');
  assert.notEqual(at, -1);
  for (const token of headings) {
    const next = page.indexOf(token, at);
    assert.notEqual(next, -1, token);
    at = next + token.length;
  }
});

test('source does not reintroduce the refund line or a tiled pattern', () => {
  const textExt = new Set(['.ts', '.tsx', '.css', '.md', '.json']);
  const hits: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.next' || entry === 'lib') continue;
      const path = join(dir, entry);
      const stat = statSync(path);
      if (stat.isDirectory()) {
        walk(path);
        continue;
      }
      const ext = entry.slice(entry.lastIndexOf('.'));
      if (!textExt.has(ext)) continue;
      const text = readFileSync(path, 'utf8').toLowerCase();
      if (
        text.includes('devolvemos') ||
        text.includes('no se completa') ||
        text.includes('no inventados') ||
        text.includes('patron-mate-pan') ||
        text.includes('background-repeat')
      ) {
        hits.push(relative(root, path));
      }
    }
  }
  walk(root);
  assert.deepEqual(hits, []);
});

test('founder trust is one shared line, with the mark, and not a second copyright', () => {
  assert.equal(TRUST_LINE, '© 2026 Changuito\u00AE · Hecho en 🇦🇷 por SimonethG y Fabio.');
  assert.equal(COPYRIGHT_LINE, '© 2026 Changuito\u00AE');
  assert.equal(FOUNDER_SENTENCE, 'Hecho en 🇦🇷 por SimonethG y Fabio.');
  assert.equal('copyright' in FOOTER, false);

  const home = readFileSync(join(root, 'components/landing/landing-page.tsx'), 'utf8');
  const footerSrc = readFileSync(join(root, 'components/landing/site-footer.tsx'), 'utf8');
  assert.match(home, /<SiteFooter \/>/);
  const footer = footerSrc.slice(footerSrc.indexOf('<footer'));
  const legalAt = footer.indexOf('{FOOTER.legal}');
  const trustAt = footer.indexOf('<FounderTrust');
  const navClose = footer.indexOf('</nav>');
  assert.ok(navClose !== -1 && navClose < legalAt);
  assert.ok(legalAt !== -1 && legalAt < trustAt);
  assert.equal(footer.includes('FOOTER.copyright'), false);
  assert.equal(footer.includes('©'), false);
  assert.equal(footer.slice(0, navClose).includes('FounderTrust'), false);
  assert.equal(footer.split('FounderTrust').length - 1, 1);
  assert.match(footer, /trust \? <FounderTrust/);

  const whitelist = readFileSync(join(root, 'app/whitelist/page.tsx'), 'utf8');
  const cardAt = whitelist.indexOf('styles.card');
  const whitelistTrust = whitelist.indexOf('<FounderTrust');
  const mainClose = whitelist.indexOf('</main>');
  assert.ok(cardAt !== -1 && cardAt < whitelistTrust && whitelistTrust < mainClose);
  assert.equal(whitelist.split('FounderTrust').length - 1, 2);
  assert.match(whitelist, /<SiteFooter navBase="\/" trust=\{false\} \/>/);

  const bug = readFileSync(join(root, 'app/reportarbug/page.tsx'), 'utf8');
  const panel = readFileSync(join(root, 'components/bug-report/bug-report-panel.tsx'), 'utf8');
  const bugCss = readFileSync(join(root, 'components/bug-report/bug-report.module.css'), 'utf8');
  const viewport = readFileSync(join(root, 'components/bug-report/bug-report-viewport.tsx'), 'utf8');
  assert.equal(panel.includes('FounderTrust'), false);
  assert.equal(bug.split('FounderTrust').length - 1, 2);
  assert.match(bugCss, /data-keyboard='open'/);
  assert.match(viewport, /dataset\.keyboard = 'open'/);
  assert.equal(existsSync(join(root, 'components/trust/founder-line.tsx')), false);
});

test('footer social links are at least a 44×44 tap target', () => {
  // The X link is one letter; without a min-width it measured about 32×44.
  const css = readFileSync(new URL('../../components/landing/landing.module.css', import.meta.url), 'utf8');
  const rule = css.slice(css.indexOf('.socialLink {'));
  const body = rule.slice(0, rule.indexOf('}'));
  assert.match(body, /min-width:\s*44px/);
  assert.match(body, /min-height:\s*44px/);
});
