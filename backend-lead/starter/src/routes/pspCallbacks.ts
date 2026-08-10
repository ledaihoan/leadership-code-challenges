import { Router } from 'express';
import { z } from 'zod';
import { moneyAmount } from '../lib/validation';
import * as pspCallbackService from '../services/pspCallbackService';

export const pspCallbacksRouter = Router();

const callbackBody = z.object({
  pspRef: z.string().min(1),
  status: z.enum(['completed', 'failed']),
  amount: moneyAmount,
});

pspCallbacksRouter.post('/', async (req, res, next) => {
  try {
    const body = callbackBody.parse(req.body);
    const result = await pspCallbackService.handlePspCallback(body);
    // 200 for every case we finished processing - including unknown pspRef and
    // no-op duplicates. A 4xx/5xx here just makes a well-behaved PSP retry a
    // callback we already handled (or will never be able to match) forever.
    // Only genuine failures (thrown errors) fall through to next() -> 500.
    res.status(200).json({ pspRef: body.pspRef, outcome: result.outcome });
  } catch (err) {
    next(err);
  }
});
