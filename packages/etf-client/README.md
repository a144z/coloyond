# ETF client boundary

This package is a provisional S5F TypeScript fixture-validation starter for the draft ETF v1 read model. The shared fixture corpus is component-level rather than a complete snapshot contract. It validates the checked-in examples and publishes behavior-level port types; it does not connect to RPC, build transactions, sign, submit, or reconcile real receipts.

The fixture document remains explicitly `fixtureOnly`, and the ETF deployment manifest, program ID, production fee/risk limits, and S5E IDL are not frozen. Keep unsupported or unavailable observations tagged with their reason; a failed snapshot cannot include oracle, balance or pool value payloads, while a stale oracle-only observation can retain diagnostic metadata. Preserve `u64`/`i64` values as decimal strings. Validators reject decimal strings whose digit length already exceeds the declared wire range before constructing a `BigInt`. `unknown` wallet actions never authorize automatic resend. Receiver `Full` verification and fixed Push Feed account status remain distinct.

Run `npm test --prefix packages/etf-client` and `npm run typecheck --prefix packages/etf-client`. Do not add schema-generation or RPC dependencies before the program interface is frozen.
