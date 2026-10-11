# ETF read-model fixture validator

Run the dependency-free fixture contract check from the repository root:

```sh
python3 tools/rebalancing/etf-read-model-fixtures/validate.py
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s tools/rebalancing/etf-read-model-fixtures -p 'test_*.py' -v
```

The validator checks the checked-in language-neutral JSON fixture's tagged observation states, available-snapshot identity, lossless integer-string fields, mode-specific Receiver and Push Feed shapes, and confirmed/unknown receipt rules. Python and TypeScript both consume `mutation_cases.json`, a shared fixture-only set of valid and invalid mutations covering snapshot identity and precision, duplicate mints, oracle modes, exact signed `i64` publish-time limits, failed-snapshot payload suppression, and receipt rules; each runtime must match the same expected acceptance result. Integer-string digit lengths are bounded against their wire ranges before parsing; oversized decimal strings return validation errors without large-integer conversion. Required text fields use a shared explicit Unicode White_Space set in both language validators. Failed snapshots cannot carry an oracle, balances or pool value payload; stale oracle-only observations may retain diagnostic metadata. It also requires fixtures covering stale and unavailable reads, both oracle modes, confirmed and unknown actions, a slot above JavaScript's safe-integer range, and a maximum `u64` token amount.

This tool validates examples and wire representation only. `fixtureOnly` must stay `true`; passing the validator does not freeze S5A policy, production limits, RPC identity, account values, or protocol choices. It does not create a TypeScript client or scheduler adapter and adds no package dependency.
