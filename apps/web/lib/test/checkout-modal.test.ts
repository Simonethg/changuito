import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

/**
 * Read as text, not rendered.
 *
 * This suite is `node --experimental-strip-types --test` over `lib/test/*.ts`:
 * there is no DOM, no React renderer and no TSX in it, so a behavioural test
 * of CheckoutModal is not on the table here. What *is* on the table is pinning
 * the handful of lines inside it whose absence would be silent, and that is
 * worth more than it sounds — the precedent is
 * apps/landing/lib/test/brand-lockup.test.ts, which reads a page's source for
 * the same reason.
 *
 * Only facts that a regression would hide belong here. Everything about the
 * one-click payment either works or throws in the shopper's face, except the
 * memo — a payment sent without it succeeds on the ledger, takes real money,
 * and is then never matched to the basket it was for. There is no error, no
 * log and nothing to refund from, which is precisely why it is asserted on a
 * level this crude rather than left to a browser test that does not exist.
 */
const source = readFileSync(join(import.meta.dirname, '../../components/CheckoutModal.tsx'), 'utf8');

describe('the one-click deposit', () => {
  it('RULE: attaches the código to the payment as MEMO_TEXT', () => {
    // `matchDeposit` refuses anything whose `memo_type` is not `text` or whose
    // memo is not this exact string. Drop this and the poll waits for ever on
    // an importe that already left the shopper's account.
    assert.match(source, /options:\s*\{\s*memo:\s*\{\s*type:\s*'text',\s*value:\s*intent\.memo\s*\}\s*\}/);
  });

  it('RULE: pays only from a G… account', () => {
    // A passkey C-address pays by SAC transfer, which writes a contract event
    // and no classic payment record, so there would be nothing for the poll to
    // find. See the header's third bullet.
    assert.match(source, /address\?\.startsWith\('G'\)/);
  });

  it('RULE: one press, and the button stays down until the poll answers', () => {
    // Two payments for one código: the second is credited to nothing. The
    // guard is the disabled attribute *and* the early return, because a fast
    // double-click beats a re-render.
    assert.match(source, /disabled=\{walletPaying \|\| walletSent \|\| short\}/);
    assert.match(source, /if \(!intent \|\| !pay \|\| walletPaying \|\| walletSent\) return;/);
  });

  it('RULE: never prints a ledger error at the shopper', () => {
    // `details` / `resultCode` are `tx_bad_seq`-shaped. They go to the console;
    // the shopper reads `copy.walletPayError`.
    assert.match(source, /setWalletError\(copy\.walletPayError\)/);
    assert.doesNotMatch(source, /setWalletError\(outcome\./);
  });

  it('RULE: the address and the código show only where nothing can pay', () => {
    // This rule replaced its opposite, and the reason is worth keeping. They
    // used to survive one-click: demoted under the pay button and hidden only
    // once the wallet had actually paid, so that a shopper whose dollars were
    // on an exchange still had somewhere to send them. In front of a real
    // shopper that was two ways to send one importe with nothing saying which
    // counted. So the condition is now the absence of a button, not the
    // absence of a press — and where neither button exists an address is
    // still the difference between a slow payment and none.
    assert.match(source, /const showManual = !demoPays && !walletPays;/);
  });
});
