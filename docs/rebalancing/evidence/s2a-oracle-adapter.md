# S2A oracle adapter evidence

**Status:** unfunded local adapter; not wired into a price-gated instruction, and not evidence that the feeds resolve on-chain. S0B still holds funded admission.

## Account model and pins

The module consumes the sponsored shard-0 Pyth Core push-feed accounts selected by the plan. It binds SOL/USD to account `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE` and feed ID `0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d`; it binds USDC/USD to `Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX` and feed ID `0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a`. Pyth's current official Solana contract-address list gives Receiver program `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ` for both Mainnet and Devnet. The module uses the official `pyth-solana-receiver-sdk` `PriceUpdateV2` account type; its age-aware getter enforces the expected feed ID and `Full` verification, while explicit checks bind the source-listed fixed account address and owner.

This is consistent with the plan's fixed push-feed choice and permissionless pusher backup. A static account address and `PriceUpdateV2` are not contradictory: Pyth documents fixed feed accounts as PDAs chosen by feed ID/shard, and the receiver SDK documents price-update account verification. The adapter relies on the published account address plus the SDK's typed deserialization and Pyth owner check; no dynamic caller-selected oracle account is accepted.

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
