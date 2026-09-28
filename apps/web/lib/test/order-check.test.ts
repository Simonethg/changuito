import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { orderFormIdFrom, readOrderForm } from '../order-check.ts';

/**
 * The bodies here are trimmed copies of what
 * `diaonline.supermercadosdia.com.ar/api/checkout/pub/orderForm/{id}` actually
 * returned on 2026-09-25, for a cart created and then given a profile through
 * the public API. `loggedIn: false` in both is not a typo — it describes the
 * requester, and the requester is us, with no cookies.
 */
const ID = '438358eb7d7348ec94a3f0c50b4ce228';
const URL_WITH_ID = `https://diaonline.supermercadosdia.com.ar/checkout/?orderFormId=${ID}#/cart`;

const anonymous = {
  orderFormId: ID,
  loggedIn: false,
  canEditData: true,
  userProfileId: null,
  userType: null,
  clientProfileData: null,
  items: [{ id: '1' }, { id: '2' }],
  value: 615000,
};

const identified = {
  ...anonymous,
  clientProfileData: {
    email: 'someone@example.com',
    firstName: 'Ana',
    document: '30123456',
    documentType: 'dni',
  },
};

/**
 * The same cart once a delivery has been picked, which is the state the
 * checkout now waits for before it quotes anything.
 *
 * `value` is 630000 against an Items totalizer of 615000: the difference is
 * the $150,00 envío, and the whole point of reading this document is that the
 * two numbers are not the same. `payableTotal` prefers `value`.
 *
 * The address carries a street and a postal code because a VTEX address
 * object exists before it is filled in and the classifier checks for a usable
 * one — a shell here would classify as `address` and never reach the slot.
 */
const slotted = {
  ...identified,
  totalizers: [
    { id: 'Items', name: 'Total de los produtos', value: 615000 },
    { id: 'Shipping', name: 'Total do frete', value: 15000 },
  ],
  value: 630000,
  shippingData: {
    address: { street: 'Av. Siempreviva', number: '742', postalCode: 'C1425' },
    logisticsInfo: [{ itemIndex: 0, selectedSla: 'Entrega Programada' }],
  },
  paymentData: { payments: [] },
};

/** Placed. `orderGroup` is the one unambiguous success signal in the document. */
const placed = { ...slotted, orderGroup: '1664787669574', items: [], value: 0 };

function stub(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as typeof fetch;
}

const probe = { retailer: 'dia', orderFormId: ID, itemsAtHandoff: 2 };

describe('reading a cart from outside it', () => {
  it('says nobody is attached to a fresh cart', async () => {
    const state = await readOrderForm(probe, stub(anonymous));
    assert.equal(state?.identified, false);
    assert.equal(state?.items, 2);
    assert.equal(state?.value, 615000);
    assert.equal(state?.state, 'profile');
  });

  it('RULE: a profile shell is not a signed-in shopper', async () => {
    // VTEX creates `clientProfileData` before it is filled in, so the old
    // `!== null` check read an empty object as somebody being logged in — and
    // `identified` is what the checkout waits on before it asks about the
    // delivery. An empty email is the classifier's own test, so the two
    // cannot disagree about what "signed in" means.
    const shell = { ...anonymous, clientProfileData: { email: '', firstName: null } };
    assert.equal((await readOrderForm(probe, stub(shell)))?.identified, false);
  });

  it('waits for the delivery, then reports the total with the envío in it', async () => {
    // The bug this whole reading exists to fix: `value` is the payable total
    // and the Items totalizer is not, and quoting the second one charges the
    // shopper for a basket with no flete in it.
    const before = await readOrderForm(probe, stub(identified));
    assert.equal(before?.slotChosen, false);
    assert.equal(before?.state, 'address');

    const after = await readOrderForm(probe, stub(slotted));
    assert.equal(after?.slotChosen, true);
    assert.equal(after?.payable, 630000);
    assert.deepEqual(after?.breakdown, [
      { id: 'Items', name: 'Total de los produtos', centavos: 615000 },
      { id: 'Shipping', name: 'Total do frete', centavos: 15000 },
    ]);
  });

  it('RULE: one unslotted group is enough to keep waiting', async () => {
    // Every group has to have a slot, not most of them. A cart split across
    // two deliveries quotes the second one's shipping only once it is picked.
    const half = {
      ...slotted,
      shippingData: {
        ...slotted.shippingData,
        logisticsInfo: [{ itemIndex: 0, selectedSla: 'Entrega Programada' }, { itemIndex: 1, selectedSla: null }],
      },
    };
    const state = await readOrderForm(probe, stub(half));
    assert.equal(state?.slotChosen, false);
    assert.equal(state?.state, 'shipping_slot');
  });

  it('RULE: no logistics groups at all is not a chosen delivery', async () => {
    // The store handing us nothing must never read as "settled" — that is the
    // dead-flow case, and it is what the escape hatch in the checkout covers.
    const none = { ...slotted, shippingData: { ...slotted.shippingData, logisticsInfo: [] } };
    assert.equal((await readOrderForm(probe, stub(none)))?.slotChosen, false);
  });

  it('carries the order id once the order exists', async () => {
    const state = await readOrderForm(probe, stub(placed));
    assert.equal(state?.orderGroup, '1664787669574');
    assert.equal(state?.state, 'confirmation');
    // orderGroup is real evidence, unlike the emptied-cart heuristic below.
    assert.equal(state?.looksPaid, true);
  });

  it('notices once a profile is attached', async () => {
    const state = await readOrderForm(probe, stub(identified));
    assert.equal(state?.identified, true);
  });

  it('RULE: the profile itself never comes back', async () => {
    const state = await readOrderForm(probe, stub(identified));
    // Verified by hand: this endpoint returns the email, the name and the DNI
    // unmasked to anyone holding the cart id. None of it may reach a caller,
    // a log or a receipt — `identified` is the entire answer.
    const serialised = JSON.stringify(state);
    for (const secret of ['someone@example.com', 'Ana', '30123456', 'dni']) {
      assert.equal(serialised.includes(secret), false, secret);
    }
    assert.deepEqual(
      Object.keys(state!).sort(),
      ['breakdown', 'identified', 'items', 'looksPaid', 'orderGroup', 'payable', 'slotChosen', 'state', 'value'],
    );
  });

  it('RULE: nothing about the address comes back either, and nor does the why', async () => {
    // The reading grew five fields when the checkout started quoting from it,
    // and two of them are the ones to watch. `breakdown` carries strings the
    // store wrote, so it is checked against a document that has an address in
    // it as well as a profile. And only `verdict.state` crosses out of here:
    // `why` embeds the orderGroup and `collectProblems` embeds store messages
    // and item names, neither of which anybody upstream asked for.
    const state = await readOrderForm(probe, stub(slotted));
    const serialised = JSON.stringify(state);
    for (const secret of ['someone@example.com', 'Ana', '30123456', 'Siempreviva', '742', 'C1425']) {
      assert.equal(serialised.includes(secret), false, secret);
    }
    // The state is one of a closed set of literals; it cannot carry anything
    // it was not built from.
    assert.equal(serialised.includes('selectedSla'), false);
    assert.equal(serialised.includes('confidence'), false);
    assert.equal(serialised.includes('layer'), false);
  });

  it('an emptied cart with a profile on it looks paid', async () => {
    const paid = { ...identified, items: [], value: 0 };
    assert.equal((await readOrderForm(probe, stub(paid)))?.looksPaid, true);
  });

  it('a still-full cart does not', async () => {
    assert.equal((await readOrderForm(probe, stub(identified)))?.looksPaid, false);
  });

  it('RULE: a cart that was empty to begin with never looks paid', async () => {
    const paid = { ...identified, items: [], value: 0 };
    const fromEmpty = await readOrderForm({ ...probe, itemsAtHandoff: 0 }, stub(paid));
    assert.equal(fromEmpty?.looksPaid, false);
  });

  it('RULE: an id nobody ever used does not look paid', async () => {
    // Checked against the real store: asking for a 32-hex id that was never
    // issued returns 200 with that id, zero items and a zero value. Without
    // the profile condition this exact body reads as a completed purchase,
    // which would write a receipt for an order that does not exist.
    const neverExisted = { ...anonymous, items: [], value: 0 };
    const state = await readOrderForm(probe, stub(neverExisted));
    assert.equal(state?.identified, false);
    assert.equal(state?.looksPaid, false);
  });

  it('returns null rather than throwing, for every way this can fail', async () => {
    const dead = (async () => {
      throw new Error('ECONNRESET');
    }) as typeof fetch;
    assert.equal(await readOrderForm(probe, dead), null);
    assert.equal(await readOrderForm(probe, stub({}, 404)), null);
    assert.equal(await readOrderForm(probe, stub('not an object')), null);
    assert.equal(await readOrderForm(probe, stub(null)), null);
    // A store we do not serve, and an id that is not one.
    assert.equal(await readOrderForm({ ...probe, retailer: 'coto' }, stub(anonymous)), null);
    assert.equal(await readOrderForm({ ...probe, orderFormId: '../../etc' }, stub(anonymous)), null);
    assert.equal(await readOrderForm({ ...probe, orderFormId: '' }, stub(anonymous)), null);
  });

  it('survives a body missing the fields it reads', async () => {
    const state = await readOrderForm(probe, stub({ orderFormId: ID }));
    assert.deepEqual(state, {
      identified: false,
      items: 0,
      value: 0,
      looksPaid: false,
      payable: 0,
      breakdown: [],
      slotChosen: false,
      orderGroup: null,
      state: 'empty_cart',
    });
  });
});

describe('the cart id in a handoff url', () => {
  it('finds it', () => {
    assert.equal(orderFormIdFrom(URL_WITH_ID), ID);
  });

  it('refuses anything that is not one', () => {
    for (const bad of [
      'not a url',
      'https://diaonline.supermercadosdia.com.ar/checkout',
      `https://diaonline.supermercadosdia.com.ar/checkout/?orderFormId=short`,
      `https://diaonline.supermercadosdia.com.ar/checkout/?orderFormId=${'z'.repeat(32)}`,
    ]) {
      assert.equal(orderFormIdFrom(bad), null, bad);
    }
  });
});
