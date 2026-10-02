import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  SERVER_ERROR,
  TURNSTILE_MISSING,
  WHATSAPP_INVALID,
  firstFieldMessage,
  noticeFromQuery,
} from '../waitlist/messages.ts';
import { EVENT_SOURCES, OTHER_SOURCE, SOCIAL_SOURCES, SOURCE_GROUPS, allowedSources } from '../waitlist/options.ts';
import { saveWaitlistEntry } from '../waitlist/persist.ts';
import type { RateBuckets } from '../waitlist/rate-limit.ts';
import { allowSubmission } from '../waitlist/rate-limit.ts';
import { submitWaitlist } from '../waitlist/submit.ts';
import { resetTurnstileDevLog, verifyTurnstile } from '../waitlist/turnstile.ts';
import { normalizeWhatsapp, validateWaitlist } from '../waitlist/validate.ts';

const CREATED = '2026-09-22T12:00:00.000Z';
const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

test('the whitelist header is the idle mascot plus the wordmark', () => {
  const page = readFileSync(join(root, 'app/whitelist/page.tsx'), 'utf8');
  const header = page.slice(0, page.indexOf('</header>'));
  assert.match(header, /src="\/brand\/mascot-idle\.png"/);
  assert.match(header, /data-testid="whitelist-mascot"/);
  assert.match(header, /src="\/brand\/wordmark\.png"/);
  assert.match(header, /alt="Changuito"/);
  assert.match(header, /data-testid="whitelist-wordmark"/);
  assert.equal(header.includes('>Changuito<'), false);
  assert.equal(header.includes('isotipo-mascota'), false);
  assert.equal(header.includes('mascot-error'), false);

  const css = readFileSync(join(root, 'components/waitlist/waitlist.module.css'), 'utf8');
  assert.match(css, /\.wordmark \{/);
  assert.equal(css.includes('.brandName'), false);

  const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
  assert.equal(
    hash(join(root, 'public/brand/mascot-idle.png')),
    hash(join(root, '../branding/mascot/mascota-idle.png')),
  );
  assert.equal(
    hash(join(root, 'public/brand/wordmark.png')),
    hash(join(root, '../branding/logo/wordmark.png')),
  );
  // Route icon omitted on purpose. /whitelist inherits the root full-mascot favicons.
  assert.equal(existsSync(join(root, 'app/whitelist/icon.png')), false);
});

const valid = {
  name: 'Martina López',
  email: 'Martina@Ejemplo.com',
  source: 'Instagram',
  otherDetail: '',
  whatsapp: '+54 9 11 5555 1234',
  whatsappGroup: 'no',
};

test('the source list is socials, events (with Nerdearla) and Otros — no WhatsApp or Threads', () => {
  assert.deepEqual([...SOCIAL_SOURCES], [
    'Instagram',
    'X (Twitter)',
    'LinkedIn',
    'TikTok',
    'YouTube',
    'Facebook',
    'Telegram',
  ]);
  assert.deepEqual([...EVENT_SOURCES], [
    'Nerdearla',
    'AI Founder Marketplace',
    'Astra Commons: Buenos Aires',
    'BrowserStack Meetup Buenos Aires: Master Accessibility & AI in QA',
    'Founders Fit Club — Edición 03',
    'SideQuest - LOVE.exe',
  ]);
  assert.equal(EVENT_SOURCES[4].includes('—'), true);
  assert.equal(OTHER_SOURCE, 'Otros');
  assert.deepEqual(
    SOURCE_GROUPS.map((group) => group.label),
    ['Redes sociales', 'Eventos', 'Otros'],
  );
  assert.deepEqual(
    SOURCE_GROUPS.map((group) => group.id),
    ['social', 'events', 'other'],
  );
  assert.equal(allowedSources().size, 14);
  assert.equal(allowedSources().has('Nerdearla'), true);
  assert.equal(allowedSources().has('WhatsApp'), false);
  assert.equal(allowedSources().has('Threads'), false);
});

test('waitlist fields use the same inset as the bug report controls', () => {
  const css = readFileSync(join(root, 'components/waitlist/waitlist.module.css'), 'utf8');
  const control = css.slice(css.indexOf('.control {'), css.indexOf('select.control'));
  assert.match(control, /padding:\s*14px 20px/);
  assert.match(css, /select\.control\s*\{[^}]*padding-inline-end:\s*44px/s);
  assert.equal(css.includes('\u2014'), false);
  assert.equal(css.includes('\u2013'), false);
});

test('the whitelist page fits the visual viewport and hides trust while the keyboard is open', () => {
  const css = readFileSync(join(root, 'components/waitlist/waitlist.module.css'), 'utf8');
  const page = readFileSync(join(root, 'app/whitelist/page.tsx'), 'utf8');
  const form = readFileSync(join(root, 'components/waitlist/waitlist-form.tsx'), 'utf8');
  const viewport = readFileSync(join(root, 'components/waitlist/whitelist-viewport.tsx'), 'utf8');
  const globals = readFileSync(join(root, 'app/globals.css'), 'utf8');

  assert.equal(/\btransform\s*:/.test(css), false);
  assert.equal(/\bfilter\s*:/.test(css), false);
  assert.equal(/\bperspective\s*:/.test(css), false);
  assert.equal(/\bwill-change\s*:/.test(css), false);
  assert.equal(css.includes('100dvh'), false);
  assert.equal(css.includes('100vh'), false);
  assert.match(css, /position:\s*fixed/);
  assert.match(css, /top:\s*var\(--vv-top, 0px\)/);
  assert.match(css, /height:\s*var\(--vvh, 100svh\)/);
  assert.match(css, /overflow-y:\s*auto/);
  assert.match(css, /data-keyboard='open'/);
  assert.match(css, /\.footerWrap\s*\{[^}]*flex:\s*none/s);
  assert.match(css, /data-keyboard='open'\]\) \.footerWrap\s*\{[^}]*display:\s*none/s);
  assert.match(page, /className=\{styles\.footerWrap\}/);
  assert.match(page, /<SiteFooter navBase="\/" trust=\{false\} \/>/);
  assert.match(page, /interactiveWidget:\s*'resizes-content'/);
  assert.match(page, /WhitelistViewport/);
  assert.match(viewport, /dataset\.keyboard = 'open'/);
  assert.match(form, /scrollDeltaToClear/);
  assert.match(form, /whitelist-screen/);
  assert.match(globals, /html:has\(\[data-testid='whitelist-screen'\]\) body/);
  assert.equal(css.includes('\u2014'), false);
  assert.equal(css.includes('\u2013'), false);
  assert.equal(viewport.includes('\u2014'), false);
  assert.equal(viewport.includes('\u2013'), false);
});

test('the waitlist form asks for a required WhatsApp and the beta group', () => {
  const form = readFileSync(join(root, 'components/waitlist/waitlist-form.tsx'), 'utf8');
  const page = readFileSync(join(root, 'app/whitelist/page.tsx'), 'utf8');
  assert.equal(form.includes('Elegí una sola opción.'), false);
  assert.equal(form.includes('¿Te gustaría que te contactemos para que nos des feedback?'), false);
  assert.equal(form.includes('WhatsApp (opcional)'), false);
  assert.match(form, /Elegí una opción/);
  assert.match(form, /WhatsApp/);
  assert.match(form, /Con código de país\./);
  assert.match(form, /¿Querés sumarte al grupo de WhatsApp de beta testers\?/);
  assert.match(form, /Te contactaremos por WhatsApp por privado\./);
  assert.match(form, /Te sumamos al grupo\./);
  assert.match(page, /Súmate a la lista para beta testear\./);
  assert.match(page, /Solo disponible en 🇦🇷/);
  assert.match(page, /Te bonificaremos algo de tu compra del mercado a cambio del feedback\./);
  for (const copy of [form, page]) {
    assert.equal(copy.includes('\u2014'), false);
    assert.equal(copy.includes('\u2013'), false);
  }
  assert.match(form, /turnstile/i);
});

test('a valid signup keeps the email lowercased and drops detail unless Otros', () => {
  const result = validateWaitlist(valid, CREATED);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.entry.email, 'martina@ejemplo.com');
  assert.equal(result.entry.name, 'Martina López');
  assert.equal(result.entry.otherDetail, undefined);
  assert.equal(result.entry.whatsappGroup, false);
  assert.equal(result.entry.whatsapp, '+5491155551234');
  assert.equal(result.entry.createdAt, CREATED);
});

test('Otros requires a short detail and stores it', () => {
  const missing = validateWaitlist({ ...valid, source: 'Otros', otherDetail: ' ' }, CREATED);
  assert.equal(missing.ok, false);
  if (missing.ok) return;
  assert.equal(missing.errors.otherDetail, 'Contanos dónde, en pocas palabras.');

  const ok = validateWaitlist({ ...valid, source: 'Otros', otherDetail: 'Un amigo' }, CREATED);
  assert.equal(ok.ok, true);
  if (!ok.ok) return;
  assert.equal(ok.entry.otherDetail, 'Un amigo');
});

test('WhatsApp is required and the beta group answer is required', () => {
  const missingGroup = validateWaitlist({ ...valid, whatsappGroup: '' }, CREATED);
  assert.equal(missingGroup.ok, false);
  if (missingGroup.ok) return;
  assert.equal(missingGroup.errors.whatsappGroup, 'Elegí si querés sumarte al grupo.');

  const missingPhone = validateWaitlist({ ...valid, whatsapp: '   ' }, CREATED);
  assert.equal(missingPhone.ok, false);
  if (missingPhone.ok) return;
  assert.equal(missingPhone.errors.whatsapp, 'Revisá tu WhatsApp (con código de país).');

  const noGroup = validateWaitlist({ ...valid, whatsappGroup: 'no' }, CREATED);
  assert.equal(noGroup.ok, true);
  if (!noGroup.ok) return;
  assert.equal(noGroup.entry.whatsappGroup, false);
  assert.equal(noGroup.entry.whatsapp, '+5491155551234');

  const yesGroup = validateWaitlist(
    { ...valid, whatsappGroup: 'sí', whatsapp: '011 15 5555-1234' },
    CREATED,
  );
  assert.equal(yesGroup.ok, true);
  if (!yesGroup.ok) return;
  assert.equal(yesGroup.entry.whatsappGroup, true);
  assert.equal(yesGroup.entry.whatsapp, '+5491155551234');

  const badPhone = validateWaitlist({ ...valid, whatsapp: '123' }, CREATED);
  assert.equal(badPhone.ok, false);
  if (badPhone.ok) return;
  assert.equal(badPhone.errors.whatsapp, 'Revisá tu WhatsApp (con código de país).');
});

test('WhatsApp normalization accepts Argentina and explicit international numbers', () => {
  assert.equal(normalizeWhatsapp('+54 9 11 5555-1234'), '+5491155551234');
  assert.equal(normalizeWhatsapp('5491155551234'), '+5491155551234');
  assert.equal(normalizeWhatsapp('11 5555 1234'), '+5491155551234');
  assert.equal(normalizeWhatsapp('15 5555 1234'), '+5491155551234');
  assert.equal(normalizeWhatsapp('+54 (011) 15 5555-1234'), '+5491155551234');
  assert.equal(normalizeWhatsapp('351 15 555 1234'), '+5493515551234');
  assert.equal(normalizeWhatsapp('+1 415 555 0134'), '+14155550134');
  assert.equal(normalizeWhatsapp('123'), undefined);
  assert.equal(normalizeWhatsapp('no es un teléfono'), undefined);
  assert.equal(normalizeWhatsapp(''), undefined);
});

test('rejects an unknown source, a bad email and a one-letter name', () => {
  const result = validateWaitlist(
    { name: 'A', email: 'no-es-mail', source: 'Radio', otherDetail: '', whatsapp: '123', whatsappGroup: 'no' },
    CREATED,
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.errors.name, 'El nombre es muy corto.');
  assert.equal(result.errors.email, 'Revisá tu email.');
  const emptyEmail = validateWaitlist({ ...valid, email: '  ' }, CREATED);
  assert.equal(emptyEmail.ok, false);
  if (!emptyEmail.ok) assert.equal(emptyEmail.errors.email, 'Completá tu email.');
  assert.equal(result.errors.source, 'Elegí cómo te enteraste de nosotros.');
});

test('a field failure names the field and a server failure does not', () => {
  const checked = validateWaitlist(
    { ...valid, name: '', whatsapp: '123' },
    CREATED,
  );
  assert.equal(checked.ok, false);
  if (checked.ok) return;
  assert.equal(firstFieldMessage(checked.errors), 'Completá tu nombre.');
  assert.equal(checked.errors.whatsapp, WHATSAPP_INVALID);
  assert.notEqual(SERVER_ERROR, WHATSAPP_INVALID);
  assert.notEqual(SERVER_ERROR, TURNSTILE_MISSING);
  assert.equal(noticeFromQuery('nuestro'), SERVER_ERROR);
  assert.equal(noticeFromQuery('datos', 'whatsapp'), WHATSAPP_INVALID);
  assert.equal(noticeFromQuery('datos', 'turnstile'), TURNSTILE_MISSING);
  assert.equal(noticeFromQuery('error'), 'Revisá los datos del formulario.');
  assert.equal(noticeFromQuery('listo'), undefined);

  const form = readFileSync(join(root, 'components/waitlist/waitlist-form.tsx'), 'utf8');
  const page = readFileSync(join(root, 'app/whitelist/page.tsx'), 'utf8');
  assert.equal(form.includes('No pudimos anotarte. Probá de nuevo en un rato.'), false);
  assert.match(form, /firstFieldMessage/);
  assert.match(form, /SERVER_ERROR/);
  assert.equal(page.includes('Revisá los datos e intentá de nuevo.'), false);
  assert.equal(form.includes('\u2014'), false);
  assert.equal(page.includes('\u2014'), false);
});

test('a missing Turnstile token is a field error, not a server failure', async () => {
  resetTurnstileDevLog();
  const result = await submitWaitlist(
    { ...valid, company: '', turnstileToken: '' },
    {
      ip: '198.51.100.12',
      now: Date.parse(CREATED),
      buckets: new Map(),
      env: {
        NODE_ENV: 'production',
        NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'site',
        TURNSTILE_SECRET_KEY: 'secret',
      },
      fetch: async () => Response.json({ success: true }),
    },
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 400);
  assert.equal(result.errors.turnstile, TURNSTILE_MISSING);
  assert.equal(result.errors.form, undefined);
});

test('rate limit allows eight calls from one ip and blocks the ninth', () => {
  const buckets: RateBuckets = new Map();
  for (let i = 0; i < 8; i += 1) {
    assert.equal(allowSubmission('203.0.113.8', `persona${i}@ejemplo.com`, 1_000, buckets), true);
  }
  assert.equal(allowSubmission('203.0.113.8', 'otra@ejemplo.com', 1_000, buckets), false);
});

test('the same email is blocked after three signups', () => {
  const buckets: RateBuckets = new Map();
  assert.equal(allowSubmission('1', 'ana@ejemplo.com', 1_000, buckets), true);
  assert.equal(allowSubmission('2', 'ana@ejemplo.com', 1_000, buckets), true);
  assert.equal(allowSubmission('3', 'ana@ejemplo.com', 1_000, buckets), true);
  assert.equal(allowSubmission('4', 'ana@ejemplo.com', 1_000, buckets), false);
});

test('webhook sink posts the entry and the optional secret', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const result = await saveWaitlistEntry(
    {
      name: 'Martina López',
      email: 'martina@ejemplo.com',
      source: 'Nerdearla',
      whatsapp: '+5491155551234',
      whatsappGroup: true,
      userAgent: 'Mozilla/5.0 test',
      createdAt: CREATED,
    },
    {
      env: {
        NODE_ENV: 'production',
        WAITLIST_WEBHOOK_URL: 'https://hooks.ejemplo.com/waitlist',
        WAITLIST_WEBHOOK_SECRET: 'shhh',
      },
      fetch: async (url: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(url), init: init ?? {} });
        return Response.json({ ok: true });
      },
    },
  );
  assert.deepEqual(result, { ok: true, sink: 'webhook' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://hooks.ejemplo.com/waitlist');
  const headers = new Headers(calls[0].init.headers);
  assert.equal(headers.get('authorization'), 'Bearer shhh');
  const posted = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
  assert.deepEqual(posted, {
    kind: 'waitlist',
    name: 'Martina López',
    email: 'martina@ejemplo.com',
    source: 'Nerdearla',
    otherDetail: null,
    whatsapp: '+5491155551234',
    whatsappGroup: true,
    createdAt: CREATED,
    userAgent: 'Mozilla/5.0 test',
    webhookSecret: 'shhh',
  });
  assert.equal('feedback' in posted, false);
  assert.equal('contactForFeedback' in posted, false);
});

test('submit forwards a trimmed user agent and never sends feedback', async () => {
  const bodies: Record<string, unknown>[] = [];
  const result = await submitWaitlist(
    { ...valid, company: '', turnstileToken: '' },
    {
      ip: '198.51.100.20',
      now: Date.parse(CREATED),
      buckets: new Map(),
      userAgent: '  Mozilla/5.0   test agent  ',
      env: { NODE_ENV: 'development', WAITLIST_WEBHOOK_URL: 'https://hooks.ejemplo.com/waitlist' },
      fetch: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(null, { status: 200 });
      },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(bodies[0].kind, 'waitlist');
  assert.equal(bodies[0].userAgent, 'Mozilla/5.0 test agent');
  assert.equal(bodies[0].whatsapp, '+5491155551234');
  assert.equal(bodies[0].whatsappGroup, false);
  assert.equal('feedback' in bodies[0], false);
});

test('a webhook HTTP 200 with ok false is not a saved signup', async () => {
  const errors: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map((part) => String(part)).join(' '));
  };
  const entry = {
    name: 'Martina López',
    email: 'martina@ejemplo.com',
    source: 'Nerdearla',
    whatsapp: '+5491155551234',
    whatsappGroup: false,
    createdAt: CREATED,
  };
  const env = {
    NODE_ENV: 'production' as const,
    WAITLIST_WEBHOOK_URL: 'https://hooks.ejemplo.com/waitlist',
    WAITLIST_WEBHOOK_SECRET: 'shhh',
  };
  try {
    const unauthorized = await saveWaitlistEntry(entry, {
      env,
      fetch: async () => Response.json({ ok: false, error: 'unauthorized' }),
    });
    assert.deepEqual(unauthorized, { ok: false, reason: 'upstream' });

    const upstream = await saveWaitlistEntry(entry, {
      env,
      fetch: async () =>
        new Response('{"ok":false,"error":"sheet write failed"}', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        }),
    });
    assert.deepEqual(upstream, { ok: false, reason: 'upstream' });
  } finally {
    console.error = original;
  }
  assert.equal(errors.some((line) => line.includes('webhook unauthorized')), true);
  assert.equal(errors.some((line) => line.includes('webhook upstream rejected the signup')), true);
});

test('a non-json webhook response still counts as saved', async () => {
  const result = await saveWaitlistEntry(
    {
      name: 'Martina López',
      email: 'martina@ejemplo.com',
      source: 'Instagram',
      whatsapp: '+5491155551234',
      whatsappGroup: false,
      createdAt: CREATED,
    },
    {
      env: {
        NODE_ENV: 'production',
        WAITLIST_WEBHOOK_URL: 'https://hooks.ejemplo.com/waitlist',
      },
      fetch: async (_url, init) => {
        const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
        assert.equal(Object.hasOwn(payload, 'webhookSecret'), false);
        return new Response(null, { status: 204 });
      },
    },
  );
  assert.deepEqual(result, { ok: true, sink: 'webhook' });
});

test('redis sink writes one hash field and treats an existing email as saved', async () => {
  const commands: unknown[] = [];
  const result = await saveWaitlistEntry(
    {
      name: 'Martina López',
      email: 'martina@ejemplo.com',
      source: 'Instagram',
      whatsapp: '+5491155551234',
      whatsappGroup: false,
      createdAt: CREATED,
    },
    {
      env: {
        NODE_ENV: 'production',
        KV_REST_API_URL: 'https://ejemplo.upstash.io',
        KV_REST_API_TOKEN: 'token',
      },
      fetch: async (_url: RequestInfo | URL, init?: RequestInit) => {
        commands.push(JSON.parse(String(init?.body)));
        return Response.json({ result: 0 });
      },
    },
  );
  assert.deepEqual(result, { ok: true, sink: 'redis' });
  assert.equal(commands.length, 1);
  const command = commands[0] as string[];
  assert.equal(command[0], 'HSETNX');
  assert.equal(command[1], 'changuito:landing:waitlist');
  assert.equal(command[2], 'martina@ejemplo.com');
});

test('production without a sink does not pretend the signup was stored', async () => {
  let called = false;
  const result = await saveWaitlistEntry(
    {
      name: 'Martina López',
      email: 'martina@ejemplo.com',
      source: 'Instagram',
      whatsapp: '+5491155551234',
      whatsappGroup: false,
      createdAt: CREATED,
    },
    {
      env: { NODE_ENV: 'production' },
      fetch: async () => {
        called = true;
        return new Response(null, { status: 500 });
      },
    },
  );
  assert.deepEqual(result, { ok: false, reason: 'unconfigured' });
  assert.equal(called, false);
});

test('local dev appends a json line when no sink is configured', async () => {
  const lines: string[] = [];
  const result = await saveWaitlistEntry(
    {
      name: 'Martina López',
      email: 'martina@ejemplo.com',
      source: 'Telegram',
      whatsapp: '+5491155551234',
      whatsappGroup: false,
      createdAt: CREATED,
    },
    {
      env: { NODE_ENV: 'development' },
      fetch: async () => new Response(null, { status: 500 }),
      appendLine: async (line) => {
        lines.push(line);
      },
    },
  );
  assert.deepEqual(result, { ok: true, sink: 'file' });
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).source, 'Telegram');
});

test('a filled honeypot looks successful and does not call the sink', async () => {
  let called = false;
  const result = await submitWaitlist(
    { ...valid, company: 'https://spam.example', turnstileToken: '' },
    {
      ip: '198.51.100.4',
      now: Date.parse(CREATED),
      buckets: new Map(),
      env: { NODE_ENV: 'production' },
      fetch: async () => {
        called = true;
        return new Response(null, { status: 500 });
      },
    },
  );
  assert.deepEqual(result, { ok: true });
  assert.equal(called, false);
});

test('submit persists a clean signup through the webhook', async () => {
  const result = await submitWaitlist(
    { ...valid, company: '', turnstileToken: '' },
    {
      ip: '198.51.100.9',
      now: Date.parse(CREATED),
      buckets: new Map(),
      env: { NODE_ENV: 'development', WAITLIST_WEBHOOK_URL: 'https://hooks.ejemplo.com/waitlist' },
      fetch: async () => new Response(null, { status: 200 }),
    },
  );
  assert.deepEqual(result, { ok: true });
});

test('production submit without Turnstile keys is refused', async () => {
  resetTurnstileDevLog();
  let called = false;
  const result = await submitWaitlist(
    { ...valid, company: '', turnstileToken: 'ignored' },
    {
      ip: '198.51.100.10',
      now: Date.parse(CREATED),
      buckets: new Map(),
      env: { NODE_ENV: 'production', WAITLIST_WEBHOOK_URL: 'https://hooks.ejemplo.com/waitlist' },
      fetch: async () => {
        called = true;
        return new Response(null, { status: 200 });
      },
    },
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 503);
  assert.equal(result.errors.form, 'No pudimos anotarte por un problema nuestro. Probá de nuevo en un rato.');
  assert.equal(result.errors.form?.includes('Revisá'), false);
  assert.equal(called, false);
});

test('Turnstile siteverify accepts a valid token and rejects a bad one', async () => {
  resetTurnstileDevLog();
  const env = {
    NODE_ENV: 'production' as const,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'site',
    TURNSTILE_SECRET_KEY: 'secret',
  };

  const missing = await verifyTurnstile('', {
    env,
    fetch: async () => Response.json({ success: true }),
  });
  assert.deepEqual(missing, { ok: false, error: 'Completá la verificación (Turnstile) y probá de nuevo.' });

  const calls: string[] = [];
  const ok = await verifyTurnstile('token-ok', {
    env,
    ip: '203.0.113.1',
    fetch: async (url, init) => {
      calls.push(String(url));
      assert.equal(String(url), 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
      const body = String(init?.body);
      assert.match(body, /secret=secret/);
      assert.match(body, /response=token-ok/);
      assert.match(body, /remoteip=203\.0\.113\.1/);
      return Response.json({ success: true });
    },
  });
  assert.deepEqual(ok, { ok: true });
  assert.equal(calls.length, 1);

  const bad = await verifyTurnstile('token-bad', {
    env,
    fetch: async () => Response.json({ success: false }),
  });
  assert.deepEqual(bad, { ok: false, error: 'Completá la verificación (Turnstile) y probá de nuevo.' });

  const down = await verifyTurnstile('token-ok', {
    env,
    fetch: async () => new Response(null, { status: 503 }),
  });
  assert.deepEqual(down, {
    ok: false,
    error: 'No pudimos anotarte por un problema nuestro. Probá de nuevo en un rato.',
  });
});

test('submit with Turnstile keys verifies before saving', async () => {
  resetTurnstileDevLog();
  const urls: string[] = [];
  const result = await submitWaitlist(
    { ...valid, company: '', turnstileToken: 'cf-ok' },
    {
      ip: '198.51.100.11',
      now: Date.parse(CREATED),
      buckets: new Map(),
      env: {
        NODE_ENV: 'production',
        NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'site',
        TURNSTILE_SECRET_KEY: 'secret',
        WAITLIST_WEBHOOK_URL: 'https://hooks.ejemplo.com/waitlist',
      },
      fetch: async (url) => {
        urls.push(String(url));
        if (String(url).includes('siteverify')) return Response.json({ success: true });
        return new Response(null, { status: 200 });
      },
    },
  );
  assert.deepEqual(result, { ok: true });
  assert.equal(urls[0]?.includes('siteverify'), true);
  assert.equal(urls[1], 'https://hooks.ejemplo.com/waitlist');
});

test('an http webhook that is not local is ignored', async () => {
  const result = await saveWaitlistEntry(
    {
      name: 'Martina López',
      email: 'martina@ejemplo.com',
      source: 'YouTube',
      whatsapp: '+5491155551234',
      whatsappGroup: false,
      createdAt: CREATED,
    },
    {
      env: { NODE_ENV: 'production', WAITLIST_WEBHOOK_URL: 'http://hooks.ejemplo.com/waitlist' },
      fetch: async () => new Response(null, { status: 200 }),
    },
  );
  assert.deepEqual(result, { ok: false, reason: 'unconfigured' });
});
