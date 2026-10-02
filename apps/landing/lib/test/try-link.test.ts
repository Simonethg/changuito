import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

test('the try CTA uses the locked running mascot instead of an arrow', () => {
  const source = readFileSync(join(root, 'components/landing/try-link.tsx'), 'utf8');
  assert.equal(source.includes('→'), false);
  assert.match(source, /href="\/whitelist"/);
  assert.equal(source.includes('href={APP_URL}'), false);
  assert.equal(source.includes('app.changuito.me'), false);
  assert.match(source, /HERO\.cta/);
  assert.match(source, /src="\/brand\/mascota-corriendo\.png"/);
  assert.match(source, /alt=""/);
  assert.match(source, /aria-hidden="true"/);

  const css = readFileSync(join(root, 'components/landing/landing.module.css'), 'utf8');
  assert.match(css, /\.ctaMascot\s*\{[^}]*height:\s*1\.4em;/);
  assert.match(css, /\.ctaMascot\s*\{[^}]*object-fit:\s*contain;/);
  assert.equal(css.includes('.ctaArrow'), false);

  const page = readFileSync(join(root, 'components/landing/landing-page.tsx'), 'utf8');
  const header = readFileSync(join(root, 'components/landing/site-header.tsx'), 'utf8');
  assert.equal(page.includes('APP_URL'), false);
  assert.equal(page.includes('app.changuito.me'), false);
  assert.equal(page.includes('footerLabel'), false);
  assert.equal(page.includes('landing-footer-app'), false);
  assert.equal(page.includes('FOOTER.appLabel'), false);
  assert.equal(header.includes('APP_URL'), false);
  assert.match(page, /testId="landing-cta-hero"/);
  assert.match(page, /testId="landing-cta-bofu"/);
  assert.match(header, /testId="landing-cta-header"/);

  const pub = readFileSync(join(root, 'public/brand/mascota-corriendo.png'));
  const locked = readFileSync(join(root, '../branding/mascot/mascota-corriendo.png'));
  const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  assert.equal(hash(pub), hash(locked));
});
