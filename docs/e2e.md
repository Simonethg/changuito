# End-to-end

Playwright, in three projects. Unit tests stay on `npm test` and do not open a
browser.

| Project | Target |
|---|---|
| `landing` | `LANDING_BASE_URL`, default `https://www.changuito.me` |
| `app` | `APP_BASE_URL`, default `https://app.changuito.me` |
| `checkout` | `CHECKOUT_BASE_URL`, default a `next dev` Playwright starts on 3124 |

The first two are smokes, and production is their target on purpose. A local
preview needs Pollar, Turnstile, and the model keys the app already has on
Vercel; CI does not have those, and a preview would not be what visitors hit.
Neither smoke pays, opens a store checkout, or clicks **Cargar USDC**.

`checkout` is the odd one and has to be. It runs the whole frame-checkout flow
— basket, importe, framed store, single-use card, receipt — and it cannot run
against a deployment, because the fixture it frames in the store's place
(`app/dev/checkout`) `notFound()`s in production. So it gets its own base URL
and its own server. Playwright starts that server only when the run includes
this project; `--project=app` still builds nothing and starts nothing.

**What it does not prove:** that a purchase happened. There is no sandbox
supermarket — Día has no test store — so past "Ya lo pagué" it asserts what the
app does when the store *says* paid, and nothing about Día. The agent, Horizon
and the card issuer are scripted too (`e2e/support/checkout-fixtures.ts` says
why). The deposit leg has been run for real against testnet Horizon by hand;
the card mint has not yet run against a live Vyrion sandbox account.

## Run locally

Node is `22.12.0` (`.nvmrc`). From the repo root, after `npm ci`:

```bash
npx playwright install chromium
npm run test:e2e
npm run test:e2e:ui
```

`test:e2e:ui` opens Playwright's runner. Optional overrides live in
`e2e/.env` (copy `e2e/.env.example`). Values already exported in the shell
win over that file.

## What the specs assert

- **Landing.** The home page renders, the three nav anchors (`#como-funciona`,
  `#pagos`, `#faq`) scroll into view, **Probar Changuito** and **Sumate a la beta**
  go to `/whitelist`, and one FAQ item expands.
- **Whitelist.** An empty submit shows the name and email errors. A name plus
  `no-es-un-email` shows `Revisá tu email.` The test does not submit a real
  signup.
- **App, guest.** The masthead and **Empezá a comprar** render, and the page
  throws no uncaught error. **Empezá a comprar** opens the Pollar modal
  (`Ingresá o creá tu cuenta`, email, Continuar, Google, Wallet) and there is
  no password field. The matchers also accept Pollar's English originals, for
  a run that lands before a deploy is live (`e2e/support/pollar-copy.ts`). The spec closes the modal and does not submit. Chat is
  behind Turnstile. If the check passes, the spec clicks the
  leche-con-proteína chip (or types a short prompt), waits for the reply that
  asks for the postal code, and stops. If Turnstile
  stays up, the verification screen is the pass: CI must not depend on
  Cloudflare letting a bot through. A headless run on 2026-09-24 stayed on
  that screen. Product search is not asserted: a search can take a minute.
  The postal-code reply is, because a guest stuck before it was the blocker
  in issue [#51](https://github.com/raptor0929/changuito/issues/51); the
  server now answers it without a model hop.
- **Checkout.** One test, the whole flow: a scripted turn draws a basket, the
  importe is quoted with its código and confirmed on the second poll, the
  fixture store renders inside the frame, a single-use card is issued and its
  3DS code counts down, **Ya lo pagué** is corroborated before the receipt is
  written, and the card is given back in the same breath. Then: the chat is
  read-only, a second order in it is refused, and the receipt survives a
  reload and reopens from the history rail. Two assertions are guardrails
  rather than features — that the PAN, the CVV and the one-time code never
  reach `localStorage` or `sessionStorage`, and that traces, video and
  screenshots are off, because this repo is public and those numbers are on
  screen for most of the run.
- **App, auth.** Skipped unless both `CHANGUTO_E2E_EMAIL` and
  `CHANGUTO_E2E_PASSWORD` are non-empty. It opens **Empezá a comprar** and
  uses the email field. Traces and screenshots are off for this spec so a
  public Actions artifact cannot keep the inbox or the code.

## Pollar has no password field

`@pollar/react` 0.11.3 (what the shopper mounts) signs in with email by
sending a **6-digit code**, then Google or a wallet. Pollar's own copy is
English (`Log in or sign up`, `Submit`, `or continue with`); the shopper
rewrites it to Spanish after render (`Ingresá o creá tu cuenta`, `Continuar`,
`o seguí con`). There is no password input.

So:

| Secrets | What the auth spec does |
|---|---|
| Either missing or blank | Skips |
| Email + any password, no 6-digit code | Submits the email, expects the code screen, does not claim the wallet chrome |
| Email + `CHANGUTO_E2E_OTP` (or a password that is exactly 6 digits) | Types the code and expects **Salir** and **Tu pago**. **Cargar USDC** is expected only if `GET /api/faucet` says this wallet is on `FAUCET_ALLOWLIST_ADDRESSES`; otherwise the spec checks the button is absent |

A normal password cannot finish login. A code is one-time, so a standing
GitHub secret will not keep the signed-in assertion green unless Pollar
issues a fixed test code. Google OAuth is intentionally not automated.

If the modal has no email field, the spec skips and records that the widget
was Google or wallet only.

## GitHub Actions

Two workflows. They do not share a trigger.

| Workflow | When |
|---|---|
| `.github/workflows/unit.yml` | Every pull request, and every push to `main`. Runs `npm test` only. |
| `.github/workflows/e2e.yml` | A **merge to `main`** whose diff touches a backend path, or **Actions → E2E → Run workflow**. |

E2E does not run on pull requests, and it does not run on a push that only
touches the UI, docs, or the specs themselves. There is no schedule.

A backend merge runs the two smokes (`landing` and `app`). A manual run asks
which suite: `landing`, `app`, `both` (the default), or `checkout`. `checkout`
is never part of an automatic run — it starts a `next dev` on the runner and
touches nothing live, so there is no reason to spend it on every merge, and
asking for it by name keeps that obvious. Each project is its own job, so one
failure does not cancel the other.

The E2E job installs Node from `.nvmrc`, runs `npm ci`, installs Chromium,
then `npm run test:e2e -- --project=<landing|app|checkout>`. It does not repeat
`npm test`. On failure it uploads `playwright-report` and `test-results`
for 7 days, one artifact per project. The auth and checkout specs write
neither screenshots nor traces.

### What counts as backend

The path filter is the list in `e2e.yml`. In short:

| Included | Why |
|---|---|
| `packages/mcp` | The supermarket server the shopper calls. |
| `packages/usdc-bindings`, `packages/escrow-bindings` | Contract clients used by the API. |
| `contracts`, `deployments.json`, `scripts/write-deployments-module.mjs`, `scripts/fixup-bindings.mjs` | The escrow and the demo USDC, and the files that publish their ids into the app. |
| `apps/web/app/api`, `apps/web/middleware.ts`, `apps/web/next.config.ts` | Request handlers and the edge gate. |
| `apps/web/lib/agent`, `lib/mcp`, `lib/server`, plus the server modules named in the workflow (`login-gate`, `human-gate`, `faucet-policy`, `stellar`, `token`, `deployments`, `pollar`, `protocol`, `order`) | The tool loop and the routes' own code. |
| `apps/landing/app/api`, `apps/landing/lib/waitlist`, the bug-report server files, `lib/csp.ts`, `next.config.ts` | Whitelist and bug-report handlers, and the marketing site's response headers. Waitlist copy lives in that same folder, so a string change there also starts the smoke. |
| `package.json`, `package-lock.json` | A dependency change can move the server without touching a route. |

Left out on purpose: `apps/web/components`, `apps/landing/components`, the
page files, `apps/branding`, `docs`, and `e2e/`. `packages/trust` is shared
footer copy rendered in the browser, not a server. A change in any of those
needs a manual run if you want the smoke.

### Add the secrets

Repo → **Settings** → **Secrets and variables** → **Actions** → **New
repository secret**.

| Name | Value |
|---|---|
| `CHANGUTO_E2E_EMAIL` | Inbox Pollar will accept |
| `CHANGUTO_E2E_PASSWORD` | Only useful here if it is the 6-digit code. Any other value still runs the email step. |

Optional, same screen: `CHANGUTO_E2E_OTP` for the code when the password
secret should stay a password. The E2E workflow passes it through when the
secret exists. These secrets are read on `main` and on a manual run. A pull
request does not start the E2E workflow, so a fork never sees them.

Never commit `e2e/.env` or a real inbox.
