import { randomUUID } from 'crypto';
import request from 'supertest';
import { createApp } from '../src/app';
import { sequelize } from '../src/db/sequelize';
import '../src/db/models';
import { Wallet, WalletTx } from '../src/db/models';
import { dec, ZERO } from '../src/lib/money';
import * as memberService from '../src/services/memberService';
import * as depositService from '../src/services/depositService';

const app = createApp();

beforeAll(async () => {
  await sequelize.authenticate();
});

beforeEach(async () => {
  await sequelize.truncate({ cascade: true });
});

afterAll(async () => {
  await sequelize.close();
});

describe('ledger', () => {
  it('reconstructs the wallet balance from the ledger after a mixed flow', async () => {
    const { member, wallet } = await memberService.createMember(`m_${randomUUID().slice(0, 8)}`);
    const fund = async (amount: string, turnoverMultiplier: number) => {
      const tx = await depositService.createDeposit({
        memberId: member.id,
        amount,
        turnoverMultiplier,
      });
      await request(app)
        .post('/psp/callbacks')
        .send({ pspRef: tx.pspRef, status: 'completed', amount });
    };

    await fund('100.00', 1);
    await fund('50.00', 0);
    await request(app).post(`/wallets/${wallet.id}/wagers`).send({ amount: '40.00' });
    await request(app).post(`/wallets/${wallet.id}/wagers`).send({ amount: '60.00' });
    await request(app).post('/withdrawals').send({ memberId: member.id, amount: '20.00' });

    const freshWallet = await Wallet.findByPk(wallet.id);
    expect(freshWallet!.balance).toBe('30.000000000000000000');

    const rows = await WalletTx.findAll({
      where: { walletId: wallet.id },
      order: [['createdAt', 'ASC']],
    });
    expect(rows).toHaveLength(5);

    // Invariant: every balance_after is the running ledger sum, and the final
    // sum is the cached balance.
    let running = ZERO;
    for (const row of rows) {
      running = running.plus(dec(row.amount));
      expect(dec(row.balanceAfter).isEqualTo(running)).toBe(true);
    }
    expect(running.toFixed(18)).toBe(freshWallet!.balance);
  });
});
