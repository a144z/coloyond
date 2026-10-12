# Web vault implementation status — 12 October 2026

The current request supersedes the Android/Glider hackathon scope for this
branch. It asks for wallet-created pooled ETF vaults, SPL shares, live Pyth
valuation, permissionless automatic swaps, editable membership/weights and
verified Localnet then Devnet operation. Android application sources are
outside this change.

## Repository review and access

The private repository was cloned from `a144z/coloyond` using the supplied
credential without storing it in files or the Git remote. At the initial inventory, all 19 existing PRs
were closed. Their descriptions, review comments and reviews were retrieved;
GitHub returned no review comments or reviews. Issue listing returned HTTP 403,
`Resource not accessible by personal access token`, so issue bodies and issue
conversation history could not be reviewed. No issue was closed or represented
as resolved. Repository docs contain historical, conflicting execution plans;
README, HANDOFF, the ETF contract/config/read-model sources, deployment runbook,
Localnet harness and latest acceptance evidence were compared with the code.
This is not a claim that every repository document or source file was audited.

## Concrete repairs

- ETF `rebalance` previously checked parameters/cooldown and saved a timestamp
  without validating oracle prices or moving any token. It now rejects with
  `PolicyNotFrozen` and does not attest to a completed rebalance.
- Portfolio-v2 `execute_scheduled_rebalance` previously changed cached units
  without SPL CPI. It now rejects with `ExecutionNotImplemented`. Its interface
  is preserved; the Android application is untouched.
- `init_weights` validates input before its panic-based constructor and rejects
  intervals below five seconds or above the signed timestamp domain. Eligibility
  also rejects unsafe intervals, including already-created legacy state.
- The weights client now decodes the pool key before the bump, checks optional
  expected-pool binding, option tags, bounded vectors and cooldowns. It uses the
  browser-compatible SHA-256 dependency instead of `node:crypto`.
- The web pool reader now reads share mint and initializer after the actual
  Borsh Vec length; the reserved allocation tail is not a serialized Vec field.
  Its test fixture now uses the same layout as the Rust serializer and Localnet
  harness, rather than a fabricated fixed-width config.
- The owner panel renders each asset weight and uses ordinary checked bigint
  parsing. It no longer calls nonexistent `BigInt.asIntNBit`. Drafts reset when
  pool/targets change, not on every identical polling snapshot. Legacy rebalance
  controls remain unavailable unless an execution capability is explicitly
  supplied. The live desk no longer suggests MagicBlock/poke is a swap.
- The Python observer now starts, reads live pool/weights/custody/Pyth state,
  checks feed owner/discriminator/Full verification/feed ID/age/confidence, and
  reports value and drift. Fractional SPL balances no longer round down to
  whole tokens before valuation. Empty pools and malformed baskets do not
  trigger a trade. Sending is explicitly rejected until execution exists.
- The MagicBlock smoke source is preserved on `feature/magicblocks-backup` and
  removed from this branch. Historical docs are retained for provenance.

## Devnet read-only evidence

RPC `https://api.devnet.solana.com` returned the pinned Devnet genesis
`EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`.
At confirmed slot 510280745 (chain timestamp 1791812157), the configured ETF
program `DVvBu6GDonibiR5aPqW27tt5RLcA5c4foVKojicxNm6q` was absent.
SOL/USD account `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE` and USD account
`Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX` existed but both failed the
60-second freshness bound. No deployment, swap, or funding transaction was
submitted. These observations do not prove current feed freshness later.

## Remaining requirements: not completed

1. A token-moving DEX CPI adapter with actual available liquidity, supported
   mint/feed admission and reproducible integration evidence. Permissionless
   callers must never choose arbitrary custody recipients, token delegates,
   close authorities, fee recipients or trusted prices. A router allowlist
   alone is insufficient: validate every treasury balance/authority before and
   after CPI, exact input spent, minimum output, fresh Pyth value bounds,
   unchanged other holdings and improved drift in the same atomic instruction.
2. A keeper connected to that adapter: latest config discovery each iteration,
   cooldown/revision/replay checks, route building, fee caps, simulation,
   confirmation and token-delta reconciliation. The observer is not that bot.
   Independent operator liveness and fee incentives remain unproven.
3. LP-safe dynamic membership. Current pool identity commits immutable mints.
   Removing a token must first liquidate its treasury balance or distribute it
   to all LP holders, then atomically update mint/feed/custody membership and
   revision. Changing only a UI list or dropping an account would strand funds.
   Current governance proposals are creator acceptance, not share-weighted voting.
4. Wallet-created pool registration/discovery and the full web create/fund/edit/
   rebalance/redeem flow. Existing accepted-manifest checks are still needed;
   draft manifests must not be promoted merely to make controls appear live.
5. Complete Localnet SPL/DEX lifecycle and rollback proof, then a reproducible
   SBF artifact and Devnet deployment. The original program-ID and deployer
   keypairs are not in this clone. An authorized deployment signer and funded
   Devnet setup are needed. Do not put private key bytes in Git or the frontend.
6. Fresh Pyth updates on Devnet. Posting verified Receiver updates or refreshing
   the fixed push feeds must precede valuation; relaxing age checks to admit the
   stale captures would invalidate the oracle protection.

Keeper custody restrictions do not make an upgradeable program fully immutable:
its upgrade authority can change those rules. This branch has not revoked an
upgrade authority or claimed complete decentralization, economic security,
production readiness, or a completed requested implementation.

## Validation

Commands and final results are recorded in the PR. `npm run test:web` exposes
focused account-layout, instruction, governance and editor checks. `npm run
test:bot` runs the standard-library observer/math tests. `npm run typecheck`
and `npm run build` cover the browser sources. Rust host tests are separate
from a deployed SBF/Localnet transaction proof; passing one does not imply the
other. The Localnet harness now reads its program ID from the checked-in IDL,
and the Anchor Localnet address matches current Rust `declare_id!`; it no longer
loads the compiled binary under its old incompatible H3C placeholder.

Final host checks: 22 focused web/client tests, 17 Python observer tests, 26
ETF Rust tests, and 11 portfolio Rust tests pass. Browser typecheck and Vite
build pass. The broader ETF client suite initially passed 86/87; its single
failure was a stale draft-IDL fixture assertion, corrected and verified in the
focused rerun. No weighted math source changed. A shared Cargo build cache
initially produced an invalid proc-macro metadata error in the portfolio build;
cleaning that one proc-macro package and rerunning resolved it.

SBF/Localnet attempt: Agave 4.3.0 and `cargo-build-sbf` 4.3.0 were obtained.
Platform-tools v1.57 extraction did not complete during the validation window.
While incomplete, SBF `rustc --version` first failed on a missing driver library
and later exited with a bus error. Native extraction was attempted; no completed
SBF artifact or validator transaction result is claimed. The host Rust tests
use the separately installed Rust 1.89.0 and did pass. These toolchain attempts
do not change the explicit absence of DEX execution or Devnet deployment.

The repair is published as draft PR #43. Main was not merged or deployed.
