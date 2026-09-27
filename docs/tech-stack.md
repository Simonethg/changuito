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
| **npm workspaces** | — | `apps/*`, `packages/*`. No Turborepo, no pnpm: three packages and one app do not need a build graph. |

No CSS framework, no state library, no component kit. The transcript is a
reducer in a plain file (`lib/chat-state.ts`) so the ordering rules can be
tested without a browser.

## The agent

| | Version | Notes |
|---|---|---|
| **`@anthropic-ai/sdk`** | 0.127.0 | written against `messages.stream()` rather than the tool runner, because every tool call here has a visible consequence and owning the loop means owning where those are emitted |
| **Model** | `claude-sonnet-5` | overridable with `AGENT_MODEL`. Adaptive thinking + the effort control are Claude 5 features; the loop falls back to a fixed thinking budget for Haiku 4.5, which otherwise rejects the request outright |
| **Effort** | `low` | overridable with `AGENT_EFFORT`. Thinking runs before every tool call and a basket is up to twelve of them, so this is a latency setting more than a quality one |
| **Prompt caching** | two breakpoints | the system + tools prefix, and a moving one on the newest message. The second is what stops hop nine re-reading hops one through eight at full price |
| **`@modelcontextprotocol/sdk`** | 1.30.0 | both the `Client` and the `McpServer`, linked with `InMemoryTransport` |
| **`@upstash/redis`** | ^1.39.0 | conversation history. HTTP, not TCP — one connection per lambda is the connection-limit problem the REST API avoids |

### Two models, one message format

A turn can begin on a local model and finish on Sonnet, per hop. The thing that
makes that legal is that `turn.messages` is **Anthropic-shaped whoever
answered** — `lib/agent/providers/wire.ts` translates outward to OpenAI's format
and back again, and nothing in the OpenAI shape is ever stored.

Four gates decide whether the local model is used at all: a probe of
`/api/tags` that checks the model is *pulled* and not merely that the server
answers, a circuit breaker, a lane lease that caps concurrent local turns at
one, and an 8s first-byte deadline. The breaker and the lease live in Redis so
every lambda shares one view, for the same reason conversation history does.

The default lane count is 1 on purpose: a 16 GB machine runs one model
instance, so raising it buys a queue rather than parallelism. Overflow goes to
the hosted model, which is faster anyway.

See [`../CLAUDE.md`](../CLAUDE.md) for how the agent's behaviour was arrived at,
and [`../DEPLOY.md`](../DEPLOY.md) Part 3 for setting the machine up.

## Stellar

| | Version | Notes |
|---|---|---|
| **`@stellar/stellar-sdk`** | 17.1.0 | server-side only — it never enters the client bundle |
| **`@pollar/react` / `@pollar/core`** | 0.11.3 (exact) | login, wallet, and contract signing. Pinned exactly: Pollar self-describes as "V0" |
| **`soroban-sdk`** | 25.3.2 | pinned to match the local `stellar` CLI at 25.1.0 |
| **generated bindings** | — | `packages/escrow-bindings`, `packages/usdc-bindings`, produced from the **deployed** wasm by `scripts/deploy.sh` |

Full detail in [stellar.md](stellar.md).

## The MCP server

`packages/mcp` — vendored from `supermarket-mcp-research/` so the repo is
self-contained and deployable from GitHub with no submodule and no published
package. Its only runtime dependencies are the MCP SDK and `zod`.

Four things changed on the way in, all of them improvements upstream would want:

| Change | Why |
|---|---|
| `name` → `@changuito/mcp` | workspace resolution |
| `playwright`, `ethers` → `optionalDependencies` | they belong to the checkout half. Vercel installs with `--omit=optional`, so neither reaches the lambda |
| `createSupermercadoServer()` factory added | the web app connects a `Client` over an in-memory transport instead of spawning a process |
| checkout tools became a lazy `await import()` | keeps Playwright out of the read-only import graph |

The 492 tests it came with are unmodified and still pass; 28 more were added
here, for the factory, the session state it takes, and a cart total that turned
out to be the pre-discount subtotal.

### Keeping the browser engine out of the lambda

Three independent barriers, because one is a boundary and three is a guarantee:

1. `@changuito/mcp/server` has **no reference** to the checkout module, not even
   a dynamic one.
2. `optionalDependencies` + Vercel's `--omit=optional` means Playwright is not
   installed there at all.
3. `next.config.ts` sets `outputFileTracingExcludes` for `/api/**` on
   `playwright`, `playwright-core`, `ethers`, and the compiled `checkout/` and
   `wallet/` directories.

`transpilePackages` carries all three workspace packages. The MCP package is
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
| **Tests** | 19 for the escrow, with snapshots, via `soroban-sdk`'s `testutils` |

## Infrastructure

| | |
|---|---|
| **Vercel** | the Next app. Node runtime, `maxDuration = 300` on `/api/chat` — a basket is a dozen HTTPS round trips to a storefront |
| **Upstash Redis** | conversation history, 1h TTL. Provisioned through the Vercel Marketplace, which injects legacy KV-compatible names (`KV_REST_API_URL`, `KV_REST_API_TOKEN`) — so `Redis.fromEnv()` does *not* work and credentials are passed explicitly |
| **Stellar testnet** | Soroban RPC, Horizon, friendbot |
| **stellar.expert** | explorer links |

`@vercel/kv` is deliberately **not** used: it is deprecated, and Vercel moved
existing KV stores to Upstash in December 2024.

## Tests

```
npm test                          # both suites
npm test -w @changuito/mcp        # 520 — adapters, money, FX, cart maths
npm test -w @changuito/web        # chat-state, order, turn-store, checkout-copy, …
npm run contracts:test            #  19 — the escrow
npm run typecheck -w @changuito/web
npm run build
```

The web suite runs on `node:test` with `--experimental-strip-types`, which
erases types rather than compiling them. Two sharp edges follow:

- **It cannot resolve extensionless imports.** A test that imports a module
  which imports `'../mcp/bridge'` fails at load. This is why `turn-store.ts`
  depends on the agent loop with `import type` only — type imports are erased
  and cost nothing at runtime.
- **It rejects syntax that emits code.** A parameter property, an `enum` or a
  namespace fails the whole file with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`.

## Environment variables

| | Required | For |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | the agent |
| `NEXT_PUBLIC_POLLAR_API_KEY` | no | the wallet. Without it the app degrades to "everything but paying" rather than breaking the page |
| `STELLAR_RESOLVER_SECRET` | for faucet + settle | the one server signing key |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | no | conversation history across restarts; falls back to an in-process Map |
| `FX_ARS_PER_USD` | no | pin the rate so a demo quotes the same number every time |
| `AGENT_MODEL`, `AGENT_USAGE` | no | model override; per-hop token logging, including cache reads and writes |
| `AGENT_EFFORT` | no | `low` (default) \| `medium` \| `high`. The speed knob |

Setup in [`../DEPLOY.md`](../DEPLOY.md); annotated in `apps/web/.env.example`.
