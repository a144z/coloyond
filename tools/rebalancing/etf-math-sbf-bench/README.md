# ETF math SBF compute probe

This isolated harness calls the production `coloyond-etf-math::quote_exact_in` from a tiny Solana program. It mutates no accounts and is not an ETF vault or production instruction. The transaction client submits three representative inputs to a local validator and reports confirmed signatures, slots, program logs, and `computeUnitsConsumed`.

Build from the repository root with the Solana 2.3.0 SBF toolchain:

```sh
cargo build-sbf --manifest-path tools/rebalancing/etf-math-sbf-bench/Cargo.toml -- --locked
```

Create a disposable program keypair, then run the validator with the built program:

```sh
solana-keygen new --no-bip39-passphrase --outfile /tmp/etf-math-bench-program.json
PROGRAM_ID=$(solana address -k /tmp/etf-math-bench-program.json)
solana-test-validator --reset --bpf-program "$PROGRAM_ID" target/deploy/etf_math_sbf_bench.so
```

In another terminal, create a disposable payer and submit the cases:

```sh
solana-keygen new --no-bip39-passphrase --outfile /tmp/etf-math-bench-payer.json
ETF_MATH_BENCH_PROGRAM_ID="$PROGRAM_ID" \
ETF_MATH_BENCH_PAYER_KEYPAIR=/tmp/etf-math-bench-payer.json \
node tools/rebalancing/etf-math-sbf-bench/submit.mjs
```

The probe uses local-validator SOL only. It does not establish total ETF instruction cost, CPI cost, account serialization cost, transaction fit, or production compute limits. Re-run after math changes and measure the integrated ETF instruction once S5E exists.
