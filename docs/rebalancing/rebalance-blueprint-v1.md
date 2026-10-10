# Coloyond rebalance blueprint v1 (oracle-anchored AMM on Devnet)

Converted from `p.txt` on 10 October 2026. It is a design brief, not an approved
spec: the code blocks below are illustrative sketches and **the code should be
used with caution**. Where this blueprint and
[the spec](spec-v1.md) disagree, the spec and
[the amendment](../product/2026-10-10-onchain-rebalancing-spec-amendment.md) win.

## Can this fully work on Solana Devnet?

Yes. The architecture leans on native Solana features: the Anchor framework, the
SPL Token program and Pyth Network price oracles. By writing a multi-token
index/ETF as an oracle-anchored, arbitrage-driven AMM liquidity pool, the need
for an off-chain backend tracker disappears.

- **The Mainnet reality:** on Mainnet, public MEV searchers and routers like
  Jupiter would drive this traffic for you automatically, to secure cheap
  arbitrage profit.
- **The Devnet caveat:** Devnet has zero organic trading volume and no real
  arbitrage bots, so coloyond must act as its own arbitrageur by running a
  simple loop script to simulate market movements and to force rebalancing.
  (Section III.)

## I. The passive multi-token ETF rebalancing blueprint

Instead of a script logging into a wallet to execute trades, the index fund is
written as a specialized constant-product market-maker smart contract.

### The two-part anti-exploit engine

1. **The Oracle Anchor.** The vault does not blindly price assets from what is
   left inside its pool. Before executing any swap, the smart contract reads
   live Pyth Network data. If the price of SOL spikes externally, the pool's
   internal exchange rate jumps with it, so bots cannot drain the fund through
   a stale-price exploit.
2. **The Target-Weight Skew.** The contract adjusts swap fees dynamically from
   portfolio health. With a target weight of 40% SOL / 40% BTC / 20% USDC, if
   SOL pumps the SOL weight to 45%, the contract slaps a structural premium on
   anyone buying SOL from the pool and offers a discount to anyone selling SOL
   into it. External traders are mathematically incentivized to bring the ETF
   weights back to target while paying a baseline fee.

## II. On-chain smart contract structure (Solana Anchor sketch)

A production-ready shape for an Anchor program managing a three-token ETF pool
(SOL, BTC, USDC). The illustrative program id `ETFv1...` is a placeholder, not a
deployed address.

```rust
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use pyth_sdk_solana::load_price_feed_from_account_info;

declare_id!("ETFv11111111111111111111111111111111111111");

#[program]
pub mod solana_etf_amm {
    use super::*;

    // 1. Setup ETF parameters and targets
    pub fn initialize_etf(
        ctx: Context<InitializeETF>,
        target_weights: Vec<u8> // e.g., [40, 40, 20]
    ) -> Result<()> {
        let etf_vault = &mut ctx.accounts.etf_vault;
        etf_vault.target_weights = target_weights;
        etf_vault.base_fee_bps = 30; // 0.30% base fee to generate revenue from bots
        Ok(())
    }

    // 2. The core passive rebalancing interface
    pub fn arbitrage_swap(ctx: Context<ArbitrageSwap>, amount_in: u64) -> Result<()> {
        // Fetch real-time external prices from Pyth oracles
        let clock = Clock::get()?;
        let sol_feed = load_price_feed_from_account_info(&ctx.accounts.pyth_sol_feed).unwrap();
        let btc_feed = load_price_feed_from_account_info(&ctx.accounts.pyth_btc_feed).unwrap();

        let sol_price = sol_feed.get_price_no_older_than(clock.unix_timestamp, 60).unwrap();
        let btc_price = btc_feed.get_price_no_older_than(clock.unix_timestamp, 60).unwrap();

        // Calculate current vault balances
        let bal_sol = ctx.accounts.vault_sol.amount;
        let bal_btc = ctx.accounts.vault_btc.amount;
        let bal_usdc = ctx.accounts.vault_usdc.amount;

        // Determine real-time aggregate USD value of the ETF
        let total_value = (bal_sol * sol_price.price as u64)
            + (bal_btc * btc_price.price as u64)
            + bal_usdc;

        let current_sol_weight = ((bal_sol * sol_price.price as u64) * 100) / total_value;
        let target_sol_weight = ctx.accounts.etf_vault.target_weights[0] as u64;

        // Apply skew: if the pool is low on SOL, make depositing SOL highly rewarding
        let mut pricing_multiplier = 1.0;
        if current_sol_weight < target_sol_weight {
            pricing_multiplier = 1.0 - ((target_sol_weight - current_sol_weight) as f64 / 100.0);
        }

        // Apply baseline fee protection so ETF owners accumulate value
        let fee = (amount_in * ctx.accounts.etf_vault.base_fee_bps) / 10000;
        let net_amount_in = amount_in - fee;

        // Execute CPI token transfers to route assets through the pool
        // [standard Anchor token::transfer logic executed here]

        Ok(())
    }
}

#[account]
pub struct EtfVault {
    pub target_weights: Vec<u8>,
    pub base_fee_bps: u64,
}

#[derive(Accounts)]
pub struct InitializeETF<'info> {
    #[account(init, payer = user, space = 8 + 32 + 16)]
    pub etf_vault: Account<'info, EtfVault>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ArbitrageSwap<'info> {
    pub etf_vault: Account<'info, EtfVault>,
    /// CHECK: Validated in program logic via the Pyth SDK
    pub pyth_sol_feed: AccountInfo<'info>,
    /// CHECK: Validated in program logic via the Pyth SDK
    pub pyth_btc_feed: AccountInfo<'info>,
    #[account(mut)]
    pub vault_sol: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_btc: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_usdc: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}
```

## III. Devnet High-Frequency Arbitrage Simulator

Because Devnet lacks active market participants, this loop runs locally to fire
rebalancing orders. It cycles public Devnet RPC endpoints so the caller's IP is
not banned while it pursues the high-frequency pace.

```typescript
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

const DEVNET_NODES = [
  "https://solana.com",
  "https://ankr.com",
  "https://genesysgo.net"
];

// Array of wallets pre-funded with Devnet SOL to distribute gas expenses
const CRONLESS_BOT_KEYS = [
  Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.TEST_WAL_1))),
  Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.TEST_WAL_2)))
];

async function simulateArbitragePressure() {
  let counter = 0;

  while (true) {
    const connection = new Connection(DEVNET_NODES[counter % DEVNET_NODES.length], "confirmed");
    const activeWallet = CRONLESS_BOT_KEYS[counter % CRONLESS_BOT_KEYS.length];

    try {
      // Step 1: read the Anchor ETF account pool state
      // Step 2: compare it against live Pyth pricing feeds
      const isImbalanced = true; // flag resolved by the local target formula

      if (isImbalanced) {
        console.log(`[TPS Engine] Pushing arbitrage txn #${counter} via ${activeWallet.publicKey.toBase58()}`);

        // Build, sign and send the transaction straight to the local node array
        // await program.methods.arbitrageSwap(new BN(500000)).accounts({...}).signers([activeWallet]).rpc();
      }
    } catch (err) {
      console.log("Network congestion or rate limit hit. Rolling to next RPC node...");
    }

    counter++;
    // A precise short pause to sustain the high-frequency pace
    await new Promise((resolve) => setTimeout(resolve, 85));
  }
}

simulateArbitragePressure();
```

## IV. Step-by-Step Implementation Matrix

| Phase | Core objective | Target environment | Out-of-pocket cost |
|---|---|---|---|
| 1. Oracle Mapping | Hardcode the Devnet Pyth addresses (SOL: `H6AR6H2wY6jEGV7a7ssi9b8mw7VAj68Jz6T8mxy95G32`) into the smart contract dependencies. | Devnet | $0 |
| 2. Contract Deployment | Compile the code via the Anchor CLI and run `anchor deploy` to push the bytecode live. | Devnet | ~0.06 Devnet SOL |
| 3. Liquidity Seeding | Initialize the ETF vault by depositing a mock 40/40/20 balance of testnet tokens. | Devnet | $0 |
| 4. Stress Testing | Spin up the High-Frequency loop script on the local machine to act as the external arbitrage engine. | Local node execution | $0 (consumes testnet-faucet SOL) |

Open question from the source: whether to map the exact mathematical curve
constraints (for example, the constant-product invariant) so bots can never
extract more money than the base fee allows.

## Coloyond MVP status on Devnet (10 October 2026)

What runs today, honestly labelled:

- Controlling architecture decision (from the sprint integration): the custom
  Anchor/SPL/Pyth auction is the rebalancing path; **Symmetry is kept as a
  separate Devnet comparison**, not as the core. See
  [the SDK survey](../integrations/2026-10-10-solana-vault-sdk-survey.md) status
  banner and [the amendment](../product/2026-10-10-onchain-rebalancing-spec-amendment.md).
- Browser routes: `/rebalancing-lab` runs coloyond's own Anchor auction
  workbench; on Localnet it executes the actual SBF program with SPL transfers,
  but its oracle bytes, prices and token mints are synthetic fixtures.
  `/symmetry-devnet` reads public Symmetry V3 vault state through
  `@symmetry-hq/sdk` and is read-only; it cannot submit transactions, and the
  app has no Mainnet action path. No coloyond contract is deployed to Devnet.
- Phase 1 (oracle mapping) and the anti-exploit engine are implemented in
  coloyond's own Anchor program: the pinned Pyth adapter, the bounded auction
  math, the conditional rule core and the fail-closed keeper client in
  `programs/coloyond-vault` compile and pass their native cargo tests on this
  machine (51 tests, 10 October 2026). The `initialize_vault` entry point is no
  longer a stub: its handler, `VaultInit` argument and `VaultInitialized` event
  are implemented and covered by three seeding tests; the IDL
  (`idl/coloyond_vault.json` and the client's TS mirror) now carry its 16
  accounts, its argument and the new types, and
  `packages/coloyond-client/src/instructions.ts` encodes the instruction
  byte for byte. No deployment address is claimed.
- Phase 2 (deployment) and Phase 3 (seeding) wait on the anchor/solana CLIs
  (absent on this machine; `cargo`/`rustc` are present) and on the deploy
  account being topped up — the owner tops up the devnet account later, which
  covers the gas. `Anchor.toml` carries the devnet program id and wallet slots,
  so `anchor build && anchor deploy --provider devnet` is ready to run. For
  Phase 1 the program's own pinned feed accounts were verified on-cluster by
  `tools/rebalancing/verify-devnet-feeds.mjs` (10 October 2026): both exist at
  the same addresses on Devnet and Mainnet-beta, owned by receiver program
  `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`, as 134-byte Full-variant accounts
  embedding the pinned feed ID at byte offset 41. The feed account quoted in the
  matrix (`H6AR...`) is source-listed only:
  [the manifest](deployment-manifest-v1.md) has not verified it on-cluster, so
  it must be read finalized before being copied anywhere.
- Phase 4 (stress testing) is the loop script of section III. Its working
  realization for the current, working devnet read path is
  `tools/symmetry-fixtures/devnet-rebalance-loop.mjs`: it re-reads a chosen
  devnet vault, computes drift against the on-chain automation trigger, and
  (when given a funded keypair) submits Symmetry's permissionless
  `rebalanceVaultTx`, rotating RPC endpoints and pausing between rounds —
  coloyond acting as its own arbitrageur, because devnet has no organic keeper
  traffic. Verified read-only against four automation-enabled devnet vaults on
  10 October 2026; sending its first transaction waits on the topped-up signer.
- The program-side companion is `tools/rebalancing/coloyond-drift-loop.mjs`: a
  read-only loop that reports whether the program is deployed, scans every
  Vault account it owns, decodes the 353-byte layout shared with the client
  decoder, reads both custody balances and both pinned Pyth prices, and prints
  each asset's drift in basis points against its baked target. It was run on
  10 October 2026 and correctly reported the program as not deployed yet.
