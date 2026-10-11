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

## Time-boxed Devnet-only implementation proposal

The user authorized bounded technical choices for a Devnet test profile so independent implementation can proceed without treating those choices as production policy. The following values are the proposed v1 test bounds for contract work and UI explanations. **They remain draft inputs: the manifest is not accepted, the program does not consume them, and this section does not authorize deployment, initialization, seeding, or swapping.** No Mainnet or production deployment may inherit them without a separate review and policy revision.

| Test-only field | Bounded proposal | Fail-closed behavior |
|---|---:|---|
| Basket | WSOL + the exact Test USD mint above; 5,000/5,000 bps; minimum configured leg 100 bps | Do not label Test USD as USDC or as backed. A missing, substituted, or differently ordered mint/feed disables the pool profile. |
| Oracle mode and verification | Fixed shard-0 `PushFeed` address derivation; Pyth Receiver owner; exact `PriceUpdateV2` layout and embedded feed ID; `Full` verification | Reject a wrong owner, PDA, key, layout, feed ID, or verification level. The mode tag never substitutes for those checks. |
| Maximum oracle age | 60 seconds; publish time may not be in the future | Reject every risk-increasing action if either required feed is older. Do not widen the bound to fit Devnet observations. |
| Maximum confidence ratio | 100 bps, calculated with integer cross-multiplication against the positive price midpoint | Reject a zero/negative midpoint, nonpositive lower confidence bound, overflow, or ratio above the limit. |
| Supported exponent | Inclusive `[-17, 0]` | Reject an exponent outside that range or any conversion that loses precision at the S5B USD scale. |
| Seed composition | At most 50 bps total-variation deviation from the 50/50 target using S5B's integer-normalized USD marks from the same validated feed observations | Reject if a required feed is unavailable or the basket falls outside the bound. Initial share issuance must use `initial_shares_from_nav`; never round the seed toward more shares. |
| Swap fee | Fixed 30 bps, retained in the input-token custody and reported separately from network fees | No dynamic 500/1,000-bps fee tiers from the historical blueprint are adopted. The rate is a test proposal, not an accepted economic policy. |
| Gross input cap | `amount_in <= floor(input_custody * 100 / 10,000)` (1% of that asset's pre-trade custody) | Reject zero, dust, overflow, or a larger input before CPI. Use the existing S5B checked weighted quote and strict deviation-improvement rule. |
| Oracle-parity loss band | At most 200 bps, checked with integer arithmetic against the conservative confidence endpoints and the gross input value | Reject when the post-fee output falls outside the bound or any endpoint cannot be represented exactly. This is a test guard, not an executable-depth or market-price guarantee. |
| Authorities | Distinct, nonzero governance and emergency-guardian public keys; the deployment manifest must pin the actual program ID, build/IDL hashes, loader upgrade authority, and both role keys before acceptance | Do not substitute placeholders, silently use the fee payer as both roles, or enable risk actions without the exact authority-bound config hash. The public keys remain to be supplied for an actual deployment. |
| Pause and stop | Guardian can pause risk-increasing actions immediately; governance resume remains delayed 86,400 seconds; in-kind redemption remains independent of oracle, scheduler, and pause | Unknown transaction outcome blocks retry. A rejected transaction is retryable only after complete confirmed RPC evidence shows no token/share/custody/fee-counter change. |
| Scheduler | Eligibility-only `poke`; no scheduler role in the first manual pool test | `poke` cannot move pool assets, create a counterparty, or execute a swap. Cron→TukTuk remains unproven until the separate live-task checkpoint passes. |

The 50-bps seed composition check and 200-bps conservative quote-loss formula are bounded implementation proposals added for this time-boxed test profile; they have not been independently reviewed or implemented in S5E. The existing candidate 3,000-bps input cap is **superseded for this test proposal** by the stricter 100-bps cap, but remains historical model evidence rather than a production decision. Fixed 30 bps likewise remains only a test proposal. The program must recognize a strict, versioned test policy schema and enforce these values on-chain before any such action can be considered; client-only checks are insufficient.

Even with these proposed values, the current observed USD reference feed age is 82 seconds and fails the 60-second test bound. The Test USD mint's active mint/freeze authorities and near-maximum supply make it suitable only for openly labeled Devnet mechanics testing, not backed-value validation. Therefore the profile intentionally remains blocked for a risk-increasing transaction until the live basket is fresh and a deployed program enforces the same policy.

## Oracle checks and draft parameters

### Mode-semantics reconciliation — draft recommendation

The first profile uses the fixed shard-0 feed accounts, so its canonical `oracle_mode` should be `PushFeed`: that tag identifies the fixed PDA derivation/update path. The data account remains owned by Pyth Receiver, uses `PriceUpdateV2`, and must independently pass exact feed-ID and `Full` verification checks. `oracle_program` therefore continues to mean the expected account-data owner; the Push Oracle program ID is separately pinned for PDA derivation. Full verification is required regardless of mode. This interpretation matches the S5A wire fixture and the Pyth S5C evidence. The current S5E draft decoder accepts only this fixed `PushFeed` mode and checks the fixed account/feed identity, Receiver ownership, `PriceUpdateV2` layout, and `Full` verification; this resolves the earlier mode mismatch but remains a draft until S5A review. It does not select freshness/confidence/fee policy or admit either mint.

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

## S5E implementation blockers and bounded integration recommendations

S5E code, client readers, frontend composition and host/Localnet validation may proceed against draft inputs. The draft is not a Devnet authorization. Until S5A/S0B/S5D2 review closes, fail closed for deployment, pool initialization, seed, swaps and funded use. In particular, a live seed/swap needs a fresh admitted feed under an approved policy; the latest fixed-feed Devnet evidence is stale under the 60-second diagnostic, and that ceiling must not be widened to manufacture a passing result.

The following compatibility rules are recommended as explicit S5A decisions rather than silently selected implementation defaults:

| Integration issue | Bounded recommendation | Gate / effect |
|---|---|---|
| Identity crate accepts zero-weight legs; S5B math rejects weights below 100 bps | Require every configured weight to be at least 100 bps and require the exact sum to remain 10,000 bps, matching the already-tested math domain | The identity validator and its boundary tests must enforce the same floor before S5E can accept a config. This does not change any share or weighted-swap formula. |
| Oracle helper returns an 18-decimal USD mark while S5B math uses `USD_VALUE_SCALE = 10^12` | Keep the oracle's validated raw mantissa/exponent and pass those with the mint decimals directly to the tested `normalize_usd_value` path; do not round through `to_usd_fixed()` and then rescale | Confirm with cross-crate boundary vectors before any on-chain value is used for seed or swap. The existing S5B floor rounding remains authoritative. |
| Opaque fee/risk parameter byte vectors do not define an executable policy | Define strict versioned schemas before accepting a risk-increasing config; reject unknown IDs, lengths, or fields | Until reviewed, no candidate fee, age, confidence, exponent, size cap, quote band or seed tolerance is production policy. |
| Exact authorities, program ID/build, and variable account ABI are not finalized | Keep them explicit in the deployment/IDL contract; do not substitute generated placeholders or client defaults | Blocks a verified Devnet deployment and transaction builder; does not block a read-only screen or Localnet math/CPI work. |
| Candidate fixed-feed observations are currently stale | Keep seed/swap disabled until fresh finalized account reads satisfy a reviewed limit and the on-chain parser accepts the exact Receiver-owned `PriceUpdateV2`, feed ID, Full level, owner, and fixed-address derivation | The user must not be prompted to sign a transaction that cannot meet the same on-chain checks. |

These recommendations make the existing Rust boundaries compose without altering the tested share formulas, checked arithmetic, custody limits, or fee-retention model. They remain draft until their evidence and policy owners record acceptance; a draft implementation must report an explicit blocked/unconfigured state rather than emulate a passing result.
