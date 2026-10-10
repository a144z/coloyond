# S5 scheduler source audit

**Status:** TukTuk is the first replaceable L1 candidate. A direct Devnet read now confirms the candidate program account is executable under the upgradeable BPF loader; queue/task construction, task execution and public crank-turner availability remain unverified. Source review and a deployed program are not scheduler integration.

## Findings from official Helium sources

- TukTuk is a Solana L1 task queue/crank program. Maintainer instructions describe running a crank-turner operator; no guaranteed public Devnet executor was established.
- Queue creation documents a refundable 1 SOL minimum deposit, and each crank has a separate reward intended to cover transaction/priority fees. Queue capacity/rent and repeated task creation also have costs. A refundable minimum is not continuing automation funding.
- Queue authority and custom signer choices can expose queue funds; use a narrowly scoped queue and dedicated signer.
- Use compiled tasks only for the no-HTTP project architecture. TukTuk's `RemoteV0` obtains a signed transaction from an HTTP server and therefore requires a backend service.
- The source defines a 40-byte task-description limit and compiled instruction account indexes as `u8`. Exact ETF account list, task size/rent, transaction size, nested CPI behavior, compute units and crank reward remain to be probed; there is no single source-level limit that proves the composed ETF instruction fits.
- The maintained TukTuk `Anchor.toml` declares the cited program ID under `programs.localnet`, not `programs.devnet`; the separate direct account query below now confirms that the program is nevertheless deployed on Devnet. Source declarations and deployment presence still do not prove task execution.

## Devnet status

The read-only probe at [`tools/rebalancing/etf-scheduler-probe`](../../tools/rebalancing/etf-scheduler-probe/README.md) queried `https://api.devnet.solana.com`. At confirmed slot `509628407`, Devnet genesis was `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`; program `tuktukUrfhXT6ZT77QTU8RQtvgL967uRuVagWF57zVA` existed with `executable=true`, owner `BPFLoaderUpgradeab1e11111111111111111111111`, account space 36 and 1,001,141,440 lamports. This proves deployment presence only. No task queue, compiled task, funding, task transaction, external crank-turner, execution cadence or reward was read or exercised. No scheduler transaction has been sent.

## Required proof before S5/CP5 can pass

1. [x] Read Devnet genesis and prove the exact TukTuk program account exists, is executable, and has the expected loader owner (one point-in-time read; refresh before any task creation).
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
