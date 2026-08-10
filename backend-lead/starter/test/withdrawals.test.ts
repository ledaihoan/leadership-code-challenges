import { randomUUID } from 'crypto';
import request from 'supertest';
import { createApp } from '../src/app';
import { sequelize } from '../src/db/sequelize';
import '../src/db/models';
import { FundingTransaction, WalletTx } from '../src/db/models';
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

async function createWallet() {
  const { member, wallet } = await memberService.createMember(`m_${randomUUID().slice(0, 8)}`);
  return { memberId: member.id, wallet };
}

async function fund(memberId: string, amount: string, turnoverMultiplier: number) {
  const tx = await depositService.createDeposit({ memberId, amount, turnoverMultiplier });
  await request(app)
    .post('/psp/callbacks')
    .send({ pspRef: tx.pspRef, status: 'completed', amount });
}

function wager(walletId: string, amount: string) {
  return request(app).post(`/wallets/${walletId}/wagers`).send({ amount });
}

function withdraw(memberId: string, amount: string) {
  return request(app).post('/withdrawals').send({ memberId, amount });
}

describe('POST /withdrawals', () => {
  it('blocks while turnover is outstanding, then unblocks after enough wagering', async () => {
    const { memberId, wallet } = await createWallet();
    await fund(memberId, '100.00', 1);
    await fund(memberId, '100.00', 0);

    const blocked = await withdraw(memberId, '50.00');
    expect(blocked.status).toBe(422);
    expect(blocked.body.error).toBe('turnover_not_met');
    expect(blocked.body.outstandingTurnover).toBe('100.000000000000000000');

    await wager(wallet.id, '60.00');
    const stillBlocked = await withdraw(memberId, '50.00');
    expect(stillBlocked.status).toBe(422);
    expect(stillBlocked.body.outstandingTurnover).toBe('40.000000000000000000');

    await wager(wallet.id, '40.00');
    const ok = await withdraw(memberId, '50.00');
    expect(ok.status).toBe(201);
    expect(ok.body.status).toBe('Pending');
    expect(ok.body.balance).toBe('50.000000000000000000');

    const tx = await FundingTransaction.findByPk(ok.body.transactionId);
    expect(tx!.type).toBe('withdrawal');
    expect(tx!.status).toBe('Pending');
    expect(tx!.pspRef).toBeNull();

    const rows = await WalletTx.findAll({ where: { kind: 'withdrawal_debit' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe('-50.000000000000000000');
    expect(rows[0].fundingTxId).toBe(ok.body.transactionId);
  });

  it('rejects an over-balance withdrawal even when turnover is met', async () => {
    const { memberId } = await createWallet();
    await fund(memberId, '100.00', 0);

    const res = await withdraw(memberId, '150.00');

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('insufficient_balance');
    expect(await FundingTransaction.count({ where: { type: 'withdrawal' } })).toBe(0);
  });

  it('returns 404 for an unknown member', async () => {
    const res = await withdraw('00000000-0000-4000-8000-000000000000', '10.00');
    expect(res.status).toBe(404);
  });

  it('rejects invalid amounts', async () => {
    const { memberId } = await createWallet();
    for (const amount of ['0', '-5', 'abc']) {
      expect((await withdraw(memberId, amount)).status).toBe(400);
    }
  });
});
