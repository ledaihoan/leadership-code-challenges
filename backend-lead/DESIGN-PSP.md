# DESIGN-PSP: the 50th PSP as a one-day junior task

## The problem

Dozens of PSPs, each with its own callback format, signature scheme, status
vocabulary and quirks: minor units, aggressive retries, `success` before
`pending`. Integration must be safe for someone who does not know the money
core, because at PSP #50 that is who does the work.

## Shape: adapters translate, one core decides

```
POST /psp/callbacks/:provider
   -> registry picks the adapter from config
   -> adapter.verify(raw)       signature check, provider-specific
   -> adapter.normalize(raw)    units, status map, ref extraction
   -> CanonicalPspEvent         one schema for every provider
   -> money core                lock, state machine, ledger, audit (unchanged)
```

```ts
interface PspAdapter {
  providerId: string;
  verify(req: RawRequest): boolean;
  normalize(req: RawRequest): CanonicalPspEvent;
}

interface CanonicalPspEvent {
  provider: string;
  pspRef: string;
  status: 'completed' | 'failed' | 'pending' | 'unknown';
  amount: string; // decimal string, major units
  raw: unknown;   // kept for audit
}
```

The core is what A2 already is today: row lock, guarded transition, unique
indexes, audit events. It consumes canonical events only and never changes
when a provider is added.

## Where each quirk dies

- Minor units: converted in `normalize`, declared per provider in config.
- Status vocabulary: per-provider map in config; anything unmapped becomes
  `unknown`, quarantined with an audit row and an alert, no state change.
- Retries, duplicates, out-of-order, contradictions: nothing to do, the core
  state machine absorbs them already; Pending is the only creditable state.
- Secrets, endpoints, settlement currency: config, rotated without code.

## Testing a provider you cannot call in CI

1. Contract suite: one shared test file every adapter must pass. Feeds
   duplicate delivery, concurrent duplicates, out-of-order statuses, minor
   units, bad signature, unknown status.
2. Recorded fixtures: real sandbox callbacks captured once, committed with the
   adapter, replayed in CI as golden files. No live calls on the merge path.
3. Live sandbox smoke: nightly, outside CI, so flakiness never blocks a merge.

## The junior's day

Write `verify` and `normalize`, add the config entry, record fixtures, pass
the contract suite. Review checklist: signature verified, amount unit right,
status map complete, ref extracted. The blast radius of a bad adapter is one
provider's translation, caught by the contract suite before merge. The money
core is not in their diff.
