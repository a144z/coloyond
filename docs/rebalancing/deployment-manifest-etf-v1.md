# ETF AMM v1 deployment manifest

**Status:** `DRAFT / NOT FROZEN / NOT ADMITTED`. The latest direct Devnet account/parser observation for the candidate fixed feeds is recorded in [S5C evidence](evidence/s5-oracle.md#latest-replayable-current-cluster-feed-read--11-october-2026). This does not admit assets or freeze feed risk limits. No ETF program, pool or test mint is deployed by this manifest; do not deploy, seed, or enable swaps from this draft.

## Network and program

| Field | Value | Evidence state |
|---|---|---|
| Cluster | Solana Devnet | Planned test network only. |
| Genesis hash | `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` | Both `https://api.devnet.solana.com` and `https://solana-devnet.api.onfinality.io/public` returned this hash in a reproducible capture at 2026-10-10 23:08 UTC; the public RPC also reported finalized slot `509701000`. The exact JSON responses and SHA-256 digests are in [the capture artifact](evidence/s5-devnet-genesis-capture.json). This matches the upstream Solana SDK Devnet constant; the repository does not pin `solana-sdk`. The current Solana `getGenesisHash` docs example shows `GH7ome...` as sample output, a documentation discrepancy rather than evidence of another active chain. Reverify from the selected endpoint before deployment. |
| RPC endpoint | `https://api.devnet.solana.com` | Used for current read-only probes only; the app's approved endpoint remains TBD. Endpoint is not chain identity. |
| Program name | `coloyond-etf` | New program, separate from `coloyond-vault` v0.3.0. |
| Program ID | _TBD after program IDL/source freeze_ | No ETF program exists in this manifest. |
| Program executable / loader owner | _TBD from direct Devnet read_ | Require an executable-account and ProgramData/upgrade-authority record. |
| Program source/build hash | _TBD_ | Must match the reviewed source and reproducible build evidence. |
| Pool identity / PDA | Derived from canonical `EtfPoolConfigV1` bytes as specified in [the contract](contracts/etf-v1.md#canonical-pool-and-strategy-identity) and [typed wire schema](contracts/etf-config-v1-wire.md) | A synthetic fixture now proves ordered bytes/hash/strategy ID and pool seed inputs. Program ID and deployed PDA addresses remain TBD; production fee/risk payload formats must be frozen before S5E. |
| Initializer | Permissionless deterministic `initialize_pool`; caller pays rent only | Initial governance/guardian keys are included in canonical config bytes and therefore in the config hash and pool PDA. Any different authority tuple derives a different pool identity. Clients must verify the exact manifest hash and tuple before funding. If the approved exact pool was created first, clients read and verify it before continuing. Literal authority keys remain TBD and block deployment; no placeholder/default keys are accepted. |
| Governance authority | _TBD; exact key or program PDA must be pinned before S5E deployment_ | May propose only delayed resume or authority handoff; cannot change pool economics/configuration or transfer custody. |
| Emergency guardian | _TBD; exact key must be pinned before S5E deployment_ | May pause risk-increasing actions immediately; cannot resume, alter policy or block in-kind exit. |
| Governance delay | 24 hours | Fixed before S5E; execution is permissionless after delay and new authority handoff requires new-key acceptance. |
| Target test weights | SOL 4,000 bps / test BTC 4,000 bps / test USD 2,000 bps | Blueprint example for Devnet only; freeze in S5A with seed/math tolerances. |
| Fee policy | _TBD by S5D2 and S5A amendment_ | No 30/500/1,000 bps values are approved. |
| Share mint | Six decimals, PDA authority | Exact address is created at deployment; initial USD-NAV denomination is not a peg. |

## Pyth program candidates

Pyth's current Solana documentation lists the Receiver and Price Feed programs separately, both on Devnet. The selected fixed-feed addresses are derived under the Price Feed (Push Oracle) program, while the account data is owned and decoded by the Receiver (Pull Oracle).

| Program | Devnet address | Use | Status |
|---|---|---|---|
| Pyth Receiver / Pull Oracle | `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ` | Owns verified `PriceUpdateV2` update accounts. | Direct Devnet read at confirmed slot `509627995`: executable under upgradeable BPF loader. |
| Pyth Price Feed / Push Oracle | `pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT` | Program ID used for fixed shard-0 sponsored feed accounts. | Direct Devnet read at confirmed slot `509627995`: executable under upgradeable BPF loader. |

The current first choice is the fixed shard-0 sponsored feed account path because it avoids posting a fresh update with every action. Fixed feeds and ephemeral Receiver updates share the `PriceUpdateV2` layout and Pull Oracle owner; they differ in address derivation, lifetime and updater path. Require `Full` verification for either mode. The fixed-feed PDA derivation and its supported update path remain separately bound and must not be inferred from parser compatibility alone.

## Candidate Pyth feed set

These candidate values are for identity discovery only. The direct Devnet check must confirm account existence, expected program owner, derivation, decoded embedded feed ID, price/confidence/exponent, publish time, verification state and on-chain consumption. Pyth's published 55-second heartbeat and 0.5% deviation are nominal updater criteria, not a freshness guarantee.

| Pool asset label | Feed | Stable Pyth Core feed ID | Candidate shard-0 account | Devnet mint and backing status |
|---|---|---|---|---|
| SOL | SOL/USD | `0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d` | `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE` | Latest captured feed snapshot is confirmed slot `509731704`: Receiver owner, 134-byte allocation, expected feed ID and Full verification; 11 seconds old and passed the diagnostic 60-second age check at 5 bps confidence. See [S5C evidence](evidence/s5-oracle.md#latest-replayable-current-cluster-feed-read--11-october-2026). Point-in-time evidence only; no production limits are approved and freshness is not guaranteed. WSOL Devnet mint owner, decimals, authorities and matching account remain to be verified. |
| Test BTC | BTC/USD | `0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43` | `4cSM2e6rvbGQUFiJbqytoVMi5GgghSMr8LwVrT9VPSPo` | Latest captured feed snapshot is confirmed slot `509731704`: Receiver owner, 134-byte allocation, expected feed ID and Full verification; 11 seconds old and passed the diagnostic 60-second age check at 9 bps confidence. See [S5C evidence](evidence/s5-oracle.md#latest-replayable-current-cluster-feed-read--11-october-2026). Point-in-time evidence only; no production limits are approved and freshness is not guaranteed. Devnet-created classic SPL test mint, address/decimals/authorities TBD; label `synthetic / unbacked`, not BTC. |
| Test USD | USDC/USD | `0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a` | `Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX` | Latest captured feed snapshot is confirmed slot `509731704`: Receiver owner, 134-byte allocation, expected feed ID and Full verification; 35 seconds old and passed the diagnostic 60-second age check at 10 bps confidence. See [S5C evidence](evidence/s5-oracle.md#latest-replayable-current-cluster-feed-read--11-october-2026). Point-in-time evidence only; no production limits are approved and freshness is not guaranteed. Devnet-created classic SPL test mint, address/decimals/authorities TBD; label `synthetic / unbacked`, not redeemable USDC. |

The latest observation is point-in-time only. Earlier and later samples in S5C evidence show that all feeds can become stale; a fresh read does not establish a freshness SLA. The selected freshness and confidence thresholds remain unapproved, and a Pyth price does not attest to the backing or identity of an SPL mint.

The colleague blueprint's legacy `H6AR...` SOL and `HovQM...` BTC values are preserved in the proposal file but are not selected as current Pyth Core Receiver accounts. Never infer a token's mint or backing from its ticker or price feed.

## Final manifest/IDL freeze evidence (after the S5A baseline and S5C/S5D2 amendments)

S5A freezes the interface schema and provisional candidate baseline. Do not freeze exact feed mode, risk/fee parameters or deployment values for S5E until the S5C oracle evidence and S5D2 fee amendment are reviewed and incorporated.

- Read and pin the exact Devnet genesis hash and RPC label that the wallet/client will use.
- Fetch each selected Pyth candidate at confirmed/finalized commitment and record address, existence, owner, data length, decoded account type/layout, embedded feed ID, shard, publish time, price, confidence, exponent and read slot. Under the current Solana integration, fixed feed PDAs and ephemeral updates are both Pull Oracle-owned `PriceUpdateV2` data; require `Full` in either mode.
- Complete S5C's parser compatibility proof against fetched account data. For fixed feeds, independently derive the shard/feed PDA with the pinned Pyth derivation and verify its sponsored/permissionless update path; for ephemeral mode, prove the wallet-posted account flow. The on-chain ETF consumer test happens after S5E, not before this freeze.
- Verify exact Devnet test-mint addresses, token-program owners, decimals, mint/freeze authorities and synthetic/unbacked labels. BTC/USD and USDC/USD feed identities do not prove those SPL mints are backed by BTC or USDC.
- Recompute canonical config bytes, domain-separated hash, pool/asset/authority/share/custody PDAs and strategy ID in independent predeployment client/program vectors. Freeze those vectors with the exact manifest inputs; no on-chain pool readback is expected yet.
- Freeze source-derived scheduler selection and cost assumptions with explicit evidence status; an unverified deployment or executor remains labeled as a candidate. The real program account, queue/task and crank-invocation proof is post-deployment.

## Post-deployment admission evidence (S5H / CP5)

- Read back ETF program executable/loader, source/build identity and upgrade-authority policy; compare them to the frozen deployment manifest.
- Initialize the exact pool and read back the immutable config hash, ordered assets, all PDAs, share mint and custody token accounts. Prove the selected on-chain initialization rule, including its front-run behavior and one-time PDA consumption; an off-chain manifest alone is not an authorization check.
- Prove guardian pause-only behavior and delayed governance resume/handoff with actual transactions, including early-execution rejection and new-authority acceptance.
- Submit a real ETF instruction with each selected feed account. Under the current Pyth Core Solana integration, both fixed feed PDAs and ephemeral update accounts are Receiver-owned `PriceUpdateV2` data with an actual verification level; require `Full` in either mode. Prove the fixed PDA from shard/feed ID using the pinned Pyth derivation and verify its supported update path; for ephemeral mode, prove the wallet posting/closing flow. Wrong account/feed, stale update, `Partial`, nonpositive price, unsupported exponent and excessive confidence must fail on-chain with no SPL movement. Prove stale-feed recovery through the admitted update mechanism.
- Read back every created mint/custody/share authority and reconcile actual wallet, pool, token and share balances from confirmed transactions.
- If the leading Helium Cron→TukTuk recurring candidate is selected, prove both Devnet programs executable under the expected loaders; read back Cron job and Cron transaction accounts, queue configuration/authority/balance/capacity, task PDA/ID and exact compiled `poke` payload; retain registration signatures and a distinct crank-turner-signed run transaction invoking exactly `poke`. Prove stop/recovery/funding and successive scheduled runs. Record Cron funding, queue deposit, task rent/capacity and per-run reward separately. If direct TukTuk requeue is selected instead, prove the frozen return-data/free-task contract and the same stop, funding and successive-run properties. The resulting state change is eligibility/maintenance only; a separate trader must fund the swap.

## Evidence sources

- [Pyth Solana contract addresses](https://docs.pyth.network/price-feeds/core/contract-addresses/solana)
- [Pyth sponsored Solana feeds](https://docs.pyth.network/price-feeds/core/push-feeds/solana)
- [Pyth Solana account modes and SDK integration](https://docs.pyth.network/price-feeds/core/use-real-time-data/pull-integration/solana)
- [Pyth Receiver SDK `PriceUpdateV2` validation](https://github.com/pyth-network/pyth-crosschain/blob/main/target_chains/solana/pyth_solana_receiver_sdk/src/price_update.rs)
- [Helium TukTuk source and crank-turner operations](https://github.com/helium/tuktuk)
