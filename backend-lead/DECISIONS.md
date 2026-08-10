# Decisions

## A2 - PSP callback handler

**Idempotency lives at the row lock, not the unique constraint.** `handlePspCallback`
opens a transaction and does `SELECT ... FOR UPDATE` on the `funding_transactions`
row by `psp_ref` first. Under Postgres READ COMMITTED, a second concurrent
delivery for the same `pspRef` blocks on that lock until the first commits, then
re-reads the row - so it always observes the now-terminal `status` and takes the
no-op ("duplicate") branch. This is what makes the concurrent-duplicate test pass
without retries or advisory locks. The unique index on `wallet_txs(funding_tx_id,
kind)` (migration `20260810084131`) is a deliberate second line of defense, not
the primary mechanism - if it ever fires, that means the locking discipline above
was violated by a bug, and I'd rather see a 500 from a broken unique constraint
than silently swallow a double-credit.

**Terminal states absorb retries; contradictions get their own outcome.**
Once `status !== 'Pending'` nothing is applied again. A callback repeating the
state we already have is a retry, audited as `duplicate`. A callback claiming
the opposite state (`completed` for a transaction we already failed) is the PSP
contradicting its own earlier report, audited as `invalid_transition` - an
integration signal rather than retry noise, and the thing the alerting note
below actually watches. Both still return 200: rejected means "not applied",
not "please retry". `assertTransition` stays on the money path as a guard
against future code bugs, not PSP behavior.

**Lock order is always `funding_tx -> wallet`.** Both the callback handler and
(eventually) withdrawal approval touch both rows; taking them in a fixed order
everywhere is what avoids a deadlock between two flows that lock the same two
tables in opposite order under load.

**Amount mismatch policy: hold, don't credit.** If the callback's `amount`
doesn't equal the funding transaction's `amount`, we do not credit anything.
The transaction stays `Pending`, gets flagged (`amount_mismatch = true`,
`psp_callback_events.outcome = 'applied_mismatch'`), and needs a human to
resolve it. The alternative - crediting whatever the callback says arrived - is
defensible for small provider-side rounding, but "trust the callback's number"
is a much harder rule to reason about and audit under a real incident review
than "we never move money we can't tie back to a number we already recorded."
Given the time budget, hold is the one I can fully defend. `credited_amount` on
the funding transaction always equals the original `amount` when set, precisely
because we never credit anything else.

**Callbacks always return HTTP 200 once fully processed** - including unknown
`pspRef` (`orphan`), duplicates, and contradictions (`invalid_transition`) -
because a PSP that gets a non-2xx will retry forever, and none of these
outcomes benefit from a retry. Only a thrown error (DB down, or an invariant
violated like a missing wallet) falls through to the generic error handler and
returns 500, which is the one case a retry might actually help.
Malformed request bodies (schema validation failures) still return 400 via the
existing zod/`ZodError` convention - that's a client-integration bug, a
different class of problem than "we understood the callback but chose not to
act on it."

**Every callback delivery is audited**, even ones that don't change any money:
`psp_callback_events` records `orphan` and `duplicate` outcomes too, so
"why didn't this deposit credit" is always answerable from the DB without log
diving.

### What I'd do next with more time

- An admin/ops endpoint to resolve `amount_mismatch` transactions (credit at a
  chosen amount, or explicitly fail them) - out of scope for the 4h budget but
  the schema (`amount_mismatch`, `credited_amount`) already anticipates it.
- Alerting on `invalid_transition` / `orphan` volumes, since either climbing
  suggests a PSP integration bug rather than normal retry noise.

## AI tool disclosure

Used Claude Code as a pair programmer for this task: read the existing schema/
conventions, implemented the state machine, service, route, and the two
priority idempotency tests (sequential + concurrent duplicate callback), then
added the mismatch/failed/orphan/turnover tests and this write-up. I reviewed
and understand every line; the locking strategy and mismatch policy above are
my calls, not defaults it picked.
