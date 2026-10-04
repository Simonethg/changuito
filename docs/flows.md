# Basic flows

The paths that matter, in the order a shopper meets them. Flows 1–5 are the
live product. Flow 6 is the escrow, which is deployed and tested and **not on
the shopper's path** — it is here because it is real code somebody will find.

---

## 1. A chat turn

The only streaming path in the app. One user message in, an arbitrary number of
tool calls, and a transcript that has to stay readable while it is being built.

```
BROWSER                       /api/chat                     MCP        ANTHROPIC
   │
   │ POST { sessionId, message, snapshot? }
   ├──────────────────────────►│
   │                           │ withSession(id, snapshot)
   │                           │   warm Map hit, or boot a new
   │                           │   MCP pair and restore(snapshot)
   │                           │
   │                           │ turns.get(sessionId)  ◄── Redis
   │                           │
   │                           │ ┌─ hop 0..11 ────────────────────────────┐
   │                           │ │ messages.stream(model, tools, system)  │
   │                           │ │                          ──────────────►
   │   ◄── text / thinking ────│ │  ◄── deltas ───────────────────────────│
   │                           │ │                                        │
   │                           │ │ for each tool_use:                     │
   │   ◄── tool_start ─────────│ │   MCP tool ──► tools/call ──► VTEX     │
   │   ◄── products / cart ────│ │   render tool ──► emit, no I/O         │
   │   ◄── tool_end ───────────│ │                                        │
   │                           │ │ no tool calls → done                   │
   │                           │ └────────────────────────────────────────┘
   │                           │
   │                           │ turns.set(sessionId, turn)  ──► Redis
   │                           │ chat archive ──► Postgres (signed in only)
   │   ◄── done { snapshot } ──│
   │
   │ keeps the snapshot, sends it back next turn
```

Details worth knowing:

- **Transport is SSE**, with a `:` heartbeat every 15s. A single search against
  a slow storefront can go twenty seconds without a byte, and an idle stream is
  a stream a proxy feels free to close. `X-Accel-Buffering: no` stops a proxy
  buffering the whole thing into one delivery at the end.
- **A `status` event is the first byte of the body**, before the MCP boot and
  before the model, so the UI can tell a slow turn from a dead one. Nothing in
  `lib/turn-progress.ts` is estimated: every stage is something that happened.
- **`MAX_HOPS = 12`.** Past that the model is stuck, not working, and the user
  gets a plain message saying so.
- **The first question is not a model call.** "¿Cuál es tu código postal?" is
  answered in-process by `agent/early-ask.ts` when it is the first message, no
  location is set, and nothing in the text looks like a postal code.
- **Render tools are not traced.** `tool_start`/`tool_end` fire for MCP tools
  only — those reach a supermarket and explain a wait. A render tool moves data
  the user is already looking at.
- **History is written only after a clean return.** A turn that threw mid-hop
  can leave an assistant `tool_use` with no matching `tool_result`, and the API
  rejects that pairing on the *next* request — so the failure would surface one
  message later, on a turn that did nothing wrong.
- **The transcript is a reducer.** `chat-state.ts` folds `UiEvent`s into blocks.
  The hard part is ordering: a grid arrives mid-sentence, and appending it at
  the end of the turn would make the sentence introducing it read as its
  caption.

### What the user sees

```
1. GREETING   what the agent can do, and three starter prompts
2. RESEARCH   "buscando leche…", tool trail, then a product grid
3. RESULTS    the recommended items, a cart card, and the real Día link
4. CHECKOUT   the store's own checkout, framed — flows 3 to 5
5. RECEIPT    what was paid, the explorer link, and a link to the order
```

---

## 2. Funding a wallet (testnet, and no longer on the shopper's path)

The faucet route is live and gated, but the **Fondear** button that calls it
now renders only in `/dev/ui` — preview pays from the demo wallet instead, so a
visitor never needs a balance of their own. Kept here because the route is one
of the four SEP-53 gates and because the ordering below is the interesting part.

Two steps, and the order is the point.

```
[Fondear]  ──►  POST /api/faucet { address, proof }
                   │
                   │ 0. SEP-53 proof, then the allowlist — deny-by-default
                   │      in production
                   │
                   │ 1. friendbot, if XLM < 5
                   │      an address nobody funded is just a public key: every
                   │      transaction it signs fails with tx_no_source_account,
                   │      which reads like a bug in the app rather than an
                   │      empty wallet
                   │
                   │ 2. usdc.mint(to, 50.0000000)   ── resolver signs, it is
                   │      the token admin
                   │
                   ▼
                { xlm, usdc, usdcDisplay, txHash, created }
                   │
                   ▼
                useBalances().refresh()
```

Doing it the other way round hands someone money they cannot spend.

- Grant is **50 demo USDC**; the route short-circuits above **100** held, with a
  **60s per-address cooldown**. The cooldown is in memory on purpose — it exists
  to stop a stuck button making one hot key sign fifty transactions, not to stop
  a determined adversary.
- **Smart wallets have no Horizon account**, so `xlm` comes back `null` for
  them and only the mint runs.
- The demo token is a **SEP-41 contract, not a classic asset**: there is no
  `CODE:ISSUER` and nothing to `changeTrust` to, so a mint to an address that
  has never existed just works. That is why the faucet can be one button.

This mints the *Soroban* demo token, which is what the escrow and the balance
panel speak. The deposit rail takes the **classic** testnet USDC and needs a
trustline first — `lib/trustline.ts`. Two assets, two rules; [stellar.md](stellar.md#why-testnet-has-a-classic-usdc-of-its-own)
has why.

---

## 3. Checkout, step one: the store, read from outside

The checkout is Día's own, in an iframe, and **the app cannot see into it**:
different origin, so no DOM, no URL, no completion event. Everything the app
knows about the basket it learns by asking the store's *public* cart document
by id, server-side, with no cookies.

```
BROWSER                      /api/order/verify           DÍA (public API)
   │
   │ CheckoutModal mounts the frame ONCE and never unmounts it.
   │ Re-mounting reloads the store and loses what was typed.
   │
   │ every few seconds, while the shopper works:
   ├─ POST { retailer, handoffUrl } ──►│
   │                                   │ GET /api/checkout/pub/orderForm/{id}
   │                                   ├──────────────────────────────────►│
   │                                   │  ◄── the cart document ───────────│
   │                                   │
   │                                   │ identified  = profile has an email
   │                                   │ payable     = payableTotal(of)
   │                                   │               items + envío − dtos
   │                                   │ breakdown   = totalizerBreakdown(of)
   │                                   │ slotChosen  = every logistics group
   │                                   │               has a selectedSla
   │                                   │ orderGroup  = present once the order
   │                                   │               exists
   │   ◄── { identified, items, payable, breakdown, slotChosen, orderRef } ─┤
   │
   │ stage = login → delivery → pay → card
```

- **No PII crosses that function.** The profile is read and discarded inside
  `lib/order-check.ts`; only `verdict.state` leaves it, and that is a closed
  union of literals. `verdict.why` and the collected store messages are *not*
  returned, because they embed names and item descriptions.
  `lib/test/order-check.test.ts` pins this — 17 tests, several of which exist
  only to fail if a name or an address ever appears in the response.
- **`identified` is a hint, never proof.** A VTEX profile object exists before
  it is filled in, so the check is `Boolean(clientProfileData?.email)`.
- **`orderGroup` is the one unambiguous success signal.** An emptied cart is
  not evidence: a cart id nobody ever used returns the same shape.

---

## 4. Checkout, step two: the quote and the payment

The order of the three steps *is* the design. The USDC is charged **after** the
shopper picks a delivery slot, because until then the total does not include
envío and the shopper would be charged a number the súper will not.

```
BROWSER                          /api/deposit                 STELLAR
   │
   │ identified && slotChosen && payable > 0, once:
   ├─ POST { retailer, handoffUrl, network, address, proof } ─►│
   │                                   │
   │                                   │ deposit-gate: SEP-53 proof, then the
   │                                   │   allowlist — before anything is quoted
   │                                   │ payable read from the STORE, server-side.
   │                                   │   the client's own figure is ignored
   │                                   │   whenever the store can be asked
   │                                   │ arsToUsdCents(payable) + FX buffer
   │                                   │ raise to CARD_MIN_CENTS
   │                                   │ refuse above the shared card's ceiling
   │                                   │ openChatOrder(...) → reuses the memo
   │   ◄── { address, amount, memo (el código), display } ─────┤
   │
   │ shown as:  Productos $16.345,00
   │            Envío      $1.200,00
   │            Total     $17.545,00  ≈ 17,54 USDC
   │
   │ ONE PRESS — never automatic:
   │   Pollar sends the payment ──────────────────────────────────────────►│
   │   or the shopper sends it themselves to the address + memo shown      │
   │   or, in preview, POST /api/deposit/demo signs with the demo wallet   │
   │
   │ poll every 4s:
   ├─ GET /api/deposit?memo=… ────────►│ lib/pay → activeLedger(): payments
   │                                   │   destination · asset code AND issuer
   │                                   │   · amount in stroops · memo
   │                                   │ markPaid(memo)  — monotonic, best effort
   │   ◄── { confirmed: true, hash } ──┤
```

- **The charge is a button, always.** What the app does automatically is read
  the total; it never takes the money. A shopper who does not want to pay in
  crypto is never charged.
- **The amount is read server-side.** The browser never names its own price.
- **Re-quoting is safe.** `openChatOrder` amends the amount on an existing
  unclaimed order and **reuses the memo**, so changing the delivery slot does
  not strand money on a dead código.
- **GET holds no state and can be asked forever.** It proves the money arrived,
  not that it has not been spent — the once-only claim lives in flow 5.
- **A database that is down costs a record, not a payment.** The ledger port is
  the authority in both halves (Horizon today).

---

## 5. Checkout, step three: the card, and the receipt

```
BROWSER                            /api/card                   STELLAR / DB
   │
   ├─ POST { memo, network, address, proof } ──►│
   │                                            │ read the ledger for a payment
   │                                            │   carrying the código
   │                                            │ amount ← THAT payment, not the
   │                                            │   request body
   │                                            │ claim the deposit exactly once:
   │                                            │   UPDATE … WHERE card_id IS NULL
   │                                            │
   │                                            │ preview:    a per-basket card,
   │                                            │   spending_limit = the deposit,
   │                                            │   terminated when done
   │                                            │ production: ONE card per wallet.
   │                                            │   a second deposit funds the
   │                                            │   first — claim first, then fund
   │   ◄── { cardId, last4, importe } ──────────┤
   │
   │ GET /api/card/{id}/details  ── PAN + CVV, shown and never stored
   │ POST /api/card/3ds { memo } ── the código the súper's bank sends,
   │                                keyed on the memo, never on a card id,
   │                                counted down because it expires in ~3 min
   │
   │ shopper pays at Día with the card
   │
   ├─ "Ya lo pagué" ──► re-check /api/order/verify
   │      orderGroup present → real evidence
   │      payable moved      → name BOTH numbers, charge nothing, refund
   │                           nothing, and still show the card
   │
   ├─ POST /api/order/done { memo } ── paid|carded → done. It cannot mark an
   │                                   order paid, which is why it needs no
   │                                   signature
   │
   ▼
   receipt in localStorage + the purchases list, linking the payment on
   stellar.expert and the order at the store (`{orderGroup}-01`)
```

- **The PAN, the CVV and the 3DS code never touch storage.** Not localStorage,
  not sessionStorage, not a Playwright trace — the e2e spec asserts all three
  and sets `trace: 'off', video: 'off', screenshot: 'off'` because this repo is
  public.
- **The card is funded by an operator, not by this code.** Vyrion answers
  `403 "Contact support via email to enable your API"` on every endpoint, so
  one card was created by hand and `shared_card` hands it to the wallets on
  `shared_card_member`. **No copy claims a load happened** — the panel says what
  the importe is, and stops there.
- **The `-01` suffix on the order link is inferred**, from VTEX's single-seller
  convention. Día is single-seller. A wrong guess degrades to the order *list*,
  which is what shipped before.

---

## 6. Dormant: the escrow

Everything below is deployed on testnet, covered by 19 tests, and reachable
only from `/dev/ui`. No shopper path calls it. Kept because bringing it back is
a concrete next step — see
[stellar.md](stellar.md#the-escrow-contract-dormant).

### 6a. Opening

```
orderId    = crypto.getRandomValues(32)      random, NOT derived
basketHash = sha256(canonicalBasket(cart))   32 bytes

escrow.open(buyer, order_id, amount, basket_hash, timeout_secs)
    buyer.require_auth()          ── one approval, which also covers the
                                     transfer out of the buyer's balance
    amount > 0                    ── else InvalidAmount
    300s ≤ timeout ≤ 30d          ── else InvalidTimeout
    order_id unseen               ── else OrderExists
    USDC: buyer ──► contract
    emit Opened{…}
```

- **`basket_hash` is what makes this more than a transfer.** It commits to the
  exact items, quantities, per-line and total pesos, and which lines the store
  said were unavailable — as a versioned, line-oriented text, not
  `JSON.stringify`, because a hash is a promise about bytes and object key order
  is an implementation detail of whoever built the object.
- The **USDC amount is deliberately not in the hash**: the contract stores it as
  its own field, so hashing it too would be a second copy that can disagree.
- **`order_id` is random, not derived from the basket.** `open` rejects an id it
  has seen, which is what stops a double submit — but a deliberate second
  attempt at the same basket (the first failed in the wallet) must be a new
  order, or it would be rejected for the wrong reason.
- **Arguments are positional** and `order.test.ts` reads the signature out of
  `lib.rs` to check them, because two swapped `BytesN<32>` arguments type-check,
  deploy, and then settle the wrong basket.

### 6b. Settling and refunding

```
escrow.settle(order_id, basket_hash, receipt_hash)
    cfg.resolver.require_auth()
    status must be Open              ── else OrderClosed
    basket_hash must match           ── else BasketMismatch
    status ← Settled, receipt stored
    USDC: contract ──► treasury

escrow.refund(caller, order_id)
    resolver, any time  ──  or the buyer, after the deadline. Nobody else,
    ever, even once the deadline has passed  ── else NotAuthorized
    USDC: contract ──► buyer
    emit Refunded{ self_service }    ── true means the backend never came back
```

The status is written **before** the transfer, in both: a token whose
`transfer` re-enters the contract must find the order already closed.

```
                   open()
        (none) ──────────────► Open
                                │ │
                settle() ───────┘ └─────── refund()
                   │                          │
                   ▼                          ▼
                Settled                    Refunded
```

Terminal in both directions: an order can only be closed once, and a refunded
order cannot then be settled. The 19 tests reconcile balances exactly across
`open → settle` and `open → refund`, cover every rejection above, and assert
that a rejected call leaves no event behind.
