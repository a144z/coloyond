# S2A oracle adapter evidence

**Status:** unfunded local adapter; not wired into a price-gated instruction, and not evidence that the feeds resolve on-chain. S0B still holds funded admission.

## Account model and pins

The source pins the sponsored shard-0 SOL/USD account candidate `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE` with feed ID `0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d`, and the USDC/USD candidate `Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX` with feed ID `0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a`. Its local source type is Pyth Receiver `PriceUpdateV2`, whose documented owner is `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`; the manifest also points to fixed Push Feed addresses. At the time of this source-level review, there was no direct RPC observation to compare against this account type or owner; the later confirmed Devnet observation is summarized below.

The original S2A source review had no direct Devnet account read. Later SDK-backed confirmed and finalized observations verify Receiver ownership, `PriceUpdateV2` layout, embedded feed IDs and `Full` verification for the pinned feeds on both clusters; see the [cross-cluster S0B feed captures](s0b-feed-observations-20261011.md). The latest Devnet basket is stale under the diagnostic 60-second limit, while one Mainnet observation was fresh. These are not an on-chain consumer transaction, approved policy, repeated freshness guarantee, or funded admission. S0B/S5C must still prove the selected policy and consume the accounts in the reviewed ETF SBF build; amend the manifest/code if those proofs require it.

## Validation behavior

The pure helper rejects an unexpected account key/owner, wrong embedded feed, partial verification, stale or future timestamps, nonpositive prices, over-limit confidence, and unrepresentable fixed-point conversions. USDC parity is a separate explicit policy check, so callers must validate both feeds before any price-dependent risk action. Price/exponent conversion uses checked `u128` arithmetic at 18 decimal places and rejects lossy precision instead of truncating it.

`OracleLimits` has no defaults. S0F does not freeze maximum age, confidence ratio, or USDC deviation, so callers must pass approved values; no instruction can safely activate this module until the policy revision supplies those values. The adapter does not change proportional deposits or oracle-independent in-kind redemption.

## Sources and unresolved evidence

- [Pyth Solana account integration](https://docs.pyth.network/price-feeds/core/use-real-time-data/pull-integration/solana): fixed feed account vs ephemeral update account, shard derivation and SDK account checks.
- [Pyth Solana program addresses](https://docs.pyth.network/price-feeds/core/contract-addresses/solana): Receiver program ID on Mainnet and Devnet.
- [Pyth sponsored Solana push feeds](https://docs.pyth.network/price-feeds/core/push-feeds/solana): shard-0 addresses, current heartbeat/deviation update criteria.
- [Pyth receiver SDK source](https://github.com/pyth-network/pyth-crosschain/blob/main/target_chains/solana/pyth_solana_receiver_sdk/src/price_update.rs): `PriceUpdateV2`, Full verification and age/feed checks.
- [Pyth safety guidance](https://docs.pyth.network/price-feeds/core/best-practices): stale/latency and confidence-interval risks.

S0B reports that neither target-network feed account could be fetched over RPC. Address, actual owner, account layout/type, live `feed_id`, update time, and verification level must still be verified from finalized Mainnet and Devnet state; the source-listed constants are not a deployment or admission claim. Pyth's 55-second heartbeat / 0.5% deviation are updater criteria, not the protocol's maximum acceptable age, confidence, or depeg thresholds.


## Later S5C resolution — 11 October 2026

The earlier sections accurately recorded the lack of live evidence at that time. S5C subsequently read the same fixed shard-zero candidate accounts on Devnet and decoded them as Pull Oracle-owned `PriceUpdateV2` data with the expected embedded feed IDs and `Full` verification. The current official Pyth guide says fixed price-feed PDAs and ephemeral update accounts use the same on-chain data type and owner; its TypeScript SDK derives the fixed address under the Push Oracle program ID and fetches it through the Receiver account coder. The S5C Rust test reproduces all three shard-zero addresses from the official `[u16_le(shard), feed_id]` derivation. This resolves the parser/owner compatibility uncertainty for these candidates. It does not satisfy S0B deployment admission or prove that the v0.3.0 instruction consumes them on-chain; remaining admission facts, freshness, and a real consumer transaction remain open. See [S5C evidence](s5-oracle.md#s5a-reconciliation) and the [current Pyth integration guide](https://docs.pyth.network/price-feeds/core/use-real-time-data/pull-integration/solana).
