# ETF AMM v1 deployment manifest

**Status:** `DRAFT / NOT FROZEN / NOT ADMITTED`. A direct Devnet account/parser observation for the candidate fixed feeds is recorded in [S5C evidence](evidence/s5-oracle.md#direct-devnet-observation--10-october-2026). This does not admit assets or freeze feed risk limits. No ETF program, pool or test mint is deployed by this manifest; do not deploy, seed, or enable swaps from this draft.

## Network and program

| Field | Value | Evidence state |
|---|---|---|
| Cluster | Solana Devnet | Planned test network only. |
| Genesis hash | `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` | Confirmed on 11 October 2026 by `api.devnet.solana.com` (slot 509698933) and independent OnFinality Devnet RPC (slot 509698943); both report the same active chain. This agrees with the Solana SDK genesis constant. The current Solana `getGenesisHash` docs example shows `GH7ome...`; that example conflicts with both live providers and the SDK constant and should not override observed chain identity. Reverify from the selected endpoint before deployment. |
| RPC endpoint | `https://api.devnet.solana.com` | Used for current read-only probes only; the app's approved endpoint remains TBD. Endpoint is not chain identity. |
| Program name | `coloyond-etf` | New program, separate from `coloyond-vault` v0.3.0. |
| Program ID | _TBD after program IDL/source freeze_ | No ETF program exists in this manifest. |
| Program executable / loader owner | _TBD from direct Devnet read_ | Require an executable-account and ProgramData/upgrade-authority record. |
| Program source/build hash | _TBD_ | Must match the reviewed source and reproducible build evidence. |
| Pool identity / PDA | Derived from canonical `EtfPoolConfigV1` bytes as specified in [the contract](contracts/etf-v1.md#canonical-pool-and-strategy-identity) and [typed wire schema](contracts/etf-config-v1-wire.md) | A synthetic fixture now proves ordered bytes/hash/strategy ID and pool seed inputs. Program ID and deployed PDA addresses remain TBD; production fee/risk payload formats must be frozen before S5E. |
| Initializer | _TBD; S5A must select an enforceable on-chain model before S5E_ | An off-chain manifest cannot authorize an on-chain signer. Choose permissionless deterministic initialization only if initial authorities are included in the hashed pool identity and clients verify the approved hash before funding, or an on-chain factory/registry that binds the approved config hash and authority tuple to the initializer. The chosen rule must prevent unauthorized configuration and define front-run behavior. |
| Governance authority | _TBD; exact key or program PDA must be pinned before S5E deployment_ | May propose only delayed resume or authority handoff; cannot change pool economics/configuration or transfer custody. |
| Emergency guardian | _TBD; exact key must be pinned before S5E deployment_ | May pause risk-increasing actions immediately; cannot resume, alter policy or block in-kind exit. |
| Governance delay | 24 hours | Fixed before S5E; execution is permissionless after delay and new authority handoff requires new-key acceptance. |
| Target test weights | SOL 4,000 bps / test BTC 4,000 bps / test USD 2,000 bps | Blueprint example for Devnet only; freeze in S5A with seed/math tolerances. |
| Fee policy | _TBD by S5D2 and S5A amendment_ | No 30/500/1,000 bps values are approved. |
| Share mint | Six decimals, PDA authority | Exact address is created at deployment; initial USD-NAV denomination is not a peg. |

## Pyth program candidates

Pyth's current Solana documentation lists the Receiver and Price Feed programs separately, both on Devnet. S5C must prove which program owns the chosen account mode and which exact layout/parser matches the deployed feed account.

| Program | Devnet address | Use | Status |
|---|---|---|---|
| Pyth Receiver / Pull Oracle | `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ` | Owns verified `PriceUpdateV2` update accounts. | Direct Devnet read at confirmed slot `509627995`: executable under upgradeable BPF loader. |
| Pyth Price Feed / Push Oracle | `pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT` | Program ID used for fixed shard-0 sponsored feed accounts. | Direct Devnet read at confirmed slot `509627995`: executable under upgradeable BPF loader. |

The current first choice is the fixed shard-0 sponsored feed account path because it avoids posting a fresh update with every action. A `PriceUpdateV2` Receiver account is a distinct candidate path, not an interchangeable type. If the fixed feed account path cannot be safely decoded with the current SDK/toolchain, S5C must return a reviewed amendment for Full-verified Receiver updates and their wallet update transaction flow. Do not downgrade to Partial verification.

## Candidate Pyth feed set

These candidate values are for identity discovery only. The direct Devnet check must confirm account existence, expected program owner, derivation, decoded embedded feed ID, price/confidence/exponent, publish time, verification state and on-chain consumption. Pyth's published 55-second heartbeat and 0.5% deviation are nominal updater criteria, not a freshness guarantee.

| Pool asset label | Feed | Stable Pyth Core feed ID | Candidate shard-0 account | Devnet mint and backing status |
|---|---|---|---|---|
| SOL | SOL/USD | `0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d` | `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE` | Refreshed at slot `509699169`: correct Receiver owner/layout/feed ID/Full; 16 seconds old under diagnostic 60-second ceiling. WSOL Devnet mint owner, decimals, authorities and matching account remain to be verified. |
| Test BTC | BTC/USD | `0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43` | `4cSM2e6rvbGQUFiJbqytoVMi5GgghSMr8LwVrT9VPSPo` | Refreshed at slot `509699169`: correct Receiver owner/layout/feed ID/Full but stale by 104 seconds under diagnostic 60-second ceiling. Devnet-created classic SPL test mint, address/decimals/authorities TBD; label `synthetic / unbacked`, not BTC. |
| Test USD | USDC/USD | `0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a` | `Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX` | Refreshed at slot `509699169`: correct Receiver owner/layout/feed ID/Full but stale by 138 seconds under diagnostic 60-second ceiling. Devnet-created classic SPL test mint, address/decimals/authorities TBD; label `synthetic / unbacked`, not redeemable USDC. |

The observation is point-in-time only. BTC/USD and USDC/USD were stale in an earlier sample before updating again; S5C evidence records both reads. The selected freshness and confidence thresholds remain unapproved, and a Pyth price does not attest to the backing or identity of an SPL mint.

The colleague blueprint's legacy `H6AR...` SOL and `HovQM...` BTC values are preserved in the proposal file but are not selected as current Pyth Core Receiver accounts. Never infer a token's mint or backing from its ticker or price feed.

## Final manifest/IDL freeze evidence (after the S5A baseline and S5C/S5D2 amendments)

S5A freezes the interface schema and provisional candidate baseline. Do not freeze exact feed mode, risk/fee parameters or deployment values for S5E until the S5C oracle evidence and S5D2 fee amendment are reviewed and incorporated.

- Read and pin the exact Devnet genesis hash and RPC label that the wallet/client will use.
- Fetch each selected Pyth candidate at confirmed/finalized commitment and record address, existence, owner, data length, decoded account type/layout, embedded feed ID, shard, publish time, price, confidence, exponent and read slot. Record verification according to mode: Receiver updates must show `Full`; fixed Push Feed accounts must show the program owner/layout/status/update evidence established by S5C.
- Complete S5C's parser compatibility proof against fetched account data. For Receiver mode, verify `Full`, feed identity, freshness, positivity, confidence and exponent rules at the adapter boundary; for fixed Push Feed mode, verify only the actual fields and checks exposed by that account model. The on-chain ETF consumer test happens after S5E, not before this freeze.
- Verify exact Devnet test-mint addresses, token-program owners, decimals, mint/freeze authorities and synthetic/unbacked labels. BTC/USD and USDC/USD feed identities do not prove those SPL mints are backed by BTC or USDC.
- Recompute canonical config bytes, domain-separated hash, pool/asset/authority/share/custody PDAs and strategy ID in independent predeployment client/program vectors. Freeze those vectors with the exact manifest inputs; no on-chain pool readback is expected yet.
- Freeze source-derived scheduler selection and cost assumptions with explicit evidence status; an unverified deployment or executor remains labeled as a candidate. The real program account, queue/task and crank-invocation proof is post-deployment.

## Post-deployment admission evidence (S5H / CP5)

- Read back ETF program executable/loader, source/build identity and upgrade-authority policy; compare them to the frozen deployment manifest.
- Initialize the exact pool and read back the immutable config hash, ordered assets, all PDAs, share mint and custody token accounts. Prove the selected on-chain initialization rule, including its front-run behavior and one-time PDA consumption; an off-chain manifest alone is not an authorization check.
- Prove guardian pause-only behavior and delayed governance resume/handoff with actual transactions, including early-execution rejection and new-authority acceptance.
- Submit a real ETF instruction with each selected feed account. For Receiver mode, show a valid `Full` fresh update succeeds while wrong account/feed, stale update, `Partial`, nonpositive price, unsupported exponent and excessive confidence fail on-chain with no SPL movement. For fixed Push Feed mode, test only applicable owner/layout/feed/status/freshness checks; never invent a `Full` or `Partial` state. Prove stale-feed recovery through the admitted update mechanism.
- Read back every created mint/custody/share authority and reconcile actual wallet, pool, token and share balances from confirmed transactions.
- If TukTuk is used, prove its Devnet program executable/loader, queue configuration/authority/balance/capacity, task PDA/ID, compiled payload, registration transaction and a distinct crank-turner-signed run transaction invoking exactly `poke`. Record queue deposit, rent/capacity and per-run reward separately. The resulting state change is eligibility/maintenance only; a separate trader must fund the swap.

## Evidence sources

- [Pyth Solana contract addresses](https://docs.pyth.network/price-feeds/core/contract-addresses/solana)
- [Pyth sponsored Solana feeds](https://docs.pyth.network/price-feeds/core/push-feeds/solana)
- [Pyth Solana account modes and SDK integration](https://docs.pyth.network/price-feeds/core/use-real-time-data/pull-integration/solana)
- [Pyth Receiver SDK `PriceUpdateV2` validation](https://github.com/pyth-network/pyth-crosschain/blob/main/target_chains/solana/pyth_solana_receiver_sdk/src/price_update.rs)
- [Helium TukTuk source and crank-turner operations](https://github.com/helium/tuktuk)
