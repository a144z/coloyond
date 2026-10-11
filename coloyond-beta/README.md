# coloyond ✳︎

Mobile-first Solana devnet portfolios with MagicBlock Ephemeral Rollups (ER)
execution. Portfolio state is delegated to the ER and a MagicBlock task runs
the on-chain rebalance instruction every 60 seconds. The browser reports ER
state and holds no reserve signing secret.

## Devnet setup

Install Solana CLI, Rust/SBF tools, Anchor 1.x and Node, then:

```bash
npm install
npm run gen:keys                 # local-only keys under ignored target/
npm run bootstrap:reserve       # create/fund the devnet reserve and test mints
cargo-build-sbf --manifest-path programs/coloyond-execution/Cargo.toml
npm run deploy:execution
npm run bootstrap:execution-reserve
npm run dev
```

The deployment script creates `target/upgrade-authority.json`; this file must
never be committed. A devnet faucet may be needed to fund deployment rent and
transaction fees. Set
`SOLANA_CLI` if the `solana` executable is not on `PATH`.

`bootstrap:execution-reserve` delegates the shared synthetic reserve balances
into the ER and approves the program PDA as their SPL-token delegate. Portfolio
creation checks that this migration is complete before moving user funds.

## Execution flow

1. The owner provisions the vault token accounts and deposits on Solana devnet.
2. The app initializes the portfolio PDA with the asset mints, targets and
   threshold, then delegates it to the ER.
3. MagicBlock's SPL delegation flow moves vault balances into ER custody. The
   program PDA receives bounded SPL delegate allowances for vault and reserve
   accounts.
4. The app registers an on-chain scheduled task with a 60,000 ms interval.
   Rebalance calculations and token transfers happen in the deployed program;
   the open app only polls the ER state and balances for display.

Paused portfolios keep their scheduled task but return without trading.
Target changes and pause/resume actions update the delegated portfolio on the
ER. Oracle inputs are MagicBlock real-time Pyth feeds with a 60-second age gate.

## App commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite app |
| `npm run build` | Typecheck and build the production app |
| `npm run typecheck` | Check app and Node TypeScript configurations |
| `npm run gen:keys` | Create local-only devnet reserve/mint keys under `target/` |
| `npm run bootstrap:reserve` | Create and fund synthetic devnet assets |
| `npm run deploy:execution` | Deploy the built program to devnet |
| `npm run bootstrap:execution-reserve` | Delegate reserve assets and authorize program execution |
| `npm run cap:sync` / `cap:open` | Sync or open the Android project |

## Devnet demo limits

- Synthetic tUSD/tBTC/tETH are test tokens. They have no external backing.
- The UI can show an indicative reserve quote, but manual reserve swaps are
  disabled; the program owns scheduled portfolio execution.
- The current program uses MagicBlock's scheduled-crank CPI at a one-minute
  cadence. Program deployment and reserve migration are required before vault
  creation is enabled.
- User wallet mnemonics and vault keypairs remain device-local. Reserve and
  mint admin keys live in ignored local tooling files under `target/`.
