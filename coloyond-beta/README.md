# coloyond

Mobile-first Solana Devnet portfolios. Each portfolio has a Vault State PDA,
standard SPL asset accounts controlled by its Vault Authority PDA, and one
transferable SPL share mint. Deposits mint shares from on-chain NAV; redemptions
burn shares and pay out each underlying asset pro rata.

## Automated execution

Each active vault registers one Hydra task on the shared 60-second cadence
(5,700 Ephemeral Rollup slots). Its callback evaluates every SPL asset in that
portfolio together; there is no per-token task or cadence choice. One running
cranker per ER services all portfolio tasks. The ER program values the vault,
calculates the required rebalance legs, and requests one Magic Action. The
Solana vault program checks the latest verified Pyth price
updates without rejecting them by age, a strict 0.1%
move from the last successful settlement, the minimum delay, slippage, token
accounts, liquidity and replay nonce before atomically moving standard SPL
assets. The first settlement establishes the price baseline; assets without an
oracle feed do not trigger the price guard.

The browser reads balances and displays actual settlement signatures; it is not
the trade executor. A Hydra cranker process must be running for scheduled tasks
to trigger. The app can use MagicBlock's official `hydra-cranker` binary in
Ephemeral Rollup mode; it needs an operator key per ER, not each portfolio's
one-time task-creation signer. The operator pays the ER trigger fee; portfolio
owners pay to register the shared policy. Setup is described in
[`docs/automated-execution-design.md`](docs/automated-execution-design.md).

## Devnet asset and swap limits

The executable asset set is currently WSOL plus synthetic Devnet USD, BTC, and
ETH stand-ins. They are not real BTC/ETH and are not redeemable for dollars.
Coinbase discovery and pricing are shown for exploration, but assets without a
deployed mint, oracle configuration, and executable venue are disabled in the
portfolio picker. Current rebalance settlement uses the program-controlled
synthetic market; there is no real DEX route on this Devnet path yet.

The investment preview shows an estimated USD allocation from the display price
book. SOL is wrapped to WSOL, deposited, and rebalanced by the scheduled task;
this is not an instant exchange quote. Settlement independently uses on-chain
Pyth prices and can wait for valid configured feeds or sufficient synthetic
market inventory. The display price book is for estimates and is not an execution input.

## Development

```sh
npm install
npm run build
npm run dev
```

For Devnet program setup, use a dedicated CLI-only Devnet keypair and follow
[`docs/automated-execution-design.md`](docs/automated-execution-design.md).
Never commit local signer files under `target/`.

Useful commands:

| Command | Purpose |
| --- | --- |
| `npm run build` | Typecheck and build the app |
| `npm run deploy:execution` | Deploy the vault program to Devnet |
| `npm run bootstrap:devnet-test-usd` | Create the capped synthetic USD market |
| `npm run bootstrap:standard-rebalance-vault` | Create the standard-SPL Devnet canary |
| `npm run schedule:standard-vault` | Register or replace one vault’s Hydra task |
| `npm run smoke:closed-loop:self-check` | Check the closed-loop smoke parser offline |
| `COLONYOND_SMOKE_VAULT_STATE=<PDA> COLONYOND_SMOKE_OPERATOR_KEYPAIR=<path> npm run smoke:closed-loop` | Trigger one due Devnet task and verify settlement nonce and SPL balances |
| `npm run hydra:cranker` | Start the monitored Hydra cranker; discovers the official binary and uses the local Devnet operator defaults |
| `npm run crank:service` | Alias for the monitored Hydra cranker service |
| `npm run crank:service:self-check` | Validate service configuration and command generation offline |
| `npm run crank:service:test` | Exercise health supervision, restart, and shutdown behavior with local fakes |
| `npm run crank:service:install-agent` | Install a macOS LaunchAgent for the official cranker service (does not start it) |
| `npm run crank:service:agent:self-check` | Validate LaunchAgent generation offline |

For a single Devnet ER, install MagicBlock's official `hydra-cranker` binary,
provide a funded operator keypair at `target/hydra-cranker-devnet.json` (or set
`COLONYOND_CRANKER_SIGNER`), then run `npm run hydra:cranker`. The command builds
a monitored Devnet config from those local defaults; set
`COLONYOND_HYDRA_ER_RPC` when your vault Executor uses a different ER endpoint.
For multiple ERs or custom key paths, save `target/hydra-cranker-fleet.json` and
run the same command. Keep that ignored config local to each device. The service
requires `/healthz` and rejects settings whose calculated failure-detection,
termination and restart bound reaches two minutes; the built-in default bound
is 32 seconds. `COLONYOND_HYDRA_CRANKER_CONFIG=/absolute/path/to/config.json`
overrides the default. ER slot production and RPC availability still affect
actual trigger and settlement timing.
