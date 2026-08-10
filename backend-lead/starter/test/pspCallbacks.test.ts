import { randomUUID } from 'crypto';
import request from 'supertest';
import { createApp } from '../src/app';
import { sequelize } from '../src/db/sequelize';
import '../src/db/models';
import { FundingTransaction, PspCallbackEvent, Wallet, WalletTx } from '../src/db/models';
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

async function pendingDeposit(amount = '100.50', turnoverMultiplier = 1) {
  const { member, wallet } = await memberService.createMember(`m_${randomUUID().slice(0, 8)}`);
  const tx = await depositService.createDeposit({ memberId: member.id, amount, turnoverMultiplier });
  return { wallet, tx };
}

describe('POST /psp/callbacks', () => {
  it('does not double-credit when the same completed callback is delivered twice sequentially', async () => {
    const { wallet, tx } = await pendingDeposit('100.50');

    const first = await request(app)
      .post('/psp/callbacks')
      .send({ pspRef: tx.pspRef, status: 'completed', amount: '100.50' });
    expect(first.status).toBe(200);
    expect(first.body.outcome).toBe('applied');

    const second = await request(app)
      .post('/psp/callbacks')
      .send({ pspRef: tx.pspRef, status: 'completed', amount: '100.50' });
    expect(second.status).toBe(200);
    expect(second.body.outcome).toBe('duplicate');

    const freshWallet = await Wallet.findByPk(wallet.id);
    expect(freshWallet!.balance).toBe('100.500000000000000000');

    const credits = await WalletTx.count({ where: { walletId: wallet.id, kind: 'deposit_credit' } });
    expect(credits).toBe(1);

    const freshTx = await FundingTransaction.findByPk(tx.id);
    expect(freshTx!.status).toBe('Completed');
  });

  it('does not double-credit when the same completed callback arrives concurrently', async () => {
    const { wallet, tx } = await pendingDeposit('75.00');
    const payload = { pspRef: tx.pspRef, status: 'completed', amount: '75.00' };

    const [resA, resB] = await Promise.all([
      request(app).post('/psp/callbacks').send(payload),
      request(app).post('/psp/callbacks').send(payload),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    const outcomes = [resA.body.outcome, resB.body.outcome].sort();
    expect(outcomes).toEqual(['applied', 'duplicate']);

    const freshWallet = await Wallet.findByPk(wallet.id);
    expect(freshWallet!.balance).toBe('75.000000000000000000');

    const credits = await WalletTx.count({ where: { walletId: wallet.id, kind: 'deposit_credit' } });
    expect(credits).toBe(1);
  });

  it('returns 200 and logs an orphan event for an unknown pspRef', async () => {
    const res = await request(app)
      .post('/psp/callbacks')
      .send({ pspRef: 'psp_unknown_ref', status: 'completed', amount: '10.00' });

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('orphan');
  });

  it('transitions Pending -> Failed on a failed callback without touching the wallet', async () => {
    const { wallet, tx } = await pendingDeposit('40.00');

    const res = await request(app)
      .post('/psp/callbacks')
      .send({ pspRef: tx.pspRef, status: 'failed', amount: '40.00' });

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('applied');

    const freshTx = await FundingTransaction.findByPk(tx.id);
    expect(freshTx!.status).toBe('Failed');

    const freshWallet = await Wallet.findByPk(wallet.id);
    expect(freshWallet!.balance).toBe('0.000000000000000000');
  });

  it('flags a completed callback for an already-Failed transaction as invalid_transition', async () => {
    const { wallet, tx } = await pendingDeposit('30.00');

    await request(app)
      .post('/psp/callbacks')
      .send({ pspRef: tx.pspRef, status: 'failed', amount: '30.00' });

    const res = await request(app)
      .post('/psp/callbacks')
      .send({ pspRef: tx.pspRef, status: 'completed', amount: '30.00' });

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('invalid_transition');

    const freshTx = await FundingTransaction.findByPk(tx.id);
    expect(freshTx!.status).toBe('Failed');

    const freshWallet = await Wallet.findByPk(wallet.id);
    expect(freshWallet!.balance).toBe('0.000000000000000000');

    const events = await PspCallbackEvent.count({
      where: { fundingTxId: tx.id, outcome: 'invalid_transition' },
    });
    expect(events).toBe(1);
  });

  it('holds (does not credit) a completed callback whose amount mismatches the deposit', async () => {
    const { wallet, tx } = await pendingDeposit('50.00');

    const res = await request(app)
      .post('/psp/callbacks')
      .send({ pspRef: tx.pspRef, status: 'completed', amount: '49.99' });

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('applied_mismatch');

    const freshTx = await FundingTransaction.findByPk(tx.id);
    expect(freshTx!.status).toBe('Pending');
    expect(freshTx!.amountMismatch).toBe(true);

    const freshWallet = await Wallet.findByPk(wallet.id);
    expect(freshWallet!.balance).toBe('0.000000000000000000');

    const credits = await WalletTx.count({ where: { walletId: wallet.id, kind: 'deposit_credit' } });
    expect(credits).toBe(0);
  });

  it('accrues turnover requirement by amount x multiplier on a completed deposit', async () => {
    const { wallet, tx } = await pendingDeposit('20.00', 3);

    await request(app).post('/psp/callbacks').send({ pspRef: tx.pspRef, status: 'completed', amount: '20.00' });

    const freshWallet = await Wallet.findByPk(wallet.id);
    expect(freshWallet!.turnoverRequired).toBe('60.000000000000000000');
  });
});
