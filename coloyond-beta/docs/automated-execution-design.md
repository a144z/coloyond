# On-chain portfolios and automated rebalancing

## Portfolio token model

- A portfolio is a base-layer `VaultState` PDA. It stores the supported mint list, target weights in basis points, price feeds, activity state, rebalance threshold, slippage limit, and last settled action nonce.
- Each vault owns one standard SPL share mint. Its freely transferable tokens represent a proportional claim on the whole portfolio; deposits mint shares and in-kind redemptions burn them.
- Each underlying asset stays in a standard SPL associated token account whose token authority is that portfolio's `Vault Authority` PDA. Target weights are configuration, not token balances.
- Only the separate `Executor` PDA and task sponsor are delegated to MagicBlock. Portfolio token accounts and share tokens are never delegated.
- Owners can update target weights on Solana. The ER calculation reads the latest saved configuration on its next run.

## Rebalance flow

1. A per-vault Hydra task invokes `rebalance_ephemeral` on an ER at 5,700-slot intervals, targeting about 60 seconds. Actual wall time depends on ER slot production and a running Hydra cranker.
2. The ER instruction reads the standard SPL balances and fresh Pyth prices, values every position in USD, compares actual values with target values, and pairs overweight assets with underweight assets. It can include multiple swap legs in one Magic Action request.
3. The base-layer vault program independently checks the task's Executor escrow, action age, price freshness, token mints and authorities, available balances and liquidity, quoted output against the configured slippage limit, and replay nonce.
4. If all checks pass, the base program transfers every leg using the vault Authority PDA and market Authority PDA and increments the nonce in the same atomic transaction. Any failed leg rolls back the whole action.

## Devnet market

The current Devnet swap destination is a program-controlled synthetic market with a capped, valueless test USD mint. It proves the standard-SPL custody and Magic Action settlement path; it is not a live exchange or a source of real BTC/ETH tokens. Production asset support needs real venue adapters, executable liquidity, and appropriately secured oracle/venue configuration.

## Devnet canary result

Vault `H1fupUxEGc781oFLcXDpDAWByLU7zTF1bUYTBiCxRC2h` has one transferable share mint and two classic SPL vault ATAs owned by its Vault Authority PDA. The Hydra crank `5kaxs2PnxosiSJu5RG6mgWdpMCE3gXtUUg5QrpmQw9rY` was read back at 5,700 slots. Two consecutive scoped ER triggers landed 56 seconds apart. The base-layer Magic Action settled nonce 4 atomically: the vault moved from 0.1 WSOL / 0 dUSD to 0.050000005 WSOL / 5.60355 dUSD, while the market accounts changed in the opposite direction. The dUSD is valueless Devnet test supply.

## Register or replace a task

Set `COLONYOND_VAULT_STATE` to an active portfolio PDA and run `npm run schedule:standard-vault`. The command uses the local Devnet CLI keypair, delegates the Executor and a small system-owned Hydra sponsor to the same ER, records the sponsor in a per-vault Scheduler Config, and creates the Hydra task directly on the ER. It checks the interval from the resulting crank account. It does not delegate or rewrite any portfolio token account.

The scheduled task is one task per portfolio. It will execute only while a Hydra cranker is available on that ER and only when prices are fresh, the vault has a rebalance drift above its threshold, and the synthetic market has enough liquidity. For the single-vault Devnet canary, `npm run crank:standard-vault` runs a scoped local cranker that watches only the configured portfolio task; stop it with Ctrl-C. A long-lived deployment should run a monitored cranker service for its own registered tasks.

For several already-scheduled vaults, `npm run crank:vaults` runs one long-lived process and fairly polls each ER task, continuing when one vault is temporarily unavailable. Set `COLONYOND_VAULT_STATES` to a comma-separated list of active Vault State PDA addresses, and `COLONYOND_CRANKER_SIGNERS` to a JSON object mapping each exact PDA to its local Hydra sponsor keypair file, for example:

```sh
COLONYOND_VAULT_STATES='VaultStatePda1,VaultStatePda2' \
COLONYOND_CRANKER_SIGNERS='{"VaultStatePda1":"target/sponsor-1.json","VaultStatePda2":"target/sponsor-2.json"}' \
npm run crank:vaults
```

Each sponsor file must be the signer already recorded in that vault's Scheduler Config and delegated to the same ER as its Executor. The runner checks vault state, config ownership/sponsor, ER delegation, Hydra task owner, 5,700-slot interval, and callback PDA accounts before triggering. It never prints signer contents. Run `npm run crank:vaults:self-check` for offline parsing and task-filter checks. This remains a process that an operator must keep running and monitor; it is not a hosted or supervised service.

## Local Devnet keypair

Use a separate CLI-only Devnet keypair at `~/.config/solana/devnet-id.json`; do not import a personal wallet recovery phrase. The deployment and canary scripts accept `SOLANA_RPC_URL` or `COLONYOND_BASE_RPC`, and the task registrar also accepts `COLONYOND_VAULT_STATE` and `COLONYOND_CRANKER_SIGNER`. The generated Hydra signer is stored under ignored `target/` by default.
