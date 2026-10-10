# Account and instruction contract v1

**Status:** frozen S0 interface concept for local unfunded implementation. It is not an IDL or deployed-program claim. S1 may refine layout before the first implementation commit; after S1F, changes require a contract revision and coordinated migration decision.

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
| `initialize_vault` | configured initializer | Create config, mints/accounts and initial seed/share state atomically; reject pre-seed donation/inflation condition |
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

Precise account serialization, PDA seeds, event fields, instruction arguments, integer scale, dust policy, fee values, oracle thresholds, and bounty values remain for the S1/S2/S4 contract passes; they are deliberately not guessed here. The generated IDL becomes authoritative only when S1F records its hash and matching client vectors.
