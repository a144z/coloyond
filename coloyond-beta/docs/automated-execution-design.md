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

### Operator-run Hydra service

MagicBlock's Hydra project provides an official `hydra-cranker` binary. Hydra tasks are permissionlessly triggerable when due; for an Ephemeral Rollup, the binary runs with `--ephemeral`, connects to the ER and base RPC, and delegates its own operator keypair. This means the per-portfolio sponsor key generated during task registration is only needed for task creation and does not need to be stored or shared with the service. The public Hydra materials document the cranker software, not a MagicBlock-operated hosted cranker service. See the [official Hydra repository](https://github.com/magicblock-labs/hydra).

Use one process and one dedicated operator keypair for each distinct ER endpoint. The official cranker watches Hydra tasks on that ER, including newly created tasks; it does not need a list of portfolio sponsor keys. Create a separate Devnet-only operator keypair for each ER and fund it with enough Devnet SOL for its initial delegation. Never use an owner's wallet or commit a keypair.

Install the upstream binary for the machine's architecture. For Apple silicon, the official package is:

```sh
npm install --global @magicblock-labs/hydra-cranker-darwin-arm64
command -v hydra-cranker
```

Create a private operator keypair file for each ER, fund it on Devnet, and set its file mode to `600`. The binary delegates that keypair to the ER on startup. Configure one process per ER in a JSON file outside Git, for example:

```json
{
  "binaryPath": "/absolute/path/to/hydra-cranker",
  "rollups": [
    {
      "name": "devnet-er-1",
      "rpcUrl": "https://<executor-er-rpc>",
      "baseRpcUrl": "https://api.devnet.solana.com",
      "keypairPath": "/absolute/path/to/cranker-er-1.json",
      "metricsPort": 9101
    }
  ]
}
```

The ER URL is the `fqdn` returned by MagicBlock for a delegated vault Executor. If vaults are delegated to different ERs, add one entry and a distinct operator keypair for each. Run the supervised fleet in a terminal with `COLONYOND_HYDRA_CRANKER_CONFIG=/absolute/path/to/crankers.json npm run crank:service`; `npm run crank:service:self-check` validates the config and generated arguments offline. The optional Prometheus port should only be enabled when firewall rules restrict access to trusted monitoring clients.

On macOS, install a per-user LaunchAgent to start at login and restart the fleet if it exits. The installer writes a plist but does not start it:

```sh
COLONYOND_HYDRA_CRANKER_CONFIG="$PWD/crankers.json" npm run crank:service:install-agent
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.coloyond.vault-cranker.plist"
```

Stop it with `launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.coloyond.vault-cranker.plist"`. Logs go to `~/Library/Logs/Coloyond/`. This is operator-managed infrastructure; your Mac must stay awake. For production unattended operation, run the same service on an always-on host with a process supervisor, persistent RPC/WebSocket connectivity, monitoring, and keypair backups. The repo does not deploy infrastructure or install/start the agent automatically.

## Local Devnet keypair

Use a separate CLI-only Devnet keypair at `~/.config/solana/devnet-id.json`; do not import a personal wallet recovery phrase. The deployment and canary scripts accept `SOLANA_RPC_URL` or `COLONYOND_BASE_RPC`, and the task registrar also accepts `COLONYOND_VAULT_STATE` and `COLONYOND_CRANKER_SIGNER`. The generated Hydra signer is stored under ignored `target/` by default.
