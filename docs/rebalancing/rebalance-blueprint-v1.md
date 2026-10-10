# Historical rebalance blueprint v1 (oracle-anchored AMM concept; superseded)

Converted from `p.txt` on 10 October 2026. This is archived concept material,
not an approved specification or implementation guide. Its passive AMM and
arbitrage-fee-reflow design was not selected as the custody core. The controlling
decision is the custom Anchor/SPL/Pyth bounded-auction design in the
[portfolio plan](../product/onchain-portfolio-rebalancing-plan.md) and
[versioned spec](spec-v1.md); use those docs for current decisions. The code
blocks below are illustrative sketches and **must not be deployed**.

## Historical claim: not demonstrated by this repository

The source document asserted that an oracle-anchored passive pool would rebalance
through arbitrage, but this repository has not demonstrated that mechanism,
organic Mainnet searcher participation, keeper uptime, or fee capture. The
active product does not depend on those assumptions. Devnet and Mainnet feed
account contents remain unverified under the open S0B gate.

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

## Repository status (10 October 2026)

- The controlling architecture is the custom Anchor/SPL/Pyth auction; Symmetry
  remains a separate read-only Devnet comparison. See the
  [SDK survey](../integrations/2026-10-10-solana-vault-sdk-survey.md),
  [product plan](../product/onchain-portfolio-rebalancing-plan.md), and
  [versioned amendment](../product/2026-10-10-onchain-rebalancing-spec-amendment.md).
- `/rebalancing-lab` executes auction instructions and SPL transfers against
  the actual SBF program on Localnet, using synthetic token/oracle fixtures.
  `/symmetry-devnet` reads Symmetry state and cannot submit transactions. No
  Coloyond program deployment or admitted feed/mint account state is claimed.
- The program source includes Pyth validation, bounded auction math,
  conditional rules, keeper clients, and a bootstrap path authenticated by the
  current program upgrade authority. That bootstrap starts paused, derives
  shares from verified oracle NAV, and leaves AuctionPolicy creation to S4C's
  delayed governance flow. Rust helper tests pass; the initializer/IDL/client
  contract and signed Localnet bootstrap-to-policy transaction proof remain
  incomplete. S0B remains held and S4A has approved no economic parameters.
- `tools/rebalancing/verify-devnet-feeds.mjs` is a raw-account candidate probe,
  not complete Pyth verification. It does not establish Full verification,
  current price, confidence or freshness. The finalized feed/mint reads required
  by S0B remain unverified. Anchor uses one `[provider]` table; for Devnet, use
  the documented CLI overrides `--provider.cluster devnet` and
  `--provider.wallet <wallet-path>` after the test-cluster deployment gate is
  reviewed. The default project provider remains Localnet.
- `tools/rebalancing/coloyond-drift-loop.mjs` is diagnostic prototype code and
  must not be treated as a verified drift reading or trigger until its vault,
  custody, policy and Pyth decoders pass real-chain validation. The last
  recorded attempt found no Coloyond Devnet deployment.
- S3F has one complete Localnet condition-liveness run with shared RPC and
  synthetic Pyth data. It is not independent-operator, Devnet, or production
  liveness evidence; see [the retained transcript](evidence/s3-liveness-localnet-success-20261010.jsonl).
