# ETF client boundary

This package is the S5F TypeScript conformance boundary for the draft ETF v1 read model. It validates the shared fixture semantics and publishes behavior-level port types; it does not connect to RPC, build transactions, sign, submit, or reconcile real receipts.

The fixture document remains explicitly `fixtureOnly`, and the ETF deployment manifest, program ID, production fee/risk limits, and S5E IDL are not frozen. Keep unsupported or unavailable observations tagged with their reason. Preserve `u64`/`i64` values as decimal strings. `unknown` wallet actions never authorize automatic resend. Receiver `Full` verification and fixed Push Feed account status remain distinct.

Run `npm test --prefix packages/etf-client` and `npm run typecheck --prefix packages/etf-client`. Do not add schema-generation or RPC dependencies before the program interface is frozen.
