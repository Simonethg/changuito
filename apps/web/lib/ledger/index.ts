/**
 * The ledger this deployment charges against.
 *
 * One adapter. A second chain replaces the value returned here; the quote and
 * the card keep calling `activeLedger()` and do not import a chain SDK.
 */
import type { Ledger } from './port.ts';
import { stellarLedger } from './stellar.ts';

export function activeLedger(): Ledger {
  return stellarLedger;
}

export type { DepositMatch, PaymentRecord } from './match.ts';
export type { Ledger, LedgerQuery } from './port.ts';
