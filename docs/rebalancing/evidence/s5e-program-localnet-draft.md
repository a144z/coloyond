# S5E — ETF Anchor program boundary and blocked execution paths

**Status: modular program draft compiles for SBF and host tests, but has no Localnet transaction evidence and is not cleared for Devnet use.** The accepted S5A contract/policy freeze, S0B admission, and S5D2 fee/economics review remain gates. Risk-increasing instructions validate the supplied account shape and then return `PolicyNotFrozen` before any token CPI or state write. This work does not deploy a program or pool.

## Implemented boundary

The independent `programs/coloyond-etf` package uses Anchor 0.32.1 and the existing ETF identity, math, and oracle crates. The root Cargo workspace was deliberately left unchanged; S5A-W owns its registration. `Anchor.toml` maps the generated draft program ID only under Localnet. `H3CkHowYVQcxrKXWkyswMW2rqRNzRQYaQr7N8LKXFUt9` is a compile/IDL placeholder without a deployment key, not an admitted Devnet program ID.

The code separates canonical config validation, PDA/account validation, fixed state layouts, initialization, proportional liquidity, and risk instruction contexts. Config parsing requires canonical bytes, classic SPL token assets, the manifest's fixed Receiver-owned feed identities, and an inert zero-policy schema. It does not accept opaque fee/risk policy values. Initialization creates the immutable pool/state records, classic SPL share mint and per-asset custody/fee-state PDAs; the new state starts `Unseeded` and risk-paused.

`deposit_proportional` and `redeem_in_kind` use the existing tested integer share quote helpers. Deposit transfers only `consumed` amounts, so unconsumed maxima remain in the user's token accounts as refunds; the event/result reports both consumed and refund amounts. In-kind redemption is independent of oracle accounts and risk pause, burns shares, and transfers each reserve pro rata. It marks the pool permanently `Closed` on a full-supply redemption. These paths have host compilation/unit coverage only; SPL CPI, rollback, and account reconciliation have not been exercised on a validator.

## Draft risk-instruction account ABI

The generated Anchor IDL exposes `seed_pool`, `swap_exact_in`, and `poke` with separate typed account contexts:

- `seed_pool`: `seed`, mutable pool/state/share mint, authority PDA, classic SPL Token program, and optional `oracle_feed_0..2`. Its remaining accounts are the seeder's share-token account followed by one config-ordered group per asset: `[mint, custody, seed_token_account, asset_state]`.
- `swap_exact_in`: `trader`, pool/state, authority PDA, classic SPL Token program, and optional `oracle_feed_0..2`. Its remaining accounts are one config-ordered group per asset: `[mint, custody, trader_token_account, asset_state]`. The trader signs and each source token account must be owned by that trader.
- `poke`: caller, pool/state, and optional `oracle_feed_0..2`. It has no share mint, Token program, token accounts, or counterparty; unexpected remaining accounts reject.

For each of the two or three configured assets, the explicit feed account must match the immutable config's account key and feed ID, be owned by the configured Pyth Receiver, decode as `PriceUpdateV2`, and have `Full` verification. Wrong/missing/extra feeds, wrong token accounts, custody, mints, asset-state PDAs, and unsupported remaining-account counts reject. Current seed/swap/poke handlers stop after those identity checks and return `PolicyNotFrozen`; none transfers tokens or writes eligibility. In particular, this ABI does not claim a scheduler creates a swap counterparty.

The real risk math is not enabled in this draft. It does not yet apply approved oracle age/confidence/exponent limits, seed-composition tolerance, initial NAV share issuance, fee policy, quote/parity band, input cap, or strict post-fee deviation check. `swap_exact_in` does not execute a weighted quote or fee calculation. No candidate number is silently promoted into policy. `poke` likewise does not write an observation until eligibility rules are frozen.

## Unresolved gates and effect

| Open evidence/decision | Effect on testing |
|---|---|
| S5A strict fee/risk schema and accepted oracle age, confidence, exponent, quote/parity, input-size, drift and seed-tolerance limits | Seed, swap and eligibility remain fail-closed. The documented 60-second age check and other candidate values are not approvals. |
| S5D2 selected fee/economic policy and review | No retained fee can be calculated or called safe. The candidate sensitivity models are not live depth or execution-cost proof. |
| S0B Devnet mint admission and current feed availability | The 11 October live-read evidence records a 228-second age sample and freshness as unconfigured; do not widen a limit to fit it. Test USD is synthetic/unbacked and must never be represented as USDC. |
| Exact production program ID/build provenance, governance and guardian keys, reviewed manifest, deployment authority | No verified Devnet deployment, pool, or transaction exists. The Localnet ID is a draft placeholder only. |
| Actual validator CPI/rollback evidence | Host math/account tests and successful SBF compilation do not prove SPL Token CPI, signer/PDA authority, transfer rollback, or confirmed token/share deltas. `solana-test-validator` 2.3.0 is installed, but this package has no transaction harness and `solana-program-test` is not present in the local Cargo cache. With offline dependencies required, an executable CPI harness cannot be added or run in this unit. |

These are material blockers for the real Devnet wallet flow. They do not block independent read-only frontend/client work, but they do block asking a developer to sign an ETF transaction. No actual ETF program, pool, scheduler task, wallet signature, or Devnet ETF transaction is claimed here. The Cron→TukTuk checkpoint remains separate and unproven.

## Validation performed

- `cargo test --locked --offline -p coloyond-etf-identity -p coloyond-etf-math -p coloyond-etf-oracle` — passed: 8 identity, 77 math, and 14 oracle tests, plus doc tests.
- `cargo test --manifest-path programs/coloyond-etf/Cargo.toml --features idl-build --locked --offline` — passed 12 program and Anchor IDL-build tests through Anchor 0.32.1's `anchor-lang-idl` build API.
- `cargo test --manifest-path programs/coloyond-etf/Cargo.toml --locked --offline` — passed 6 host program tests.
- `cargo-build-sbf` 2.3.0 with cached platform-tools v1.57, `--skip-tools-install --no-rustup-override --offline` — succeeded. The linker reported the usual Solana syscalls as undefined host symbols; no validator execution was performed.
- `cargo fmt --manifest-path programs/coloyond-etf/Cargo.toml -- --check` and `git diff --check` — passed after formatting.
- The generated [`ETF IDL`](../../../idl/coloyond_etf.json) includes the exact `seed_pool`, `swap_exact_in`, and token-free `poke` account fields above, and includes the draft address. This IDL is not a production deployment interface until S5A accepts the contract and program ID.

## Developer steps now

There is no safe Devnet wallet action to perform from this draft. Do not deploy the placeholder ID or construct a seed/swap transaction. A Localnet validator binary is installed, but the required transaction-test dependencies and harness are absent from the offline environment; therefore this unit cannot prove pool creation readbacks, token CPI, deposit refunds, redemption while paused, or transaction rollback. Do not interpret the compiled SBF binary as Localnet execution evidence. For local inspection only:

1. Review the generated IDL and verify `poke` has no token/share accounts, while seed and swap contain the exact explicit feeds and remaining-account order above.
2. Run the locked/offline host tests and cached SBF build from the repository instructions.
3. Add a transaction-test harness with pinned Solana/Anchor client tooling when available, then prove initialization/PDA/mint/custody readbacks, deposit/refund, in-kind redemption while risk-paused, and RPC balance reconciliation on Localnet. Keep seed/swap/poke fail-closed until S0B/S5A/S5D2 gates and approved policy are accepted; require an approved deployment manifest before using a Devnet wallet.

This unit proves a compiling modular SBF artifact, host-level serialization/config/PDA tests, and the generated instruction interface. It does **not** prove a real interactive transaction flow, initialized/seeded pool, authenticated fresh Devnet oracle consumption, a swap, a rejected transaction's unchanged balances, or automated scheduling.
