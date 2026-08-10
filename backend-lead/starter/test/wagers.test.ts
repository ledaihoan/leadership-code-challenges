import { randomUUID } from 'crypto';
import request from 'supertest';
import { createApp } from '../src/app';
import { sequelize } from '../src/db/sequelize';
import '../src/db/models';
import { Wallet, WalletTx } from '../src/db/models';
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

async function fundedWallet(amount = '100.00') {
  const { member, wallet } = await memberService.createMember(`m_${randomUUID().slice(0, 8)}`);
  const tx = await depositService.createDeposit({
    memberId: member.id,
    amount,
    turnoverMultiplier: 0,
  });
  await request(app)
    .post('/psp/callbacks')
    .send({ pspRef: tx.pspRef, status: 'completed', amount });
  return { wallet };
}

function wager(walletId: string, amount: string) {
  return request(app).post(`/wallets/${walletId}/wagers`).send({ amount });
}

describe('POST /wallets/:walletId/wagers', () => {
  it('debits the wallet, accrues turnover and writes a ledger row', async () => {
    const { wallet } = await fundedWallet('100.00');

    const res = await wager(wallet.id, '30.00');

    expect(res.status).toBe(201);
    expect(res.body.balance).toBe('70.000000000000000000');
    expect(res.body.turnoverAccrued).toBe('30.000000000000000000');

    const freshWallet = await Wallet.findByPk(wallet.id);
    expect(freshWallet!.balance).toBe('70.000000000000000000');
    expect(freshWallet!.turnoverAccrued).toBe('30.000000000000000000');

    const rows = await WalletTx.findAll({ where: { walletId: wallet.id, kind: 'wager_debit' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe('-30.000000000000000000');
    expect(rows[0].balanceAfter).toBe('70.000000000000000000');
  });

  it('rejects a wager over the balance and changes nothing', async () => {
    const { wallet } = await fundedWallet('20.00');

    const res = await wager(wallet.id, '30.00');

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('insufficient_balance');

    const freshWallet = await Wallet.findByPk(wallet.id);
    expect(freshWallet!.balance).toBe('20.000000000000000000');
    expect(freshWallet!.turnoverAccrued).toBe('0.000000000000000000');
    expect(await WalletTx.count({ where: { kind: 'wager_debit' } })).toBe(0);
  });

  it('does not overdraw the wallet under concurrent wagers', async () => {
    const { wallet } = await fundedWallet('100.00');

    const results = await Promise.all([
      wager(wallet.id, '30.00'),
      wager(wallet.id, '30.00'),
      wager(wallet.id, '30.00'),
      wager(wallet.id, '30.00'),
      wager(wallet.id, '30.00'),
    ]);

    const succeeded = results.filter((r) => r.status === 201);
    const rejected = results.filter((r) => r.status === 422);
    expect(succeeded).toHaveLength(3);
    expect(rejected).toHaveLength(2);

    const freshWallet = await Wallet.findByPk(wallet.id);
    expect(freshWallet!.balance).toBe('10.000000000000000000');
    expect(freshWallet!.turnoverAccrued).toBe('90.000000000000000000');
    expect(await WalletTx.count({ where: { kind: 'wager_debit' } })).toBe(3);
  });

  it('keeps exact precision at the smallest representable unit', async () => {
    const { wallet } = await fundedWallet('0.000000000000000003');

    const first = await wager(wallet.id, '0.000000000000000001');
    const second = await wager(wallet.id, '0.000000000000000001');

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.balance).toBe('0.000000000000000001');
    expect(second.body.turnoverAccrued).toBe('0.000000000000000002');

    const freshWallet = await Wallet.findByPk(wallet.id);
    expect(freshWallet!.balance).toBe('0.000000000000000001');
    expect(freshWallet!.turnoverAccrued).toBe('0.000000000000000002');

    const rows = await WalletTx.findAll({ where: { walletId: wallet.id, kind: 'wager_debit' } });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.amount).toBe('-0.000000000000000001');
    }
  });

  it('rejects an overdraw by a single smallest unit', async () => {
    const { wallet } = await fundedWallet('0.000000000000000001');

    const res = await wager(wallet.id, '0.000000000000000002');

    expect(res.status).toBe(422);
    const freshWallet = await Wallet.findByPk(wallet.id);
    expect(freshWallet!.balance).toBe('0.000000000000000001');
  });

  it('carries correctly across a run of trailing nines', async () => {
    const { wallet } = await fundedWallet('99.999999999999999999');

    const res = await wager(wallet.id, '99.999999999999999998');

    expect(res.status).toBe(201);
    expect(res.body.balance).toBe('0.000000000000000001');

    const freshWallet = await Wallet.findByPk(wallet.id);
    expect(freshWallet!.balance).toBe('0.000000000000000001');
    expect(freshWallet!.turnoverAccrued).toBe('99.999999999999999998');
  });

  it('returns 404 for an unknown wallet', async () => {
    const res = await wager('00000000-0000-4000-8000-000000000000', '10.00');
    expect(res.status).toBe(404);
  });

  it('rejects invalid amounts', async () => {
    const { wallet } = await fundedWallet('50.00');
    for (const amount of ['0', '-5', 'abc']) {
      const res = await wager(wallet.id, amount);
      expect(res.status).toBe(400);
    }
  });
});
