# ETF v1 config identity vector

`validate.py` independently encodes the synthetic input in [`etf-config-v1-identity-fixture.json`](../../../docs/rebalancing/contracts/etf-config-v1-identity-fixture.json) using Python's standard library, then checks the Borsh bytes, domain-separated SHA-256, strategy ID and pool seed inputs.

The Rust implementation is the isolated [`coloyond-etf-identity` crate](../../../crates/etf-identity/). It owns only config encoding and identity. The initial governance and emergency-guardian keys are nonzero, distinct canonical fields, so changing either changes the config hash, strategy ID and pool PDA seeds. Its decoder requires a caller-supplied size ceiling, preflights vector lengths before Borsh allocation, rejects trailing bytes and validates v1 asset count, duplicate mints, authority keys and weight sums. It does not impose a per-asset minimum weight or derive PDA addresses because math review and the program ID remain unresolved.

The fixture is explicitly synthetic and is not an approved manifest. Its previous hash, which omitted the initial authority tuple, is superseded and must not be treated as a canonical `etf1:` identity. Policy parameter bytes are opaque test payloads; the ETF program remains blocked until S5C/S5D2 define strict production formats and bounds and the reviewed authority keys are selected. The on-chain initializer and client funding preflight are not implemented by this crate.

```sh
PYTHONDONTWRITEBYTECODE=1 python3 tools/rebalancing/etf-config-identity/validate.py
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tools/rebalancing/etf-config-identity -p 'test_*.py' -v
cargo test -p coloyond-etf-identity --locked
```
