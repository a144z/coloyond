# S5A bounded Devnet test-profile recommendation

**Status: draft recommendation only — not frozen, not admitted, and not authorization to deploy or transact.** This note narrows a possible first interactive Devnet test to two assets. It does not replace the S5A production-policy review, S0B asset/oracle admission, S5D2 economics review, or the preserved colleague blueprint.

## Bounded recommendation

Use the following candidate profile for planning the first real client/program walkthrough:

| Field | Draft recommendation | Status |
|---|---|---|
| Pool shape | Two classic-SPL assets: WSOL and Test USD | Candidate only |
| WSOL mint | `So11111111111111111111111111111111111111112` | Exact Devnet candidate; refresh mint/program/authority facts before admission |
| Test USD mint | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` | Exact Devnet candidate; label `Test USD / synthetic / unbacked / not redeemable USDC` |
| Target | WSOL 5,000 bps / Test USD 5,000 bps | Candidate only; not frozen |
| SOL/USD feed | Account `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE`; feed ID `0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d` | Fixed shard-0 candidate |
| Test USD reference feed | Account `Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX`; feed ID `0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a` | USDC/USD oracle reference only; does not make the mint USDC |

The Test USD mint was observed as a classic SPL mint with six decimals, active mint and freeze authorities, and supply near `u64::MAX`. Those controls and the supply are material test limitations and must be shown in the UI or nearby asset disclosure. The mint is not backed by USD or USDC and is not redeemable as USDC. This profile intentionally makes no BTC mint or BTC backing claim; the three-asset 40/40/20 allocation in the historical blueprint is not selected for the first exercise.

## Oracle checks and draft parameters

For each fixed feed account, require all of the following before any risk-increasing transaction can be enabled:

- Verify the RPC genesis against the pinned Devnet genesis.
- Verify the exact account key and shard-0 PDA derivation using the Pyth Push Oracle program ID `pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT`.
- Verify that the account is owned by the Pyth Receiver `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`, decodes as `PriceUpdateV2`, embeds the expected feed ID, and reports `Full` verification.
- Reject wrong owner/account/feed, nonpositive price, non-Full verification, future publish time, unsupported exponent, excessive confidence, and stale data. Use the exact fixed-point conversion path; do not substitute ticker or mint claims for feed identity.

The documented 60-second age ceiling remains diagnostic only. It is not a selected production/test policy and must not be widened to fit observed Devnet data. The latest finalized three-feed observation recorded by the manifest was 166 seconds old for every feed; therefore a complete basket failed that diagnostic check. Freshness has varied across snapshots and no repeatable updater SLA or successful ETF consumer transaction is proven.

These are review inputs, not accepted values:

| Parameter | Draft candidate | Required treatment |
|---|---:|---|
| Maximum feed age | 60 seconds, diagnostic only | Do not widen. Fail closed while the limit is unapproved and whenever a required feed exceeds it. |
| Maximum confidence ratio | 100 bps | Candidate only; no selected risk limit. |
| Supported exponent | `[-17, 0]` | Candidate only; exactness and accepted range need S5A review. |
| Swap fee | Fixed 30 bps | Candidate model value only; no fee is approved. |
| Gross input cap | 3,000 bps of the input reserve | Candidate model value only; no on-chain bound is approved. |
| Quote/parity band | Unresolved | Do not invent or silently derive a limit from synthetic sensitivity results. |
| Seed composition tolerance | Unresolved | Do not authorize seed or initial share issuance until reviewed. |

The candidate 30-bps fee and 3,000-bps cap do not show safe economics. Existing sensitivities are finite models, not executable depth or transaction-cost evidence. S5D2 still needs a reviewed fee/economics amendment; S5A must own and accept the final schemas and values. Candidate limits must not be embedded in a client as if approved, and risk-increasing actions must fail closed until the policy is explicitly frozen.

## Evidence basis and remaining gates

- The [deployment manifest](../deployment-manifest-etf-v1.md) records the exact candidate mint/feed identities, Devnet genesis, and current admission status.
- [S0B mint observations](s0b-mint-observations-20261011.md) record the Test USD mint's active mint/freeze authorities and near-maximum supply, and the WSOL mint observation. These are point-in-time facts to refresh, not permanent guarantees.
- [S0B feed observations](s0b-feed-observations-20261011.md) and [S5C oracle evidence](s5-oracle.md) show Receiver ownership, `PriceUpdateV2` layout, feed identity, Full verification and variable freshness. They do not establish freshness liveness or an approved risk policy.
- [S5B math evidence](s5-math.md) and [S5D2 economics evidence](s5-amm-economics.md) contain finite parameterized and synthetic sensitivities. They do not prove integrated SBF/CPI behavior, live depth, a safe quote band, a seed tolerance, or a selected fee.
- The colleague's [preserved blueprint](../../product/blueprints/no-backend-auto-rebalancing-multi-token-etf-solana-devnet.md) remains the historical proposal. Its three-asset 40/40/20 example, 30/500/1,000-bps fee table, and scheduled `rebalance()`-as-trade claim are not adopted by this recommendation.

S0B and the S5A/S5D2 production-review gate remain open. The ETF program ID, program build/deployment, authority keys, strict policy schemas, approved asset manifest, freshness/confidence/exponent limits, seed tolerance, quote band and fee policy are not frozen. No deployment, pool initialization, seed, swap, or other wallet action is enabled by this draft. `poke` remains eligibility-only; it cannot transfer pool assets or create a counterparty. Scheduler execution is a separate unproven checkpoint, and any actual swap requires a distinct trader-funded transaction.
