# Deployment and asset manifest v1

**Status:** source-identified proposal for test fixtures; **not admitted for funded use**. A field marked unverified must not be copied into an executable UI/configuration or treated as proof of deployment.

## Candidate assets and price feeds

| Cluster | Asset | Mint | Token program | Decimals / authorities |
|---|---|---|---|---|
| Mainnet and Devnet | WSOL | `So11111111111111111111111111111111111111112` | Classic SPL `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | Finalized observations: initialized 82-byte mint, 9 decimals, no mint/freeze authority on both clusters. See [S0B snapshots](evidence/s0b-mint-observations-20261011.md). |
| Mainnet | Circle-native USDC candidate | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | Classic SPL `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | Finalized observation: 6 decimals; mint authority `BJE5MMbqXjVwjAF7oxwPYXnTXDyspzYzt4vwenNw5ruG`; freeze authority `7dGbd2QZcCKcTndnHcTL8q7SMVXAkp688NTQYwrRCrar`. Authority review pending. |
| Devnet | Test-USDC candidate | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` | Classic SPL `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | Finalized observation: 6 decimals; mint authority `GrNg1XM2ctzeE2mXxXCfhcTUbejM8Z4z4wNVTy2FjMEz`; freeze authority `CJtyoKSLrktozQzjERTiK3btQtiTK3nN4QrqGHLidyCT`; observed supply near `u64::MAX`. Authority/range review pending; no redemption value. |

| Pair | Feed ID | Pyth shard-0 account (source-listed) | Live account verification |
|---|---|---|---|
| SOL/USD | `0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d` | `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE` | Finalized Devnet read at slot `509739413` confirms account identity/parser but is stale under the diagnostic 60-second age. Mainnet read and approved limits remain open. See [latest S5C evidence](evidence/s5-oracle.md#latest-replayable-finalized-feed-read--11-october-2026). |
| USDC/USD | `0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a` | `Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX` | Finalized Devnet read at slot `509739413` confirms account identity/parser but is stale under the diagnostic 60-second age. Mainnet read and approved limits remain open. See [latest S5C evidence](evidence/s5-oracle.md#latest-replayable-finalized-feed-read--11-october-2026). |

The earlier source report records finalized `getAccountInfo` requests failing DNS resolution for both public Solana endpoints; later read-only mint captures succeeded. A finalized Devnet feed capture now exists but all three feeds fail the diagnostic age check; Mainnet feed reads remain open. Before admission, complete finalized feed observations for both clusters, verify feed PDA derivation and exact program owner, review the observed mint/freeze authorities and Devnet amount range, and demonstrate two separately operated pusher configurations without committing credentials. Full mint and feed capture details are in [S0B evidence](evidence/s0b-mint-observations-20261011.md) and [S5C evidence](evidence/s5-oracle.md#latest-replayable-finalized-feed-read--11-october-2026).

## Program and operations fields

| Field | v1 value | Admission rule |
|---|---|---|
| Anchor program ID / binary hash / IDL hash | **Unset** | Set only from reproducible build and exact cluster account verification |
| ProgramData address / upgrade authority | **Unset** | Verify current authority; prove independent multisig/timelock or revocation |
| Vault PDA / share mint / configuration revision | Vault PDA seed is defined in source; share mint and initialized revision remain **unset** | The paused bootstrap path exists in source but has no verified deployment or signed initializer transaction; no audit or live account is claimed |
| Pyth receiver program ID/version | Source report recommends SDK `1.2.0` with Anchor `0.32.1` for compile spike | Pin exact lockfile; build in actual SBF toolchain before acceptance |
| Transaction format and MWA wallet/origin | **Unset** | Select after real wallet capability, reviewed-byte and recovery probe |
| Keepers, RPCs, pusher, fee/bounty parameters | **Unset** | Two independent operators, public third-party path and S4 economics evidence required |
| Mainnet pilot cap / operator approval | **Deferred** | Separately reviewed and explicitly approved after audit and S6 evidence |

## Admission status

`manifest_status = research_only`; `funded_entry_enabled = false`; `funded_exit_path = implemented_in_source_unverified_on_chain`. The source includes oracle-independent in-kind redemption, but it is not deployed or transaction-validated for an admitted asset profile. These values are normative until an approved manifest revision says otherwise. The mainnet USDC issuer can freeze token accounts; in-kind exit cannot bypass that external token-program/issuer constraint. Disclose issuer, freeze, depeg, redemption, and chain/RPC limitations. Never silently replace the mint/feed or downgrade oracle verification.

## Source record

See [S0B asset/oracle evidence](evidence/assets-oracle.md) for dated primary sources and exact evidence gaps, [S0D solver economics](evidence/venues-economics.md) for depth/route limitations, and [S0E client/operations](evidence/client-operations.md) for MWA/operator limits. This manifest is a pointer to evidence, not a replacement for finalized account observations.
