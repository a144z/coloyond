# Deployment and asset manifest v1

**Status:** source-identified proposal for test fixtures; **not admitted for funded use**. A field marked unverified must not be copied into an executable UI/configuration or treated as proof of deployment.

## Candidate assets and price feeds

| Cluster | Asset | Mint | Token program | Decimals / authorities |
|---|---|---|---|---|
| Mainnet and Devnet | WSOL | `So11111111111111111111111111111111111111112` | Classic SPL `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | Must read finalized account on each cluster |
| Mainnet | Circle-native USDC | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | Classic SPL `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | 6 decimals per source; current mint/freeze authority not verified |
| Devnet | Circle test USDC | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` | Expected classic SPL; verify | Must read finalized account; no redemption value |

| Pair | Feed ID | Pyth shard-0 account (source-listed) | Live account verification |
|---|---|---|---|
| SOL/USD | `0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d` | `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE` | Not fetched on either cluster |
| USDC/USD | `0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a` | `Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX` | Not fetched on either cluster |

The source report records that finalized `getAccountInfo` requests failed DNS resolution for both public Solana endpoints. This is missing evidence, not evidence that accounts are absent. Before admission, record per cluster: genesis hash, RPC/provider, finalized slot/time, account owner/executable/data length; mint decimals/supply/mint authority/freeze authority; feed owner/type/decoded ID, price/confidence/exponent/publish time/age and verification. Confirm feed PDA derivation and exact program owner. Two separately operated pusher configurations and current Hermes credential requirements must be demonstrated without committing credentials.

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
