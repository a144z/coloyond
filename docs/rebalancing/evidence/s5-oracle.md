# S5 Pyth account-mode research

**Status:** primary-source inventory complete; fixed-feed Devnet account and consumer proof outstanding. This is not S5C acceptance, S0B admission, or a claim that any candidate account was fetched from chain.

## Account model decision

Pyth's current Solana guide distinguishes fixed, shard-selected price-feed accounts from ephemeral `PriceUpdateV2` Receiver update accounts. The fixed path is the first ETF candidate because it avoids posting a Pyth update in every seed/swap transaction and Pyth lists its shard-0 SOL/BTC/USDC feeds as sponsored on Devnet. The account owner and data parser still must be established against the exact account and SDK used by the program.

`PriceUpdateV2` is a Receiver account type. Its `get_price_no_older_than` method checks Full verification, feed ID and maximum age; the integration still has to check positive price, confidence, exponent, nonfuture publish time and policy limits. Official Push Oracle source shows the fixed PDA is CPI-posted through Receiver `post_update`, then deserialized as this same account type; its TypeScript SDK also decodes fixed PDAs with the Receiver account coder. Fixed and ephemeral feeds therefore differ in address derivation, lifecycle and updater path, while the serialized parser appears shared. The fixed PDA's actual Devnet owner, bytes and verification level still need direct confirmation; report `Full` only if present in the decoded account. If the fixed path fails direct proof or exact-build compatibility, the fallback is a client-posted Receiver update with Full verification and an explicit multi-transaction update flow. Partial verification is not accepted.

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

The isolated adapter now depends on the repository-pinned `anchor-lang = 0.32.1` and `pyth-solana-receiver-sdk = 1.2.0`. It checks the manifest PDA and Receiver owner before SDK deserialization, then validates the pinned feed ID, Full verification, maximum age, positive/nonfuture price, confidence ratio and exact 18-decimal fixed-point conversion. Three offline unit tests pass, including round-trip SDK account serialization/deserialization and negative owner/staleness/Partial cases. These tests use constructed local account data and do **not** prove any live Devnet owner, bytes, price or update status.

- Read exact Devnet genesis and query each candidate address from the same cluster.
- Record account owner, data length, type/layout, embedded feed ID, shard, raw price/confidence/exponent, publish time, read slot and mode-specific verification evidence.
- Compile the selected parser against the repo's exact Anchor and Pyth SDK lockfile; use fetched account data to prove successful decoding and reject wrong owner, wrong feed identity, malformed layout, nonpositive price, unsupported exponent, excessive confidence, stale and nonfuture-time cases at the adapter boundary.
- If using Receiver updates, prove `Full` verification and the exact client posting flow. If using fixed Push Feed accounts, document the trusted Pyth program's verification/update semantics and do not report a Receiver verification field.
- S5C does not require an ETF-program transaction because S5E has not deployed that program yet. The real Devnet consumer transaction, on-chain rejection without token movement, and stale-feed recovery are S5H/CP5 proof obligations after S5E.

No Devnet account read was available during this audit because the environment could not resolve the public Solana RPC host. All addresses above remain candidates until the direct proof succeeds.

## 11 October 2026 compatibility finding

The current repository pins `pyth-solana-receiver-sdk = 1.2.0`, whose Rust `PriceUpdateV2` parser and `get_price_no_older_than` method enforce the Receiver account discriminator, feed ID, maximum age and Full verification when used through Anchor `Account<PriceUpdateV2>`. A fixed sponsored feed is a different lifecycle (long-lived shard/feed PDA) from a user-posted ephemeral update, but Pyth's current official Push Oracle program source shows `update_price_feed` CPI-calls the Receiver's `post_update` using that PDA as the `price_update_account`, then deserializes it with `PriceUpdateV2::try_deserialize` and verifies the embedded feed ID. This strongly indicates the same account data type and Receiver CPI ownership path are used for both modes. Thus the current Rust parser is a plausible candidate for fixed feeds; no custom raw-byte parser is justified from the evidence found so far.

The public TypeScript SDK's `buildUpdatePriceFeedInstructions` targets the separate PythPushOracle program and derives the fixed PDA from shard ID and feed ID. Its `fetchPriceFeedAccount` then decodes that PDA using the Receiver `priceUpdateV2` account coder. The fixed/ephemeral distinction therefore concerns address derivation, lifecycle and updater path; it does not by itself imply a different serialized Rust type. For the fixed sponsored path, the Full-verification property must still be asserted from the actual decoded account (there is no separate feed-mode verification field), and the exact owner must be read from Devnet. The Pyth guide currently documents Receiver SDK compatibility up to Anchor 0.31.1 while this repository pins Anchor 0.32.1; existing native Rust tests compile locally, but S5C still needs the exact intended build target and consumer proof.

No S5A oracle decision change is proposed: fixed sponsored shard-0 feeds remain primary because they match the always-current read model and official SDK update path. S5C must prove exact address derivation, account owner/discriminator/layout, Full verification, embedded feed ID, freshness, confidence and precision against Devnet before acceptance. If account owner or parser compatibility fails, return a reviewed S5A amendment to ephemeral Full Receiver `PriceUpdateV2` accounts, including the client-posted update transaction and rent/cleanup flow. Do not hand-parse production account bytes without a versioned layout and official-source validation.

The direct `getGenesisHash` RPC probe in this session failed before connecting because the environment could not resolve `api.devnet.solana.com`. This environmental failure does not establish that the feed accounts are absent or malformed. Exact genesis, owner, executable state, account bytes, feed identity, price, timestamp, and slot remain open.

## Primary sources

- [Pyth Solana account modes and integration](https://docs.pyth.network/price-feeds/core/use-real-time-data/pull-integration/solana)
- [Pyth sponsored Solana Push Feeds](https://docs.pyth.network/price-feeds/core/push-feeds/solana)
- [Pyth Solana program addresses](https://docs.pyth.network/price-feeds/core/contract-addresses/solana)
- [Pyth Receiver `PriceUpdateV2` checks](https://github.com/pyth-network/pyth-crosschain/blob/main/target_chains/solana/pyth_solana_receiver_sdk/src/price_update.rs)
- [Pyth Solana Receiver SDK README](https://github.com/pyth-network/pyth-crosschain/tree/main/target_chains/solana/pyth_solana_receiver_sdk)
- [Pyth Solana Receiver TypeScript SDK fixed-feed builder](https://github.com/pyth-network/pyth-crosschain/blob/main/target_chains/solana/sdk/js/pyth_solana_receiver/src/PythSolanaReceiver.ts)
- [Pyth Push Oracle program implementation](https://github.com/pyth-network/pyth-crosschain/blob/main/target_chains/solana/programs/pyth-push-oracle/src/lib.rs)
- [Pyth Push Oracle IDL](https://github.com/pyth-network/pyth-crosschain/blob/main/target_chains/solana/sdk/js/pyth_solana_receiver/src/idl/pyth_push_oracle.ts)
- [Pyth Core upgrade guide](https://docs.pyth.network/price-feeds/core/upgrade)
- [Pyth Solana Rust account parser source](https://github.com/pyth-network/pyth-sdk-rs/blob/main/pyth-sdk-solana/src/state.rs)
- [Pyth price safety guidance](https://docs.pyth.network/price-feeds/core/best-practices)
