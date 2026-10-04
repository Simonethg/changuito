# Stellar technologies

What runs on Stellar, and what each piece is doing. Everything on this list is
load-bearing — there is no component here whose removal would leave the app
functioning — with the single, explicitly marked exception of the escrow.

| Technology | Where it is used |
|---|---|
| **Classic payments with a memo** | the money rail. One payment to an operator account, identified by a `código` in the memo. `lib/pay/deposit-rail.ts` quotes and confirms; `lib/deposit.ts` holds address and memo helpers |
| **Horizon** | today's confirmation source behind `activeLedger()` (`lib/ledger/`). There is no webhook, no callback and no reconciliation step — the payment either exists on the public ledger or it does not |
| **Classic assets and trustlines** | USDC on both networks: Circle's on mainnet, one this repo issued on testnet. `lib/trustline.ts` handles the `changeTrust` a shopper needs before they can hold it |
| **[SEP-53](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0053.md) — signed messages** | identity. Every gate that can spend real money verifies a signature over a message naming the address, never an address the browser claims |
| **[SEP-41](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0041.md) — Soroban token interface** | `contracts/mock_usdc` implements it; the escrow calls the standard `transfer` through `token::TokenClient` |
| **[SEP-7](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0007.md) — payment URIs** | the receive screen, so another wallet can be pointed at the deposit with one scan |
| **Soroban smart contracts** (Rust, `soroban-sdk` 25.3.2) | the escrow and the demo USDC token |
| **Soroban authorization** (`require_auth`) | the buyer authorizes `open`; the resolver authorizes `settle` and `refund` |
| **Contract constructors** (`__constructor`) | both contracts are configured at deploy — no separate `initialize` anyone could front-run |
| **Contract events** (`#[contractevent]`) | `Opened`, `Settled`, `Refunded` on the escrow; `Transfer`, `Mint`, `Burn`, `Approve`, `SetAdmin` on the token |
| **Persistent storage + TTL extension** | one entry per order, plus instance TTL bumped on every write |
| **Soroban RPC** | simulating and submitting contract calls, and reading contract balances |
| **Friendbot** | creating and funding testnet accounts so their first transaction can pay a fee |
| **`stellar contract bindings typescript`** | `packages/escrow-bindings`, `packages/usdc-bindings`, generated from the **deployed** wasm |
| **`@stellar/stellar-sdk` 17.1.0** | `rpc.Server`, `Horizon.Server`, `StrKey`, `Keypair`, `basicNodeSigner` — server-side only |
| **Pollar** (`@pollar/react` 0.11.3) | the wallet: login, the address, the SEP-53 signature, and the USDC payment |
| **stellar.expert** | the explorer links shown after every transaction |

---

## The money rail: a payment, a memo, and Horizon

This is the part a judge should look at first, because it is the part that
handles real money and it is deliberately the least clever thing in the repo.

**Quoting** — `POST /api/deposit` → `lib/pay/deposit-rail.ts`. The use case
reads the shopper's cart from the store, server-side, and takes the *payable*
total: items plus envío minus descuentos. It converts ARS to USD with a buffer,
raises to the card minimum, refuses to quote above the card's ceiling, and
returns an address, an amount and a memo. The client's own figure is used only
when there is no store cart to read — the rehearsal fixture and the older
payment modal — and is ignored entirely whenever the store can be asked.

**Paying.** One press. The shopper's Pollar wallet sends the payment, or they
send it themselves from wherever their dollars are. It is always an explicit
press: what the app does automatically is read the total, never take the money.

**Confirming** — `GET /api/deposit` → the same use case, through
`activeLedger()`. The Stellar adapter reads Horizon; the matcher
(`lib/ledger/match.ts`) is pure and matches on four things: the destination,
the asset (code *and* issuer — native has no issuer, which is exactly the
mistake worth guarding), the amount in stroops, and the memo. Matching is where
money bugs live; the fetch is the part that needs a network and has nothing to
get wrong. `lib/deposit-watch.ts` remains a facade for existing callers and
tests.

**Spending** — `POST /api/card` → `lib/pay/issue-card.ts`. Re-reads the ledger
port for a payment carrying the código and derives the amount **from the payment
that actually landed**. The deposit is then claimed exactly once, with a
conditional `UPDATE … where card_id is null`.

### Why a payment and not the escrow

> *The thing the order actually needs is much smaller than an escrow: the money
> has to arrive before a card is issued against it. A classic payment with a
> memo does that with no contract, no resolver key on the server, and nothing to
> deploy.*
>
> *It also means the failure path is honest. There is no automated outbound
> payment here and no Stellar secret in the deployment, so a failed order is
> refunded by hand. That is a worse product and a much better blast radius.*
>
> — [`lib/deposit.ts`](../apps/web/lib/deposit.ts)

### Why testnet has a classic USDC of its own

For a long time testnet's deposit asset was native XLM, because
`contracts/mock_usdc` is a pure SEP-41 Soroban token: balances live in contract
storage, transfers are contract events, and there is **no classic payment record
with a memo field** for the matcher to read. So preview paid in lumens while
production paid in USDC, and the one path nobody could rehearse was the one that
handles real money.

`scripts/setup-demo-asset.mjs` issued a classic USDC on testnet — supply fixed at
a billion, held by the demo wallet, **issuer locked** by setting its master
weight to 0 as the last act before the identity is deleted. Both networks now
take the same path, with the same trustline step, differing in one field: which
issuer.

| | testnet | mainnet |
|---|---|---|
| USDC issuer | `GCGV3225…ZHJTGJB` — this repo's, locked | `GA5ZSEJY…34K4KZVN` — Circle's |
| deposit account | `DEPOSIT_ADDRESS_TESTNET` | `DEPOSIT_ADDRESS_MAINNET` |
| contracts deployed | escrow + mock_usdc | none, and none needed |

The native branch stays in `depositAssetFor` anyway: it is what any network with
a falsy issuer falls back to, and reading a missing issuer as lumens is how the
code refuses to quote an asset it cannot observe.

### No secret passes through the issuing script

Every signature in `setup-demo-asset.mjs` is made by the `stellar` CLI from a
local identity named on the command line. The secrets stay in the CLI keystore —
never read by the script, never printed, never placed in `argv` where `ps` would
show them, never written to an env file. The issuer's secret is discarded
outright.

---

## SEP-53: identity that cannot be claimed

Four gates decide who may spend real money, and they share one shape on purpose:
two gates answering the same question in two shapes is how one of them ends up
wrong.

| Gate | Guards |
|---|---|
| `lib/deposit-gate.ts` | who may quote and pay on the mainnet deposit rail |
| `lib/network-access.ts` | who may switch the app into modo real at all |
| `lib/faucet-auth.ts` | who may make the mint key sign |
| `lib/settle-gate.ts` | who may settle or refund an escrow |

Each one checks an allowlist **against an address already proven by a SEP-53
signature**, never one the browser merely claims. A signature over a message
naming the address is something the server can verify with nothing but the
address — no session store, no shared secret, no account.

`REAL_MODE_OPEN_TO_ALL` drops the allowlist. It does **not** drop the signature:
"anybody may pay" and "nobody has to prove who they are" are different sentences
and only the first one was ever asked for. Dropping the signature costs a
logged-in shopper nothing and costs a script the whole exercise.

Deny by default: in production an empty allowlist means nobody, which also covers
Vercel previews, since those run as production too. Testnet is never gated; it is
the default and it cannot spend anything.

---

## The escrow contract (dormant)

`CBCUESHDKRXAH4YAHOKJFRFEOIYBTU2LYJ4LCOFIGMYGNHBCPACXQ557` — deployed on
testnet, 19 tests, reachable from `/dev/ui` and not from the shopper's path.
It is documented in full because it is real code that works, and because
bringing it back is a concrete next step rather than a hypothetical.

```rust
open(buyer, order_id: BytesN<32>, amount: i128,
     basket_hash: BytesN<32>, timeout_secs: u64) -> Order
settle(order_id, basket_hash, receipt_hash) -> Order
refund(caller, order_id) -> Order
get_order(order_id) -> Order          // panics if unknown
find_order(order_id) -> Option<Order> // does not
config() -> Config                    // resolver, treasury, token
```

Configured at deploy with three addresses — resolver, treasury, and the SEP-41
token it holds — and **the token is fixed there**, so an escrow cannot be
convinced to settle in something else.

### What it was for

The flow has a real gap in it. The money is taken when the shopper confirms, but
the groceries are not secured until the basket clears the store, and between
those two moments the price can move, stock can vanish, or the store can reject
the basket. Three properties a plain transfer does not have:

1. **The money is recoverable** — a failed basket refunds without anyone's
   goodwill, and after the deadline without anyone's cooperation.
2. **The basket is committed** — `settle` rejects a `basket_hash` that is not the
   one the buyer approved, with `BasketMismatch`.
3. **The receipt is verifiable** — `settle` stores a hash, `get_order` reads it
   back, and both transitions emit events, so stellar.expert is a real audit
   trail.

### Why it came off the rail, and what would put it back

An escrow's `settle` needs proof the basket happened. Behind the cross-origin
wall the app's only source for that was the shopper's own word — and an escrow
that settles on the buyer's word is a custodial box with extra steps. The
`settle-gate.ts` header has always said so out loud.

That has since weakened in the app's favour. `orderGroup`, read server-side from
the store's own public cart document, is real evidence that an order exists:
`lib/order-check.ts` surfaces it and `lib/test/order-check.test.ts` pins that an
emptied cart alone is *not* enough (an id nobody ever used returns the same
shape). Wiring `orderGroup` to `settle` — and a mainnet deploy of the contract —
is the honest path back, and it is the one piece of future work this repo would
prioritise.

### Authorization, exactly

- `open` calls `buyer.require_auth()`. That same signature also covers the
  `transfer` out of the buyer's balance underneath it — one approval, not two.
- `settle` calls `cfg.resolver.require_auth()`. The buyer cannot move money out
  of an escrow they funded; only the resolver can release it, and only to the
  treasury address fixed at deploy.
- `refund` takes `caller` **explicitly**, because the two cases authorize
  different addresses and `require_auth` has to be called on the one that
  actually signed. The resolver may refund at any time; the buyer only after
  `deadline`; nobody else, ever — a stranger is rejected with `NotAuthorized`
  even after the deadline has passed.

### Bounds and invariants

| Rule | Error |
|---|---|
| `amount > 0` | `InvalidAmount` |
| `300s ≤ timeout_secs ≤ 30 days` | `InvalidTimeout` |
| an `order_id` is never reused | `OrderExists` |
| an order can only be closed once | `OrderClosed` |
| `settle` must present the approved basket | `BasketMismatch` |
| neither resolver, nor buyer after the deadline | `NotAuthorized` |

The timeout has a floor because a deadline that has already passed is an instant
self-refund, and a ceiling because one far enough out means the money is
effectively gone.

**Status is written before the transfer**, in both `settle` and `refund`: a token
whose `transfer` re-enters this contract must find the order already closed.

19 tests in `contracts/escrow/src/test.rs`, with snapshots. They cover both happy
paths with balances reconciled exactly, every rejection above, that a rejected
call leaves no event behind, and that a refunded order cannot then be settled.

---

## The demo USDC token (SEP-41)

`CB63C7UVZ3PBALQ7IE37QU2ZX5X3UMTLJOHDRI2EW44JU26YDGLQUBJF` — SEP-41, symbol
`USDC`, 7 decimals, admin-gated `mint`, 15 tests. It backs the escrow and the
faucet; it is **not** on the deposit rail, for the memo reason above.

**Why not Blend's testnet mock.** It is a real SEP-41 token, but a probe during
planning showed its admin is `GATALTGT…5V56`, an address we do not control, and
there is no faucet for it. A demo could not hand anyone a balance.
`contracts/mock_usdc` is the same interface, same symbol, same decimals, with our
resolver as admin. The UI says *"USDC de prueba"* rather than implying Blend.

`mint` is admin-gated rather than permissionless so a public demo cannot be
drained.

### It has no issuer, and needs no trustline

This is a Soroban contract, not a classic Stellar asset. There is no
`CODE:ISSUER` pair and nothing to `changeTrust` to — balances live in the
contract's own storage, so a mint to an address that has never existed just
works. Verified: a freshly generated address with no account at all went from `0`
to `50.00` through one `POST /api/faucet`.

That is what makes "press Fondear, get USDC" one button. It also means Pollar's
`setTrustline({ code, issuer })` does not apply to it, and Pollar's balance
endpoints — Horizon-backed, classic assets only — will not list it, which is why
`/api/balance` reads the contract directly.

The classic testnet USDC the deposit rail uses **does** need a trustline, and
`lib/trustline.ts` is the step that handles it. Two assets, two rules, one app.

---

## Accounts and keys

| Role | Address | Does |
|---|---|---|
| resolver | `GBGMPRHU…HTFK` | token admin (the faucet mints) **and** escrow resolver |
| treasury | `GAXUICH5…BNZG` | where a settled escrow's USDC lands |
| demo wallet | `GDFF477U…MINA55X` | holds the testnet classic USDC; pays in preview |
| deposit accounts | configuration, not committed | receive the shopper's payment |

**In production the backend holds no Stellar signing key.** The deposit rail
needs an address to receive at, not a key to spend with. `STELLAR_RESOLVER_SECRET`
belongs to the testnet faucet and the escrow, and it is read **at call time**,
never at import time — so a build without it still succeeds and only the routes
that actually sign fail. The loader also checks the key's public address against
`deployments.json` and refuses a mismatch, which turns "the contract silently
rejects everything" into one clear error.

One hot key rather than two on testnet, because a demo with two hot keys is two
keys to leak.

---

## RPC, Horizon, and friendbot

**Horizon** does the work that matters: it is where a deposit is confirmed, and
it is the only source for that. It is also the only way to read a classic XLM
balance, which is not contract state. A smart wallet has no Horizon account at
all, so `xlm` comes back `null` for one and the UI does not pretend otherwise.

**Soroban RPC** simulates and submits contract calls and reads contract balances.
`/api/balance` calls the token contract directly rather than asking a wallet API,
because the wallet API only knows about classic assets.

**Friendbot** runs before any mint. Below `MIN_XLM = 5` the faucet goes back to
it. Existing-and-non-empty is not the test: Pollar creates its wallets with a
sponsored `createAccount` at a starting balance that cannot pay for much, and an
address nobody topped up signs transactions that fail with `tx_no_source_account`
— which reads like a bug in the app rather than an empty wallet.

---

## Bindings, and the version pin

`scripts/deploy.sh` builds for `wasm32v1-none`, deploys both contracts, writes
`deployments.json`, then runs `stellar contract bindings typescript` against the
**deployed** contract ids into `packages/escrow-bindings` and
`packages/usdc-bindings`. So the TypeScript the app compiles against is generated
from the wasm actually on the ledger, not from the source next to it — and
`lib/test/stellar.test.ts` reads the ids back out of the generated files as text
and compares them with `deployments.json`, so a redeploy that half-lands fails
the suite rather than the demo.

`soroban-sdk` is pinned to **25.3.2** to match the local `stellar` CLI
(**25.1.0**). A contract built by a newer SDK than the CLI that deploys it is a
confusing class of build error, and the protocol accepts an older env meta
version than the ledger's anyway. If you upgrade the CLI, move the pin with it.

Node must be **≥ 22.12** — `@stellar/stellar-sdk@17` requires it, and on Vercel
the project's Node version has to be set explicitly or the install fails.
