# coloyond

Mobile-first Solana Devnet portfolios. Each portfolio has a Vault State PDA,
standard SPL asset accounts controlled by its Vault Authority PDA, and one
transferable SPL share mint. Deposits mint shares from on-chain NAV; redemptions
burn shares and pay out each underlying asset pro rata.

## Automated execution

Each active vault registers one Hydra task at 5,700 Ephemeral Rollup slots
(about 60 seconds). The ER program values the vault, calculates the required
rebalance legs, and requests one Magic Action. The Solana vault program checks
the task authority, fresh Pyth prices, slippage, token accounts, liquidity and
replay nonce before atomically moving the standard SPL assets.

The browser reads balances and displays actual settlement signatures; it is not
the trade executor. A Hydra cranker process must be running for scheduled tasks
to trigger. The app can use MagicBlock's official `hydra-cranker` binary in
Ephemeral Rollup mode; it needs an operator key per ER, not each portfolio's
one-time task-creation signer. Setup is described in
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
Pyth prices and can wait for fresh prices or sufficient synthetic market
inventory.

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
| `npm run crank:service` | Supervise MagicBlock's official Hydra cranker per configured ER |
| `npm run crank:service:self-check` | Validate service configuration and command generation offline |
| `npm run crank:service:install-agent` | Install a macOS LaunchAgent for the official cranker service (does not start it) |
| `npm run crank:service:agent:self-check` | Validate LaunchAgent generation offline |

The service reads `target/hydra-cranker-fleet.json` by default, so run
`npm run crank:service` from the repository without an environment prefix. Keep
that ignored config local to each device because binary and operator-key paths
are machine-specific. Set `COLONYOND_HYDRA_CRANKER_CONFIG=/absolute/path/to/config.json`
only when you need to override the default.
