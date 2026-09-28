import type { Page, Route } from '@playwright/test';

import type { Cart, Product } from '@changuito/mcp/types';

/**
 * The scripted shop that `app-frame-checkout.spec.ts` runs against.
 *
 * This is the first browser mocking in the repo — there was no `page.route`,
 * no MSW and no HAR before it — so the shape is set here deliberately rather
 * than copied from somewhere.
 *
 * ## Why mock at all
 *
 * The flow crosses four things that are not ours and not deterministic: a
 * model, a supermarket, a ledger and a card issuer. Two of them cost money and
 * one of them has no test mode at all. A test that waited on the real four
 * would be measuring their uptime, not our behaviour, and the thing actually
 * worth pinning — that a cart becomes a receipt, exactly once, with the card
 * given back at the end — is entirely on our side of those seams.
 *
 * ## What the mocks are allowed to be
 *
 * Every response here is the shape the real route returns, taken from the
 * exported interface rather than invented: `DepositIntent`, `DepositStatus`,
 * `IssuedCard`, `ThreeDsCode`, `VerifyResponse`. A mock that drifts from its
 * route is a test that passes while the app is broken, so the types are the
 * contract and the fixtures are typed against them where the type is exported.
 *
 * The card numbers are the payment industry's published test PAN. They are
 * fake in the strongest available sense — every processor rejects them — which
 * matters because this file is in a public repo and because one of the
 * assertions in the spec is that they never reach storage.
 */

export const RETAILER = 'dia';
export const CART_ID = 'cart-e2e-0001';
export const HANDOFF_URL = `https://diaonline.supermercadosdia.com.ar/checkout?orderFormId=${CART_ID}#/cart`;

/** The código the deposit is tied to. Also the order id on the receipt. */
export const MEMO = 'E2ETESTX';
export const DEPOSIT_ADDRESS = 'GDYSKGLYEO2WJSI6TWJNKEMAPLM6J5WCXH5HYRLLPIUNGOI77W22PNGB';
export const DEPOSIT_AMOUNT = '4.6600000';

export const CARD_PAN = '4242424242424242';
export const CARD_PAN_GROUPED = '4242 4242 4242 4242';
export const CARD_CVV = '311';
export const OTP_CODE = '558102';

const money = (centavos: number, display: string) => ({ centavos, display });

/**
 * What the súper says the delivery costs, and the total with it in.
 *
 * These only matter on the paths where the store is read — which the rehearsal
 * is not, so the spec never sees them on screen. They are here so the
 * `/api/order/verify` mock is the shape the route actually returns rather than
 * the shape it returned before the reorder.
 */
export const SHIPPING_CENTAVOS = 120000;
export const PAYABLE_CENTAVOS = 515000 + SHIPPING_CENTAVOS;
/** `${orderGroup}-01`, the id the receipt links to. See lib/storefront.ts. */
export const ORDER_REF = '1664787669574-01';

export const PRODUCTS: Product[] = [
  {
    skuId: '31415',
    productId: '2718',
    name: 'Leche Entera La Serenísima 1L',
    brand: 'La Serenísima',
    sellerId: '1',
    price: money(185000, '$1.850,00'),
    available: true,
  },
  {
    skuId: '31416',
    productId: '2719',
    name: 'Fideos Matarazzo Spaghetti 500g',
    brand: 'Matarazzo',
    sellerId: '1',
    price: money(145000, '$1.450,00'),
    available: true,
  },
];

export const CART: Cart = {
  retailer: RETAILER,
  cartId: CART_ID,
  lines: [
    {
      index: 0,
      skuId: '31415',
      name: 'Leche Entera La Serenísima 1L',
      quantity: 2,
      sellerId: '1',
      unitPrice: money(185000, '$1.850,00'),
      lineTotal: money(370000, '$3.700,00'),
      available: true,
    },
    {
      index: 1,
      skuId: '31416',
      name: 'Fideos Matarazzo Spaghetti 500g',
      quantity: 1,
      sellerId: '1',
      unitPrice: money(145000, '$1.450,00'),
      lineTotal: money(145000, '$1.450,00'),
      available: true,
    },
  ],
  total: money(515000, '$5.150,00'),
  messages: [],
};

/**
 * One turn of the agent, as SSE.
 *
 * Written as the events rather than as a transcript string so it stays in step
 * with `UiEvent`: a field renamed in lib/protocol.ts should break this file,
 * not produce a stream the reducer silently drops. The frame encoding is
 * `encodeEvent`'s, reproduced rather than imported because importing a browser
 * module into the Playwright process drags its whole import graph along.
 */
export function transcript(): string {
  const events: unknown[] = [
    { t: 'status', stage: 'received' },
    { t: 'status', stage: 'thinking', hop: 0 },
    { t: 'tool_start', id: 't1', name: 'search_products' },
    { t: 'tool_end', id: 't1', ok: true, ms: 820 },
    { t: 'products', items: PRODUCTS, note: 'Esto es lo que encontré cerca tuyo.' },
    { t: 'text', delta: 'Te armé el changuito con la leche y los fideos. ' },
    { t: 'text', delta: 'Cuando quieras, lo pagamos.' },
    { t: 'cart', cart: CART, handoffUrl: HANDOFF_URL },
    { t: 'done', stopReason: 'end_turn', snapshot: { carts: { [RETAILER]: CART_ID } } },
  ];
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
}

/** Every request the flow makes to our own server, counted. */
export interface MockCalls {
  chat: number;
  depositMint: number;
  depositPoll: number;
  card: number;
  threeDs: number;
  terminate: number;
  verify: number;
}

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  });

/** How long the importe takes to land. Longer than nothing, shorter than the 4s poll. */
const DEPOSIT_LANDS_AFTER_MS = 2_500;
/** Same idea for the code the bank sends, against a 3s poll. */
const OTP_ARRIVES_AFTER_MS = 1_800;

/**
 * Put the scripted server in front of the real one.
 *
 * Installed before the first navigation, because the deposit is minted by an
 * effect that runs the moment the dialog opens and a route registered late
 * would let one real request through to a route that would 503 without an
 * operator address configured.
 *
 * Two of these keep the shopper waiting on purpose: the importe takes a beat
 * to land and the bank's code takes a beat to arrive, because a flow that were
 * instantly done at every step would never render the two screens a shopper
 * spends most of their time looking at.
 *
 * **Both windows are wall-clock, not a poll count.** Counting polls was the
 * obvious way to write it and it flaked one run in eight: React StrictMode
 * remounts every effect in `next dev`, so each poll fires twice on mount, the
 * second answer lands about fifty milliseconds after the first, and "esperando"
 * was gone before the assertion could read it. A duration cannot be
 * double-mounted.
 */
export function installCheckoutMocks(page: Page): MockCalls {
  const calls: MockCalls = {
    chat: 0,
    depositMint: 0,
    depositPoll: 0,
    card: 0,
    threeDs: 0,
    terminate: 0,
    verify: 0,
  };
  let mintedAt = 0;
  let issuedAt = 0;

  void page.route('**/api/chat', async (route) => {
    calls.chat += 1;
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream; charset=utf-8',
      headers: { 'Cache-Control': 'no-cache, no-transform' },
      body: transcript(),
    });
  });

  void page.route('**/api/deposit**', async (route) => {
    if (route.request().method() === 'POST') {
      calls.depositMint += 1;
      mintedAt = Date.now();
      await json(route, {
        network: 'testnet',
        address: DEPOSIT_ADDRESS,
        asset: { code: 'XLM', issuer: null },
        memo: MEMO,
        amount: DEPOSIT_AMOUNT,
        centavos: CART.total.centavos,
        usdCents: 466,
        arsPerUsd: 1105,
        source: 'e2e-fixture',
        cardAvailable: true,
      });
      return;
    }
    calls.depositPoll += 1;
    if (Date.now() - mintedAt < DEPOSIT_LANDS_AFTER_MS) {
      await json(route, { status: 'waiting' });
      return;
    }
    await json(route, {
      status: 'confirmed',
      txHash: '4be7604cf0e2f1a0d3c5e7b9a1c3d5e7f9b1d3c5e7a9b1d3c5e7f9a1b3d5c7e9',
      amount: DEPOSIT_AMOUNT,
      at: new Date().toISOString(),
    });
  });

  void page.route('**/api/card', async (route) => {
    calls.card += 1;
    issuedAt = Date.now();
    await json(route, {
      cardId: 'card_e2e_0001',
      last4: '4242',
      brand: 'visa',
      pan: CARD_PAN,
      cvv: CARD_CVV,
      expiryMonth: '11',
      expiryYear: '29',
      holder: 'CHANGUITO',
      fundedDisplay: '$4.66',
    });
  });

  void page.route('**/api/card/3ds**', async (route) => {
    calls.threeDs += 1;
    if (Date.now() - issuedAt < OTP_ARRIVES_AFTER_MS) {
      await json(route, { code: null });
      return;
    }
    await json(route, {
      code: {
        id: 'ch_e2e_1',
        otp: OTP_CODE,
        merchant: 'DIA ONLINE',
        // Far enough out that the countdown is still running when the
        // assertion reads it, close enough that it is plainly a countdown.
        expiresAt: Date.now() + 180_000,
      },
    });
  });

  void page.route('**/api/card/terminate', async (route) => {
    calls.terminate += 1;
    await json(route, { terminated: true });
  });

  void page.route('**/api/order/verify', async (route) => {
    calls.verify += 1;
    await json(route, {
      verified: true,
      identified: true,
      items: 0,
      unknown: false,
      // The four fields the route grew when the checkout started quoting from
      // the store instead of from the basket. The modal reads `breakdown` and
      // `payable` off every answer, so a mock still returning the old shape is
      // a mock that throws — the drift this file's header warns about.
      payable: PAYABLE_CENTAVOS,
      breakdown: [
        { id: 'Items', name: 'Total de los produtos', centavos: CART.total.centavos },
        { id: 'Shipping', name: 'Total do frete', centavos: SHIPPING_CENTAVOS },
      ],
      slotChosen: true,
      orderRef: ORDER_REF,
    });
  });

  return calls;
}

/**
 * Did this value reach storage *as a value*, rather than by coincidence?
 *
 * The plain substring check was wrong and flaked one run in sixteen: a CVV is
 * three digits and a storage dump is full of epoch milliseconds, so `311`
 * turned up inside `createdAt: 1790370311219` and failed a test about card
 * data with a timestamp. The needles are all digits, so the rule is that a
 * digit on either side means it is part of a longer number and not our value.
 * A CVV the app actually persisted would be written as `"cvv":"311"` —
 * quoted, delimited, caught.
 */
export function leaked(dump: string, value: string): boolean {
  return new RegExp(`(?<!\\d)${value.replace(/\s/g, '\\s')}(?!\\d)`).test(dump);
}

/** Everything the app wrote to storage, as one string to search. */
export async function storageDump(page: Page): Promise<string> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key) out.push(`${key}=${localStorage.getItem(key) ?? ''}`);
    }
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (key) out.push(`${key}=${sessionStorage.getItem(key) ?? ''}`);
    }
    return out.join('\n');
  });
}
