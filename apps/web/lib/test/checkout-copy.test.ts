import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CHECKOUT_MODES, checkoutCopy } from '../checkout-copy.ts';

/** The same list mode-copy.test.ts enforces. Two files, one rule. */
const FORBIDDEN =
  /\b(testnet|mainnet|blockchain|wallet|billetera virtual|on-chain|cripto|crypto|web3|defi|stellar|soroban|mcp|escrow|smart ?contract)\b/i;

const every = CHECKOUT_MODES.flatMap((m) => Object.values(m));

describe('checkout copy', () => {
  it('RULE: never names a network, a chain or a wallet', () => {
    for (const text of every) assert.doesNotMatch(text, FORBIDDEN, `forbidden word in: ${text}`);
  });

  it('speaks voseo, never tuteo', () => {
    const all = every.join(' ');
    assert.match(all, /mandá|pagaste|seguí|Escribinos/i);
    assert.doesNotMatch(all, /\b(puedes|tienes|tú|envía|sigue|escríbenos)\b/i);
  });

  it('RULE: says a refund is manual, in the mode where the money is real', () => {
    // There is no outbound payment path in this deployment and no key to sign
    // one with. Copy that implied otherwise would be a promise nothing keeps.
    assert.match(checkoutCopy('mainnet').refundNote, /a mano/);
    assert.match(checkoutCopy('mainnet').failed, /a mano/);
  });

  it('RULE: says plainly, in test mode, that nothing real moves', () => {
    assert.match(checkoutCopy('testnet').refundNote, /no se mueve plata real/i);
    assert.match(checkoutCopy('testnet').depositLead, /prueba/i);
  });

  it('RULE: never claims the payment itself was confirmed', () => {
    // The store's public API cannot show us an order. All it shows is that
    // the cart closed, so that is all the words are allowed to say.
    for (const m of CHECKOUT_MODES) {
      assert.doesNotMatch(m.verified, /confirmamos tu pago|pago confirmado/i);
      assert.match(m.verified, /changuito se cerró/);
    }
  });

  it('RULE: not-verified never reads as not-paid', () => {
    for (const m of CHECKOUT_MODES) {
      assert.doesNotMatch(m.unverified, /no pagaste|no se pagó/i);
      assert.match(m.unverified, /Si ya pagaste/);
    }
  });

  it('RULE: the tab is an equal path, not a failure', () => {
    for (const m of CHECKOUT_MODES) {
      assert.doesNotMatch(m.openTabNote, /error|falló|no funciona\b/i);
      assert.match(m.openTabNote, /Funciona igual/);
    }
  });

  it('says the memo is not optional', () => {
    for (const m of CHECKOUT_MODES) assert.match(m.memoNote, /sí o sí/);
  });

  it('RULE: the one-button words exist only where the shopper has a balance', () => {
    // Preview has no session, so no saldo of the shopper's own to spend — the
    // demo wallet pays there and says so. Offering "pagar con mis dólares" to
    // somebody who has none would be a button about money that is not theirs.
    assert.equal(checkoutCopy('testnet').walletPayCta, '');
    assert.equal(checkoutCopy('testnet').walletPayLead, '');
    assert.equal(checkoutCopy('mainnet').demoPayCta, '');
    assert.match(checkoutCopy('mainnet').walletPayCta, /mis dólares/);
  });

  it('RULE: the button is the only instruction where there is a button', () => {
    // This rule replaced its opposite. The address and the código used to sit
    // under the pay button with "O mandalo vos…" introducing them, offered as
    // a second way for a shopper whose dollars are on an exchange. On screen
    // it read as two competing instructions for one importe, so the manual
    // path is now shown only where nothing can pay at all — and the sentence
    // that introduced it has no job left, which is why `walletPayNote` is
    // gone rather than blanked. See `showManual` in CheckoutModal.
    const real = checkoutCopy('mainnet');
    assert.equal('walletPayNote' in real, false);
    // And the lead above the button is now true. It has always said "no hay
    // nada que copiar" while an address and a código sat directly underneath
    // it; taking them out is what makes that sentence honest, so it is pinned
    // here rather than left to be read as boilerplate.
    assert.match(real.walletPayLead, /saldo/);
    assert.match(real.walletPayLead, /nada que copiar/);
  });

  it('RULE: a short balance is said before the press, and points nowhere false', () => {
    // There is no funding control in this dialog, so "cargá dólares arriba"
    // would send them looking for a button that is not on the screen.
    const short = checkoutCopy('mainnet').walletPayShort;
    assert.match(short, /No te alcanza/);
    assert.doesNotMatch(short, /arriba|acá/i);
  });
});

describe('the single-use card', () => {
  it('RULE: is offered as an alternative, never as the only way to pay', () => {
    // The frame is the store's own checkout and takes the shopper's own card
    // for free. A deployment without a card provider still works, so the copy
    // has to read the same way the code behaves.
    for (const m of CHECKOUT_MODES) {
      assert.match(m.cardLead, /tu tarjeta de siempre/);
      // The reason line changes with the failure; this one never does, which
      // is what stops a card failure reading as a dead end.
      assert.match(m.cardFallback, /Podés pagar con la tuya/);
    }
  });

  it('RULE: says the numbers are not kept', () => {
    // They live in React state for the length of the dialog and nowhere else.
    // If that ever changes, this sentence becomes a lie and this test is where
    // it gets caught. lib/card-store.ts writes four digits and an id, which
    // is not "la tarjeta" and is the reason that file has a validator rather
    // than a serializer.
    for (const m of CHECKOUT_MODES) assert.match(m.cardNote, /No la guardamos/);
  });

  it('RULE: only the mode where the card dies says it dies with the window', () => {
    // In production there is one card per customer and it is topped up, so
    // "cuando cerrás esta ventana, la tarjeta se cierra con ella" would be
    // false — and false in the direction that matters, because a shopper who
    // believes it will not think to come back to a card that still has money.
    assert.match(checkoutCopy('testnet').cardNote, /se cierra con ella/);
    assert.doesNotMatch(checkoutCopy('mainnet').cardNote, /se cierra/);
  });

  it('RULE: the returning-customer words exist only where a card is kept', () => {
    // Empty in the test mode, and the panel keys off that emptiness rather
    // than off the network — so a mode with nothing to come back to cannot
    // render a sentence about a card it no longer has.
    assert.equal(checkoutCopy('testnet').cardAgainCta, '');
    assert.equal(checkoutCopy('testnet').cardAgainLead, '');
    assert.match(checkoutCopy('mainnet').cardAgainCta, /tarjeta/i);
    assert.match(checkoutCopy('mainnet').cardAgainLead, /misma/i);
  });

  it('RULE: a kept card is described by its balance, not by this basket', () => {
    // It can carry change from the last shop, so "justo el importe de esta
    // compra" would be wrong about the one number on screen.
    assert.match(checkoutCopy('testnet').cardFunded, /justo el importe de esta compra/);
    assert.match(checkoutCopy('mainnet').cardFunded, /saldo que tiene ahora/);
  });
});
