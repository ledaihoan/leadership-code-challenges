import { sequelize } from '../db/sequelize';
import { FundingTransaction, Wallet, WalletTx } from '../db/models';
import { dec } from '../lib/money';
import { InsufficientBalanceError } from './wagerService';

export class TurnoverNotMetError extends Error {
  constructor(
    public readonly requiredTurnover: string,
    public readonly accruedTurnover: string,
    public readonly outstandingTurnover: string,
  ) {
    super(`turnover not met: ${outstandingTurnover} outstanding`);
  }
}

export type WithdrawalResult = {
  transactionId: string;
  status: string;
  balance: string;
};

export async function createWithdrawal(memberId: string, amount: string): Promise<WithdrawalResult> {
  return sequelize.transaction(async (t) => {
    const wallet = await Wallet.findOne({
      where: { memberId },
      transaction: t,
      lock: t.LOCK.UPDATE,
      rejectOnEmpty: true,
    });

    // Gate order: turnover first, then balance.
    const outstanding = dec(wallet.turnoverRequired).minus(dec(wallet.turnoverAccrued));
    if (outstanding.isGreaterThan(0)) {
      throw new TurnoverNotMetError(
        wallet.turnoverRequired,
        wallet.turnoverAccrued,
        outstanding.toFixed(18),
      );
    }

    const requested = dec(amount);
    if (dec(wallet.balance).isLessThan(requested)) {
      throw new InsufficientBalanceError(wallet.balance, amount);
    }

    const newBalance = dec(wallet.balance).minus(requested).toFixed(18);
    const tx = await FundingTransaction.create(
      {
        walletId: wallet.id,
        type: 'withdrawal',
        status: 'Pending',
        amount,
        turnoverMultiplier: 0,
      },
      { transaction: t },
    );
    await WalletTx.create(
      {
        walletId: wallet.id,
        fundingTxId: tx.id,
        kind: 'withdrawal_debit',
        amount: requested.negated().toFixed(18),
        balanceAfter: newBalance,
      },
      { transaction: t },
    );

    wallet.balance = newBalance;
    await wallet.save({ transaction: t });

    return { transactionId: tx.id, status: tx.status, balance: wallet.balance };
  });
}
