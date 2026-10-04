# Tech stack

Versions are pinned exactly where a minor bump would be a real risk — the wallet
SDK, the chain SDK, the agent SDK — and left as ranges where it would not.

## Application

| | Version | Why this one |
|---|---|---|
| **Next.js** | 16.3.5 | App Router, route handlers and streaming responses in one place. Every API route is `runtime = 'nodejs'` — XDR encoding and the MCP server's `node:url` import both fail on edge, and they fail at *import* time, which is a confusing way to find out. |
| **React** | 19.2.0 | |
| **TypeScript** | 5.9.3 | `strict`, `target: ES2022`. ES2023 methods like `findLastIndex` do **not** typecheck here. |
| **Node** | ≥ 22.12 (`.nvmrc`: 22.12.0) | `@stellar/stellar-sdk@17` requires it. On Vercel the project's Node version must be set explicitly or the install fails. |
| **`postgres`** | ^3.4.9 | the order and card records. A plain SQL client, no ORM — the schema is four migrations and the queries are the interesting part |
| **npm workspaces** | — | `apps/*`, `packages/*`. No Turborepo, no pnpm: three apps and four packages do not need a build graph. |

No CSS framework, no state library, no component kit. The transcript is a
reducer in a plain file (`lib/chat-state.ts`) so the ordering rules can be
tested without a browser.

Three apps share the workspace: `apps/web` (the shopper), `apps/landing` (the
marketing site) and `apps/branding` (the assets). `packages/trust` exists so the
copyright line, the registered mark and the founder attribution are written once
and rendered by both public sites rather than drifting apart.

## The agent

| | Version | Notes |
|---|---|---|
| **`@anthropic-ai/sdk`** | 0.127.0 | written against `messages.stream()` rather than the tool runner, because every tool call here has a visible consequence and owning the loop means owning where those are emitted |
| **Model** | `claude-sonnet-5` | overridable with `AGENT_MODEL`. Adaptive thinking + the effort control are Claude 5 features; the loop falls back to a fixed thinking budget for Haiku 4.5, which otherwise rejects the request outright |
| **Effort** | `low` | overridable with `AGENT_EFFORT`. Thinking runs before every tool call and a basket is up to twelve of them, so this is a latency setting more than a quality one |
| **Prompt caching** | two breakpoints | the system + tools prefix, and a moving one on the newest message. The second is what stops hop nine re-reading hops one through eight at full price |
| **`@modelcontextprotocol/sdk`** | 1.30.0 | both the `Client` and the `McpServer`, linked with `InMemoryTransport` |
| **`@upstash/redis`** | ^1.39.0 | conversation history. HTTP, not TCP — one connection per lambda is the connection-limit problem the REST API avoids |

**There is one model provider.** There used to be two: a local model on a Mac at
home over a Cloudflare Tunnel, chosen per hop behind four gates, with a wire
translator between Anthropic's message shape and OpenAI's. It was slower than
the thing it stood in for and it saved an API bill that was never the
constraint, so `provider.ts`, `providers/ollama.ts`, `providers/wire.ts` and
`providers/gate.ts` are deleted along with their tests, and `loop.ts` calls
`anthropicProvider()` directly. `lib/agent/providers/` now holds `anthropic.ts`
and `types.ts`.

The `Provider` interface stays, with `kind` narrowed to one value: it costs one
indirection and it is where the model, the thinking budget and the effort level
live, in a file that is not the loop. Two artefacts of the removal are
deliberate and should not be tidied away — `status: 'fallback'` is still in the
wire protocol though nothing emits it, and `errorCode()` still classifies the
two local-model sentences. [`../CLAUDE.md`](../CLAUDE.md) §5 has the outage that
taught us why.

## Stellar

| | Version | Notes |
|---|---|---|
| **`@stellar/stellar-sdk`** | 17.1.0 | server-side only — it never enters the client bundle. `Horizon.Server` confirms deposits, `rpc.Server` talks to the contracts |
| **`@pollar/react` / `@pollar/core`** | 0.11.3 (exact) | login, wallet, the SEP-53 signature and the USDC payment. Pinned exactly: Pollar self-describes as "V0" |
| **`soroban-sdk`** | 25.3.2 | pinned to match the local `stellar` CLI at 25.1.0 |
| **generated bindings** | — | `packages/escrow-bindings`, `packages/usdc-bindings`, produced from the **deployed** wasm by `scripts/deploy.sh` |

The money rail is a classic payment with a memo, confirmed through
`activeLedger()` (Horizon adapter today) — no contract is on it. Quote and card
live in `lib/pay/`; the port is `lib/ledger/`. Full detail, and why, in
[stellar.md](stellar.md).

## Data

| Store | Holds | Lifetime |
|---|---|---|
| **MCP session snapshot** | retailer, postal code, cart id | the browser holds it and sends it back each turn |
| **Upstash Redis** | the hop loop's conversation history | 1h TTL, falls back to an in-process `Map` |
| **localStorage** | the transcript the shopper sees, and their chat list | the browser |
| **Postgres** | orders, deposits, cards, archived chats | the record |

Four migrations in `supabase/migrations/`, applied with `npm run db:migrate`:
`0001_init`, `0002_order_identity`, `0003_card_face`, `0004_shared_card`.
`npm run db:invariants` checks the ones SQL cannot state — chiefly that a
deposit is claimed by at most one card.

The archive is written only for a signed-in wallet: `chat.address` is `not null`
and reads are narrowed by it in the `WHERE` clause, because a transcript is a
list of what somebody bought and usually carries their postal code.

## The MCP server

`packages/mcp` — vendored from `supermarket-mcp-research/` so the repo is
self-contained and deployable from GitHub with no submodule and no published
package. Its only runtime dependencies are the MCP SDK and `zod`.

Ten tools: `list_retailers`, `set_location`, `search_products`, `get_product`,
`price_check`, `add_to_cart`, `update_cart_item`, `view_cart`, `get_cart_link`,
`where_am_i`.

Four things changed on the way in, all of them improvements upstream would want:

| Change | Why |
|---|---|
| `name` → `@changuito/mcp` | workspace resolution |
| `playwright`, `ethers` → `optionalDependencies` | they belong to the checkout half. Vercel installs with `--omit=optional`, so neither reaches the lambda |
| `createSupermercadoServer()` factory added | the web app connects a `Client` over an in-memory transport instead of spawning a process |
| checkout tools became a lazy `await import()` | keeps Playwright out of the read-only import graph |

The 492 tests it came with are unmodified and still pass; the rest were added
here, for the factory, the session state it takes, a cart total that turned out
to be the pre-discount subtotal, and the `payableTotal` / `totalizerBreakdown` /
`classifyOrderForm` trio the checkout reads through the `./orderform` subpath.

### Keeping the browser engine out of the lambda

Three independent barriers, because one is a boundary and three is a guarantee:

1. `@changuito/mcp/server` has **no reference** to the checkout module, not even
   a dynamic one.
2. `optionalDependencies` + Vercel's `--omit=optional` means Playwright is not
   installed there at all.
3. `next.config.ts` sets `outputFileTracingExcludes` for `/api/**` on
   `playwright`, `playwright-core`, `ethers`, and the compiled `checkout/` and
   `wallet/` directories.

`transpilePackages` carries all four workspace packages. The MCP package is
compiled ESM and gets **bundled rather than marked external**: a symlinked
workspace package that Next treats as external is not traced into the lambda at
all and fails at runtime with `MODULE_NOT_FOUND`. The two bindings packages are
raw TypeScript published from `src/` with no `dist`, so they have to be compiled
here.

## Smart contracts

| | |
|---|---|
| **Language** | Rust 2021, `crate-type = ["cdylib", "rlib"]` |
| **Target** | `wasm32v1-none` |
| **Release profile** | `opt-level = "z"`, `lto`, `panic = "abort"`, symbols stripped, **`overflow-checks = true`** — the one thing not traded away for size |
| **Tests** | 34 — 19 for the escrow with snapshots, 15 for the token — via `soroban-sdk`'s `testutils` |

## Infrastructure

| | |
|---|---|
| **Vercel** | the Next apps. Node runtime, `maxDuration = 300` on `/api/chat` — a basket is a dozen HTTPS round trips to a storefront |
| **Postgres** | orders, deposits, cards and archived chats, over `DATABASE_URL` |
| **Upstash Redis** | conversation history, 1h TTL. Provisioned through the Vercel Marketplace, which injects legacy KV-compatible names (`KV_REST_API_URL`, `KV_REST_API_TOKEN`) — so `Redis.fromEnv()` does *not* work and credentials are passed explicitly |
| **Cloudflare Turnstile** | the human gate in `middleware.ts`. Unset in production it fails **shut**: every `/api/*` route but `/api/human` answers 403 |
| **Stellar** | Horizon on both networks; Soroban RPC and friendbot on testnet |
| **stellar.expert** | explorer links |

`@vercel/kv` is deliberately **not** used: it is deprecated, and Vercel moved
existing KV stores to Upstash in December 2024.

## Tests

```
npm test                          # 1178 — mcp 520 · trust 2 · web 583 · landing 73
npm test -w @changuito/mcp        #  520 — adapters, money, FX, cart maths
npm test -w @changuito/web        #  583 — chat-state, order-check, deposit, copy, …
npm run contracts:test            #   34 — escrow 19 · mock_usdc 15
npm run typecheck -w @changuito/web
npm run build
```

`npm run test:e2e` runs Playwright. Two specs set
`test.use({ trace: 'off', video: 'off', screenshot: 'off' })` and must keep it:
the repo is public and one of them walks past a card number.

The web suite runs on `node:test` with `--experimental-strip-types`, which
erases types rather than compiling them. Two sharp edges follow:

- **It cannot resolve extensionless imports.** A test that imports a module
  which imports `'../mcp/bridge'` fails at load. This is why `turn-store.ts`
  depends on the agent loop with `import type` only — type imports are erased
  and cost nothing at runtime — and why `deposit-watch.ts` spells its own
  relative import as `'./units.ts'`. A *package* import resolves fine.
- **It rejects syntax that emits code.** A parameter property, an `enum` or a
  namespace fails the whole file with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`.

## Environment variables

Nothing here is required to read the code, and the app degrades rather than
breaking when a value is missing — each row says into what. Annotated at length
in `apps/web/.env.example`; setup in [`../DEPLOY.md`](../DEPLOY.md).

| | Required | For, and what happens without it |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | the agent |
| `NEXT_PUBLIC_POLLAR_API_KEY_MAINNET` | no | the wallet. Without it preview still works end to end; what is missing is the way *out* of preview |
| `DATABASE_URL`, `DIRECT_URL` | for orders | orders, cards and the chat archive. Unset, the checkout has nowhere to record |
| `DEPOSIT_ADDRESS_TESTNET` / `_MAINNET` | for checkout | where a deposit is paid. A `C…` contract address is refused — it cannot take a memo. Unset, the deposit screen answers 503 |
| `DEMO_WALLET_SECRET` | for preview pay | lets preview settle a real testnet payment for a visitor with no wallet. Unset, the button answers 503 and says so |
| `VYRION_API_KEY` | for the card | unset, the card button is never rendered rather than rendered and broken |
| `ALLOW_LIVE` | no | an `sk_live_` key is refused unless this is exactly `1` |
| `STELLAR_RESOLVER_SECRET` | for faucet + settle | the testnet signing key. Read at call time, never at import, so a build without it succeeds |
| `STELLAR_RESOLVER_SECRET_MAINNET` | no | must be a *different* key; checked against `deployments.json` and refused on mismatch |
| `REAL_MODE_ALLOWLIST_ADDRESSES` | for modo real | deny-by-default: empty in production means nobody, Vercel previews included |
| `REAL_MODE_OPEN_TO_ALL` | no | drops the allowlist, **not** the SEP-53 signature |
| `FAUCET_ALLOWLIST_ADDRESSES`, `FAUCET_OPEN_TO_ALL` | no | same rules, for the testnet faucet |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | in production | the human gate. The secret alone decides it, and unset in production it fails shut |
| `CHG_SESSION_SECRET` | in production | signs the httpOnly login cookie. Unset, nobody can sign in |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | no | conversation history across restarts; falls back to an in-process Map |
| `FX_ARS_PER_USD` | no | pin the rate so a demo quotes the same number every time |
| `AGENT_MODEL`, `AGENT_EFFORT`, `AGENT_USAGE` | no | model override; the speed knob; per-hop token logging including cache reads and writes |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID`, `NEXT_PUBLIC_META_PIXEL_ID`, `NEXT_PUBLIC_CLARITY_PROJECT_ID` | no | analytics. Unset, nothing loads |

There is **no mode variable, and there must not be one.** The mode is whether
Pollar has a session — see [architecture.md](architecture.md#two-products-in-one-bundle).
