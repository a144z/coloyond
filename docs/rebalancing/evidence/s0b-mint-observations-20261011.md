# S0B — finalized SPL mint observations (11 October 2026)

**Status:** read-only account observations; technical admission and funded entry remain unapproved. No wallet, transaction, or chain-state mutation was used.

## Capture and decoder

The probe queried `getGenesisHash`, `getMultipleAccounts` with `commitment: finalized` and `encoding: base64`, then `getSlot` with `commitment: finalized` from the pinned public RPC endpoint for each cluster. The replayable requests and full responses are checked in:

- Mainnet: [slot 455472024 snapshot](../../../tools/rebalancing/etf-asset-probe/snapshots/mainnet-beta-455472024-20261011T013732.032261Z.json), captured at `2026-10-11T01:37:32.032261Z`; mint account context slot `455472019`.
- Devnet: [slot 509738517 snapshot](../../../tools/rebalancing/etf-asset-probe/snapshots/devnet-509738517-20261011T013735.190931Z.json), captured at `2026-10-11T01:37:35.190931Z`; mint account context slot `509738512`.

Both genesis hashes matched their pinned cluster identities. The decoder requires the classic SPL Token Program owner, a non-executable account, the exact 82-byte classic Mint layout, a valid initialized flag, and valid COption tags. The observations below are derived from the raw base64 account bytes, and the offline replay validates those derived fields against the stored RPC responses.

## Observed account state

| Cluster | Candidate | Mint | Owner / account | Decimals | Supply in base units | Mint authority | Freeze authority |
|---|---|---|---|---:|---:|---|---|
| Mainnet | WSOL | `So11111111111111111111111111111111111111112` | Classic SPL Token; non-executable; 82 bytes; initialized | 9 | 0 | None | None |
| Mainnet | Circle-native USDC candidate | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | Classic SPL Token; non-executable; 82 bytes; initialized | 6 | 7,714,010,708,486,571 | `BJE5MMbqXjVwjAF7oxwPYXnTXDyspzYzt4vwenNw5ruG` | `7dGbd2QZcCKcTndnHcTL8q7SMVXAkp688NTQYwrRCrar` |
| Devnet | WSOL | `So11111111111111111111111111111111111111112` | Classic SPL Token; non-executable; 82 bytes; initialized | 9 | 0 | None | None |
| Devnet | Test-USDC candidate | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` | Classic SPL Token; non-executable; 82 bytes; initialized | 6 | 16,286,767,455,835,388,570 | `GrNg1XM2ctzeE2mXxXCfhcTUbejM8Z4z4wNVTy2FjMEz` | `CJtyoKSLrktozQzjERTiK3btQtiTK3nN4QrqGHLidyCT` |

## Limits and next S0B work

These reads establish the state returned by the named public RPC endpoints at the recorded finalized contexts. They do not identify the controllers behind authority keys, establish issuer identity or reserve backing, confer redemption rights, test freezing, or establish that token balances will be available to this program. The Devnet test-USDC supply is close to the `u64` maximum; the eventual test-pool seed/trade bounds must be chosen so all token and valuation arithmetic remains within the reviewed domain. It is not evidence of a useful market or backed USDC.

Mint authorities are present for both USDC candidates and freeze authorities are present for both. Review and accept these controls and disclosures before manifest freeze. Keep the exact authority addresses in the versioned manifest; never silently copy or replace them.

The separate [S5C oracle snapshot](s5-oracle.md#latest-replayable-current-cluster-feed-read--11-october-2026) is a confirmed Devnet feed read, not a finalized S0B feed observation. S0B still requires finalized feed-account records for SOL/USD and USDC/USD on both clusters, repeated freshness/confidence observations under reviewed limits, the pusher-operability proof, the exact SBF compatibility/consumer proof, and pre-deposit issuer/freeze/depeg disclosure. This mint report does not pass those gates or enable funded entry.
