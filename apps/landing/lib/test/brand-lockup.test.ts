import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const landing = join(dirname(fileURLToPath(import.meta.url)), '../..');
const web = join(landing, '../web');

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

test('the home header is the wordmark alone', () => {
  const header = source(join(landing, 'components/landing/site-header.tsx'));
  const page = source(join(landing, 'components/landing/landing-page.tsx'));
  const footer = source(join(landing, 'components/landing/site-footer.tsx'));
  const lockup = source(join(landing, 'components/landing/brand-lockup.tsx'));

  assert.match(header, /<BrandLockup variant="wordmark" \/>/);
  assert.equal(header.includes('mascot'), false);
  assert.equal(header.includes('isotipo'), false);
  assert.equal(header.includes('>Changuito<'), false);

  const wordmark = lockup.slice(lockup.indexOf('function Wordmark'), lockup.indexOf('function CharacterMark'));
  assert.match(wordmark, /src="\/brand\/wordmark\.png"/);
  assert.match(wordmark, /alt="Changuito"/);
  assert.equal(wordmark.includes('mascot'), false);
  assert.equal(wordmark.includes('>Changuito<'), false);
  assert.equal(wordmark.includes('isotipo'), false);

  const character = lockup.slice(lockup.indexOf('function CharacterMark'));
  assert.match(character, /src="\/brand\/mascot-idle\.png"/);
  assert.match(character, />Changuito</);

  assert.match(page, /<BrandLockup className=\{styles\.bofuBrand\} \/>/);
  assert.match(page, /<SiteFooter \/>/);
  assert.match(footer, /<BrandLockup className=\{styles\.footerBrand\} \/>/);
  assert.equal(page.includes('variant="wordmark"'), false);
  assert.equal(footer.includes('variant="wordmark"'), false);
  assert.equal(page.includes('/brand/animacion-cargando.gif'), false);
  assert.match(page, /<HeroDemo \/>/);
  assert.equal(page.includes('animacion-busqueda'), false);
  assert.equal(header.includes('BrandLockup'), true);
  assert.equal(page.includes('BrandLockup'), true);
  assert.equal(footer.includes('BrandLockup'), true);
});

test('the shopper header is the wordmark alone, not the mascot and not type', () => {
  const shopper = source(join(web, 'app/page.tsx'));

  assert.match(shopper, /src="\/brand\/wordmark\.png"/);
  assert.equal(shopper.includes('lockup-stacked'), false);

  // The mascot used to sit beside the wordmark here, and it is gone on
  // purpose: the cart rail already draws one in the top-right corner at the
  // same size, so the masthead's copy was the second of two. This is the
  // assertion that keeps it gone — the img is three lines and would come back
  // the next time somebody reaches for "the header looks bare".
  //
  // The src, not the word: the comment that replaced the img says why it is
  // not there, and a test that reads prose would fail on the explanation.
  assert.equal(shopper.includes('/brand/mascot-idle.png'), false);
  assert.equal(shopper.includes('className="brand-mark"'), false);

  // The h1 is named by text a screen reader and a crawler can read, and the
  // only place that text lives is visually hidden: what shows is the image.
  const h1 = shopper.slice(shopper.indexOf('<h1'), shopper.indexOf('</h1>'));
  assert.match(h1, /<span className="sr-only">Changuito<\/span>/);
  assert.match(h1, /className="brand-wordmark"[\s\S]*alt=""/);
  assert.equal(shopper.replace('<span className="sr-only">Changuito</span>', '').includes('>Changuito<'), false);
});
