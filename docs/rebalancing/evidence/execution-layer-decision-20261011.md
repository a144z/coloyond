# Execution layer decision: MagicBlock first, TukTuk second (2026-10-11)

This record is an S5A amendment note, written on the side branch `feature/execution-layer-magicblock` so it rebases cleanly onto moving main: it adds no code, changes no program instruction, and touches two other documents only by appended paragraphs.

## Decision

The recurring execution layer now admits two providers behind one contract:

1. **MagicBlock — first priority.** The candidate is the MagicBlock base layer, referenced by earlier review as the "Hydra" candidate, driven by its own external crank. This is the L1-comparable candidate, not the Ephemeral Rollups component; MagicBlock Ephemeral Rollups change the execution environment and are still not an L1 substitute.
2. **Helium Cron→TukTuk — named second candidate.** The composition and its audit history are unchanged and remain recorded in S5D1 evidence.

The permissionless manual `poke` remains the fallback at all times. Priority here is an ordering of proof and build effort, not an admission: no provider is accepted until it passes the existing scheduler contract checks.

## Why the swap is safe

Every provider sits behind the same contract boundary in [ETF v1 contract section 8](../contracts/etf-v1.md): a generation-guarded scheduled `poke` against exact pool and feed accounts, no authority over configuration, price, transfers or settlement, and an eligibility-only state change. The ETF program itself is provider-agnostic; a preference change never requires a program edit. This is what makes the side branch upgradable onto main without touching Rust, IDL or the keeper TypeScript.

## Proof obligations that MagicBlock must now carry

Before MagicBlock can satisfy S5H/CP5 it needs the same class of evidence already required of Cron→TukTuk:

1. Read-only deployment proof: program/cluster presence, source or version pin, and the exact instruction path that invokes the ETF `poke`.
2. Task identity and payload proof: the scheduled payload must equal the reviewed compiled `poke` with exact pool and feed accounts, read back rather than assumed.
3. A distinct crank-turner-signed run transaction that invokes exactly `poke` and leaves custody, shares and prices unchanged; confirmation semantics of the provider must be verified, not assumed equivalent to Solana confirmation.
4. Stop authority and sequence: disabling or removing the schedule must stop future runs in flight terms that the provider documents, with an observed stale-run no-op if the provider can deliver a removed-but-in-flight task.
5. Funding and recovery costs listed separately: schedule storage, queue or slot cost, task rent or capacity, and per-run crank reward.
6. Successive runs: at least two consecutive provider-driven `poke` runs on Devnet-class infrastructure, since the no-backend product excludes any scheduler mode that needs a remote HTTP transaction fetch.

Until those are observed, MagicBlock holds first priority for work and probing only; CP5 and scheduler-automation claims stay blocked exactly as before.

## Files amended by this decision

- [ETF v1 contract, section 8](../contracts/etf-v1.md): appended priority paragraph.
- [ETF v1 deployment manifest](../deployment-manifest-etf-v1.md): appended provider-priority bullet under post-deployment admission evidence.
