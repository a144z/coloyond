# S5 Devnet ETF program deployment — wallet-reviewed runbook

**Status: prepared procedure only; not deployment authorization.** No deployment transaction has been built or signed. This runbook does not make the current S5E draft deployable: its ID is a Localnet placeholder, the Devnet manifest and authority tuple are absent, and risk-increasing instructions remain fail-closed. The user's instruction is to prepare a wallet-reviewed flow; it is not an instruction to deploy without a separate explicit review/signature.

## Separation of identities

The deployment uses two independent identities:

1. **Program ID keypair** — determines the permanent program address. It is not the payer wallet and its secret must stay outside the repository and logs. The public address must match Rust `declare_id!`, the Anchor configuration, and the generated IDL before the final build.
2. **Deployment signer / fee payer** — reviews and signs deployment transactions and becomes the initial upgrade authority unless a different approved authority is deliberately provided. The signer must be the user's chosen wallet. Do not export its secret into the app or paste it into chat.

The user-facing wallet connected to the React app cannot by itself deploy a Solana program. Program deployment is an operator action through the Solana CLI and a configured signer. If a hardware wallet or external signer is used, first confirm that the installed CLI supports that signer and that the command actually prompts that wallet; never silently fall back to a local keypair.

## Stop gates before asking for a wallet signature

All gates below must be recorded in the S5 evidence and the reviewed transaction summary:

- S0B/S5A asset admission is complete for each exact mint. The Devnet Test USD candidate is synthetic, unbacked and not redeemable as USDC; it must be explicitly accepted for this test or excluded. A ticker/feed does not prove backing.
- The exact oracle account keys, Receiver owner, `PriceUpdateV2` layout, embedded feed IDs, `Full` verification and accepted freshness/confidence/exponent bounds are verified. Stale or unavailable feeds stay fail-closed.
- The S5A config and strict fee/risk wire schemas are frozen for this Devnet-only test profile, while remaining distinct from production policy.
- Exact governance, emergency guardian, deployer, and upgrade-authority public keys are reviewed. The current contract requires the governance/guardian tuple as part of canonical pool identity; these are not interchangeable with the deployer.
- S5E has a reproducible SBF build for the reviewed commit, successful Localnet SPL CPI and rollback evidence for the intended init/seed/deposit/refund/redeem/swap paths, oracle rejection cases, and pause-safe exit. Currently those transaction proofs are missing; `seed_pool`, `swap_exact_in`, and `poke` still return `PolicyNotFrozen`.
- `declare_id!`, `Anchor.toml`, generated IDL, artifact, source commit, and generated program keypair public address agree. `H3CkHowYVQcxrKXWkyswMW2rqRNzRQYaQr7N8LKXFUt9` is not eligible: it is the Localnet compile placeholder.
- The exact Devnet genesis hash is read from the selected RPC immediately before deployment. The deployment wallet balance covers program rent and transaction fees. No Mainnet endpoint or signer is accepted by this runbook.

If any gate is open, stop before creating or submitting deployment transactions. Record the failed gate and its evidence instead.

## Wallet review and deployment sequence

This is an operator-guided procedure. Before each signing prompt, show the user the network, genesis hash, program ID, artifact SHA-256, source commit, payer address, intended upgrade-authority address, expected maximum cost, and exact action. The wallet owner reviews the operation and decides whether to sign. No browser wallet popup or signature is implied by these steps.

1. **Pin the release candidate.** Record the feature branch commit, clean worktree status, toolchain versions, SBF artifact path and SHA-256. Do not build from an uncommitted tree. Independently reproduce the SBF artifact and compare the hash/equivalent verifiable-build evidence before deployment.
2. **Pin the IDs.** Generate/select the program ID keypair through the approved local secure process, outside the repository. Reveal only its public address. Update `declare_id!`, `Anchor.toml`, and generated IDL together; review and commit these exact changes before building the final artifact. Do not reuse the current placeholder.
3. **Check signer and cluster without exposing secrets.** Review `solana --version`, `solana config get`, signer public address, Devnet genesis hash, and balance. The signer path or hardware-wallet URI may be shown only locally; never print keypair bytes or copy them to the repo. Pin the RPC URL and verify its genesis equals `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` before proceeding.
4. **Review the deployment command.** Use the project-specific `.so` path and explicit program-ID keypair. Confirm the installed `solana program deploy --help` options before running. The deployment uses the reviewed wallet as payer and, by default, upgrade authority. Do not use `--final`; immutability is irreversible and is a separate product/governance decision.
5. **Sign and submit only after review.** The user confirms the wallet's displayed Devnet deployment operation. If the wallet cannot show or safely sign the CLI operation, stop; do not substitute another signer. A submitted deployment is pending, not successful.
6. **Reconcile from RPC.** Retrieve the deployment signature and confirm it at the required commitment. Read the program account and ProgramData account directly from the same verified Devnet endpoint. Check executable status, loader owner, exact program ID, ProgramData address, upgrade authority, deployed slot, data length, and deployed binary verification against the recorded artifact. Record the transaction fee and rent separately. If submission times out, query/reconcile the signature and program state before offering any retry; do not redeploy blindly.
7. **Publish accepted artifacts only after reconciliation.** Create the accepted Devnet manifest and production-served IDL from the verified deployment, including genesis, RPC label, program and ProgramData identities, artifact/build hash, authorities, exact mint/feed profile, and evidence links. Verify the frontend consumes those exact artifacts and still gates when any identity or oracle check fails.
8. **Prepare the first pool transaction separately.** Only after the deployment artifact passes all gates should the frontend prepare initialization. Show canonical config bytes/hash, exact pool PDA, authorities, mints, feeds, token programs, wallet, rent/fees, and expected post-state before a wallet signature. Reconcile the confirmed signature and RPC account state. Deployment approval does not approve pool initialization, seeding, swaps, or any later transaction.

## Command shape (not ready to execute)

The command below is intentionally a template. Replace each placeholder only after all stop gates close and the user has reviewed the displayed identities. Do not paste a private key into any argument or environment variable.

```sh
# Read-only checks first; compare the RPC genesis to the manifest.
solana --version
solana config get
solana address
solana genesis-hash
solana balance --url https://api.devnet.solana.com

# Inspect local CLI flags, then review the exact target command before signing.
solana program deploy --help
solana program deploy <reviewed-sbf-artifact.so> \
  --program-id <program-id-keypair-path-outside-repo> \
  --url https://api.devnet.solana.com

# After submission, reconcile the returned signature and program state.
solana confirm <deployment-signature> --url https://api.devnet.solana.com
solana program show <reviewed-program-id> --url https://api.devnet.solana.com
```

This command shape uses the CLI wallet as the payer and default upgrade authority; verify the installed CLI's exact behavior/options before signing. Deployment uploads can use temporary buffer accounts and are not atomic; if interrupted, inspect and recover the buffer state before retrying. Keep the upgrade authority active during this Devnet test. Never close the program or revoke authority as cleanup.

## Current disposition

**Not ready for a deployment signature.** Current evidence still has no admitted Devnet ETF program/pool, no final program ID or authority tuple, no accepted asset/oracle policy, no public deployment manifest or served matching IDL, and no on-chain SPL CPI/rollback proof. `solana` and `anchor` are not installed in the active shell (`command -v` found neither), so no CLI deployment command or wallet-signing flow was run. An ignored `target/deploy` directory contains candidate ETF keypair and SBF artifact files; their relationship to each other and to the current source/placeholder ID is unverified. The keypair contents were not opened, copied, moved, or used. The next action is to close those code/evidence gates, then establish the public program ID without exposing its private key and create a reproducible artifact for the user to inspect. At present there is no wallet transaction for the user to sign.

## Official references

- [Solana program deployment](https://solana.com/docs/programs/deploying) — CLI deployment, selected program ID, program/ProgramData concepts, upgrade authority, and deployment cost.
- [Solana CLI reference](https://solana.com/docs/references/solana-cli) — CLI version and `--help` guidance, Devnet checks, deployment and reconciliation commands.
- [Solana production readiness](https://solana.com/docs/tools/production-readiness) — non-atomic deployment/buffer recovery, rent, upgrade-authority handling and verification.
- [Solana program deployment model](https://solana.com/docs/core/programs/program-deployment) — loader-v3 upgrade authority and program verification.
- [Anchor CLI reference](https://www.anchor-lang.com/docs/references/cli) — workspace `anchor deploy` deploys workspace programs and may generate a new program address; avoid using it as an unreviewed shortcut for this multi-program repo.
