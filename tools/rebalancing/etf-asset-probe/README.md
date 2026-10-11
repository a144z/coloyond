# Read-only SPL mint account probe

This small Python 3 tool captures finalized Solana account observations for
candidate mints and decodes only the classic SPL Token Mint packed layout (82
bytes). It has no wallet dependency and does not construct, sign, or submit
transactions.

Candidate queries are cluster-specific:

| Cluster | Candidate | Address |
| --- | --- | --- |
| mainnet-beta | WSOL | `So11111111111111111111111111111111111111112` |
| mainnet-beta | Circle USDC | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| devnet | WSOL | `So11111111111111111111111111111111111111112` |
| devnet | Circle test USDC | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |

Each capture includes the cluster genesis hash, a finalized slot, the
`getMultipleAccounts` context slot, full JSON-RPC request/response objects, UTC
timestamps around each request, raw base64 account data, and derived mint
fields. The script pins RPC endpoints, genesis hashes, account addresses, query
parameters, classic Token Program ownership, and the 82-byte layout. Account
context slot must not be newer than the separately observed finalized slot.

## Commands

Run a live, read-only capture for both clusters (network access required):

```sh
python3 tools/rebalancing/etf-asset-probe/probe.py
```

Select one cluster:

```sh
python3 tools/rebalancing/etf-asset-probe/probe.py --cluster devnet
python3 tools/rebalancing/etf-asset-probe/probe.py --cluster mainnet-beta
```

Replay a saved capture without network access:

```sh
python3 tools/rebalancing/etf-asset-probe/probe.py \
  --replay tools/rebalancing/etf-asset-probe/snapshots/<capture>.json
```

Run offline-only tests:

```sh
python3 tools/rebalancing/etf-asset-probe/test_probe.py
```

The capture is an observation, not a signed attestation. Its SHA-256 values and
replay checks detect accidental or internal snapshot edits; they do not prove
who served the RPC response or make the observation tamper-evident against an
editor who can recompute the entire file. Mint supply, decimals, and authorities
are account metadata only: this probe does not infer an asset's backing,
issuer, collateral, redemption rights, or economic equivalence. Wrapped SOL is
also an SPL mint whose mint account alone does not describe its wrapping state.
