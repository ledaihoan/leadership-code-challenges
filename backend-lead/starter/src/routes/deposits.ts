import { Router } from 'express';
import { z } from 'zod';
import { EmptyResultError } from 'sequelize';
import { moneyAmount } from '../lib/validation';
import * as depositService from '../services/depositService';

export const depositsRouter = Router();

const createDepositBody = z.object({
  memberId: z.string().uuid(),
  amount: moneyAmount,
  turnoverMultiplier: z.number().int().min(0).default(1),
});

depositsRouter.post('/', async (req, res, next) => {
  try {
    const body = createDepositBody.parse(req.body);
    const tx = await depositService.createDeposit(body);
    res.status(201).json({ transactionId: tx.id, pspRef: tx.pspRef, status: tx.status });
  } catch (err) {
    // even better make exception filter middleware more generic way
    if (err instanceof EmptyResultError) {
      res.status(404).json({ error: 'wallet_not_found' });
      return;
    }
    next(err);
  }
});
