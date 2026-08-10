import { sequelize } from '../db/sequelize';
import { Wallet, WalletTx } from '../db/models';
import { dec } from '../lib/money';

export class InsufficientBalanceError extends Error {
  constructor(
    public readonly balance: string,
    public readonly requested: string,
  ) {
    super(`insufficient balance: have ${balance}, requested ${requested}`);
  }
}

export type WagerResult = {
  balance: string;
  turnoverAccrued: string;
};

export async function placeWager(walletId: string, amount: string): Promise<WagerResult> {
  return sequelize.transaction(async (t) => {
    // Wallet row lock serializes all money movement.
    const wallet = await Wallet.findOne({
      where: { id: walletId },
      transaction: t,
      lock: t.LOCK.UPDATE,
      rejectOnEmpty: true,
    });

    const wager = dec(amount);
    // Reject before any write.
    if (dec(wallet.balance).isLessThan(wager)) {
      throw new InsufficientBalanceError(wallet.balance, amount);
    }

    const newBalance = dec(wallet.balance).minus(wager).toFixed(18);
    await WalletTx.create(
      {
        walletId: wallet.id,
        kind: 'wager_debit',
        amount: wager.negated().toFixed(18),
        balanceAfter: newBalance,
      },
      { transaction: t },
    );

    wallet.balance = newBalance;
    wallet.turnoverAccrued = dec(wallet.turnoverAccrued).plus(wager).toFixed(18);
    await wallet.save({ transaction: t });

    return { balance: wallet.balance, turnoverAccrued: wallet.turnoverAccrued };
  });
}
