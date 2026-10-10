# Read-only Pyth Devnet account probe

Run from the repository root with Python 3 and Cargo available:

```sh
python3 tools/rebalancing/etf-oracle-probe/probe.py
python3 tools/rebalancing/etf-oracle-probe/test_probe.py
```

The standard-library script reads the Devnet genesis hash, current slot/time, and the manifest-pinned SOL/USD, BTC/USD, and USDC/USD feed accounts. It writes account bytes to temporary files and passes them to `crates/etf-oracle/examples/decode_devnet_snapshot.rs`, which parses and validates them using the repository-pinned Pyth Receiver SDK. It never loads a wallet, submits a transaction, or writes account data on chain.

The diagnostic policy uses 60 seconds maximum age and `u16::MAX` confidence bps so the command can report actual freshness and confidence. These are probe ceilings, not approved production limits. The report is a dated account observation, not a continuing SLA, proof of Devnet SPL-mint backing, or S5C acceptance; refresh it before deployment and keep the final risk limits under review.

The offline response tests validate JSON-RPC 2.0 version/ID/result-or-error envelopes, the signed 64-bit integer returned by `getBlockTime`, then the complete `getMultipleAccounts` batch, context slot, each account record, base64 decoding and agreement between decoded bytes and RPC `space`. They do not query Devnet or add an account observation.
