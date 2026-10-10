# ETF AMM v1 contract baseline

**Status:** S5A design baseline, not yet frozen for implementation. The existing S4 sprint/gates remain ahead of S5 code. Freeze this contract only after S5C verifies the Pyth account mode and S5D2 returns fee bounds against the accepted S5B math revision. No deployment or Devnet admission is implied.

## 1. Protocol boundary

ETF v1 is a separate Anchor program and tokenized pool. It does not alter `programs/coloyond-vault` v0.3.0, its account layouts, auction settlement, share rules, or `cb3:` strategy identities. Its program ID, account discriminators, IDL, manifest, strategy identity, client, tests, and deployment are independently versioned.

The retained colleague blueprint remains the proposal record at [the full blueprint](../../product/blueprints/no-backend-auto-rebalancing-multi-token-etf-solana-devnet.md). This contract resolves its scheduler boundary: a scheduled call may evaluate and record eligibility, but it cannot supply the counterparty's tokens. Only a trader-funded `swap_exact_in` changes a pool's asset composition. The ETF v1 product is a bounded rebalancing AMM, not a general-purpose swap venue: a swap is accepted only when its post-fee value-weight deviation is strictly lower under the same accepted oracle snapshot.

## 2. Trust and authority model

- The manifest names the one-time initializer for the first reviewed pool. Only that signer may initialize its deterministic pool PDA; initialization consumes the PDA and cannot be repeated. The initializer cannot withdraw or redirect custody and has no post-initialization admin power.
- The pool stores separate governance and emergency-guardian authorities. The guardian can immediately pause risk-increasing instructions; it cannot transfer assets, change pool configuration, resume risk, or block `redeem_in_kind`.
- Governance may submit a delayed resume or authority-handoff proposal. Execution is permissionless after the pool's immutable 24-hour delay; a new authority must also sign acceptance. Governance cannot alter the asset set, target weights, oracle bindings, fee/risk policy, math version, delay or share rules. S5A must pin the initial authority identities and exact delay in the manifest before S5E; an unassigned key is a deployment blocker. The loader upgrade authority is a separate deployment control and cannot be inferred from pool governance.
- No arbitrary CPI, Token-2022 extension, lending position, leverage, cross-chain route, or external-program custody is in v1.
- Pool custody accounts are controlled by program-derived authority. Every transfer is checked against the exact pool, asset index, mint, token program, and expected custody address.

## 3. Account and module boundaries

| On-chain state | Responsibility |
|---|---|
| `EtfPool` | Version, unique pool ID, ordered asset count, target weights, config hash/revision, share mint, fee-policy ID, pause/resume state, sequence, last observation and eligibility state. |
| `EtfAsset` (one per asset) | Ordered index, exact mint, classic token program, decimals, custody account, and exact Pyth feed ID/account mode pinned by the manifest. |
| Share mint | Classic SPL share token with six decimals, minted/burned only by the pool authority. |
| PDA custody token accounts | Actual reserves. These token-account amounts are the single source of truth for backing and AMM math. |

The repository boundary is:

```text
programs/coloyond-etf/       Anchor accounts, instruction validation, custody, shares,
                             oracle adapter, AMM instruction orchestration, events
crates/etf-math/             pure checked fixed-point value-weight and weighted-mean math
packages/etf-client/         manifest checks, PDA helpers, read/transaction builders,
                             wallet receipt reconciliation
packages/etf-scheduler/      optional scheduler SDK adapter; no protocol authority
apps/android/.../protocols/etf/  isolated ETF route and presentation model
docs/rebalancing/contracts/  versioned contract/read model/deployment manifest
```

`crates/etf-math` has no Anchor, RPC, wallet, token or scheduler dependency. The Pyth adapter does not own swap math. The scheduler adapter only builds registration and invocation transactions for public pool instructions. The program's `lib.rs` and generated IDL have one owner (S5E); S5H consumes them and owns final app composition/evidence, not program entry-point generation.

### Canonical pool and strategy identity

S5A freezes a canonical `EtfPoolConfigV1` field order and Borsh encoding. It contains the protocol version, ordered asset count and entries (mint, Token Program, decimals, oracle mode/program/account/feed ID and target weight), math version, immutable fee-policy ID/parameters, immutable risk-policy ID/parameters (oracle bounds, swap bounds, drift bands and cooldown), and governance delay. Authority keys are stored separately in the pool state so they may be rotated only through the delayed handoff; they do not alter the economic pool identity. S5A freezes the schema, and the reviewed S5C/S5D2 amendments must fill every value before the S5E IDL/program freeze. The program rejects unsupported counts, duplicate mints, noncanonical order where a manifest order is required, trailing bytes and invalid weight sums. No floating-point value or display ticker is serialized.

```text
config_hash = SHA-256("coloyond:etf:config:v1" || Borsh(EtfPoolConfigV1))
pool_pda    = PDA(["etf_pool_v1", config_hash], ETF_PROGRAM_ID)
asset_pda   = PDA(["etf_asset_v1", pool_pda, asset_index_u8], ETF_PROGRAM_ID)
authority   = PDA(["etf_authority_v1", pool_pda], ETF_PROGRAM_ID)
share_mint  = PDA(["etf_share_v1", pool_pda], ETF_PROGRAM_ID)
custody_pda = PDA(["etf_custody_v1", pool_pda, asset_index_u8], ETF_PROGRAM_ID)
strategy_id = "etf1:" || lowercase_hex(config_hash)
```

Each `custody_pda` is allocated as a classic SPL Token account with `authority` as its token authority. The share mint is also controlled by `authority`.

Every client, manifest and program must derive the same values from the same ordered config bytes; S5A commits shared serialization vectors. Any change to an immutable field creates a different pool PDA and strategy ID. The Devnet genesis hash remains part of the deployment/read-model identity, not a substitute for the content-addressed config.

## 4. Instruction surface

| Instruction | Caller and effect | Oracle dependency |
|---|---|---|
| `initialize_pool` | Approved initializer creates the one-time immutable pool configuration, share mint and per-asset custody. | Validate manifest-pinned feed identities and policy; no token transfer. |
| `seed_pool` | Seed signer transfers the first proportional basket; program verifies target composition and mints the initial shares with `min_shares_out`. | Yes. |
| `deposit_proportional` | Signer supplies maxima for every asset; program mints against the limiting reserve ratio and returns unused inputs atomically. | No; proportional token math only. |
| `redeem_in_kind` | Share owner burns shares and receives each reserve pro rata in the same transaction. Works while risk is paused. | No. |
| `swap_exact_in` | Trader transfers real input SPL tokens and receives output SPL tokens atomically. | Yes, for quote bounds and pre/post value-weight deviation. |
| `poke` | Anyone records the current oracle observation, deviation, eligibility and sequence. Scheduler may invoke it; it does not trade. Swaps recompute their own guards, so a scheduler outage does not block a valid swap. | Yes. |
| `pause_risk` | Guardian pauses seed/deposit/swap/other risk-increasing actions. | No. |
| `propose_resume` | Governance records a resume proposal and its earliest execution time; it does not unpause immediately. | No. |
| `resume_risk_after_delay` | Anyone executes the still-valid proposal after the immutable 24-hour delay. | No. |
| `propose_authority_handoff` | Governance proposes a new governance or guardian key; it does not change authority immediately. | No. |
| `accept_authority_handoff` | The proposed new key signs after the delay; the program updates only the named role. | No. |

No `rebalance()` instruction exchanges assets by itself. Every swap requires a trader signer and actual input-token accounts. All instructions use checked arithmetic and atomic token CPIs; any error rolls back state and token movements.

## 5. Value weights and trade direction

For each asset, normalize the raw price `p_i × 10^e_i` and base-unit reserve `r_i` using that mint's decimals `d_i` into the one fixed USD scale selected by S5B. Let `V_i` be that normalized oracle-marked value, `V = ΣV_i`, and configured target `t_i = target_weight_bps_i / 10,000`. Target weights sum to exactly 10,000 bps and are also the normalized exponents in the weighted constant-mean invariant.

The deviation metric is the total-variation distance in basis points:

```text
D_bps = 5,000 × Σ_i |V_i / V − target_weight_bps_i / 10,000|
```

S5B chooses the fixed-point scale and conservative rounding implementation. `swap_exact_in` computes pre- and post-swap values with the same accepted oracle observations and includes the retained input fee in post-swap custody. It rejects a trade unless `D_post < D_pre`, the quote is inside the configured oracle-relative band, output is nonzero, inventory and size bounds hold, and `min_amount_out` is met. A result that rounds to equal deviation is rejected. This constrains direction but does not eliminate MEV, latency risk, or adverse selection.

`poke` records eligibility when deviation reaches the configured start band; clearing eligibility uses the configured lower stop band and cooldown. S5B/S5D2 freeze numeric precision, dust, bounds and bands before program implementation. A scheduled task is an optional liveness signal, not a prerequisite for a trade.

## 6. Shares and asset accounting

All input/output amounts below use integer base units. Let `R_i` be actual custody amount for asset `i`; `S` is share supply in six-decimal base units. Oracle NAV is a display/issuance denomination, not a redemption promise, peg, or return.

### Initial seed

- A new pool begins unseeded with zero shares and empty custody accounts. `seed_pool` rejects any nonzero pre-seed custody balance; no first depositor can capture an unsolicited donation.
- The seed must include every configured asset, meet the immutable target-composition tolerance, and pass fresh oracle bounds. S5B freezes the exact tolerance from token precision and rounding evidence.
- At the contract's documented USD scale `Q`, `nav_q = Σ oracle_value_q_i`. Initial shares are `floor(nav_q × 10^6 / 10^Q)`, where `10^6` is the share mint's six-decimal scale. This creates a nominal one-share-per-USD starting denomination only; the share has no dollar peg.
- Reject zero or below-`min_shares_out` issuance. There is no permanently locked minimum share. The pool's seeded flag prevents re-seeding or reinitializing the same pool after full exit.

### Later deposits

For offered maximum `A_i` in each asset, compute:

```text
shares_out = min_i floor(A_i × S / R_i)
consumed_i = ceil(shares_out × R_i / S)
refund_i = A_i − consumed_i
```

Reject zero reserves, zero shares, zero consumed legs, arithmetic overflow, or `shares_out < min_shares_out`. The instruction transfers `consumed_i`, mints shares, and returns `refund_i` atomically. This preserves the current basket ratio and does not require a spot oracle.

### In-kind redemption

For `0 < burn <= S`, a partial redemption outputs `floor(burn × R_i / S)` of every asset. Full-supply redemption returns every remaining custody base unit exactly, then leaves the pool permanently closed for new deposits. The instruction burns before token CPIs in the same atomic transaction and enforces `min_amounts_out[]`; dust remains in backing for remaining shares. Risk pause, scheduler state and oracle availability do not block exits.

### Fees, donations and liabilities

- The swap fee is withheld from effective input for quote math, while the trader's gross input remains in custody. Retained fee units increase actual backing and are included once in each reserve.
- A checked per-asset `u128` cumulative fee counter is informational only. It is not an extra reserve, claim, withdrawal bucket, or liability. The event records each individual fee delta.
- ETF v1 has no separate automation reserve, bounty claim, or protocol fee liability. TukTuk queue deposit, task rent and crank reward are funded outside pool custody by the queue owner; they are never charged to shares by this program.
- A direct post-seed donation is already visible in custody and therefore belongs pro rata to current shares; it does not need a state-sync instruction. If tokens are donated before first seed, seeding rejects. A donation after the pool has reached zero share supply cannot be captured by a new seed; that pool stays closed and a new pool identity is required.

## 7. Oracle contract and manifest dependency

S5A freezes an abstract `VerifiedPriceSet` input: one validated observation per configured asset, one bounded age policy, exact feed identity, positive price, bounded confidence/exponent, publish-time freshness, and a manifest-pinned source account. Verification is mode-specific: Receiver updates require `verification_level == Full`; fixed Push Feed accounts require the official owner/layout/status/update-provenance checks established by S5C. S5C owns the concrete parser and account-mode proof.

Pyth's current docs distinguish:

- fixed sponsored shard-0 price-feed accounts under the Pyth Push Oracle program; and
- ephemeral `PriceUpdateV2` accounts verified by the Pyth Receiver/Pull Oracle program.

They have different account lifecycles and owners. The chosen adapter must bind both program owner and account key and decode the exact feed identity. Do not pass a fixed push account to Anchor's `Account<PriceUpdateV2>` solely because both originate from the same feed. Full-verification Receiver updates are the reviewed fallback only if S5C proves the current SDK/version path and wallet update flow; partial verification is not accepted. A stale feed blocks new risk. An oracle-independent proportional deposit and in-kind redemption do not consult price.

The full candidate IDs, account addresses, status and direct-read requirements live in the [ETF v1 deployment manifest](../deployment-manifest-etf-v1.md). No candidate is a Devnet admission until exact genesis, account existence, owner, layout, feed identity, freshness, confidence and successful program consumption are observed on Devnet.

## 8. Scheduler contract

The scheduler calls only the public `poke`/eligibility instruction with the exact pool and feed accounts. It cannot set pool configuration, forge a price, transfer tokens, or settle a swap. Anyone may call `poke`; swaps and exits do not depend on scheduler availability.

TukTuk is the first replaceable Solana L1 candidate, not a verified Devnet dependency. It is accepted only after direct Devnet `getAccountInfo` proves the program is executable under the expected loader, a funded queue and compiled task are read back, and a distinct crank-turner-signed task-invocation transaction calls the exact `poke` payload. The no-backend product cannot use a scheduler mode that fetches a remote HTTP transaction. Queue deposit, rent/capacity, and per-run crank rewards are separate costs; a refundable queue minimum alone does not fund continuing operation. If TukTuk fails, compare only another proven L1 executor against the same contract and checkpoint. MagicBlock ER changes the execution environment and is not a drop-in L1 substitute.

## 9. Acceptance invariants before IDL freeze

- Pool configuration is immutable after initialization; any mint/feed/target/fee change gets a new pool identity.
- No user can mint shares against another user's deposit; deposits and exits conserve each token under integer rounding.
- Every accepted swap improves `D_bps`, satisfies the independent weighted-invariant/quote checks, and transfers exact SPL deltas atomically.
- Wrong mint, token program, custody, price owner, feed ID, verification, age, confidence, exponent, direction, size, slippage, paused state, or task payload is rejected on-chain with no token balance change.
- `poke` changes only bounded observation/eligibility state and cannot transfer tokens; a scheduler call never counts as a trade.
- All holders can redeem in kind under pause without oracle or scheduler state; a full-supply redeem returns all remaining custody.
- Oracle/custody/share/math/scheduler/client boundaries remain separately testable; no v0.3.0 account or IDL is changed.
