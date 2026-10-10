# Coloyond keeper core (S2D)

This package is a replaceable transaction submitter for the existing S2D `start_rebalance`, `fill_auction`, and `finish_or_expire` instructions. It reads Vault, GovernanceAccount, AuctionPolicy, and RebalanceIntent from Solana, wakes on account notifications and periodic reconciliation, simulates each exact instruction, applies an operator fee cap, waits for confirmation, then rereads chain state. Sequence and PDA state, rather than a local database, are the source of truth after restart.

## Safety boundary

- The library defaults to `dryRun: true`; dry run can read and simulate, but never signs or broadcasts.
- Runtime configuration only accepts `localnet` or `devnet` and checks the RPC genesis hash. Mainnet is rejected.
- Submission requires an explicitly supplied local runtime signer and a positive `maxFeeLamports`; no key file or secret is included here. `loadRuntimeSignerFromEnvironment()` reads the private keypair path from `COLOYOND_KEEPER_KEYPAIR` only when called. It never logs the key material.
- The signer is only an instruction caller/executor. It cannot initialize or change vault policy. A fill is considered only when a concrete taker proposal is supplied; the current adapter requires that taker to be the same explicitly configured signer and uses that wallet's own token accounts. Vault custody keys are never loaded.
- Proposal inputs select candidate amounts/accounts, not authority. The keeper does not calculate prices or parse them into an alternate oracle; each candidate is rechecked against current state and simulated against the pinned Pyth accounts, then revalidated atomically by S2D. An absent or invalid policy fails closed. This base has no AuctionPolicy initializer, so no production or funded execution is implied.
- No two-keeper independence, Devnet execution, liveness, safe economics, or deployment is claimed. S3E conditions are not in this package; it only schedules S2D instructions.

## Runtime

Configure `COLOYOND_KEEPER_RPC_URL`, `COLOYOND_KEEPER_CLUSTER`, `COLOYOND_KEEPER_GENESIS_HASH`, `COLOYOND_KEEPER_VAULT_ADDRESS`, and the public caller address in `COLOYOND_KEEPER_PUBLIC_KEY`. Dry-run is the default and does not load signing material. The public key should be a funded Localnet/Devnet caller if you want RPC simulation to execute the instructions. For submission, additionally set `COLOYOND_KEEPER_DRY_RUN=false`, a positive `COLOYOND_KEEPER_MAX_FEE_LAMPORTS`, and the private keypair path. Supply an `ActionProposalSource` for an approved start candidate or an independently funded taker fill; finish/expiry is derived from chain state. `KeeperService.run()` performs an initial full read, subscribes to the Vault, GovernanceAccount, AuctionPolicy, RebalanceIntent, both pinned Pyth accounts, and both custody token accounts, and also polls at a bounded interval. Notifications are wakeups only; every pass rereads the full account set.

Use a private local keypair file with restrictive filesystem permissions (group/other access is rejected on Unix) and set `COLOYOND_KEEPER_KEYPAIR` in the process environment only for an explicitly authorized local/devnet submit run. Do not put the path or key bytes in Git, app assets, or logs. The signing helper is never called in default dry-run mode.

## Validation

`npm test` covers fail-closed action selection, terminal and stale sequence handling, retry bounds, and post-confirmation reconciliation. `npm run typecheck` checks the package. These checks do not prove Localnet/Devnet liveness, a funded taker, or the S3 liveness drill.

The client keeps no persistent authority or local transaction database. A restart begins with a new full chain read; S2D's intent PDA and sequence compare-and-swap prevent duplicate financial effects. If the previous process ended while an RPC submission was still uncertain and the state has not landed yet, a later attempt can still consume a network fee even though the on-chain effect remains idempotent.
