# changuito

An agent that shops Argentine supermarkets and pays in USDC on Stellar.

You ask for a basket in plain Spanish. It searches a real store, compares real
prices, builds a real cart, and hands you the store's own checkout link. Then
it locks the money in a Soroban escrow contract on testnet, and releases it to
the treasury once you confirm the basket went through — or gives it back if it
did not.

*changuito* is what an Argentine calls a shopping trolley.

> **Testnet only.** The USDC is a token we deployed ourselves and mint on
> demand. Nothing here moves real money.

---

## Why an escrow, and not just a transfer

Most demo contracts are decoration: a payment happens, and a contract logs it.
This one is load-bearing, because the flow has a genuine gap in it.

The agent takes your money when you confirm — but the groceries are not secured
until the cart is actually checked out at the store, and in between the price
can move, stock can vanish, or the basket can be rejected. Something has to
hold the money across that gap and be able to give it back.

```
  you confirm the cart
        │
        ▼
  escrow.open(order_id, amount, basket_hash)        USDC: you ──► contract
        │   your wallet signs; basket_hash pins WHAT you agreed to
        │
        ├── basket completed at the store
        │        └─► escrow.settle(order_id, basket_hash, receipt_hash)
        │                                            USDC: contract ──► treasury
        │
        └── it failed, or you walked away
                 └─► escrow.refund(order_id)         USDC: contract ──► you
                         resolver any time, or you yourself after the deadline
```

Three things this buys that a plain transfer does not:

1. **The money is recoverable.** A failed basket refunds without anyone's
   goodwill. After `deadline` you can refund yourself, with no cooperation from
   the backend at all — that is what makes it an escrow and not a deposit.
2. **The basket is committed.** `basket_hash` is a SHA-256 of the exact items,
   quantities and totals you were shown. `settle` takes it as an argument and
   compares; the resolver cannot settle against a different basket than the one
   on your screen.
3. **The receipt is verifiable.** `settle` stores a `receipt_hash`, and the app
   shows you the plain-text preimage it was taken over. You can run `shasum` on
   it yourself and compare against the ledger.

---

## The flow

| | |
|---|---|
| **1. Greeting** | The agent says what it can do and offers three prompts to try. |
| **2. Research** | `set_location` → `search_products` → `price_check`, streamed, with a product grid as results land. |
| **3. Results** | Product cards, a built cart, and the store's real checkout link. |
| **4. Confirm** | Items, peso total, USDC total, exchange rate, your balance — then *Pagar*. |
| **5. On chain** | Your wallet signs `escrow.open`. The funds are locked. |
| **6. Done** | *Ya lo completé* settles it, *No se pudo* refunds it. Both transactions link to stellar.expert. |

A balance widget with a **Fondear** button sits in the masthead throughout. It
creates your testnet account with friendbot if it does not exist yet, then
mints 50 demo USDC.

---

## Architecture

```
  Browser
    PollarProvider                 login, wallet, and the signature on escrow.open
    Chat ──► POST /api/chat        SSE stream of text, tool calls, products, carts

  Next.js on Vercel — Node runtime, not edge: XDR needs Node
    /api/chat      Anthropic tool loop
                     └─ MCP Client ──InMemoryTransport──► McpServer ──► Día's VTEX API
    /api/balance   XLM + demo USDC for an address
    /api/faucet    friendbot, then mint
    /api/quote     ARS → USDC at the live rate
    /api/settle    resolver-signed settle / refund

  Stellar testnet
    escrow    CBCUESHDKRXAH4YAHOKJFRFEOIYBTU2LYJ4LCOFIGMYGNHBCPACXQ557
    demo USDC CB63C7UVZ3PBALQ7IE37QU2ZX5X3UMTLJOHDRI2EW44JU26YDGLQUBJF
```

**The MCP server is the point.** `packages/mcp` is a real Model Context Protocol
server for four Argentine VTEX supermarkets — it was written first, and
changuito exists to drive it from something other than a chat client. The web
app speaks to it over `InMemoryTransport`, which is the actual MCP protocol
(`tools/list`, `tools/call`) with no subprocess: the server keeps module-global
state, and its checkout half opens a headed browser on the host, so it cannot
run on Vercel at all. The read-only half is plain HTTPS and runs anywhere. The
checkout tools are behind a dynamic import so no bundle can even resolve
Playwright.

**Why our own USDC.** Blend's testnet mock is a real SEP-41 token, but its
admin is an address we do not control and there is no faucet for it, so a demo
could not hand anyone a balance. `contracts/mock_usdc` is the same interface,
same `"USDC"` symbol, same 7 decimals, with our resolver as admin. The UI calls
it *"USDC de prueba"* rather than implying Blend.

### The demo USDC token has no issuer, and needs no trustline

`CB63C7UVZ3PBALQ7IE37QU2ZX5X3UMTLJOHDRI2EW44JU26YDGLQUBJF` is a SEP-41 Soroban
contract, not a classic Stellar asset. There is no `CODE:ISSUER` pair and
nothing to `changeTrust` to — balances live in the contract's own storage, so a
mint to an address that has never existed just works. Verified: a freshly
generated address with no account at all went from `0` to `50.00` through one
`POST /api/faucet`.

That is deliberate. A classic asset cannot reach an account without a
trustline, so every visitor would have to sign a `changeTrust` before the
faucet could give them anything, and "press Fund, get USDC" is the point of the
widget.

It follows that Pollar's `setTrustline({ code, issuer })` does not apply, and
Pollar's balance endpoints — Horizon-backed, classic assets only — will not
list this token. That is why `/api/balance` reads the contract directly and the
masthead widget uses it instead of the wallet's own asset list.


---

## Layout

```
apps/web/            the shopper — chat, wallet, payment, API routes (app.changuito.me)
apps/landing/        marketing site only (www.changuito.me). See apps/landing/README.md
apps/branding/       brand kit (not an npm package): logo, mascot, manuals, social
packages/mcp/        the supermarket MCP server (vendored, 520 tests)
packages/*-bindings/ generated TypeScript clients for the two contracts
contracts/escrow/    open / settle / refund, with events
contracts/mock_usdc/ SEP-41 token, admin-gated mint
scripts/             deploy.sh and its two helpers
deployments.json     what is deployed, and where — committed on purpose
```

`deployments.json` is the single source of truth for contract ids. A script
generates `apps/web/lib/deployments.ts` from it, and the tests check that the
generated bindings carry the same ids, so a redeploy that half-lands fails the
suite rather than the demo.

### Deeper documentation

`docs/` goes past what fits here:
[architecture](docs/architecture.md) (the system diagram and the trust
boundaries), [flows](docs/flows.md) (a chat turn, funding, payment, settlement
and refund, end to end), [stellar](docs/stellar.md) (every Stellar technology
used and what each is doing), and the [tech stack](docs/tech-stack.md).

---

## Setup

Requires **Node ≥ 22.12** (`.nvmrc` pins 22.12.0) and, for the contracts, Rust
with the `wasm32v1-none` target and the [Stellar CLI](https://developers.stellar.org/docs/tools/developer-tools/cli/stellar-cli).

```bash
git clone https://github.com/raptor0929/changuito
cd changuito
npm install

cp apps/web/.env.example apps/web/.env.local
# fill in ANTHROPIC_API_KEY; the other two are optional to start

npm run dev            # http://localhost:3124
```

Without `NEXT_PUBLIC_POLLAR_API_KEY` the app still runs — search, comparison and
carts all work, and the masthead reads *"Billetera: sin configurar"* instead of
a balance. Without `STELLAR_RESOLVER_SECRET` everything works except the faucet
and settling.

The contracts are already deployed; you only need to redeploy if you change
them. See **[DEPLOY.md](DEPLOY.md)** for that and for putting it on Vercel.

### Environment

| Variable | Where | Required for |
|---|---|---|
| `ANTHROPIC_API_KEY` | server | the agent |
| `NEXT_PUBLIC_POLLAR_API_KEY` | browser | login, wallet, signing |
| `STELLAR_RESOLVER_SECRET` | server | faucet, settle, refund |
| `FX_ARS_PER_USD` | server | optional — pins the rate for a reproducible demo |
| `AGENT_EFFORT` | server | optional — `low` (default), `medium`, `high`. The speed knob; see `apps/web/.env.example` |

---

## Tests

```bash
npm test                    # 520 MCP + 107 web
npm run contracts:test      # 34 contract tests
```

The contract suite covers what the money depends on: a double open is rejected,
settling an order that was never opened is rejected, an unauthorized settle is
rejected, a buyer refunding before the deadline is rejected, after it is
allowed, and balances reconcile exactly across both `open → settle` and
`open → refund`.

Two of the web tests are worth knowing about, because they guard mistakes that
type-check cleanly:

- `order.test.ts` reads `pub fn open` out of `contracts/escrow/src/lib.rs` and
  compares the argument names, Rust types and timeout bounds against the
  encoder. Soroban arguments are positional and two of them are `BytesN<32>` —
  swap `order_id` and `basket_hash` and everything compiles, deploys, and then
  settles a basket nobody approved.
- `stellar.test.ts` reads the contract ids baked into the generated bindings as
  text and compares them with `deployments.json`.
- `wire.test.ts` checks that every `tool_call_id` sent to a local model pairs
  back to a `tool_use` id. An unmatched one is rejected on the *next* request,
  a turn later, on a turn that did nothing wrong.

---

## Deployed on testnet

Live since **2026-09-21**, and these are the ids the app actually loads —
`deployments.json` is the single source of truth, and `stellar.test.ts` compares
it against the ids baked into the generated bindings.

| | |
|---|---|
| **escrow** | [`CBCUESHDKRXAH4YAHOKJFRFEOIYBTU2LYJ4LCOFIGMYGNHBCPACXQ557`](https://stellar.expert/explorer/testnet/contract/CBCUESHDKRXAH4YAHOKJFRFEOIYBTU2LYJ4LCOFIGMYGNHBCPACXQ557) |
| **demo USDC** — SEP-41, `USDC`, 7 decimals | [`CB63C7UVZ3PBALQ7IE37QU2ZX5X3UMTLJOHDRI2EW44JU26YDGLQUBJF`](https://stellar.expert/explorer/testnet/contract/CB63C7UVZ3PBALQ7IE37QU2ZX5X3UMTLJOHDRI2EW44JU26YDGLQUBJF) |
| **resolver** — settles, refunds, mints | [`GBGMPRHU3NW3BCXUNDNC7VSYQKS6FZKWFHSGEHHMR3G3TZOUWEDBHTFK`](https://stellar.expert/explorer/testnet/account/GBGMPRHU3NW3BCXUNDNC7VSYQKS6FZKWFHSGEHHMR3G3TZOUWEDBHTFK) |
| **treasury** — receives settled baskets | [`GAXUICH5DZMB4ZIZVF6ETTE524RCZYRKHWLGG7EOLY6ECVD4IS6TBNZG`](https://stellar.expert/explorer/testnet/account/GAXUICH5DZMB4ZIZVF6ETTE524RCZYRKHWLGG7EOLY6ECVD4IS6TBNZG) |

Network passphrase `Test SDF Network ; September 2015`, RPC
`https://soroban-testnet.stellar.org`.

The escrow's constructor wired those three addresses in at deploy time and there
is no setter, so who can settle and where the money lands are fixed. You do not
have to take that from a README — ask the contract:

```bash
stellar contract invoke --network testnet \
  --id CBCUESHDKRXAH4YAHOKJFRFEOIYBTU2LYJ4LCOFIGMYGNHBCPACXQ557 \
  --source-account GBGMPRHU3NW3BCXUNDNC7VSYQKS6FZKWFHSGEHHMR3G3TZOUWEDBHTFK \
  --send=no -- config
```
```json
{"resolver":"GBGMPRHU…DBHTFK","token":"CB63C7UV…LQUBJF","treasury":"GAXUICH5…S6TBNZG"}
```

`--send=no` only simulates, so it signs nothing, costs nothing, and any funded
account will do as `--source-account`.

### The escrow's interface

```rust
fn open(buyer: Address, order_id: BytesN<32>, amount: i128,
        basket_hash: BytesN<32>, timeout_secs: u64) -> Order;   // buyer signs
fn settle(order_id: BytesN<32>, basket_hash: BytesN<32>,
          receipt_hash: BytesN<32>) -> Order;                   // resolver only
fn refund(caller: Address, order_id: BytesN<32>) -> Order;      // resolver, or buyer after the deadline
fn get_order(order_id: BytesN<32>) -> Order;                    // panics if unknown
fn find_order(order_id: BytesN<32>) -> Option<Order>;           // the non-panicking read
fn config() -> Config;
```

That is the deployed wasm's own spec, not a copy of the source —
`stellar contract info interface --id CBCUESHDKRXAH4YAHOKJFRFEOIYBTU2LYJ4LCOFIGMYGNHBCPACXQ557 --network testnet`
prints it for yourself.

Source lives in `contracts/escrow/` and `contracts/mock_usdc/`. To put up your
own copy, `scripts/deploy.sh` rebuilds both, deploys them, and rewrites
`deployments.json` and the bindings in one pass — see **[DEPLOY.md](DEPLOY.md)**.

---

## Verified on testnet

Not by inspection — these are ledger entries:

| | |
|---|---|
| open | [`a72b4f33…`](https://stellar.expert/explorer/testnet/tx/a72b4f33bc155b8de1b2f2c15a975b31a04048a3bc6f881bc306e8a1080782a2) — 3.44 USDC buyer → escrow |
| settle | [`3410b8a0…`](https://stellar.expert/explorer/testnet/tx/3410b8a01e913b4613a5c23568392ad3d707e29f42bbdf0aa7a02cb09f3e68c3) — escrow → treasury, receipt recorded |
| refund | [`a64fb38a…`](https://stellar.expert/explorer/testnet/tx/a64fb38ac495112ff0fbc798fb45df67f945a4781cd80d6334155496581627c8) — escrow → buyer, balance back to the stroop |
| faucet | [`03baa469…`](https://stellar.expert/explorer/testnet/tx/03baa469c514406487ea29c32da076d8c8af7725c2a67fb73f5f8ad056ca215a) — friendbot, then 50 USDC minted |

And the receipt is checkable by hand. The settle above stored
`881ae41cb172e10778dd6810e5c3e9be5fef54b266cb0686f4da446109f978d0`, which is:

```bash
printf 'changuito/receipt/v1\nretailer|dia\ncart|live-check-1\nhandoff|https://diaonline.supermercadosdia.com.ar/checkout?orderFormId=live-check-1\nsettled|2026-09-21T07:22:14.394Z\n' | shasum -a 256
```

---

## Where this is honest about itself

- **The resolver settles on the browser's word.** In a real deployment it would
  confirm with the store itself. It is safe here because the money is test USDC
  and the only account a caller can affect is their own. The route says so at
  the top, in a comment.
- **`receipt_hash` hashes the handoff, not a store order number.** The
  read-only MCP path stops at the cart link, so that is what we can honestly
  commit to. The shape does not change when a real order number arrives.
- **The faucet's cooldown is per-process.** It is an in-memory `Map`, so on
  serverless it is per-lambda. Good enough for a demo; a real one needs a store.
- **The store's catalogue is live.** Prices and stock on any given day are
  whatever Día actually has.
- **The commit dates are backdated** to the window the work was planned over.

## Tests

Unit tests stay on `npm test` (mcp, trust, web, landing) and run in CI on
every pull request. Browser smoke is separate: `npm run test:e2e` hits the
live sites, and CI runs it only after a backend merge to `main`, or when
someone starts the E2E workflow by hand. How to run it, and how to add the
GitHub Actions secrets, is in [docs/e2e.md](docs/e2e.md).

## License

MIT
