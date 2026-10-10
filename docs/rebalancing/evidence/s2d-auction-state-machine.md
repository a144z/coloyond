# S2D auction state-machine evidence

**Status:** local Anchor implementation and generated IDL only. No admitted
policy account, initialized vault, deployed program, validator CPI proof, live
feed verification, funded taker, or executable market is claimed.

## Implemented interface

The program exposes `start_rebalance`, `fill_auction`, and `finish_or_expire`.
`RebalanceIntent` is a single PDA per vault, so a concurrent start cannot
create a second live auction. Its sequence is a per-fill compare-and-swap
counter; each accepted fill increments it atomically and uses the prior value
to derive a unique `BountyClaim` PDA. Replayed or stale fills fail before a
second state transition. `finish_or_expire` closes the intent PDA to its signed
caller on every terminal path, including stale-configuration recovery, so the
fixed PDA can be initialized again for a later auction and its rent is returned
to the caller that performed the close.

`fill_auction(expected_intent_sequence, sell_amount, gross_buy_amount,
bounty_amount)` preserves the S2C solver shape. The taker transfers the gross
incoming amount to the configured vault custody account and receives the
outgoing amount from the opposite custody account. Both CPIs, the bounded
math quote, accounting update, bounty liability, claim receipt, intent size,
and sequence update are in one Solana instruction. A CPI or later check error
therefore reverts the transaction state atomically. The fill has no immediate
bounty payout: it records a per-executor claim and aggregate Vault liability;
the separate payout path remains S4 work under S0F's `claim_bounty` contract.

## On-chain checks

- A versioned `AuctionPolicy` PDA is required and contains explicit oracle
  age/confidence/USDC deviation, drift, maximum trade value, cooldown, auction
  duration/curve, fee, bounty, per-fill and cumulative NAV-loss, and feed-map
  parameters. No numeric defaults are embedded. Start copies the relevant
  bounds into the intent. Policy has **no initializer** in this revision, so
  callers cannot create an executable policy before S4/config admission.
- Start, fill, and price-dependent early finish require the two pinned Pyth
  `PriceUpdateV2` accounts. The S2A SDK adapter checks account address/owner,
  feed ID, `Full` verification, freshness, positive price, confidence and
  USDC parity under explicit policy inputs. Published feed account state is
  still unverified by S0B.
- Custody and mints are bound to `Vault`; SPL Token is the classic token
  program. The taker source/destination must have the expected signer owner
  and corresponding input/output mint. Direct donations are synchronized
  from live account balances; deficits reject.
- Start checks configured target drift, direction, cooldown, inventory, and a
  ceiling-rounded USD-Q9 maximum trade value. Each fill uses S2B's checked
  Dutch curve, size/inventory, no-overshoot, NAV-loss and post-fee drift
  improvement checks. It adds conservative per-fill NAV loss to a cumulative
  intent loss bound against start NAV; overflow rejects.
- A fresh unchanged push-feed timestamp may price multiple fills. Freshness is
  checked on every transition, timestamps cannot regress, and CAS sequence
  prevents transaction replay. Strictly increasing observations remain the
  separate S3 condition-module contract.
- Each booked bounty is capped by policy and by unencumbered seeded
  `bootstrap_reserve`; `bounty_liabilities` are subtracted from share backing.
  A stale target/policy revision makes fills reject but permits permissionless
  intent closure, avoiding a stranded PDA. Expiry and completed intents can
  close without current oracle data. In-kind redemption remains independent
  of oracle and auction accounts and risk pause.

## Validation and remaining gates

The package runs Anchor-native tests for policy bounds, bounty reserve
coverage, stale intent closure, sequence replay/overflow, unchanged fresh
feed reuse, and timestamp regression. S2A and S2B tests are linked into the
same crate suite. `idl/coloyond_vault.json` and the TypeScript IDL are generated
from the actual program entrypoints. The Solana v1.57 SBF build completed with
no stack-frame overflow diagnostics after boxing the auction accounts and
splitting fill math/CPI work into bounded helpers.

These are local compile/unit/SBF and IDL checks. The package cannot prove actual
SPL CPI rollback against a local validator because S1F intentionally leaves
`initialize_vault` unavailable, and the policy account has no approved
initializer. S0B feed accounts/authority and S4 economics/configuration remain
admission blockers. Do not enable funded UI, seed, Devnet operation, or public
custody based on this package.
