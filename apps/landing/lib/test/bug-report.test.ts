import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  bytesToBase64,
  clientFileError,
  MAX_FILE_BYTES,
  validateAttachments,
  wrongTypeMessage,
} from '../bug-report/attachments.ts';
import { SEVERITIES } from '../bug-report/options.ts';
import { saveBugReport } from '../bug-report/persist.ts';
import { submitBugReport } from '../bug-report/submit.ts';
import { validateBugReport, type BugReportEntry } from '../bug-report/validate.ts';

const CREATED = '2026-09-22T12:00:00.000Z';
const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

const valid = {
  name: 'Martina López',
  email: 'Martina@Ejemplo.com',
  description: 'Apreté pagar y la pantalla quedó en blanco.',
  context: '',
  severity: '',
};

test('a valid report lowercases the email and drops empty optional fields', () => {
  const result = validateBugReport(valid, CREATED);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.entry.email, 'martina@ejemplo.com');
  assert.equal(result.entry.name, 'Martina López');
  assert.equal(result.entry.description, valid.description);
  assert.equal(result.entry.context, undefined);
  assert.equal(result.entry.severity, undefined);
  assert.equal(result.entry.createdAt, CREATED);
});

test('optional context and severity are kept when they are real', () => {
  const result = validateBugReport(
    {
      ...valid,
      context: 'https://app.changuito.me después de buscar leche',
      severity: 'No puedo seguir',
    },
    CREATED,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.entry.context, 'https://app.changuito.me después de buscar leche');
  assert.equal(result.entry.severity, 'No puedo seguir');
  assert.deepEqual([...SEVERITIES], ['Molesta un poco', 'Me frena', 'No puedo seguir']);
});

test('name, email and description are required', () => {
  const result = validateBugReport(
    { name: '', email: 'no-es-mail', description: 'corto', context: 'x', severity: 'alta' },
    CREATED,
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.errors.name, 'Completá tu nombre.');
  assert.equal(result.errors.email, 'Ingresá un email válido.');
  assert.equal(result.errors.description, 'Contanos un poco más.');
  assert.equal(result.errors.context, 'Si lo completás, contanos un poco más.');
  assert.equal(result.errors.severity, 'Elegí una opción de la lista.');
});

test('production without a webhook accepts the report and logs it', async () => {
  const logs: BugReportEntry[] = [];
  let called = false;
  const result = await submitBugReport(
    { ...valid, company: '' },
    {
      ip: '198.51.100.20',
      now: Date.parse(CREATED),
      buckets: new Map(),
      env: { NODE_ENV: 'production' },
      fetch: async () => {
        called = true;
        return new Response(null, { status: 500 });
      },
      log: (entry) => logs.push(entry),
    },
  );
  assert.deepEqual(result, { ok: true });
  assert.equal(called, false);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].email, 'martina@ejemplo.com');
  assert.equal(logs[0].description, valid.description);
});

test('webhook sink posts the report and the optional secret', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const saved = validateBugReport(
    { ...valid, context: 'En el carrito', severity: 'Me frena' },
    CREATED,
  );
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  const result = await saveBugReport(saved.entry, {
    env: {
      NODE_ENV: 'production',
      BUG_REPORT_WEBHOOK_URL: 'https://hooks.ejemplo.com/bugs',
      BUG_REPORT_WEBHOOK_SECRET: 'shhh',
    },
    fetch: async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return Response.json({ ok: true });
    },
  });
  assert.deepEqual(result, { ok: true, sink: 'webhook' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://hooks.ejemplo.com/bugs');
  const headers = new Headers(calls[0].init.headers);
  assert.equal(headers.get('authorization'), 'Bearer shhh');
  assert.equal(headers.get('x-changuito-bug-report'), '1');
  assert.equal(headers.get('x-changuito-bug'), '1');
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    kind: 'bug',
    name: 'Martina López',
    email: 'martina@ejemplo.com',
    description: valid.description,
    context: 'En el carrito',
    severity: 'Me frena',
    createdAt: CREATED,
    titulo: `Me frena. ${valid.description}`,
    error: valid.description,
    pasos: 'En el carrito',
    adjuntos: [],
    origen: 'www.changuito.me/reportarbug',
    webhookSecret: 'shhh',
  });
});

const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

test('a small image is forwarded as adjuntos with kind bug', async () => {
  const png = bytesToBase64(PNG_BYTES);
  const calls: { init: RequestInit }[] = [];
  const result = await submitBugReport(
    {
      ...valid,
      company: '',
      adjuntos: [{ name: 'captura.png', mimeType: 'image/png', type: 'image/png', base64: png }],
    },
    {
      ip: '198.51.100.30',
      now: Date.parse(CREATED),
      buckets: new Map(),
      userAgent: 'Mozilla/5.0 test',
      env: { NODE_ENV: 'production', BUG_REPORT_WEBHOOK_URL: 'https://hooks.ejemplo.com/bugs' },
      fetch: async (_url: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ init: init ?? {} });
        return new Response(null, { status: 204 });
      },
    },
  );
  assert.deepEqual(result, { ok: true });
  const payload = JSON.parse(String(calls[0].init.body)) as {
    kind: string;
    userAgent: string;
    webhookSecret?: string;
    adjuntos: { name: string; mimeType: string; base64: string }[];
  };
  assert.equal(payload.kind, 'bug');
  assert.equal(payload.userAgent, 'Mozilla/5.0 test');
  assert.equal(Object.hasOwn(payload, 'webhookSecret'), false);
  assert.equal(payload.adjuntos.length, 1);
  assert.equal(payload.adjuntos[0].name, 'captura.png');
  assert.equal(payload.adjuntos[0].mimeType, 'image/png');
  assert.equal(payload.adjuntos[0].base64, png);
});

test('rejects a non image, too many files, and a file over the cap', () => {
  const png = bytesToBase64(PNG_BYTES);
  const pdf = bytesToBase64(Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]));
  const badType = validateAttachments([{ name: 'notas.pdf', mimeType: 'application/pdf', base64: pdf }]);
  assert.equal(badType.ok, false);
  if (!badType.ok) assert.equal(badType.error, wrongTypeMessage('notas.pdf'));

  const tooMany = validateAttachments(
    [0, 1, 2, 3].map((index) => ({ name: `f${index}.png`, mimeType: 'image/png', base64: png })),
  );
  assert.equal(tooMany.ok, false);
  if (!tooMany.ok) assert.match(tooMany.error, /hasta 3 archivos/);

  const huge = new Uint8Array(MAX_FILE_BYTES + 1);
  huge.set(PNG_BYTES);
  const tooBig = validateAttachments([
    { name: 'clip.mp4', mimeType: 'video/mp4', base64: bytesToBase64(huge) },
  ]);
  assert.equal(tooBig.ok, false);
  if (!tooBig.ok) assert.match(tooBig.error, /3 MB/);

  assert.equal(
    clientFileError({ name: 'foto.jpg', type: 'image/jpeg', size: 1200 }, { count: 0, bytes: 0 }),
    undefined,
  );
  assert.match(
    clientFileError({ name: 'notas.txt', type: 'text/plain', size: 20 }, { count: 0, bytes: 0 }) ?? '',
    /no sirve/,
  );
});

test('the log records attachment names and not the base64 body', async () => {
  const png = bytesToBase64(PNG_BYTES);
  const lines: string[] = [];
  const original = console.info;
  console.info = (message?: unknown) => {
    lines.push(String(message));
  };
  try {
    const saved = validateBugReport(valid, CREATED);
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    const result = await saveBugReport(
      { ...saved.entry, adjuntos: [{ name: 'captura.png', mimeType: 'image/png', base64: png }] },
      {
        env: { NODE_ENV: 'production' },
        fetch: async () => new Response(null, { status: 500 }),
      },
    );
    assert.deepEqual(result, { ok: true, sink: 'log' });
  } finally {
    console.info = original;
  }
  assert.equal(lines.length, 1);
  assert.equal(lines[0].includes(png), false);
  assert.equal(lines[0].includes('captura.png'), true);
});

test('a webhook HTTP 200 with ok false is not a saved report', async () => {
  const errors: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map((part) => String(part)).join(' '));
  };
  const saved = validateBugReport(valid, CREATED);
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  const env = {
    NODE_ENV: 'production' as const,
    BUG_REPORT_WEBHOOK_URL: 'https://hooks.ejemplo.com/bugs',
    BUG_REPORT_WEBHOOK_SECRET: 'shhh',
  };
  try {
    const unauthorized = await saveBugReport(saved.entry, {
      env,
      fetch: async () => Response.json({ ok: false, error: 'unauthorized' }),
    });
    assert.deepEqual(unauthorized, { ok: false, reason: 'upstream' });

    const upstream = await saveBugReport(saved.entry, {
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
  assert.equal(errors.some((line) => line.includes('webhook upstream rejected the report')), true);
});

test('a failed webhook does not pretend the report was delivered', async () => {
  const result = await submitBugReport(
    { ...valid, company: '' },
    {
      ip: '198.51.100.21',
      now: Date.parse(CREATED),
      buckets: new Map(),
      env: { NODE_ENV: 'production', BUG_REPORT_WEBHOOK_URL: 'https://hooks.ejemplo.com/bugs' },
      fetch: async () => new Response(null, { status: 502 }),
    },
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 503);
});

test('an http webhook that is not local is ignored and the report is still logged', async () => {
  const logs: BugReportEntry[] = [];
  const saved = validateBugReport(valid, CREATED);
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  const result = await saveBugReport(saved.entry, {
    env: { NODE_ENV: 'production', BUG_REPORT_WEBHOOK_URL: 'http://hooks.ejemplo.com/bugs' },
    fetch: async () => new Response(null, { status: 200 }),
    log: (entry) => logs.push(entry),
  });
  assert.deepEqual(result, { ok: true, sink: 'log' });
  assert.equal(logs.length, 1);
});

test('a filled honeypot looks successful and does not log or call the webhook', async () => {
  const logs: BugReportEntry[] = [];
  let called = false;
  const result = await submitBugReport(
    { ...valid, company: 'https://spam.example' },
    {
      ip: '198.51.100.4',
      now: Date.parse(CREATED),
      buckets: new Map(),
      env: { NODE_ENV: 'production', BUG_REPORT_WEBHOOK_URL: 'https://hooks.ejemplo.com/bugs' },
      fetch: async () => {
        called = true;
        return new Response(null, { status: 500 });
      },
      log: (entry) => logs.push(entry),
    },
  );
  assert.deepEqual(result, { ok: true });
  assert.equal(called, false);
  assert.equal(logs.length, 0);
});

test('the report page shows the error mascot and the home hero does not', () => {
  const page = readFileSync(join(root, 'app/reportarbug/page.tsx'), 'utf8');
  const panel = readFileSync(join(root, 'components/bug-report/bug-report-panel.tsx'), 'utf8');
  const form = readFileSync(join(root, 'components/bug-report/bug-report-form.tsx'), 'utf8');
  const home = readFileSync(join(root, 'components/landing/landing-page.tsx'), 'utf8');
  const footer = readFileSync(join(root, 'components/landing/site-footer.tsx'), 'utf8');
  const css = readFileSync(join(root, 'components/bug-report/bug-report.module.css'), 'utf8');

  const header = page.slice(0, page.indexOf('</header>'));
  assert.match(header, /src="\/brand\/mascot-error\.png"/);
  assert.match(header, /data-testid="bug-report-mascot"/);
  assert.match(header, /src="\/brand\/wordmark\.png"/);
  assert.match(header, /alt="Changuito"/);
  assert.equal(page.split('/brand/mascot-error.png').length - 1, 1);
  assert.equal(page.includes('isotipo-mascota'), false);
  assert.equal(page.includes('>Changuito<'), false);
  assert.match(page, /BugReportPanel/);
  assert.match(panel, /Contanos qué pasó/);
  assert.match(panel, /Si algo no anduvo, dejalo acá\./);
  const success = form.slice(form.indexOf('export function BugReportSuccess'), form.indexOf('export function BugReportForm'));
  assert.equal(success.includes('Contanos qué pasó'), false);
  assert.equal(success.includes('Si algo no anduvo'), false);
  const confirm = panel.slice(panel.indexOf('if (done)'), panel.indexOf('Contanos qué pasó'));
  assert.match(confirm, /BugReportSuccess/);
  assert.equal(confirm.includes('Si algo no anduvo'), false);
  assert.match(form, /onSuccess/);
  assert.match(form, /Reportar otro error/);
  assert.equal(page.includes('animacion-busqueda'), false);
  assert.equal(page.includes('animacion-cargando'), false);
  assert.equal(page.includes('mascot-exito'), false);
  assert.equal(page.includes('mascot-idle'), false);
  assert.equal(form.includes('mascot-exito'), false);
  assert.equal(form.includes('animacion-busqueda'), false);
  assert.equal(form.includes('animacion-cargando'), false);
  assert.match(home, /<SiteFooter \/>/);
  assert.match(footer, /href="\/reportarbug"/);
  assert.match(footer, /Reportar un bug/);
  assert.equal(home.includes('mascot-error'), false);
  assert.equal(footer.includes('mascot-error'), false);
  assert.equal(home.includes('/brand/animacion-cargando.gif'), false);
  assert.equal(home.includes('animacion-busqueda'), false);

  const mascot = readFileSync(join(root, 'public/brand/mascot-error.png'));
  const idle = readFileSync(join(root, 'public/brand/mascot-idle.png'));
  assert.equal(mascot.readUInt32BE(16), 397);
  assert.equal(mascot.readUInt32BE(20), 583);
  assert.equal(idle.readUInt32BE(16), 397);
  assert.equal(idle.readUInt32BE(20), 583);
  assert.notEqual(createHash('sha256').update(mascot).digest('hex'), createHash('sha256').update(idle).digest('hex'));
  assert.equal(
    createHash('sha256').update(mascot).digest('hex'),
    '960aa1ad5028b53a0ef6bd6deaaa4f4984ede84c0c95cd6a731672d1517dc674',
  );

  const wordmark = readFileSync(join(root, 'public/brand/wordmark.png'));
  const wordmarkMaster = readFileSync(join(root, '../branding/logo/wordmark.png'));
  assert.equal(wordmark.readUInt32BE(16), 1097);
  assert.equal(wordmark.readUInt32BE(20), 249);
  assert.equal(
    createHash('sha256').update(wordmark).digest('hex'),
    createHash('sha256').update(wordmarkMaster).digest('hex'),
  );

  assert.match(form, /Adjuntá una foto o un video/);
  assert.match(form, /type="file"/);

  const ui = `${page}\n${panel}\n${form}\n${css}\n${readFileSync(join(root, 'lib/bug-report/attachments.ts'), 'utf8')}`;
  assert.equal(ui.includes('\u2014'), false);
  assert.equal(ui.includes('\u2013'), false);
});

test('report fields pad the glyphs and leave room for the focus ring', () => {
  const css = readFileSync(join(root, 'components/bug-report/bug-report.module.css'), 'utf8');
  const control = css.slice(css.indexOf('.control {'), css.indexOf('select.control'));
  assert.match(control, /padding:\s*14px 20px/);
  assert.match(css, /select\.control\s*\{[^}]*padding-inline-end:\s*44px/s);
  assert.match(css, /overflow-x:\s*hidden/);
  assert.match(css, /padding:\s*12px 14px 14px/);
  assert.match(css, /padding:\s*14px 16px 16px/);
});
