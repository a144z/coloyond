# S5 Pyth account-mode research

**Status:** primary-source inventory complete; Devnet account and consumer proof outstanding. This is not S5C acceptance, S0B admission, or a claim that any candidate account was fetched from chain.

## Account model decision

Pyth's current Solana guide distinguishes fixed, shard-selected price-feed accounts from ephemeral `PriceUpdateV2` Receiver update accounts. The fixed path is the first ETF candidate because it avoids posting a Pyth update in every seed/swap transaction and Pyth lists its shard-0 SOL/BTC/USDC feeds as sponsored on Devnet. The account owner and data parser still must be established against the exact account and SDK used by the program.

`PriceUpdateV2` is a Receiver-owned update account. Its `get_price_no_older_than` method checks Full verification, feed ID and maximum age; the integration still has to check positive price, confidence, exponent, nonfuture publish time and policy limits. This Receiver `Full` field must not be assumed to exist on a fixed Push Feed account. If fixed Push Feed parsing is incompatible with the current Anchor/SDK versions, the fallback is a client-posted Receiver update with Full verification and an explicit multi-transaction update flow. Partial verification is not accepted.

## Candidate identifiers

| Asset price | Stable Pyth Core feed ID | Candidate shard-0 account | Source status |
|---|---|---|---|
| SOL/USD | `0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d` | `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE` | Listed by Pyth as sponsored on Solana Mainnet and Devnet; direct Devnet read not performed here. |
| BTC/USD | `0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43` | `4cSM2e6rvbGQUFiJbqytoVMi5GgghSMr8LwVrT9VPSPo` | Address derived with the official SDK for shard 0; direct Devnet read not performed here. |
| USDC/USD | `0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a` | `Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX` | Listed by Pyth as sponsored on Solana Mainnet and Devnet; direct Devnet read not performed here. |

| Program | Solana Devnet address | Role |
|---|---|---|
| Pyth Receiver / Pull Oracle | `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ` | Owns `PriceUpdateV2` update accounts. |
| Pyth Price Feed / Push Oracle | `pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT` | Program listed for fixed Push Feed accounts. |

Pyth documents a nominal 55-second heartbeat and 0.5% deviation for the default sponsored Solana feeds. These are updater criteria, not an update SLA; stale feeds must block new risk. A price feed does not prove that the corresponding Devnet SPL mint is backed by that real-world asset. Use labeled synthetic BTC/USD and USD test mints if no backed Devnet mint is separately established.

## S5C account/parser proof required

- Read exact Devnet genesis and query each candidate address from the same cluster.
- Record account owner, data length, type/layout, embedded feed ID, shard, raw price/confidence/exponent, publish time, read slot and mode-specific verification evidence.
- Compile the selected parser against the repo's exact Anchor and Pyth SDK lockfile; use fetched account data to prove successful decoding and reject wrong owner, wrong feed identity, malformed layout, nonpositive price, unsupported exponent, excessive confidence, stale and nonfuture-time cases at the adapter boundary.
- If using Receiver updates, prove `Full` verification and the exact client posting flow. If using fixed Push Feed accounts, document the trusted Pyth program's verification/update semantics and do not report a Receiver verification field.
- S5C does not require an ETF-program transaction because S5E has not deployed that program yet. The real Devnet consumer transaction, on-chain rejection without token movement, and stale-feed recovery are S5H/CP5 proof obligations after S5E.

No Devnet account read was available during this audit because the environment could not resolve the public Solana RPC host. All addresses above remain candidates until the direct proof succeeds.

## Primary sources

- [Pyth Solana account modes and integration](https://docs.pyth.network/price-feeds/core/use-real-time-data/pull-integration/solana)
- [Pyth sponsored Solana Push Feeds](https://docs.pyth.network/price-feeds/core/push-feeds/solana)
- [Pyth Solana program addresses](https://docs.pyth.network/price-feeds/core/contract-addresses/solana)
- [Pyth Receiver `PriceUpdateV2` checks](https://github.com/pyth-network/pyth-crosschain/blob/main/target_chains/solana/pyth_solana_receiver_sdk/src/price_update.rs)
- [Pyth price safety guidance](https://docs.pyth.network/price-feeds/core/best-practices)
