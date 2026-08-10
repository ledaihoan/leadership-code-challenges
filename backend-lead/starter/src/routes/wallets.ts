import { Router } from 'express';
import { z } from 'zod';
import { EmptyResultError } from 'sequelize';
import { moneyAmount } from '../lib/validation';
import * as wagerService from '../services/wagerService';
import { InsufficientBalanceError } from '../services/wagerService';

export const walletsRouter = Router();

const wagerBody = z.object({
  amount: moneyAmount,
});

walletsRouter.post('/:walletId/wagers', async (req, res, next) => {
  try {
    const walletId = z.string().uuid().parse(req.params.walletId);
    const body = wagerBody.parse(req.body);
    const result = await wagerService.placeWager(walletId, body.amount);
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof EmptyResultError) {
      res.status(404).json({ error: 'wallet_not_found' });
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
