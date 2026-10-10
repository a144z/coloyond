# Read-only Pyth Devnet account probe

Run from the repository root with Python 3 and Cargo available:

```sh
python3 tools/rebalancing/etf-oracle-probe/probe.py
```

The standard-library script reads the Devnet genesis hash, current slot/time, and the manifest-pinned SOL/USD, BTC/USD, and USDC/USD feed accounts. It writes account bytes to temporary files and passes them to `crates/etf-oracle/examples/decode_devnet_snapshot.rs`, which parses and validates them using the repository-pinned Pyth Receiver SDK. It never loads a wallet, submits a transaction, or writes account data on chain.

The diagnostic policy uses 60 seconds maximum age and `u16::MAX` confidence bps so the command can report actual freshness and confidence. These are probe ceilings, not approved production limits. The report is a dated account observation, not a continuing SLA, proof of Devnet SPL-mint backing, or S5C acceptance; refresh it before deployment and keep the final risk limits under review.
