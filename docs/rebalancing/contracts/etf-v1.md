# ETF AMM v1 contract baseline

**Status:** S5A design baseline, not yet frozen for implementation. Separate the structural/interface baseline from the final contract and policy freeze: S5B may review parameterized core math, S5C may prove oracle account-mode/parser behavior, and S5D2 may run candidate economic sensitivities against explicit assumptions before S5A selects policy values. These evidence reviews do not themselves freeze precision, oracle/risk limits, fee bounds, or other contract parameters. S5A owns the final contract/policy amendment after reviewing the S5B math findings, S5C oracle evidence and risk requirements, and S5D2 economics plus required executable-depth/cost evidence. S5E must not freeze the implementation contract or start program code until that final S5A amendment and all named math, oracle/risk, and fee/economics decisions are accepted. S5 work may progress alongside independent S3/S4 implementation, but it does not waive their gates or admit either protocol to funded use. No deployment or Devnet admission is implied.

## 1. Protocol boundary

ETF v1 is a separate Anchor program and tokenized pool. It does not alter `programs/coloyond-vault` v0.3.0, its account layouts, auction settlement, share rules, or `cb3:` strategy identities. Its program ID, account discriminators, IDL, manifest, strategy identity, client, tests, and deployment are independently versioned.

The retained colleague blueprint remains the proposal record at [the full blueprint](../../product/blueprints/no-backend-auto-rebalancing-multi-token-etf-solana-devnet.md). This contract resolves its scheduler boundary: a scheduled call may evaluate and record eligibility, but it cannot supply the counterparty's tokens. Only a trader-funded `swap_exact_in` changes a pool's asset composition. The ETF v1 product is a bounded rebalancing AMM, not a general-purpose swap venue: a swap is accepted only when its post-fee value-weight deviation is strictly lower under the same accepted oracle snapshot.

## 2. Trust and authority model

- **Initializer model selected for the S5A amendment:** pool creation is permissionless at the PDA derived from canonical config bytes, and the initializer signer is only the rent payer. The config bytes include nonzero, distinct initial governance and emergency-guardian keys, so those roles and all economic fields are committed by the config hash and pool PDA. A different tuple derives a different PDA; no caller can substitute roles at the reviewed PDA. Clients must verify the full config hash and initial authority tuple against the reviewed manifest before showing any seed/deposit action. If another caller creates the exact approved pool first, clients read and verify that state and continue rather than treating that safe front-run as a different pool. Exact authority keys remain a deployment blocker; no defaults or placeholders are accepted.
- The pool stores separate governance and emergency-guardian authorities. The guardian can immediately pause risk-increasing instructions; it cannot transfer assets, change pool configuration, resume risk, or block `redeem_in_kind`.
- Governance may submit a delayed resume or authority-handoff proposal. Execution is permissionless after the pool's immutable 24-hour delay; a new authority must also sign acceptance. Governance cannot alter the asset set, target weights, oracle bindings, fee/risk policy, math version, delay or share rules. S5A must pin the initial authority identities and exact delay in the manifest before S5E; an unassigned key is a deployment blocker. The loader upgrade authority is a separate deployment control and cannot be inferred from pool governance.
- No arbitrary CPI, Token-2022 extension, lending position, leverage, cross-chain route, or external-program custody is in v1.
- Pool custody accounts are controlled by program-derived authority. Every transfer is checked against the exact pool, asset index, mint, token program, and expected custody address.

## 3. Account and module boundaries

| On-chain state | Responsibility |
|---|---|
| `EtfPool` | Version, unique pool ID, ordered asset count, exact canonical config bytes and hash, parsed execution fields, immutable initial governance/guardian keys, current governance/guardian keys, immutable delay, initializer/rent payer, share mint, lifecycle (`Unseeded`, `Active`, `Closed`), risk-pause state, sequence, last observation/eligibility state, and pending resume/handoff proposals. |
| `EtfAsset` (one per asset) | Ordered index, exact mint, classic token program, decimals, custody account, expected oracle account owner, exact Pyth feed ID/account mode pinned by the manifest, and informational cumulative fee base units. |
| Share mint | Classic SPL share token with six decimals, minted/burned only by the pool authority. |
| PDA custody token accounts | Actual reserves. These token-account amounts are the single source of truth for backing and AMM math. |

The pool persists `initializer` as the signer that paid account rent; it conveys no authority. It stores the exact canonical config bytes and verifies their hash, so `math_version` and immutable fee/risk policy IDs and parameters have an on-chain source as well as a reviewed manifest. Parsed execution fields must match the bytes; clients recompute the hash and compare both sources before offering actions. `lifecycle` begins `Unseeded`, changes to `Active` only on the first successful seed, and changes permanently to `Closed` on full-supply redemption, so zero share supply alone can never authorize reseeding. The pool also stores immutable initial authority keys from config separately from the mutable current roles. At most one resume proposal and one role-handoff proposal may be pending; each stores proposer, monotonically increasing proposal nonce, and `execute_after_unix_timestamp`, with a handoff additionally storing role and proposed key. A governance-only cancellation instruction consumes each proposal; a successful delayed execution consumes it as well. Nonces and the pool sequence advance on proposal, cancellation, and execution, preventing replay. Each `EtfAsset` fee counter accumulates the exact retained fee in that asset's base units; it is informational, adds no separate backing, and is reconciled with `SwapExecuted` events. This is the draft storage/source map required by the read model, not an accepted byte layout; S5A still has to size and freeze account serialization before S5E.

The repository boundary is:

```text
programs/coloyond-etf/       Anchor accounts, instruction validation, custody, shares,
                             oracle adapter, AMM instruction orchestration, events
crates/etf-math/             pure checked fixed-point value-weight and weighted-mean math
crates/etf-oracle/           mode-specific Pyth account parsing and validation
packages/etf-client/         manifest checks, PDA helpers, read/transaction builders,
                             wallet receipt reconciliation
packages/etf-scheduler/      optional scheduler SDK adapter; no protocol authority
apps/android/.../protocols/etf/  isolated ETF route and presentation model
docs/rebalancing/contracts/  versioned contract/read model/deployment manifest
```

`crates/etf-math` and `crates/etf-oracle` have no dependency on the ETF Anchor program; math has no oracle/RPC/wallet/token/scheduler dependency, and the oracle adapter does not own swap math. S5A-W registers these two pure crates in the root Cargo workspace and creates their minimal manifests before parallel implementation, then relinquishes those files. S5E alone owns `programs/coloyond-etf`, Anchor workspace registration, its `lib.rs`, and generated IDL. The scheduler adapter only builds registration and invocation transactions for public pool instructions. S5H consumes the generated program interface and owns final app composition/evidence, not program entry-point generation.

### Canonical pool and strategy identity

The typed field order, exact Borsh wire types, fixed oracle-mode tags, domain bytes and fixture-only vector are specified in the [ETF v1 canonical wire schema](etf-config-v1-wire.md). The config contains protocol version, ordered assets (mint, Token Program, decimals, oracle mode/program/account/feed ID and target weight), math version, immutable fee-policy ID/parameters, immutable risk-policy ID/parameters, initial governance and guardian keys, and governance delay. The initial authority tuple is committed to pool identity; current authority state may rotate only through the delayed handoff. The checked-in vector verifies outer serialization only: fee/risk parameter payloads remain opaque placeholders while S5C/S5D2 produce evidence and candidate amendments; S5A freezes their strict inner schemas and bounds after review. The program must reject unsupported counts, duplicate mints, zero/equal initial authorities, noncanonical order where a manifest order is required, trailing bytes and invalid weight sums. No floating-point value or display ticker is serialized.

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

Every client, manifest and program must derive the same values from the same ordered config bytes; S5A commits shared serialization vectors. Any change to an immutable field, including the initial authority tuple, creates a different pool PDA and strategy ID. Funding clients accept only the reviewed manifest hash and authority tuple. The Devnet genesis hash remains part of the deployment/read-model identity, not a substitute for the content-addressed config.

The client preflight also compares the immutable initial authority commitment and fetched current governance/guardian roles with the manifest's accepted authority state. A valid delayed handoff may change current role state while preserving pool identity. S5E must prove permissionless initialization handles third-party lamports sent to deterministic PDAs and does not become permanently bricked by pre-funding; it must reject conflicting owner/data safely. Exact retries must either return verified existing state or reject as already initialized. These are unproven program obligations until S5E transaction evidence exists.

## 4. Instruction surface

| Instruction | Caller and effect | Oracle dependency |
|---|---|---|
| `initialize_pool` | Any signer may pay rent for the PDA derived from one canonical `EtfPoolConfigV1`; no parallel authority or caller-selected identity arguments. Recompute and validate the full config hash and create the immutable pool configuration, share mint and per-asset custody atomically. | Validate manifest-pinned feed identities and policy; no token transfer. |
| `seed_pool` | Seed signer transfers the first proportional basket; program verifies target composition and mints the initial shares with `min_shares_out`. | Yes. |
| `deposit_proportional` | Signer supplies maxima for every asset; program mints against the limiting reserve ratio and returns unused inputs atomically. | No; proportional token math only. |
| `redeem_in_kind` | Share owner burns shares and receives each reserve pro rata in the same transaction. Works while risk is paused. | No. |
| `swap_exact_in` | Trader transfers real input SPL tokens and receives output SPL tokens atomically. | Yes, for quote bounds and pre/post value-weight deviation. |
| `poke` | Anyone records the current oracle observation, deviation, eligibility and sequence. Scheduler may invoke it; it does not trade. Swaps recompute their own guards, so a scheduler outage does not block a valid swap. | Yes. |
| `pause_risk` | Guardian pauses seed/deposit/swap/other risk-increasing actions. | No. |
| `propose_resume` | Governance records a resume proposal and its earliest execution time; it does not unpause immediately. | No. |
| `resume_risk_after_delay` | Anyone executes the still-valid proposal after the immutable 24-hour delay. | No. |
| `cancel_resume_proposal` | Governance consumes the pending resume proposal before execution. | No. |
| `propose_authority_handoff` | Governance proposes a new governance or guardian key; it does not change authority immediately. | No. |
| `accept_authority_handoff` | The proposed new key signs after the delay; the program updates only the named role. | No. |
| `cancel_authority_handoff_proposal` | Governance consumes the pending role-handoff proposal before execution. | No. |

No `rebalance()` instruction exchanges assets by itself. Every swap requires a trader signer and actual input-token accounts. All instructions use checked arithmetic and atomic token CPIs; any error rolls back state and token movements.

## 5. Value weights and trade direction

For each asset, normalize the raw price `p_i × 10^e_i` and base-unit reserve `r_i` using that mint's decimals `d_i` into a candidate fixed USD scale under S5B review. The current pure-math implementation candidate uses integer `10^-12 USD` units, rounds down, and rejects nonzero values below that resolution; this is a math candidate, not a contract or policy choice. S5B reviews the correctness and supported domain of parameterized math; S5A selects and freezes the production scale and associated contract bounds after reviewing the S5B findings with S5C and S5D2 inputs. See the [S5B math work log](../evidence/s5-math.md). Let `V_i` be that normalized oracle-marked value, `V = ΣV_i`, and configured target `t_i = target_weight_bps_i / 10,000`. Target weights sum to exactly 10,000 bps and are also the normalized exponents in the weighted constant-mean invariant.

The deviation metric is the total-variation distance in basis points:

```text
D_bps = 5,000 × Σ_i |V_i / V − target_weight_bps_i / 10,000|
```

S5B reviews the candidate fixed-point and conservative-rounding math over explicitly stated parameter domains; it does not select the production contract values. S5A freezes those values after reviewing the math evidence and the S5C/S5D2 inputs. `swap_exact_in` computes pre- and post-swap values with the same accepted oracle observations and includes the retained input fee in post-swap custody. It rejects a trade unless `D_post < D_pre`, the quote is inside the configured quote-parity/slippage band, output is nonzero, inventory and size bounds hold, and `min_amount_out` is met. The quote band compares fee-adjusted output value with gross input value, so it bounds curve impact plus fee relative to the accepted point mark; it is not the oracle confidence interval, a manipulation bound, or a guarantee of executable market parity. Its exact definition and value remain an S5A decision informed by S5D2 evidence. A result that rounds to equal deviation is rejected. This constrains direction but does not eliminate MEV, latency risk, or adverse selection.

`poke` records eligibility when deviation reaches the configured start band; clearing eligibility uses the configured lower stop band and cooldown. S5B reviews parameterized precision/dust behavior and S5D2 supplies candidate band/fee sensitivity; S5A selects and freezes the actual numeric precision, dust, bounds and bands before program implementation. A scheduled task is an optional liveness signal, not a prerequisite for a trade.

## 6. Shares and asset accounting

All input/output amounts below use integer base units. Let `R_i` be actual custody amount for asset `i`; `S` is share supply in six-decimal base units. Oracle NAV is a display/issuance denomination, not a redemption promise, peg, or return.

### Initial seed

- A new pool begins unseeded with zero shares and empty custody accounts. `seed_pool` rejects any nonzero pre-seed custody balance; no first depositor can capture an unsolicited donation.
- The seed must include every configured asset, meet the immutable target-composition tolerance, and pass fresh oracle bounds. S5B supplies parameterized token-precision and rounding evidence; S5A freezes the exact tolerance with the other contract/policy values.
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

S5A freezes an abstract `VerifiedPriceSet` input: one validated observation per configured asset, one bounded age policy, exact feed identity, positive price, bounded confidence/exponent, publish-time freshness, and a manifest-pinned stable source account. Pyth fixed price-feed PDAs and ephemeral price-update accounts both use the Receiver `PriceUpdateV2` layout and Pull Oracle account owner; both expose `verification_level`, and the ETF requires `Full`. ETF v1's canonical config pins an account key, so its `ReceiverFull` tag is limited to stable Receiver-owned accounts. Per-transaction ephemeral update accounts are not admitted by this version; supporting them requires a new authenticated runtime-binding schema. S5C owns the concrete parser and fixed-address derivation proof.

Pyth's current docs distinguish:

- fixed sponsored shard-0 price-feed PDAs, whose addresses are derived under the Pyth Push Oracle program from the little-endian shard ID and 32-byte feed ID, and whose long-lived data is updated through Pyth's sponsored/permissionless price-feed update path; and
- ephemeral `PriceUpdateV2` accounts that a client posts for a specific transaction/time and may later close.

These modes have different address derivation, lifecycle, and updater paths, but the current official guide describes both as `PriceUpdateV2` data owned by the Pull Oracle program. The Pyth TypeScript SDK derives a fixed feed PDA using the Push Oracle program ID, fetches it through the Receiver `priceUpdateV2` account coder, and builds updates via the Push Oracle instruction. Bind the expected data owner and account key separately, then validate the embedded feed ID, `Full` level and policy. Do not treat a shared parser as proof of the correct fixed PDA or updater path; S5C verifies both. Partial verification is not accepted. A stale feed blocks new risk. An oracle-independent proportional deposit and in-kind redemption do not consult price. [Pyth Solana integration guide](https://docs.pyth.network/price-feeds/core/use-real-time-data/pull-integration/solana), [sponsored feed list](https://docs.pyth.network/price-feeds/core/push-feeds/solana), [Pyth receiver SDK](https://github.com/pyth-network/pyth-crosschain/blob/main/target_chains/solana/sdk/js/pyth_solana_receiver/src/PythSolanaReceiver.ts).

The full candidate IDs, account addresses, status and direct-read requirements live in the [ETF v1 deployment manifest](../deployment-manifest-etf-v1.md). No candidate is a Devnet admission until exact genesis, account existence, owner, layout, feed identity, freshness, confidence and successful program consumption are observed on Devnet.

## 8. Scheduler contract

The scheduler calls only the public `poke`/eligibility instruction with the exact pool and feed accounts. It cannot set pool configuration, forge a price, transfer tokens, or settle a swap. Anyone may call `poke`; swaps and exits do not depend on scheduler availability. The draft candidate is TukTuk one-shot task chaining, under which an external scheduler adapter would register a `Timestamp` child after each successful poke, including a blocked or not-yet-eligible observation. A stale oracle must set or retain blocked eligibility; it must never turn stale data into a swap. Invalid configuration or task accounts may fail closed and rely on crank retry. A cancel/stop path must prevent further child creation without holding up exit. This remains a candidate, not the accepted scheduler ABI: task payload, task identity/nonce, duplicate behavior, child construction, stop authority and two-cycle proof are not in the ETF pool instruction surface and require S5D1 evidence plus S5A review before any freeze.

TukTuk is the first replaceable Solana L1 candidate, not a verified Devnet dependency. It is accepted only after direct Devnet `getAccountInfo` proves the program is executable under the expected loader, a funded queue and compiled task are read back, and a distinct crank-turner-signed task-invocation transaction calls the exact `poke` payload. The no-backend product cannot use a scheduler mode that fetches a remote HTTP transaction. Queue deposit, rent/capacity, and per-run crank rewards are separate costs; a refundable queue minimum alone does not fund continuing operation. The maintained TukTuk `TriggerV0` variants are one-shot `Now` and `Timestamp(i64)`; there is no native interval, cron or account-condition trigger. Recurrence therefore requires a separately reviewed ETF return-data/free-task requeue protocol and successive crank submissions, including bounded task capacity, stop conditions and external funding. If TukTuk fails, compare only another proven L1 executor against the same contract and checkpoint. MagicBlock ER changes the execution environment and is not a drop-in L1 substitute.

## 9. Acceptance invariants before IDL freeze

- Pool configuration is immutable after initialization; any mint/feed/target/fee change gets a new pool identity.
- No user can mint shares against another user's deposit; deposits and exits conserve each token under integer rounding.
- Every accepted swap improves `D_bps`, satisfies the independent weighted-invariant/quote checks, and transfers exact SPL deltas atomically.
- Wrong mint, token program, custody, price owner, feed ID, verification, age, confidence, exponent, direction, size, slippage, paused state, or task payload is rejected on-chain with no token balance change.
- `poke` changes only bounded observation/eligibility state and cannot transfer tokens; a scheduler call never counts as a trade.
- All holders can redeem in kind under pause without oracle or scheduler state; a full-supply redeem returns all remaining custody.
- Oracle/custody/share/math/scheduler/client boundaries remain separately testable; no v0.3.0 account or IDL is changed.
