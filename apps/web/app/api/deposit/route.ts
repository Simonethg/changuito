/**
 * POST /api/deposit  -> what to send, where, and with which memo.
 * GET  /api/deposit  -> has it landed yet.
 *
 * The whole payment rail, and it holds no state. A deposit is a plain Stellar
 * payment to an operator account with a memo on it, so "has the shopper paid"
 * is a question the public ledger answers and neither a database nor a webhook
 * is involved. The browser keeps the memo it was given and asks again.
 *
 * Nothing *here* can move money. This route reads Horizon and reports; there
 * is no outbound path in it and no parameter that could become one. A refund
 * is a human doing it by hand, which is a worse product and a much smaller
 * blast radius.
 *
 * That used to be true of the whole deployment, and it is worth saying plainly
 * that it no longer is, because the old claim was load-bearing for anyone
 * reading this file to work out what could go wrong. `POST /api/deposit/demo`
 * holds a hot key. What that key can do is bounded four ways, set out in
 * lib/server/demo-wallet.ts: the asset is testnet play money from an issuer
 * that is locked and can never mint again, the destination is not a parameter,
 * the network is pinned in deployments.json and blank on mainnet, and the
 * secret is read at call time so a build without it still succeeds.
 *
 * The mainnet rail is exactly as it was: no key, no outbound path, refunds by
 * hand. Preview is the only thing that pays for anybody.
 *
 * ## Who may ask
 *
 * On the default network, anybody — it is play money and gating it would only
 * stop people trying the demo. On a real network this is a door onto somebody's
 * actual USDC, so `lib/deposit-gate.ts` answers first, with the same allowlist
 * and the same signature that `lib/settle-gate.ts` puts in front of the escrow.
 * It runs *before* the operator-address check below, so a stranger is refused
 * without learning whether there is anything deployed to reach.
 *
 * Statelessness has one consequence worth naming. This route will confirm the
 * same deposit as many times as it is asked, so it proves the money arrived
 * and *not* that it has not already been spent. Issuing a card against a memo
 * is the step that must happen once, and that is where the once-only claim
 * lives — not here.
 *
 * ## The order row, which is not state this route reads back
 *
 * Both halves write one. POST opens the order the memo belongs to, because
 * `POST /api/card` needs a row to latch its once-only claim onto; GET marks it
 * paid when the payment shows up on the ledger, because the poll is the only
 * place confirmation is ever observed and an order stuck at `quoted` for a
 * shopper who has paid is a record that lies.
 *
 * Neither write changes what either half *answers*. The ledger is still the
 * authority: GET reports what Horizon says whether or not the UPDATE lands,
 * and a database that is down costs a record rather than a payment. That is
 * why both are best-effort and logged, and why `markPaid` is monotonic — the
 * browser polls every four seconds and keeps confirming long after the card
 * has been issued.
 */
import { arsToUsdCents, getArsPerUsd } from '@changuito/mcp/fx';
import { CARD_MIN_CENTS, formatUsd } from '@changuito/mcp/pay';

import { modeKeepsRecords } from '../../../lib/app-mode.ts';
import { canIssueCard, rememberDepositor } from '../../../lib/card.ts';
import { hasDatabase, markPaid, openChatOrder } from '../../../lib/db.ts';
import { DEFAULT_NETWORK, type NetworkId } from '../../../lib/deployments.ts';
import { depositAddress, depositAsset, isMemo, mintMemo, type DepositAsset } from '../../../lib/deposit.ts';
import { authorizeRealMode, realModeNeedsProof } from '../../../lib/deposit-gate.ts';
import { findDeposit } from '../../../lib/deposit-watch.ts';
import { requireHuman } from '../../../lib/human-gate.ts';
import { orderFormIdFrom, readOrderForm } from '../../../lib/order-check.ts';
import { sharedCardCeilingCents } from '../../../lib/shared-card.ts';
import { canDemoPay } from '../../../lib/server/demo-wallet.ts';
import { proofFromBody } from '../../../lib/wallet-proof-verify.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface DepositIntent {
  network: NetworkId;
  address: string;
  asset: DepositAsset;
  memo: string;
  /** The figure to send, as a 7-decimal string — what a wallet wants pasted in. */
  amount: string;
  /** The basket, for the line the shopper reads. */
  centavos: number;
  usdCents: number;
  arsPerUsd: number;
  source: string;
  /**
   * Whether this deployment can mint a single-use card at all. Answered here
   * rather than in a `NEXT_PUBLIC_` flag so the browser learns it from the
   * same server that would have to honour it — and so a deployment without a
   * card provider never renders a button that 503s.
   */
  cardAvailable: boolean;
  /**
   * Whether this deployment can pay the deposit itself. True only in preview,
   * and only where `DEMO_WALLET_SECRET` is actually set — answered here for
   * the same reason `cardAvailable` is, rather than in a `NEXT_PUBLIC_` flag:
   * the browser learns it from the server that would have to honour it, so a
   * deployment without the secret never renders a button that 503s. A preview
   * shopper who gets `false` sees the address and the memo instead, which is
   * the manual path and still works.
   */
  demoPayable: boolean;
}

export interface DepositStatus {
  status: 'waiting' | 'confirmed';
  txHash?: string;
  /** What actually arrived, which is not always what was quoted. */
  amount?: string;
  at?: string;
}

/**
 * The buffer is 15%, the same one the card-funding path in @changuito/mcp
 * uses and for the same reason: the card network applies its own rate when the
 * supermarket charges it, and a cent short at the till is a decline in front
 * of a shopper with a full basket. The escrow path quotes at zero buffer
 * because it settles the exact number it locked; this one does not.
 */
const BUFFER = 0.15;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

function networkFrom(value: string | null): NetworkId {
  return value === 'mainnet' || value === 'testnet' ? value : DEFAULT_NETWORK;
}

/**
 * The deposit figure, in whichever asset this network takes.
 *
 * On mainnet the asset is USDC and this is a conversion: one USDC is one US
 * dollar, so US cents divided by a hundred is the amount.
 *
 * On testnet it is the same conversion, and now for the same reason: since
 * scripts/setup-demo-asset.mjs the testnet asset is a classic USDC of our own
 * rather than lumens, so one unit is one dollar there too and the figure is
 * the figure. It used to be XLM — the old mock USDC was a Soroban token with
 * no classic payment record to carry a memo — and the number was deliberately
 * *not* an XLM price, because there is no XLM/ARS feed in this app and
 * inventing one to move play money would have been a lie with a decimal point
 * in it. That awkwardness is gone; the copy still says "de prueba".
 */
export function depositAmount(usdCents: number): string {
  return (usdCents / 100).toFixed(7);
}

export async function POST(req: Request): Promise<Response> {
  const gated = await requireHuman(req);
  if (gated) return gated;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'body must be JSON' }, { status: 400 });
  }
  const input = (body ?? {}) as {
    centavos?: unknown;
    network?: unknown;
    address?: unknown;
    chatId?: unknown;
    retailer?: unknown;
    handoffUrl?: unknown;
    settled?: unknown;
  };

  const claimed = Number(input.centavos);
  if (!Number.isInteger(claimed) || claimed <= 0) {
    return Response.json({ error: 'centavos must be a positive integer' }, { status: 400 });
  }

  const network = networkFrom(typeof input.network === 'string' ? input.network : null);

  // The conversation this basket came out of, when there is one. Absent is
  // ordinary — preview has no chat to file anything against — but a string
  // that is not a uuid is a bug in the caller, and `chat.id` is a uuid. Said
  // out loud rather than dropped: silently ignoring it would open a second
  // order for a chat that already has one, which is the rule this carries.
  let chatId: string | undefined;
  if (input.chatId !== undefined && input.chatId !== null) {
    if (typeof input.chatId !== 'string' || !UUID.test(input.chatId)) {
      return Response.json({ error: 'chatId must be a uuid' }, { status: 400 });
    }
    chatId = input.chatId;
  }

  // Before anything that costs, and before the operator address is even looked
  // up. A wallet that may not use this network is told so and nothing else.
  const auth = authorizeRealMode({
    address: typeof input.address === 'string' ? input.address : '',
    proof: proofFromBody(body),
    now: Date.now(),
    net: network,
  });
  if (!auth.ok) {
    return Response.json({ error: auth.error, message: auth.message }, { status: auth.status });
  }

  const address = depositAddress(network);
  if (!address) {
    // Not configured is not the shopper's problem to decode, but it is
    // absolutely the operator's, so the log says which variable is missing.
    console.error(`[deposit] no DEPOSIT_ADDRESS_${network.toUpperCase()} set`);
    return Response.json({ error: 'los pagos no están habilitados en este entorno' }, { status: 503 });
  }

  // ---------------------------------------------------------------- the price
  //
  // The browser does not get to name it. When the caller hands over the cart
  // it is checking out, the total is read from the store's own orderForm here,
  // server-side, and whatever the browser claimed is discarded — see
  // `storeTotal` below for why that read is the whole point of this change.
  //
  // The claimed figure is still the fallback, for the two callers that have no
  // store cart to read: `PaymentModal`, and the `/dev/checkout` rehearsal,
  // which is a fixture with no orderForm behind it at all.
  const quoted = await storeTotal(input.retailer, input.handoffUrl, input.settled === true);
  if (quoted?.kind === 'unsettled') {
    return Response.json(
      {
        error: 'delivery_not_chosen',
        message: 'Todavía falta elegir el envío en el súper.',
      },
      { status: 409 },
    );
  }
  if (quoted?.kind === 'unreadable') {
    return Response.json(
      {
        error: 'cart_unreadable',
        message: 'No pudimos leer el changuito en el súper en este momento. Probá de nuevo en un minuto.',
      },
      { status: 409 },
    );
  }
  const centavos = quoted?.kind === 'read' ? quoted.centavos : claimed;

  try {
    const override = Number(process.env.FX_ARS_PER_USD);
    const rate = await getArsPerUsd(Number.isFinite(override) && override > 0 ? { override } : {});
    // Raised to the card minimum, the way `decideFunding` does it in the MCP
    // package. Not a call to `decideFunding` itself, which wants a settled
    // provider balance this deployment cannot read — the provider API is 403 —
    // so the one rule that applies here is applied directly. Without it a very
    // small basket quotes below $1 and is then refused by `POST /api/card`
    // with `too-small`, after the money has already moved.
    const bare = arsToUsdCents(centavos, rate.arsPerUsd, BUFFER);
    const usdCents = bare > 0 && bare < CARD_MIN_CENTS ? CARD_MIN_CENTS : bare;

    // A basket bigger than what is on the card. Refused here rather than
    // discovered at the till: the card is loaded by hand and nothing tops it
    // up, so quoting past it means taking the USDC and *then* declining. Soft
    // by construction — `sharedCardCeilingCents` says why — and absent on
    // every deployment that has no such record, where it is a no-op.
    const ceiling = await sharedCardCeilingCents(network);
    if (ceiling !== null && usdCents > ceiling) {
      return Response.json(
        {
          error: 'over_card_ceiling',
          message: `Este changuito supera el límite por compra (${formatUsd(ceiling)}). Sacá algo o escribinos.`,
        },
        { status: 409 },
      );
    }

    // The order is opened for every memo, so the claim latch that `POST
    // /api/card` needs always has a row to latch onto. The *address* is written
    // only where the signature above actually proved one: in mode 'open'
    // nothing was proven, so recording the claimed address would be writing
    // down a guess and then trusting it later — and `POST /api/card` skips the
    // ownership check in that mode for exactly the same reason.
    const depositor = realModeNeedsProof(auth.mode)
      ? (input.address as string).trim().toUpperCase()
      : undefined;

    // One chat is one order, and this is where that stops being a rule the
    // browser keeps. ShopProvider already refuses to let a shopper type a
    // second basket into a paid chat; this refuses to *quote* one, which is
    // the half that matters, because a rule about money does not get to live
    // in a browser.
    //
    // The memo comes back from the database rather than from `mintMemo()` when
    // a chat already has an unclaimed order: a deposit sent against the old
    // código still matches, so a shopper who paid and then reloaded is not
    // stranded with real money against a memo nothing will ever look for.
    const order = chatId && modeKeepsRecords(network) && hasDatabase()
      ? await openChatOrder({
          network,
          chatId,
          memo: mintMemo(),
          address: depositor,
          amountCents: usdCents,
          arsQuoted: centavos,
        }).catch((err) => {
          console.error('[deposit] could not open the chat order:', message(err));
          return null;
        })
      : null;

    if (order?.kind === 'closed') {
      return Response.json(
        {
          error: 'order_closed',
          message: 'Esta conversación ya tiene una compra. Empezá un chat nuevo para comprar de nuevo.',
        },
        { status: 409 },
      );
    }
    if (order && !order.linked) {
      // The order exists and works; it just is not filed under the chat, so
      // the one-per-chat rule is not holding it. Worth a line, because the
      // cause is upstream — a conversation that never got archived.
      console.warn(`[deposit] ${network}:${order.order.memo} opened without chat ${chatId}`);
    }

    const memo = order?.order.memo ?? mintMemo();

    // No chat id, or no database to file one against: the old path, which
    // records the same fact with no conversation attached.
    //
    // A failure here is not the shopper's problem *yet*. It becomes one when
    // they try to mint a card, which refuses rather than let an unowned memo
    // through. Loud, because the recovery is a manual refund.
    if (!order) {
      await rememberDepositor(network, memo, {
        address: depositor,
        amountCents: usdCents,
        arsQuoted: centavos,
      }).catch((err) => {
        console.error('[deposit] could not record the deposit:', message(err));
      });
    }

    const intent: DepositIntent = {
      network,
      address,
      asset: depositAsset(network),
      memo,
      amount: depositAmount(usdCents),
      centavos,
      usdCents,
      arsPerUsd: rate.arsPerUsd,
      source: rate.source,
      cardAvailable: canIssueCard(),
      demoPayable: canDemoPay(network),
    };
    return Response.json(intent);
  } catch (err) {
    // assertSaneRate throws rather than returning a bad number. Refusing to
    // quote is correct: the alternative is pricing a basket off a feed that
    // said one peso to the dollar.
    return Response.json({ error: `no pudimos cotizar el carrito: ${message(err)}` }, { status: 502 });
  }
}

export async function GET(req: Request): Promise<Response> {
  const gated = await requireHuman(req);
  if (gated) return gated;

  const q = new URL(req.url).searchParams;
  const memo = q.get('memo') ?? '';
  const amount = q.get('amount') ?? '';
  const network = networkFrom(q.get('network'));

  if (!isMemo(memo)) return Response.json({ error: 'memo inválido' }, { status: 400 });
  if (!/^\d+(\.\d{1,7})?$/.test(amount)) return Response.json({ error: 'monto inválido' }, { status: 400 });

  const address = depositAddress(network);
  if (!address) return Response.json({ error: 'los pagos no están habilitados en este entorno' }, { status: 503 });

  try {
    const hit = await findDeposit(network, {
      to: address,
      asset: depositAsset(network),
      memo,
      minAmount: amount,
    });
    if (hit) {
      // Best effort, and deliberately not awaited into the answer: the ledger
      // said the money arrived, and that is true whether or not the row can be
      // written. Failing the poll over a database would tell a shopper who has
      // paid that they have not.
      await markPaid(network, memo, hit.txHash).catch((err) => {
        console.error(`[deposit] ${network}:${memo} confirmed but not recorded:`, message(err));
      });
    }
    const body: DepositStatus = hit
      ? { status: 'confirmed', txHash: hit.txHash, amount: hit.amount, at: hit.at }
      : { status: 'waiting' };
    return Response.json(body);
  } catch (err) {
    // Horizon being unreachable is not "no deposit" — saying so would tell a
    // shopper who has already paid that they have not.
    console.error('[deposit] horizon read failed:', message(err));
    return Response.json({ error: 'no pudimos consultar la red en este momento' }, { status: 502 });
  }
}

/**
 * The exact total, read from the store's own cart.
 *
 * This is the change the whole reorder exists for. The deposit used to be
 * quoted from `cart.total`, which is the goods subtotal by design — see
 * `payableTotal` in `@changuito/mcp/orderform` — so the shopper was charged
 * before a delivery slot existed and for a number that did not include envío.
 * Now the browser hands over *which cart*, and the amount comes from the
 * document.
 *
 * Four outcomes, and the middle two matter:
 *
 * - `undefined` — no cart was named at all. The caller falls back to the
 *   figure the browser claimed, which is what it always did, and which is
 *   what keeps `PaymentModal` and the `/dev/checkout` rehearsal working: both
 *   are baskets with no store orderForm behind them.
 * - `unsettled` — the cart was read and the shopper has not chosen a delivery
 *   yet, so the shipping line is not in the total. Quoting here would
 *   reintroduce the exact bug this replaces, so it is a refusal instead.
 * - `unreadable` — a cart *was* named and the store could not be asked, or
 *   answered with no usable total. Also a refusal; see below.
 * - `read` — the payable total, envío included.
 *
 * Note what is *not* here: no fallback to the claimed figure once a cart has
 * been named. A caller that names a cart is quoted from that cart or not at
 * all; letting it fall back would make the server-side read advisory, and an
 * advisory price check is not one. That is why the store being briefly
 * unreachable is a 409 the shopper can act on rather than a quiet reversion
 * to the wrong number.
 *
 * ## `settled` skips the wait and nothing else
 *
 * It is the browser saying the shopper told us they picked a delivery — the
 * escape hatch for a store that does not hand `shippingData.logisticsInfo` to
 * a reader with no session. It can only ever suppress the `unsettled`
 * refusal. It cannot name a figure, and the figure is still read from the
 * store's own document either way, so the rule the whole change rests on —
 * the browser does not name its own price — survives it intact.
 */
async function storeTotal(
  retailer: unknown,
  handoffUrl: unknown,
  settled: boolean,
): Promise<
  { kind: 'read'; centavos: number } | { kind: 'unsettled' } | { kind: 'unreadable' } | undefined
> {
  if (typeof retailer !== 'string' || typeof handoffUrl !== 'string') return undefined;
  const orderFormId = orderFormIdFrom(handoffUrl);
  if (!retailer || !orderFormId) return undefined;

  // `itemsAtHandoff: 0` because `looksPaid` is not being asked here — a zero
  // makes that flag false whatever the cart says, which is correct: this call
  // is about the price, and nothing reads the verdict.
  const state = await readOrderForm({ retailer, orderFormId, itemsAtHandoff: 0 });
  if (!state) return { kind: 'unreadable' };
  if (!state.slotChosen && !settled) return { kind: 'unsettled' };
  if (!Number.isInteger(state.payable) || state.payable <= 0) return { kind: 'unreadable' };
  return { kind: 'read', centavos: state.payable };
}
