import { sequelize } from '../db/sequelize';
import { FundingTransaction, PspCallbackEvent, Wallet, WalletTx } from '../db/models';
import { FundingTxStatus } from '../db/models/fundingTransaction';
import { PspCallbackOutcome } from '../db/models/pspCallbackEvent';
import { dec } from '../lib/money';
import { assertTransition } from './fundingTransactionStateMachine';

export type PspCallbackInput = {
  pspRef: string;
  status: 'completed' | 'failed';
  amount: string;
};

export type PspCallbackResult = {
  outcome: PspCallbackOutcome;
};

// Lock order is always funding_tx -> wallet. Every code path that needs both
// rows (this one, and eventually withdrawal approval) must take them in this
// order or a concurrent callback + wager pair can deadlock.
export async function handlePspCallback(input: PspCallbackInput): Promise<PspCallbackResult> {
  return sequelize.transaction(async (t) => {
    const tx = await FundingTransaction.findOne({
      where: { pspRef: input.pspRef },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!tx) {
      // Unknown pspRef: never seen it, or it belongs to another environment.
      // 200 so the PSP stops retrying a callback we will never be able to match.
      await PspCallbackEvent.create(
        { pspRef: input.pspRef, fundingTxId: null, outcome: 'orphan', payload: input },
        { transaction: t },
      );
      return { outcome: 'orphan' };
    }

    if (tx.status !== 'Pending') {
      // Same status again is a retry; the opposite one is the PSP
      // contradicting its own earlier report.
      const target: FundingTxStatus = input.status === 'completed' ? 'Completed' : 'Failed';
      const outcome: PspCallbackOutcome =
        tx.status === target ? 'duplicate' : 'invalid_transition';
      await PspCallbackEvent.create(
        { pspRef: input.pspRef, fundingTxId: tx.id, outcome, payload: input },
        { transaction: t },
      );
      return { outcome };
    }

    if (input.status === 'failed') {
      assertTransition(tx.status, 'Failed');
      tx.status = 'Failed';
      await tx.save({ transaction: t });
      await PspCallbackEvent.create(
        { pspRef: input.pspRef, fundingTxId: tx.id, outcome: 'applied', payload: input },
        { transaction: t },
      );
      return { outcome: 'applied' };
    }

    const amountMatches = dec(input.amount).isEqualTo(dec(tx.amount));
    if (!amountMatches) {
      // Policy: mismatch = hold. We never credit a figure the deposit record didn't promise
      tx.amountMismatch = true;
      await tx.save({ transaction: t });
      await PspCallbackEvent.create(
        { pspRef: input.pspRef, fundingTxId: tx.id, outcome: 'applied_mismatch', payload: input },
        { transaction: t },
      );
      return { outcome: 'applied_mismatch' };
    }

    // FK guarantees the wallet exists; missing means corrupted DB, let it 500.
    const wallet = await Wallet.findOne({
      where: { id: tx.walletId },
      transaction: t,
      lock: t.LOCK.UPDATE,
      rejectOnEmpty: new Error(`wallet ${tx.walletId} not found for funding tx ${tx.id}`),
    });

    assertTransition(tx.status, 'Completed');

    const newBalance = dec(wallet.balance).plus(dec(tx.amount));
    const turnoverDelta = dec(tx.amount).times(tx.turnoverMultiplier);

    // Ledger write before the balance/status mutations it explains; the unique index on (funding_tx_id, kind) is the
    // DB-level backstop against a double credit if this code path is ever reached twice regardless.
    await WalletTx.create(
      {
        walletId: wallet.id,
        fundingTxId: tx.id,
        kind: 'deposit_credit',
        amount: tx.amount,
        balanceAfter: newBalance.toString(),
      },
      { transaction: t },
    );

    wallet.balance = newBalance.toString();
    wallet.turnoverRequired = dec(wallet.turnoverRequired).plus(turnoverDelta).toString();
    await wallet.save({ transaction: t });

    tx.status = 'Completed';
    tx.creditedAmount = tx.amount;
    await tx.save({ transaction: t });

    await PspCallbackEvent.create(
      { pspRef: input.pspRef, fundingTxId: tx.id, outcome: 'applied', payload: input },
      { transaction: t },
    );

    return { outcome: 'applied' };
  });
}
