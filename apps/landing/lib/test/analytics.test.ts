import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  analyticsCspSources,
  clarityBootstrap,
  clarityProjectId,
  ctaIdFrom,
  gaBootstrap,
  gaMeasurementId,
  metaBootstrap,
  metaPixelId,
  outboundLabel,
  sanitizeProps,
  track,
} from '../analytics.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

const KEYS = [
  'NEXT_PUBLIC_GA_MEASUREMENT_ID',
  'NEXT_PUBLIC_META_PIXEL_ID',
  'NEXT_PUBLIC_CLARITY_PROJECT_ID',
] as const;

function withIds(values: Partial<Record<(typeof KEYS)[number], string | undefined>>, run: () => void) {
  const previous = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  for (const key of KEYS) {
    const next = values[key];
    if (next === undefined) delete process.env[key];
    else process.env[key] = next;
  }
  try {
    run();
  } finally {
    for (const key of KEYS) {
      const prior = previous[key];
      if (typeof prior === 'string') process.env[key] = prior;
      else delete process.env[key];
    }
  }
}

test('unset or malformed analytics ids stay off and add no CSP hosts', () => {
  withIds({}, () => {
    assert.equal(gaMeasurementId(), undefined);
    assert.equal(metaPixelId(), undefined);
    assert.equal(clarityProjectId(), undefined);
    assert.deepEqual(analyticsCspSources(), { script: [], connect: [], img: [] });
  });

  withIds(
    {
      NEXT_PUBLIC_GA_MEASUREMENT_ID: "G-X');alert(1)",
      NEXT_PUBLIC_META_PIXEL_ID: '12abc',
      NEXT_PUBLIC_CLARITY_PROJECT_ID: 'bad id',
    },
    () => {
      assert.equal(gaMeasurementId(), undefined);
      assert.equal(metaPixelId(), undefined);
      assert.equal(clarityProjectId(), undefined);
      assert.deepEqual(analyticsCspSources().script, []);
    },
  );
});

test('a valid id opens only that vendor, and the snippet cannot carry another id', () => {
  withIds({ NEXT_PUBLIC_GA_MEASUREMENT_ID: 'G-TEST1234' }, () => {
    const sources = analyticsCspSources();
    assert.equal(gaMeasurementId(), 'G-TEST1234');
    assert.ok(sources.script.includes('https://www.googletagmanager.com'));
    assert.equal(sources.script.includes('https://connect.facebook.net'), false);
    assert.equal(sources.script.includes('https://www.clarity.ms'), false);
    const snippet = gaBootstrap('G-TEST1234');
    assert.match(snippet, /gtag\('config','G-TEST1234'\)/);
    assert.equal(snippet.includes('facebook'), false);
  });

  withIds({ NEXT_PUBLIC_META_PIXEL_ID: '1234567890' }, () => {
    const snippet = metaBootstrap('1234567890');
    assert.match(snippet, /fbq\('init','1234567890'\)/);
    assert.match(snippet, /fbq\('track','PageView'\)/);
    assert.ok(analyticsCspSources().script.includes('https://connect.facebook.net'));
  });

  withIds({ NEXT_PUBLIC_CLARITY_PROJECT_ID: 'abc123xyz' }, () => {
    assert.match(clarityBootstrap('abc123xyz'), /clarity\.ms\/tag\/"\+i/);
    assert.ok(analyticsCspSources().script.includes('https://scripts.clarity.ms'));
  });
});

test('track props drop personal data and keep the allowlist', () => {
  const safe = sanitizeProps({
    error_type: 'field',
    value: 'yes',
    cta_id: 'landing-cta-hero',
    label: 'x',
    page_path: '/whitelist',
    utm_source: 'instagram',
    utm_medium: 'bio',
  });
  assert.deepEqual(safe, {
    error_type: 'field',
    value: 'yes',
    cta_id: 'landing-cta-hero',
    label: 'x',
    page_path: '/whitelist',
    utm_source: 'instagram',
    utm_medium: 'bio',
  });

  const leaked = sanitizeProps({
    error_type: 'server',
    page_path: '/whitelist?email=ada@ejemplo.com',
    utm_source: 'ada@ejemplo.com',
    cta_id: 'not-a-cta',
  } as never);
  assert.deepEqual(leaked, { error_type: 'server' });
  assert.equal(JSON.stringify(leaked).includes('ada@'), false);

  assert.equal(ctaIdFrom('landing-cta-header'), 'landing-cta-header');
  assert.equal(ctaIdFrom('whitelist-submit'), undefined);
  assert.equal(outboundLabel('https://www.linkedin.com/in/simonethg/'), 'simoneth_linkedin');
  assert.equal(outboundLabel('https://www.linkedin.com/in/fabio-laura-yavi'), 'fabio_linkedin');
  assert.equal(outboundLabel('https://x.com/appchanguito'), 'x');
  assert.equal(outboundLabel('https://instagram.com/appchanguito'), 'instagram');
  assert.equal(outboundLabel('https://www.linkedin.com/company/appchanguito/'), 'linkedin');
  assert.equal(outboundLabel('https://www.linkedin.com/company/appchanguito/?viewAsMember=true'), undefined);
  assert.equal(outboundLabel('https://instagram.com/otra'), undefined);
  assert.doesNotThrow(() => track('whitelist_submit_success', { error_type: 'server' }));
});

test('the landing wires analytics without sending form fields', () => {
  const layout = readFileSync(join(root, 'app/layout.tsx'), 'utf8');
  const scripts = readFileSync(join(root, 'components/analytics/analytics-scripts.tsx'), 'utf8');
  const listener = readFileSync(join(root, 'components/analytics/analytics-listener.tsx'), 'utf8');
  const whitelist = readFileSync(join(root, 'app/whitelist/page.tsx'), 'utf8');
  const bugPage = readFileSync(join(root, 'app/reportarbug/page.tsx'), 'utf8');
  const form = readFileSync(join(root, 'components/waitlist/waitlist-form.tsx'), 'utf8');
  const bugForm = readFileSync(join(root, 'components/bug-report/bug-report-form.tsx'), 'utf8');
  const config = readFileSync(join(root, 'next.config.ts'), 'utf8');
  const csp = readFileSync(join(root, 'lib/csp.ts'), 'utf8');
  const example = readFileSync(join(root, '.env.example'), 'utf8');

  assert.match(layout, /AnalyticsScripts/);
  assert.match(layout, /AnalyticsListener/);
  assert.match(scripts, /next\/script/);
  assert.match(scripts, /gaMeasurementId\(\)/);
  assert.match(scripts, /metaPixelId\(\)/);
  assert.match(scripts, /clarityProjectId\(\)/);
  assert.match(listener, /cta_probar_click/);
  assert.match(listener, /outbound_click/);
  assert.match(listener, /trackPageView/);
  assert.match(whitelist, /whitelist_view/);
  assert.match(whitelist, /whitelist_submit_success/);
  assert.match(bugPage, /bug_report_view/);
  assert.match(bugPage, /bug_report_success/);
  assert.match(form, /whitelist_submit_attempt/);
  assert.match(form, /whitelist_submit_error/);
  assert.match(form, /error_type: 'field'/);
  assert.match(form, /error_type: 'server'/);
  assert.match(form, /whitelist_group_optin/);
  assert.match(form, /value: 'yes'/);
  assert.match(form, /value: 'no'/);
  assert.match(bugForm, /bug_report_success/);
  assert.equal(/track\([^)]*email/.test(form), false);
  assert.equal(/track\([^)]*whatsapp[^G]/.test(form), false);
  assert.match(config, /landingSecurityHeaders/);
  assert.match(csp, /analyticsCspSources/);
  assert.match(example, /NEXT_PUBLIC_GA_MEASUREMENT_ID/);
  assert.match(example, /NEXT_PUBLIC_META_PIXEL_ID/);
  assert.match(example, /NEXT_PUBLIC_CLARITY_PROJECT_ID/);
  const analyticsBlock = example.slice(example.indexOf('# ---- analytics'));
  assert.match(analyticsBlock, /NEXT_PUBLIC_CLARITY_PROJECT_ID/);
  for (const file of [scripts, listener, form, analyticsBlock]) {
    assert.equal(file.includes('\u2014'), false);
    assert.equal(file.includes('\u2013'), false);
  }
});
