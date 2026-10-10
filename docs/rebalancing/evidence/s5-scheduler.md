# S5 scheduler source audit

**Status:** TukTuk is the first replaceable L1 candidate; Devnet deployment and execution are unverified. Source review is not scheduler integration, and a permissionless program is not proof of a public/available Devnet crank-turner.

## Findings from official Helium sources

- TukTuk is a Solana L1 task queue/crank program. Maintainer instructions describe running a crank-turner operator; no guaranteed public Devnet executor was established.
- Queue creation documents a refundable 1 SOL minimum deposit, and each crank has a separate reward intended to cover transaction/priority fees. Queue capacity/rent and repeated task creation also have costs. A refundable minimum is not continuing automation funding.
- Queue authority and custom signer choices can expose queue funds; use a narrowly scoped queue and dedicated signer.
- Use compiled tasks only for the no-HTTP project architecture. TukTuk's `RemoteV0` obtains a signed transaction from an HTTP server and therefore requires a backend service.
- The source defines a 40-byte task-description limit and compiled instruction account indexes as `u8`. Exact ETF account list, task size/rent, transaction size, nested CPI behavior, compute units and crank reward remain to be probed; there is no single source-level limit that proves the composed ETF instruction fits.
- The maintained TukTuk `Anchor.toml` declares the cited program ID under `programs.localnet`, not `programs.devnet`. Source code and third-party examples are not direct proof of a live Devnet deployment.

## Devnet status

The audit attempted a read-only Devnet account query, but the environment could not resolve the public Solana RPC host. Therefore program executable/loader ownership, queue configuration, task execution, crank-turner identity, costs and cadence remain unverified. Do not represent TukTuk as deployed or available on Devnet until direct account reads and a confirmed invocation prove it.

## Required proof before S5/CP5 can pass

1. Read Devnet genesis and prove the exact TukTuk program account exists, is executable, and has the expected loader owner.
2. Wallet-sign queue creation/funding; record the 1 SOL deposit separately from queue/task rent and per-crank reward.
3. Register a compiled task with the exact public ETF `poke` instruction; record registration signature, queue/task PDAs, task ID, trigger and decoded payload, then read back the task account independently.
4. Capture a separate confirmed task-run transaction signed by the identified external crank-turner. Its inner instruction must invoke exactly `poke` and its before/after pool state must show eligibility/maintenance only.
5. Separately prove a trader wallet supplies SPL input for `swap_exact_in`. The scheduler invocation must not be described as a trade.
6. Prove permissionless direct `poke`, swaps and in-kind exits still work if the scheduler is unavailable.

If TukTuk fails the direct Devnet checks, evaluate another demonstrated L1 scheduler against the same `poke` contract. MagicBlock Ephemeral Rollups change the execution environment and are not a drop-in L1 replacement. If no candidate passes, Sprint 5 and CP5 stay blocked; a local simulation is not a substitute.

## Primary sources

- [Helium TukTuk repository and operator documentation](https://github.com/helium/tuktuk)
- [TukTuk task state definitions](https://github.com/helium/tuktuk/blob/main/solana-programs/programs/tuktuk/src/state.rs)
- [TukTuk task queue instruction](https://github.com/helium/tuktuk/blob/main/solana-programs/programs/tuktuk/src/instructions/queue_task_v0.rs)
- [TukTuk run-task instruction](https://github.com/helium/tuktuk/blob/main/solana-programs/programs/tuktuk/src/instructions/run_task_v0.rs)
- [TukTuk maintained `Anchor.toml`](https://github.com/helium/tuktuk/blob/main/solana-programs/Anchor.toml)
