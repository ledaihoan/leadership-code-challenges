import { FundingTxStatus } from '../db/models/fundingTransaction';

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: FundingTxStatus,
    public readonly to: FundingTxStatus,
  ) {
    super(`invalid funding transaction transition: ${from} -> ${to}`);
  }
}

// The only edges the state machine allows. Anything not listed here throws
const ALLOWED_TRANSITIONS: Record<FundingTxStatus, FundingTxStatus[]> = {
  Pending: ['Completed', 'Failed'],
  Completed: [],
  Failed: [],
};

export function assertTransition(from: FundingTxStatus, to: FundingTxStatus): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new InvalidTransitionError(from, to);
  }
}
