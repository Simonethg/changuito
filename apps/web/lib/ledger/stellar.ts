/**
 * The Stellar adapter. A classic payment to an operator account, matched by
 * memo, confirmed by reading Horizon. No contract, and no secret: this file
 * cannot move money.
 *
 * The dormant Soroban escrow is not this adapter. Settling that contract is a
 * different question, and it is not on the rail.
 */
import { depositAddress, depositAsset } from '../deposit.ts';
import type { NetworkId } from '../deployments.ts';
import { horizon } from '../stellar.ts';
import { matchDeposit, type PaymentRecord } from './match.ts';
import type { Ledger, LedgerQuery } from './port.ts';

export const stellarLedger: Ledger = {
  receiveAddress(net: NetworkId, env?: NodeJS.ProcessEnv): string | null {
    return depositAddress(net, env);
  },

  asset(net: NetworkId) {
    return depositAsset(net);
  },

  /**
   * Newest first and capped, because a deposit is looked for within minutes of
   * being quoted and walking an operator account's whole history to find it
   * would get slower every day the account is used.
   *
   * `.join('transactions')` is what puts the memo on the payment record. The
   * memo lives on the transaction, not the operation, so without it every
   * candidate would cost a second round trip to read one string.
   */
  async findDeposit(net: NetworkId, want: LedgerQuery, limit = 50) {
    const page = await horizon(net)
      .payments()
      .forAccount(want.to)
      .join('transactions')
      .order('desc')
      .limit(limit)
      .call();

    return matchDeposit(page.records as unknown as PaymentRecord[], want);
  },
};
