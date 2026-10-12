# Automated execution design

## Custody and canonical state

- Each portfolio is a base-layer `VaultState` PDA derived from the owner and a client-generated seed. It remains a normal Solana account and is not delegated to the ER, so the settlement program can read and update its replay nonce on the base layer.
- Each vault has a `Vault Authority` PDA derived from `VaultState`.
- The program creates one standard SPL share-token mint per vault, with the Vault Authority PDA as mint authority. Deposits mint shares; redemptions burn the holder's shares and pay an in-kind slice of each asset. The mint stays transferable.
- Each asset is held in a standard SPL associated token account whose token authority is the Vault Authority PDA. These accounts remain on Solana and are never delegated to the ER.
- A separate reserve program PDA controls the synthetic devnet market accounts. Reserve accounts provide liquidity; they are not portfolio custody.

## ER schedule and base settlement

1. The ER instruction receives read-only clones of `VaultState`, standard SPL balances, and Pyth price-feed accounts. It reads them to calculate a proposed trade; it never writes the portfolio token accounts.
2. One Hydra ephemeral crank is created per portfolio from its Executor PDA and a Vault State-specific seed. The scheduled instruction includes the instructions sysvar but deliberately omits the crank account: Hydra makes it writable in `Trigger`, and transaction-wide privilege promotion would otherwise make the stored schedule template fail to match. The ER instruction verifies the immediately preceding `Trigger` and the payer-bound crank PDA `[b"crank", executor, seed]`. Only this program can sign as that Executor PDA to create the crank.
3. Hydra stores intervals in slots. The source requests 5,700 ER slots, targeting 60 seconds. The active Devnet crank still reports 6,650 slots and its registration logs the old interval, even though the base and ER program-data accounts contain the updated 5,700-slot binary. The runtime therefore has not picked up the new scheduling handler; the reason is unresolved. Across seven confirmed ER invocations, observed wall-clock gaps were 86, 118, 186, 82, 207, and 115 seconds. Slot-based scheduling plus cranker lag does not guarantee a 60-second wall-clock cadence. Task execution also requires a continuously running `hydra-cranker --ephemeral` service.
4. Each portfolio has a dedicated Executor PDA for Hydra sponsorship and Magic Action fees. Only this lamport sponsor is delegated; it is never a portfolio token account. The ER program signs the standalone Magic Action request with the Executor PDA.
5. The base-layer action verifies MagicBlock's escrow signer is the expected ephemeral-balance PDA derived from the Executor PDA and action index. It loads the base-layer vault and reserve token accounts and Pyth accounts, checks each token account's mint and authority, requires full Pyth verification and fresh publish times, independently recomputes the trade quote, enforces the configured maximum slippage, and rejects an already-used rebalance nonce.
6. Only after all checks pass does the base program transfer SPL assets, signing the portfolio transfer with the Vault Authority PDA and the liquidity transfer with the reserve PDA. It increments the nonce in the same transaction, preventing replay.

## Oracle requirements

- Use persistent Pyth push-feed accounts on the base layer, not MagicBlock realtime-oracle accounts (which exist only on the ER) or caller-created pull-update accounts.
- SOL/USD, BTC/USD, and ETH/USD push feeds are listed as sponsored on Solana Devnet and normally update on a 55-second heartbeat. A freshness bound must account for feed and slot jitter; the settlement program still fails closed when the configured age is exceeded.
- Stable synthetic USD assets use a fixed $1 valuation only when their mint is a program-approved devnet test mint.

## Devnet proof required before enabling

1. Deploy the Anchor program and create one test `VaultState`, Vault Authority PDA, share mint, standard SPL vault ATAs, and reserve ATAs.
2. Run a focused ER canary instruction that deserializes a standard, nondelegated SPL ATA and reports its mint, authority, and amount. An RPC read or `getTokenAccountBalance` response alone does not prove an ER program can read it.
3. Create the per-vault Hydra task, run the ephemeral cranker, and observe the ER instruction submit a standalone Magic Action.
4. Confirm the base action accepts a valid fresh quote and rejects stale prices, excessive slippage, wrong token authority/mint, and replayed nonces. Verify only the standard SPL vault/reserve balances change.

## Local Devnet signer

Use the separate CLI-only keypair at `~/.config/solana/devnet-id.json`; do not import a personal wallet's recovery phrase. `Anchor.toml` and the canary runner already use this path. The compiled program is about 466 KB and its current Devnet rent-exempt minimum is about 2.367 SOL. The test signer needs at least 3 Devnet SOL for deployment, fees, and the small set of canary accounts. Send only valueless Devnet SOL to the CLI address shown by `solana address`.

The first compatibility check is implemented as `canary_read_standard_ata`. Build and deploy the program, then invoke it against a classic SPL account that has no delegate. Use `SOLANA_RPC_URL=https://rpc.magicblock.app/devnet` for deployment and `COLONYOND_BASE_RPC=https://rpc.magicblock.app/devnet` for base-layer canary reads if Solana's public Devnet RPC returns HTTP 429:

```sh
COLONYOND_CANARY_ACCOUNT=<vault-token-account-address> \
COLONYOND_CANARY_AUTHORITY=<vault-authority-pda> \
npm run canary:standard-ata
```

The runner signs with the separate local Devnet keypair at `~/.config/solana/devnet-id.json` by default, or the path in `COLONYOND_CANARY_SIGNER`. Before sending, it verifies the base account is the associated token account for the supplied Vault Authority and that MagicBlock reports it as not delegated. The on-chain instruction then requires a classic SPL token account with that authority and no SPL delegate. It prints the mint, token authority, and amount only after the ER instruction successfully deserializes that account. The selected signer needs a Devnet and ER transaction-fee balance.

After the canary succeeds, register a task for the test vault:

```sh
COLONYOND_BASE_RPC=https://rpc.magicblock.app/devnet \
COLONYOND_VAULT_STATE=<vault-state-pda> \
npm run schedule:standard-vault
```

This creates missing program-controlled market ATAs, delegates only the vault's Executor PDA, and creates one payer-bound Hydra task on the ER. It never delegates a portfolio token account. The script reads the registered interval back from the ER crank account; compare `registeredIntervalSlots` with `requestedIntervalSlots`. Keep an ephemeral Hydra cranker running against the delegated Executor's ER with the base RPC set to `https://rpc.magicblock.app/devnet`; scheduled execution stops when no cranker is available. The source requests 5,700 slots, but this task reports 6,650. A task with zero balances exercises the recurring calculation but does not submit a Magic Action. A real settlement also needs funded standard SPL vault and market accounts.

## Implementation and verification status

The replacement Anchor program now defines the Vault State PDA, per-vault Authority PDA, per-vault transferable SPL share mint, classic SPL asset ATAs, per-vault Executor PDA, Hydra recurring task, ER rebalance calculation, standalone Magic Action request, and base-layer settlement checks. Only the Executor PDA is delegated. The recurring instruction authenticates the current payer-bound Hydra crank PDA from the prior `Trigger` instruction sysvar entry and never includes the crank in the scheduled account metas.

The Devnet program deployment and standard-ATA ER read canary succeeded; the latest canary transaction was `4HZ5eQGTo6zTJXbdkRxXxcSsa7qpEGaBEcVuX2W2M55pNcJLSFwu6UhVdSJ38uhCwjHCd4mWv5avoAqWje7badWZ` and logged the mint, Vault Authority, zero amount, and `no_delegate=true`. The Executor delegation account-exit issue was fixed and deployed. After upgrading the base program, I canceled the first task and registered a replacement; the ER still reported 6,650 and logged the old handler, despite the updated program-data image being visible on the ER. The active task is therefore recurring at 6,650 slots, not the source's 5,700-slot target. A local ephemeral cranker produced seven confirmed `RebalanceEphemeral` invocations. Each transaction succeeded, but logged no Magic Action because the vault has zero value. The test Vault ATA remains a classic SPL account controlled by the Vault Authority PDA, is not delegated, and has a zero balance; the market ATA also has zero tokens. The CLI Devnet signer now has 4.001 SOL and no SPL token accounts. The existing synthetic TUSD mint is controlled by a different authority whose key is not available to this canary, so it cannot safely create the missing liquidity. Funded, supported test assets are required to validate Magic Action delivery, successful base settlement, and stale-price/slippage/replay rejection.

The React client still calls the previous delegated-token instruction set and has not yet been migrated to this Vault State PDA ABI. Do not create or rebalance portfolios from the app until that client migration is complete; the canary and Devnet harness must use the standard SPL ATAs described above. Deposits/redemptions and share mint/burn are also not wired into the client yet.
