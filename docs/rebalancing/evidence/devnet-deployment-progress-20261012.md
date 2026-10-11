# Devnet deployment progress (2026-10-12) — toolchain, program ID, loader reality, and the deploy path

Status: recorded evidence of what was verified on the live Devnet cluster and in the local toolchain. Nothing here admits the manifest, the asset policy, or a pool; the program is pinned but not yet executable.

## Toolchain and artifact

- `cargo-build-sbf` 4.4.0 with platform-tools v1.57 installs and builds on this Windows workspace (after clearing a corrupted platform-tools cache that lacked its `rust` directory).
- `cargo build-sbf` in `programs/coloyond-etf` emits `target/deploy/coloyond_etf.so` (~464 kb, release, SBF v3); incremental rebuilds after a `declare_id!` change take seconds; the built binary bakes the declared program ID, so a rebuilt artifact is required whenever the ID changes.
- The package declares both `cdylib` and `lib` crate types, which disables link-time optimization; a warning only, noted for a later cleanup decision.

## Program identity

- Final Devnet candidate program ID: `DVvBu6GDonibiR5aPqW27tt5RLcA5c4foVKojicxNm6q`, generated as a real keypair (gitignored `etf-program-keypair.json`, array form `etf-program-keypair-array.json`).
- Pins updated together per the runbook rule: `declare_id!` in `programs/coloyond-etf/src/lib.rs`, the `address` field of `idl/coloyond_etf.json` (copied to `public/idl/`), and the `[programs.devnet]` entry of `Anchor.toml`; `[programs.localnet]` keeps the earlier placeholder.
- Buffer accounts (upload vehicles) use their own gitignored keypairs (`devnet-program-keypair.json`); several were consumed during instruction-shape probing and their rent is parked on-chain.

## Loader reality on this Devnet (definitive, source-checked)

`BPFLoaderUpgradeab1e11111111111111111111111` on the live node is the upgradeable loader of the `solana-labs/solana` v1.17.20 line (`sdk/program/src/loader_upgradeable_instruction.rs`, `sdk/program/src/bpf_loader_upgradeable.rs`, `programs/sbf/rust/upgradeable`), not the plain v2 `BPFLoader2111…`. Consequences, each confirmed by a live transaction error or acceptance:

- The program-verification feature is active: a non-executable program account cannot be invoked, and a BPF-family owner is rejected for deployment (`Unsupported program id` during simulation).
- Instructions are bincode with u32 variant tags: `InitializeBuffer` = 0 (authority taken from the account list; payload bytes were tolerated), `Write { offset: u32, bytes: Vec<u8> with u64 length }` = 1, `DeployWithMaxDataLen { max_data_len: u64 }` = 2, `Upgrade` = 3, `SetAuthority` = 4, `Close` = 5.
- Deployment is a three-account model: a buffer (37-byte state header plus code; written by tag 1), a Program account (36 bytes, owns the program address), and a ProgramData account whose address is the loader-addressed PDA derived from the program address (45-byte header plus code). The deploy transaction creates program and programdata in the same transaction as the deploy instruction itself.
- Buffer state is one-shot: a wrongly shaped `SetAuthority` or `InitializeBuffer` bricks a buffer (sysvars cannot sign as authorities), and this fork's system program has no `realloc`, so a bricked or mis-sized buffer must be re-created rather than repaired.
- Buffer rent-exemption at Devnet rent costs ~2.416 SOL for a 475 kb buffer; the deploy needs buffer plus programdata, program itself is negligible at 36 bytes. Lamports are parked, not burned, and are recoverable through the loader's own `Close` instruction.

## Transaction-client findings (`@solana/web3.js` fork)

- Deploy instructions must be addressed to the loader id, not the program id; the bundled legacy `Loader` helper (its write/finalize tags and one-key account lists) does not match this native and was not used.
- Legacy transaction packets cap at 1,232 bytes: with the five-key account set the practical write chunk is 800 bytes; a u32 offset with a u64 vector length (16-byte header) is the accepted write framing.
- The shared public Devnet RPC rate-limits per IP (429 with retries under a naive loop); sending at roughly 1.5 transactions per second with preflight at `processed` (skipping the extra simulation round-trip) streams 595 writes without further 429s.
- JSON-RPC through the bundled client cannot carry a BigInt parameter (airdrop amount must be a number or use a raw request); the wallet airdrop itself is capped daily (429 answer).
- No `Program`/`Token`/`TokenProgram` class or ATA helper exists in the bundle; the token program ids and loader ids are exported constants (used read-only so far).

## State of play

- Offline verification green after the pins: typecheck clean, 28/28 portfolio tests, production build.
- `public/etf-devnet/deployment-manifest.json` still serves the pending placeholder, so the dapp desk keeps its fail-closed live section while deployment finishes.
- The one-shot deploy script `scratch/deploy-final3.mts` (create, init, chunked writes, deploy with PDA programdata in-transaction) is ready; the open blocker is Devnet SOL: two further rent-exempt accounts are needed and the RPC faucet answered its daily cap at log time with ~0.33 SOL left in the wallet.
- MagicBlock Ephemeral-Rollups delegation and the Validator-Crank auto-`poke` proof (the S6 gate) remain blocked behind executable plus init/seed; Devnet support itself is affirmed by the vendor's own endpoints, and community friction concerns base-Devnet restarts rather than MagicBlock (see the execution-layer decision evidence).
- Not yet touched and due right after deployment: governance and guardian keypairs for the config, Test USD and WSOL mint/ATA preparation, and the exact borsh encoding of `EtfPoolConfigV1` for `initialize_pool`/`seed_pool`.
