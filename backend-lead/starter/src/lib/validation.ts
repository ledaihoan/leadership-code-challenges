import { z } from 'zod';
import { dec } from './money';

// Money arrives as string decimals, max 18 dp, strictly positive.
// The refine runs even when the regex check failed (zod marks the parse dirty,
// not aborted), so it must not throw on garbage input.
export const moneyAmount = z
  .string()
  .regex(/^\d+(\.\d{1,18})?$/, 'must be a positive decimal string')
  .refine((s) => {
    try {
      return dec(s).isGreaterThan(0);
    } catch {
      return false;
    }
  }, 'must be positive');
