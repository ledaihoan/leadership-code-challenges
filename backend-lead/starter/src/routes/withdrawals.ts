import { Router } from 'express';
import { z } from 'zod';
import { EmptyResultError } from 'sequelize';
import { moneyAmount } from '../lib/validation';
import * as withdrawalService from '../services/withdrawalService';
import { TurnoverNotMetError } from '../services/withdrawalService';
import { InsufficientBalanceError } from '../services/wagerService';

export const withdrawalsRouter = Router();

const createWithdrawalBody = z.object({
  memberId: z.string().uuid(),
  amount: moneyAmount,
});

withdrawalsRouter.post('/', async (req, res, next) => {
  try {
    const body = createWithdrawalBody.parse(req.body);
    const result = await withdrawalService.createWithdrawal(body.memberId, body.amount);
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof EmptyResultError) {
      res.status(404).json({ error: 'wallet_not_found' });
      return;
    }
    if (err instanceof TurnoverNotMetError) {
      res.status(422).json({
        error: 'turnover_not_met',
        requiredTurnover: err.requiredTurnover,
        accruedTurnover: err.accruedTurnover,
        outstandingTurnover: err.outstandingTurnover,
      });
      return;
    }
    if (err instanceof InsufficientBalanceError) {
      res.status(422).json({
        error: 'insufficient_balance',
        balance: err.balance,
        requested: err.requested,
      });
      return;
    }
    next(err);
  }
});
