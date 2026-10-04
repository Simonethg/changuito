/**
 * Has the shopper's deposit landed?
 *
 * The matcher is pure and lives in `ledger/match.ts` — one implementation,
 * which is the one the tests pin. Fetching is the Stellar adapter: Horizon,
 * through `activeLedger()`, and that adapter holds no key. This file is the
 * facade those callers and those tests already import.
 */
import type { DepositAsset } from './deposit.ts';
import type { NetworkId } from './deployments.ts';
import { activeLedger } from './ledger/index.ts';

export type { DepositMatch, PaymentRecord } from './ledger/match.ts';
export { matchDeposit } from './ledger/match.ts';

/**
 * Re-exported, not re-declared. The implementation lives in lib/units.ts so a
 * client component can have it without @stellar/stellar-sdk coming too, and
 * this line is what keeps every existing caller, and the test that pins the
 * arithmetic, importing it from where it belongs.
 */
export { stroops } from './units.ts';

export async function findDeposit(
  net: NetworkId,
  want: { to: string; asset: DepositAsset; memo: string; minAmount: string },
  limit = 50,
) {
  return activeLedger().findDeposit(net, want, limit);
}
