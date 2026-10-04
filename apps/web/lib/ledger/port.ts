/**
 * What a deposit needs from a chain, and nothing the chain needs from us.
 *
 * The use case quotes a total the store already computed, then asks whether a
 * payment carrying that memo has landed. The amount it gets back is the amount
 * that landed. Which chain holds the USDC is this interface's problem to hide:
 * today that is a classic Stellar payment, and the adapter in `stellar.ts` is
 * the only one wired. It holds no signing key — a deposit address receives,
 * it does not spend.
 */
import type { NetworkId } from '../deployments.ts';
import type { DepositAsset } from '../deposit.ts';
import type { DepositMatch } from './match.ts';

export interface LedgerQuery {
  to: string;
  asset: DepositAsset;
  memo: string;
  minAmount: string;
}

export interface Ledger {
  /** Where a deposit is paid. Null when this deployment cannot take one. */
  receiveAddress(net: NetworkId, env?: NodeJS.ProcessEnv): string | null;
  /** The asset a deposit on this network is denominated in. */
  asset(net: NetworkId): DepositAsset;
  /**
   * The first payment that matches, or null when none has landed.
   *
   * `DepositMatch.amount` is what arrived, never `minAmount`. A caller that
   * funds a card reads that field and no figure the browser sent.
   */
  findDeposit(net: NetworkId, want: LedgerQuery, limit?: number): Promise<DepositMatch | null>;
}
