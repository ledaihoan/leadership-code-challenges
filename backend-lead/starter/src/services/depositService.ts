import { randomUUID } from 'crypto';
import { FundingTransaction, Wallet } from '../db/models';

export async function createDeposit(input: {
  memberId: string;
  amount: string;
  turnoverMultiplier: number;
}): Promise<FundingTransaction> {
  const wallet = await Wallet.findOne({ where: { memberId: input.memberId }, rejectOnEmpty: true });
  // Single insert, no money moves. The pspRef is ours; the PSP echoes it back.
  return FundingTransaction.create({
    walletId: wallet.id,
    type: 'deposit',
    status: 'Pending',
    amount: input.amount,
    turnoverMultiplier: input.turnoverMultiplier,
    pspRef: `psp_${randomUUID()}`,
  });
}
