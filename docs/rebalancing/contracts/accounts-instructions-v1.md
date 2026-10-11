# v0.3.0 auction-vault account and instruction contract v1

> **Protocol ownership:** This document specifies the existing two-asset Dutch-auction vault (`programs/coloyond-vault`, v0.3.0). It is not the separate multi-asset ETF AMM contract in [`etf-v1.md`](etf-v1.md). The shared `v1` label is local to this legacy contract and does not define ETF v1 accounts, instructions, reserves, initializer authority, or settlement rules.

**Status:** frozen S0 interface concept for local unfunded implementation. It is not a deployed-program claim. The additive S3E condition revision below records the first concrete condition account and instruction contract; it does not authorize production policy values, deployment, or funded use.

## Accounts

- `Vault`: version, bump, authority/configuration, `Paused | Active`, revision, two mint/token-program/decimals/target-bps entries, share mint, total shares, locked minimum shares, reserve accounting, sequence, active auction pointer, and policy digest. Only the program may mutate accounting or transfer custody.
- `OraclePolicy`: version, bump, receiver program, exact SOL/USD and USDC/USD feed account/ID, maximum age, maximum confidence ratio, maximum USDC deviation, maximum cross-source deviation if later approved, and last accepted publish times. Numeric thresholds are unset until S0B evidence and review.
- `ConditionalRule`: version, enabled flag, target revision, condition kind, threshold/hysteresis, prior valid observation and publish time, minimum separation, expiry, nonce. V1 uses vault-level policy changes only; it is not a personal limit order.
- `RebalanceIntent`: version, sequence, target revision, eligible pair/direction, initial and remaining size, start/end slot/time, oracle snapshot, price bounds, cumulative loss and bounty/fee caps, status. One active intent per vault.
- `AutomationReserve`: token mint, holder-owned reserve amount, unpaid bounty liability, epoch spend and immutable policy revision. Backing and reserve claims must not be double-counted.
- SPL custody accounts and share mint: canonical associated/configured addresses; token program and mint must match `Vault` exactly.

## Instructions and authority boundaries

| Instruction | Caller | Required atomic checks / effect |
|---|---|---|
| `initialize_vault` | one-time program-upgrade-authority bootstrap signer plus separate seeder, governance and emergency signers | Create Vault and Governance PDAs; validate a pre-created zero-supply share mint and empty custody accounts; value the seed from pinned Full Pyth feeds; atomically transfer seed assets and mint computed shares; leave vault and governance paused and AuctionPolicy absent |
| `deposit_proportional` | holder | Check current backing ratio, user max inputs/min shares, exact token programs, sync donation or reject; mint shares atomically |
| `redeem_in_kind` | holder | Burn shares then transfer pro-rata assets and eligible reserve claim; no oracle/keeper/auction dependency; failure rolls back |
| `sync_donation` | permissionless | Account direct token donations to holder backing deterministically; no caller payout |
| `observe_condition` | permissionless | Accept only valid pinned Full Pyth data, strictly increasing publish time and configured crossing/hysteresis; write sequence/observation |
| `activate_condition` | permissionless | Re-check live predicate and revision/expiry/nonce; no keeper-supplied price authority |
| `start_rebalance` | permissionless | Require valid fresh prices, eligible drift, reserve/bounty bounds, cooldown/window, no active intent; freeze bounded intent |
| `fill_auction` | any solver | Atomic taker/vault transfer, fee and bounty booking; validate inventory/size/price/NAV loss/no overshoot and post-fee improvement |
| `finish_or_expire` | permissionless | Close only at target/terminal condition or fixed expiry; cannot extend existing price bounds |
| `claim_bounty` | earned executor | Pay only recorded earned liability within per-fill/epoch caps and reserve floor |
| `pause_risk` / `resume_risk` | narrow emergency/governance roles | Pause new deposits, observations/activation and auction risk as specified; never gate in-kind redemption |
| `propose_policy` / `execute_policy_after_timelock` | governance | Versioned bounded config; delayed execution; cannot arbitrarily withdraw custody or alter a live intent's bounds |

## Global checks

Every price-dependent instruction verifies the supplied account's owner and exact address/feed ID, Full verification, positive price, age, confidence and approved USDC depeg guard. All arithmetic uses checked integer fixed point and explicit exponent/decimal bounds. No action trusts a keeper-provided price or arbitrary CPI/program. State sequence and revision make stale/replayed submissions reject. Failed token transfer or downstream instruction rolls back all account and event effects. Pause is a risk gate, not a custody lock. Program upgrade authority remains a separate deployment trust boundary.

The frozen S0 interface paragraph above records the original design boundary; later source refinements are listed below. The current generated IDL is authoritative for instruction/account serialization, while deployment and funded use still require the documented gates.

## Bootstrap implementation refinement (10 October 2026)

- The initializer creates only the Vault and Governance PDAs. The classic SPL token mints, seeder token accounts and PDA-controlled custody token accounts must already exist. The share mint must have six decimals, zero supply, the Vault PDA as mint authority and no freeze authority; both custody accounts must be empty. Anchor creates the Vault/Governance accounts and seed transfers/share mint are atomic within the instruction.
- `bootstrap_authority` must be the current upgrade authority in the program's canonical loader `ProgramData`; it is separate from the seeder and the distinct governance/emergency signers. This requires an upgradeable deployment and is not proof that a deployment has been admitted.
- Current source computes seed NAV in Q9 USD from fresh, fully verified pinned feeds, values each asset at the Pyth lower confidence bound (`price - confidence`), converts that NAV to six-decimal share units at a provisional $1/share, and floors fractional shares. This is a conservative implementation convention, not an approved market price or finalized economic parameter. The minimum locked share floor, privileged feed limits and asset manifest still require review before funded use.
- The admitted source profile currently pairs classic SPL WSOL with canonical mainnet or Devnet USDC and maps each mint to its corresponding SOL/USD or USDC/USD feed. The program cannot infer the active cluster; the reviewed deployment manifest must choose the matching profile.
- No AuctionPolicy is created by bootstrap. The first policy must use the S4C governance proposal and delay; `resume_risk` validates the resulting policy before enabling risk.

## S3E condition interface revision 1

This additive revision pins the S3A pure condition module to an on-chain PDA and four Anchor instructions. `ConditionState` is a new account; existing `Vault`, `GovernanceAccount`, and `AuctionPolicy` layouts do not change. The versioned program IDL and the hash recorded in the sprint checklist are authoritative for this revision.

### `ConditionStateV1`

- PDA seeds: `[b"condition_state", vault.key()]`; one state per vault.
- Fields: `version: u8`, `bump: u8`, `vault: Pubkey`, `sequence: u64`, `next_nonce: u64`, `active_rule: Option<ConditionalRule>`, `active_bounds: Option<ConditionBounds>`, and `pending: Option<PendingConditionRule>`.
- `PendingConditionRule` stores the complete disabled `ConditionalRule`, all `ConditionBounds`, and `activate_after_slot`. `ConditionalRule` retains the S3A target, predicate, observed Pyth sample, expiry, revision guards and nonce.
- No account exists until a governance-authorized proposal supplies the full configuration. The first proposal creates only a pending rule; the active rule and bounds remain absent until the inherited governance delay elapses and anyone executes it. An absent state, missing bounds, unknown account version, or stale revision rejects closed.
- `ConditionBounds` is fully explicit: maximum observation age; minimum observation separation in seconds and slots; maximum rule lifetime in seconds and slots; maximum schedule delay in seconds and slots; and maximum hysteresis bps. No default or hard-coded production value exists. Its maximum observation age must be no greater than the current explicit `AuctionPolicy.maximum_age_seconds`.
- The current S1F accounts expose one `configuration_revision`, so S3E binds both S3A target and configuration revision guards to that exact value. A successful target activation increments it once in both `Vault` and `GovernanceAccount`; `AuctionPolicy.configuration_revision` advances with it while its numeric risk values remain unchanged, preserving the existing policy-to-vault binding.

### S3E instructions

| Instruction | Caller and effect |
|---|---|
| `propose_condition_rule(config, bounds)` | Only `GovernanceAccount.governance_authority` may sign. The full target, predicate, expiry and every bound are explicit inputs. The program snapshots the current revisions and clock, advances the rule nonce, and stores a disabled pending rule with `activate_after_slot = current_slot + GovernanceAccount.min_delay_slots`. A pending governance target change or a still-live rule/proposal rejects. This is the only account-creation path and cannot make a rule executable. |
| `execute_condition_rule()` | Permissionless after the recorded delay. Checks risk pause, vault status, absence of a pending governance target proposal, exact target/configuration revisions, rule expiry, explicit bounds and the bound against the current auction oracle-age limit. Promotes only the committed pending rule and bounds to active state. |
| `observe_condition()` | Permissionless. Reads bounds only from active `ConditionState`; accepts no caller-supplied bounds. Validates both exact pinned Pyth feed accounts at Full verification, the current AuctionPolicy confidence/age limits and USDC parity guard, maps the rule asset to its pinned feed, then stores the sample and advances condition sequence. |
| `activate_condition(expected_nonce)` | Permissionless single use. Revalidates the latest pinned Full Pyth prices and parity, latest trigger side, stored observation freshness, nonce, expiry, exact target/configuration revisions, risk pause, vault status, absence of a pending governance target proposal, and absence of the canonical active `RebalanceIntent` PDA. Atomically updates Vault and Governance target weights and revisions, advances only the AuctionPolicy binding revision, consumes the nonce and disables the rule. It performs no token transfer and cannot overlap an auction. |

The no-active-auction check relies on the canonical `[b"rebalance_intent", vault.key()]` PDA: a program-owned intent means an auction exists and blocks activation; only the system-owned empty PDA state permits it. Condition observations and activations are still unfunded protocol transitions until separate admission and transaction evidence gates pass.
