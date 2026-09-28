# Reviewing changuito

A path through the repo for someone with fifteen minutes, and the evidence for
every claim the submission makes. Nothing here asks you to take our word for
something — each row points at a file, a command, or a ledger entry.

If you read one other thing, make it the
[**honesty section in the README**](../README.md#where-this-is-honest-about-itself).
It is at the top of that file on purpose: what is operator-run rather than
automated is stated by us, before you find it.

---

## 0. Submission facts

| | |
|---|---|
| **Live app** | [app.changuito.me](https://app.changuito.me) — signed out is testnet and costs the visitor nothing |
| **Marketing site** | [www.changuito.me](https://www.changuito.me) |
| **Repository** | [github.com/raptor0929/changuito](https://github.com/raptor0929/changuito) — MIT |
| **Built by** | [SimonethG](https://www.linkedin.com/in/simonethg/) and [Fabio](https://www.linkedin.com/in/fabio-laura-yavi/), in Argentina |
| **Networks** | Stellar **testnet** (preview, and the deployed contracts) and **mainnet** (production, real USDC) |
| **What is on-chain** | a classic USDC payment with a memo, confirmed by reading Horizon. No contract sits on the money rail, and the deployment holds no signing key on mainnet |
| **Contracts** | escrow [`CBCUESHD…CXQ557`](https://stellar.expert/explorer/testnet/contract/CBCUESHDKRXAH4YAHOKJFRFEOIYBTU2LYJ4LCOFIGMYGNHBCPACXQ557) *(deployed, tested, dormant)* · SEP-41 token [`CB63C7UV…LQUBJF`](https://stellar.expert/explorer/testnet/contract/CB63C7UVZ3PBALQ7IE37QU2ZX5X3UMTLJOHDRI2EW44JU26YDGLQUBJF) |
| **SEPs used** | SEP-53 (signed messages, for identity), SEP-41 (the token interface), SEP-7 (the receive URI) |
| **Wallet** | Pollar (`@pollar/react` 0.11.3) — email or Google login, so a shopper needs no prior wallet |
| **Tests** | `npm test` → 1178 · `npm run contracts:test` → 34. Neither needs an API key |
| **Pitch video** | sources in [`creatives/`](../creatives) (Remotion, three cuts: ES, EN, promo). There is no hosted link in this repo — `npm run render` in any of those folders produces the mp4 |

## 1. The one-paragraph version

An Argentine supermarket takes pesos through a card form. Somebody holding
dollars on Stellar cannot pay with them, and the gap is not a swap — it is the
last mile: the store wants a card, at a peso amount nobody knows until a
delivery slot is picked, from a person whose profile the store already holds.

changuito is a chat agent that shops the store over
[MCP](https://modelcontextprotocol.io), opens the store's *own* checkout inside
the app, reads the exact payable total from the store's cart server-side, takes
that amount in USDC on Stellar, and hands back a card number for the store's
payment form. The store changes nothing. changuito custodies nothing but a
deposit account.

## 2. Fifteen minutes, in order

| Minutes | Do this | What it shows |
|---|---|---|
| 0–3 | Open [app.changuito.me](https://app.changuito.me) signed out and ask for a basket in Spanish — *"armá un desayuno por menos de $10.000"* | The agent is driving a real store. Prices and stock are Día's, live. This is **preview**: testnet, and we pay |
| 3–6 | Press *Pagar* and watch the three-step rail: **entrá a tu cuenta → elegí el envío → pagá el importe** | The store's real checkout, in an iframe. No amount is quoted until the store has one |
| 6–9 | Read [`apps/web/lib/order-check.ts`](../apps/web/lib/order-check.ts) and [`apps/web/lib/test/order-check.test.ts`](../apps/web/lib/test/order-check.test.ts) | How the app reads a cart it cannot see, cookie-free — and the test that pins that no profile data crosses back out |
| 9–12 | Read [`apps/web/lib/deposit-watch.ts`](../apps/web/lib/deposit-watch.ts) | The Stellar half. Horizon is the only confirmation source; the matcher is pure and tested separately from the fetch, because that is where money bugs live |
| 12–15 | Run the commands in [§5](#5-verify-it-yourself) | The contract config, the ledger entries, and the test suites |

## 3. Claim → evidence

| The claim | Where to check it |
|---|---|
| It is a real MCP server, spoken over the real protocol | [`apps/web/lib/mcp/boot.ts`](../apps/web/lib/mcp/boot.ts) — `InMemoryTransport.createLinkedPair()`, so `initialize` / `tools/list` / `tools/call` actually happen. Importing the functions would have been shorter |
| The supermarket integration is not a mock | [`packages/mcp/`](../packages/mcp) — four Argentine VTEX chains, 520 tests, written before this app existed |
| The model cannot put a wrong price on screen | [`apps/web/lib/agent/render-tools.ts`](../apps/web/lib/agent/render-tools.ts) — render tools take **identifiers only**. A hallucinated price has no argument to travel in |
| The shopper is charged the store's exact total, envío included | [`apps/web/app/api/deposit/route.ts`](../apps/web/app/api/deposit/route.ts) — the route ignores the client's figure whenever it can read the store's. Commit `16ee1a8` is the fix and says why |
| Confirmation is trustless | [`apps/web/lib/deposit-watch.ts`](../apps/web/lib/deposit-watch.ts) — Horizon only. No webhook, no secret, no reconciliation. You can check any deposit yourself |
| Identity is proven, not claimed | [`apps/web/lib/wallet-proof-verify.ts`](../apps/web/lib/wallet-proof-verify.ts) (SEP-53) and the four gates that use it: `deposit-gate`, `network-access`, `faucet-auth`, `settle-gate` |
| A deposit can buy exactly one card | [`apps/web/lib/card.ts`](../apps/web/lib/card.ts) — the claim is a conditional `UPDATE … where card_id is null`, not a read-then-write, because two tabs pressing the button together is the ordinary case |
| Card numbers are never written down | `card.ts` header, and `e2e/app-frame-checkout.spec.ts`, which asserts no PAN or CVV reaches `localStorage` or `sessionStorage` and runs with traces off |
| Mainnet is closed by default | [`apps/web/lib/network-access.ts`](../apps/web/lib/network-access.ts) — in production an empty allowlist means nobody, and Vercel previews run as production |
| The contracts do what the README says | [§5](#5-verify-it-yourself) — ask the deployed wasm, not the source |

## 4. What is real, and what is not

Stated plainly, because a judge finding this out unaided is worse than a judge
being told.

| | Status |
|---|---|
| The supermarket catalogue, cart and checkout | **Real.** Día's own API and Día's own checkout page |
| The exact payable total, envío included | **Real.** Read server-side from VTEX's public `orderForm` |
| The USDC payment and its confirmation | **Real.** A classic Stellar payment, matched by memo, confirmed from Horizon |
| Identity and the gates on real money | **Real.** SEP-53 signatures, allowlisted in production |
| The escrow contract | **Deployed and tested, dormant.** Reachable from `/dev/ui`, not from the shopper's path. The reasoning is in [`lib/deposit.ts`](../apps/web/lib/deposit.ts) |
| **Funding the card from the deposit** | **Operator-run.** The issuer's API answers `403 "Contact support via email to enable your API"` on every endpoint. One card exists, created by hand, read from a `shared_card` row by wallets on a member list. No copy in the app claims a load happened |
| Refunds | **By hand.** No automated outbound payment and no Stellar secret in the production deployment |
| The receipt's per-order link | **Inferred by one character.** `orderRef` is `${orderGroup}-01`; degrades to the order list, never a 404 |

## 5. Verify it yourself

Ask the deployed contract who can settle and where money lands. `--send=no`
simulates only: it signs nothing, costs nothing, and any funded account works as
the source.

```bash
stellar contract invoke --network testnet \
  --id CBCUESHDKRXAH4YAHOKJFRFEOIYBTU2LYJ4LCOFIGMYGNHBCPACXQ557 \
  --source-account GBGMPRHU3NW3BCXUNDNC7VSYQKS6FZKWFHSGEHHMR3G3TZOUWEDBHTFK \
  --send=no -- config
```

The deployed wasm's own interface, rather than a copy of the source:

```bash
stellar contract info interface --network testnet \
  --id CBCUESHDKRXAH4YAHOKJFRFEOIYBTU2LYJ4LCOFIGMYGNHBCPACXQ557
```

Re-derive the receipt hash stored by the settle linked in the README:

```bash
printf 'changuito/receipt/v1\nretailer|dia\ncart|live-check-1\nhandoff|https://diaonline.supermercadosdia.com.ar/checkout?orderFormId=live-check-1\nsettled|2026-09-21T07:22:14.394Z\n' | shasum -a 256
# 881ae41cb172e10778dd6810e5c3e9be5fef54b266cb0686f4da446109f978d0
```

And the suites, from a clean clone with only `npm install`:

```bash
npm test                 # 1178: mcp 520 · trust 2 · web 583 · landing 73
npm run contracts:test   #   34: escrow 19 · mock_usdc 15
npm run build
```

Neither needs an API key. The web suite runs on `node:test` with
`--experimental-strip-types`.

## 6. Questions we expect, answered

**Why not settle on-chain with the escrow you already wrote?**
Because the app cannot prove the basket happened. The store's confirmation page
is `SAMEORIGIN` and the checkout is cross-origin, so "the basket went through"
would be the shopper's own word — and an escrow that settles on the buyer's word
is a custodial box with extra steps. The one unambiguous signal the app *can*
read is `orderGroup`, server-side, from the public cart document. Wiring that to
`settle` is the honest next step and it is written up in
[stellar.md](stellar.md#the-escrow-contract-dormant).

**Why a card at all, rather than paying the store in USDC?**
Día takes cards. That is the whole of it. The card is the adapter between a
ledger the store has never heard of and the payment form it already has, and it
is the part a real deployment would replace with an anchor or a direct merchant
integration — neither of which a hackathon can conjure.

**Why is so much of the reasoning in comments rather than in docs?**
Because the comments are next to the code that would otherwise be undone. Most
of them record something that was observed rather than designed: a probe against
Día's live API on a dated day, a flake that happened one run in sixteen, a fix
that was reversed. [`CLAUDE.md`](../CLAUDE.md) is the long-form version for the
agent, and the file headers are the rest.

**Is the AI load-bearing, or decoration?**
Load-bearing, and the constraint on it is explicit: the model decides *which*
products to surface and *what* to say, and it is structurally prevented from
deciding what anything costs. See the render-tools rule above. The first
question a shopper is asked — their postal code — is answered without a model
call at all ([`agent/early-ask.ts`](../apps/web/lib/agent/early-ask.ts)),
because it is the same question every time.

---

## Reaching us

Issues and pull requests on the repository. If something in this document does
not match what you find, that is a bug in the document and worth filing.
