/**
 * Has the shopper's deposit landed?
 *
 * Horizon is the only source here, read straight from the public ledger. There
 * is no webhook to miss, no secret to hold and nothing to reconcile: the
 * payment either exists on the network or it does not, and anyone can check.
 *
 * The matcher is split from the fetch on purpose. Matching is where the money
 * bugs live — an off-by-one on the amount, a memo compared case-sensitively,
 * the wrong asset accepted because native has no issuer — and all of it is
 * pure arithmetic over records that can be written down in a test. The fetch
 * is the part that needs a network and has nothing to get wrong.
 */
import type { NetworkId } from './deployments.ts';
import type { DepositAsset } from './deposit.ts';
import { horizon } from './stellar.ts';
import { stroops } from './units.ts';

/**
 * Re-exported, not re-declared. The implementation moved to lib/units.ts so a
 * client component could have it without @stellar/stellar-sdk coming too —
 * see the header there — and this line is what keeps every existing caller,
 * and the test that pins the arithmetic, importing it from where it belongs.
 */
export { stroops };

/** The fields of a Horizon payment record this cares about, and no others. */
export interface PaymentRecord {
  type: string;
  to?: string;
  /**
   * Who paid. Not matched on — a deposit is identified by its memo, and
   * demanding a particular sender would strand every shopper whose dollars sit
   * on an exchange. It is carried because it is the only *evidence* of who paid
   * that cannot be claimed: see `DepositMatch.from`.
   */
  from?: string;
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
  amount?: string;
  transaction_hash?: string;
  created_at?: string;
  /** On the payment record itself, joined or not. */
  transaction_successful?: boolean;
  /**
   * Where `.join('transactions')` actually puts the joined transaction —
   * checked against live testnet Horizon on 2026-09-25, because the obvious
   * guess is wrong in a way that fails silently.
   *
   * `record.transaction` exists, but it is a **function**: the SDK's lazy
   * "go and fetch it" link, present whether or not you joined anything.
   * Reading `record.transaction.memo` off it yields `undefined`, no error and
   * no type complaint, so a matcher written against it rejects every deposit
   * that ever arrives while looking completely correct.
   */
  transaction_attr?: { memo?: string; memo_type?: string; successful?: boolean };
}

export interface DepositMatch {
  txHash: string;
  /** What actually arrived, as a decimal string. Not what was asked for. */
  amount: string;
  at: string;
  /**
   * The account the payment came from, as the ledger records it.
   *
   * Here because a signed-in shopper was refused a card for a deposit that had
   * genuinely landed: the row naming who opened the memo was missing, and that
   * row was the only thing `POST /api/card` would accept as proof of ownership.
   * The ledger had the answer the whole time, one field away from the amount
   * the route was already reading.
   *
   * It is better proof than the row, too. The row holds an address a caller
   * *claimed* and a signature vouched for minutes earlier; this is the account
   * that actually moved the money. Empty string when Horizon omits it, which a
   * caller must treat as "unknown" rather than as an address.
   */
  from: string;
}

/**
 * The first payment that satisfies every condition, or null.
 *
 * All five conditions are load-bearing:
 *
 * - **type** — only a `payment`. A `create_account` moves XLM too and its
 *   record spells the amount `starting_balance`, so accepting it would read
 *   `undefined` as the amount.
 * - **to** — paid *to* the deposit account. The same stream carries what the
 *   account sends out, and an outgoing payment carrying the shopper's memo is
 *   a refund, not a deposit.
 * - **asset** — exact. Native is matched by `asset_type`, because a native
 *   record carries no code and no issuer; anything else has to match both
 *   code and issuer. Code alone is not enough — "USDC" is a string anyone can
 *   issue, and an asset with the right code and a stranger's issuer is a
 *   different asset that happens to look like money.
 * - **memo** — exact, case-sensitive, `memo_type: 'text'`. The alphabet is
 *   uppercase-only (see deposit.ts) so a case-insensitive compare would only
 *   ever loosen it.
 * - **amount** — at least what was quoted. Compared in integer stroops rather
 *   than as floats: `0.1 + 0.2 > 0.3` is true in binary floating point, and a
 *   comparison that is wrong in the seventh decimal of somebody's money is
 *   not a rounding detail.
 *
 * A failed transaction never reaches here — Horizon only records operations of
 * successful ones — but `successful === false` is rejected anyway, because
 * relying on an upstream invariant we do not control costs one line to avoid.
 *
 * Every one of these was exercised against live testnet Horizon with a real
 * memo payment before it was written down; see lib/test/deposit-watch.test.ts,
 * whose fixture is that transaction's actual record.
 */
export function matchDeposit(
  records: readonly PaymentRecord[],
  want: { to: string; asset: DepositAsset; memo: string; minAmount: string },
): DepositMatch | null {
  const min = stroops(want.minAmount);
  if (min === null) return null;

  for (const r of records) {
    if (r.type !== 'payment') continue;
    if (r.to !== want.to) continue;
    if (r.transaction_successful === false || r.transaction_attr?.successful === false) continue;
    if (r.transaction_attr?.memo_type !== 'text' || r.transaction_attr.memo !== want.memo) continue;

    if (want.asset.issuer === null) {
      if (r.asset_type !== 'native') continue;
    } else if (r.asset_code !== want.asset.code || r.asset_issuer !== want.asset.issuer) {
      continue;
    }

    const got = stroops(r.amount ?? '');
    if (got === null || got < min) continue;

    return {
      txHash: r.transaction_hash ?? '',
      amount: r.amount ?? '0',
      at: r.created_at ?? '',
      from: r.from ?? '',
    };
  }
  return null;
}

/**
 * Ask Horizon. Newest first and capped, because a deposit is looked for within
 * minutes of being quoted and walking an operator account's whole history to
 * find it would get slower every day the account is used.
 */
export async function findDeposit(
  net: NetworkId,
  want: { to: string; asset: DepositAsset; memo: string; minAmount: string },
  limit = 50,
): Promise<DepositMatch | null> {
  // `.join('transactions')` is what puts the memo on the payment record. The
  // memo lives on the transaction, not the operation, so without it every
  // candidate would cost a second round trip to read one string.
  const page = await horizon(net)
    .payments()
    .forAccount(want.to)
    .join('transactions')
    .order('desc')
    .limit(limit)
    .call();

  return matchDeposit(page.records as unknown as PaymentRecord[], want);
}
