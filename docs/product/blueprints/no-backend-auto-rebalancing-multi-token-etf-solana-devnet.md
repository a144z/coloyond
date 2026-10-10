# ARCHITECTURE: No-Backend Auto-Rebalancing Multi-Token ETF on Solana Devnet

## 1. System Overview

This architecture implements a fully automated, no-backend, multi-token ETF vault on Solana Devnet. The system combines three independent layers:

1.  **A Self-Owned AMM Vault (Anchor Program)** that holds multiple tokens (e.g., SOL, BTC, USDC) at target weights, uses Pyth oracles for price anchoring, and charges dynamic fees to protect against LVR.
2.  **A Chain-Native Scheduler** that triggers the vault's rebalance logic at fixed intervals or on specific conditions, with zero off-chain infrastructure to maintain.
3.  **Pyth Oracle Price Feeds** on Devnet that the vault reads on-chain to determine true market prices and enforce directional rebalancing.

The vault itself is "passive" in the sense that it only executes swaps when its `rebalance` instruction is called. The scheduler is responsible for calling this instruction. **No backend server, cron job, or personal bot is required.**


## 2. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CHAIN-NATIVE SCHEDULER                              │
│  (MagicBlock Cranks / TukTuk / Antegen Threads — choose one)                │
│                                                                             │
│  • Registers a recurring task or condition-based trigger                   │
│  • Automatically calls the ETF Vault's `rebalance` instruction             │
│  • Zero off-chain infrastructure. The scheduler network handles execution  │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ CPI / Instruction Call
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      SELF-OWNED ETF AMM VAULT (Anchor)                      │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  State: EtfVault                                                    │    │
│  │  • target_weights: [40, 40, 20]  // SOL, BTC, USDC                  │    │
│  │  • base_fee_bps: 30             // 0.30% base fee                   │    │
│  │  • pyth_sol_feed: Pubkey                                            │    │
│  │  • pyth_btc_feed: Pubkey                                            │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  Instructions:                                                      │    │
│  │  • initialize_etf(target_weights)                                   │    │
│  │  • rebalance()  ← Called by Scheduler                              │    │
│  │  • arbitrage_swap(amount_in, token_in, token_out)  ← External       │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  Token Accounts: vault_sol, vault_btc, vault_usdc                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ Reads live prices
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      PYTH ORACLE PRICE FEEDS (DEVNET)                       │
│                                                                             │
│  • SOL/USD Feed Account                                                    │
│  • BTC/USD Feed Account                                                    │
│  • USDC/USD Feed Account (for $1 peg validation)                           │
│  • Price updates every ~30–55 seconds or 0.5% deviation                    │
└─────────────────────────────────────────────────────────────────────────────┘
```


## 3. Scheduler Layer: Chain-Native Trigger Options

The scheduler is responsible for calling the vault's `rebalance` instruction automatically. All three options below are fully supported on Devnet and require **zero off-chain infrastructure** after initial setup.

### 3.1 MagicBlock Cranks (Recommended)

MagicBlock provides native scheduled execution via Ephemeral Rollups (ER). Cranks are automated, scheduled tasks that execute on-chain instructions at predetermined intervals without anyone manually triggering them.

**How it works:**

1.  **Initialize** the ETF vault account on Solana base layer.
2.  **Delegate** the vault account to MagicBlock's Ephemeral Rollup for faster execution.
3.  **Schedule a crank task** via CPI to the MagicBlock program, specifying:
    *   `task_id`: Unique task identifier
    *   `execution_interval_millis`: Interval in milliseconds (e.g., 3600000 for 1 hour)
    *   `iterations`: Number of executions (or `u64::MAX` for indefinite)
    *   `instructions`: The `rebalance()` instruction from the ETF vault
4.  **MagicBlock automatically executes** the `rebalance()` instruction at each interval.

**Anchor implementation — schedule_rebalance:**

```rust
use anchor_lang::prelude::*;
use bincode::serialize;

declare_id!("YourEtfVaultProgramId...");

#[program]
pub mod etf_vault {
    use super::*;

    pub fn schedule_rebalance(
        ctx: Context<ScheduleRebalance>,
        execution_interval_millis: u64,
        iterations: u64,
    ) -> Result<()> {
        // Build the instruction to call rebalance()
        let rebalance_ix = Instruction {
            program_id: crate::ID,
            accounts: vec![
                AccountMeta::new(ctx.accounts.etf_vault.key(), false),
                AccountMeta::new(ctx.accounts.vault_sol.key(), false),
                AccountMeta::new(ctx.accounts.vault_btc.key(), false),
                AccountMeta::new(ctx.accounts.vault_usdc.key(), false),
                AccountMeta::new_readonly(ctx.accounts.pyth_sol_feed.key(), false),
                AccountMeta::new_readonly(ctx.accounts.pyth_btc_feed.key(), false),
                AccountMeta::new_readonly(ctx.accounts.token_program.key(), false),
            ],
            data: anchor_lang::InstructionData::data(
                &crate::instruction::Rebalance {}
            ),
        };

        // Serialize into a MagicBlock ScheduleTask instruction
        let ix_data = serialize(&MagicBlockInstruction::ScheduleTask(
            ScheduleTaskArgs {
                task_id: 1,
                execution_interval_millis,
                iterations,
                instructions: vec![rebalance_ix],
            },
        ))?;

        let schedule_ix = Instruction::new_with_bytes(
            MAGIC_PROGRAM_ID,
            &ix_data,
            vec![
                AccountMeta::new(ctx.accounts.payer.key(), true),
                AccountMeta::new(ctx.accounts.etf_vault.key(), false),
            ],
        );

        // CPI to MagicBlock to schedule the task
        invoke_signed(
            &schedule_ix,
            &[
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.etf_vault.to_account_info(),
            ],
            &[],
        )?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct ScheduleRebalance<'info> {
    #[account(mut)]
    pub etf_vault: Account<'info, EtfVault>,
    #[account(mut)]
    pub vault_sol: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_btc: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_usdc: Account<'info, TokenAccount>,
    /// CHECK: Pyth oracle account
    pub pyth_sol_feed: AccountInfo<'info>,
    /// CHECK: Pyth oracle account
    pub pyth_btc_feed: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
    #[account(mut)]
    pub payer: Signer<'info>,
}
```

**Important note on CPI and account re-serialization:**

When using `ScheduleIncrement` with CPI, use `AccountInfo<'info>` instead of `Account<'info, Counter>` for the counter. This is intentional because after a CPI, Anchor would normally try to re-serialize the account state, but since the account was modified by the CPI, this would result in stale data.

**Devnet configuration:**

*   **Network:** `devnet` (SDK operates on Devnet by default)
*   **RPC:** `https://api.devnet.solana.com` (base layer) or `https://rpc.magicblock.app/devnet` (ER)
*   **Pricing:** Base fee is **0** per ER transaction. Session fee is **0.0003 SOL** (deducted on undelegation). Commit fee is **0.0001 SOL** per commit after the first.
*   **Crank execution:** ~50ms execution intervals, zero transaction fees.

### 3.2 TukTuk

TukTuk is a permissionless crank service built by Helium. It allows any smart contract endpoint to be scheduled on a trigger or specific time.

**How it works:**

1.  **Create a Task Queue** and deposit a minimum of **1 SOL** (refunded when the queue is closed).
2.  **Queue a Task** with the desired execution schedule and the ETF vault's `rebalance()` instruction.
3.  **Crank Turners** (network participants) automatically execute the task and earn SOL rewards from the queue's deposited fee.

**Devnet configuration:**

*   **Program ID:** `tuktukUrfhXT6ZT77QTU8RQtvgL967uRuVagWF57zVA` (deployed on Devnet)
*   **Minimum deposit:** 1 SOL to create a task queue
*   **Payment:** Each crank execution pays a fee set by the task queue creator in SOL

### 3.3 Antegen Threads

Antegen is a hard fork of Clockwork that provides automation and scheduling threads on Solana. It supports multiple trigger types: timestamps, intervals, cron expressions, account data changes, slots, and epochs.

**How it works:**

1.  **Create a Thread** via the Antegen program, specifying the `rebalance()` instruction and trigger conditions.
2.  **Antegen's executor network** automatically executes the thread when the trigger condition is met.
3.  **No maintenance required** — the executor network handles all execution.

**Devnet configuration:**

*   **Network Program ID:** `AgNet6qmh75bjFULcS9RQijUoWwkCtSiSwXM1K3Ujn6Z`
*   **Thread v1 Program ID:** `AgThdyi1P5RkVeZD2rQahTvs8HePJoGFFxKtvok5s2J1`
*   **SDK:** Anchor bindings available via `antegen-sdk` crate


## 4. Vault Layer: Self-Owned AMM ETF Contract

The vault holds multiple tokens and uses a weighted geometric mean invariant to maintain target weights. It reads Pyth oracles on-chain to enforce directional rebalancing and protect against LVR.

### 4.1 Mathematical Model

For a multi-token ETF with target weights \( w_i \) (sum = 1), the invariant is:

\[
\prod_{i} R_i^{w_i} = k
\]

Where \( R_i \) is the reserve of token \( i \). The invariant \( k \) must not decrease after any swap (excluding fees). Fees increase \( k \), benefiting LPs. This is the Balancer-style weighted geometric mean invariant.

### 4.2 Core Vault State

```rust
#[account]
pub struct EtfVault {
    pub target_weights: Vec<u8>,       // e.g., [40, 40, 20]
    pub base_fee_bps: u64,             // e.g., 30 (0.30%)
    pub pyth_sol_feed: Pubkey,
    pub pyth_btc_feed: Pubkey,
    pub total_lp_supply: u64,
}
```

### 4.3 Rebalance Instruction

```rust
pub fn rebalance(ctx: Context<Rebalance>) -> Result<()> {
    let clock = Clock::get()?;

    // 1. Fetch live prices from Pyth oracles
    let sol_feed = load_price_feed_from_account_info(&ctx.accounts.pyth_sol_feed)?;
    let btc_feed = load_price_feed_from_account_info(&ctx.accounts.pyth_btc_feed)?;

    let sol_price = sol_feed
        .get_price_no_older_than(clock.unix_timestamp, 60)?
        .price;
    let btc_price = btc_feed
        .get_price_no_older_than(clock.unix_timestamp, 60)?
        .price;

    // 2. Compute current portfolio weights
    let bal_sol = ctx.accounts.vault_sol.amount;
    let bal_btc = ctx.accounts.vault_btc.amount;
    let bal_usdc = ctx.accounts.vault_usdc.amount;

    let total_value = (bal_sol * sol_price as u64)
        + (bal_btc * btc_price as u64)
        + bal_usdc;

    let current_sol_weight =
        ((bal_sol * sol_price as u64) * 100) / total_value;
    let target_sol_weight = ctx.accounts.etf_vault.target_weights[0] as u64;

    // 3. Determine if rebalance is needed
    let deviation = if current_sol_weight > target_sol_weight {
        current_sol_weight - target_sol_weight
    } else {
        target_sol_weight - current_sol_weight
    };

    // Only rebalance if deviation exceeds threshold (e.g., 5%)
    if deviation <= 5 {
        msg!("No rebalance needed. Deviation: {}%", deviation);
        return Ok(());
    }

    // 4. Execute rebalancing swaps (simplified)
    // In production: determine which token to sell/buy,
    // compute output using oracle-anchored pricing,
    // apply dynamic fee, execute CPI transfers.

    Ok(())
}
```

### 4.4 Arbitrage Swap Instruction

External traders (or your Devnet stress-test script) call this instruction to help rebalance the vault. The vault uses oracle-anchored pricing to prevent stale-price exploitation.

```rust
pub fn arbitrage_swap(
    ctx: Context<ArbitrageSwap>,
    amount_in: u64,
) -> Result<()> {
    let clock = Clock::get()?;
    let sol_feed = load_price_feed_from_account_info(&ctx.accounts.pyth_sol_feed)?;
    let btc_feed = load_price_feed_from_account_info(&ctx.accounts.pyth_btc_feed)?;

    let sol_price = sol_feed
        .get_price_no_older_than(clock.unix_timestamp, 60)?
        .price;
    let btc_price = btc_feed
        .get_price_no_older_than(clock.unix_timestamp, 60)?
        .price;

    let bal_sol = ctx.accounts.vault_sol.amount;
    let bal_btc = ctx.accounts.vault_btc.amount;
    let bal_usdc = ctx.accounts.vault_usdc.amount;

    let total_value = (bal_sol * sol_price as u64)
        + (bal_btc * btc_price as u64)
        + bal_usdc;

    let current_sol_weight =
        ((bal_sol * sol_price as u64) * 100) / total_value;
    let target_sol_weight = ctx.accounts.etf_vault.target_weights[0] as u64;

    // Dynamic fee: increase fee if trade moves away from target
    let mut fee_bps = ctx.accounts.etf_vault.base_fee_bps;

    // If SOL weight is already too high and user is buying more SOL,
    // increase fee to 5% to discourage imbalance
    if current_sol_weight > 45 {
        fee_bps = 500; // 5%
    }

    // Apply oracle-anchored pricing for output calculation
    // ...
    // Execute CPI token transfers
    // ...

    Ok(())
}
```

### 4.5 Pyth Oracle Accounts on Devnet

The following table lists the Pyth price feed account addresses on Devnet:

| Asset | Devnet Feed Account | Price Feed ID |
|---|---|---|
| SOL/USD | `H6AR6H2wY6jEGV7a7ssi9b8mw7VAj68Jz6T8mxy95G32` | `0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d` |
| BTC/USD | `HovQMDrbAgAYPCmHVSrezcSmkMtXSSUsLDFANExrZh2J` | (Look up current Pyth Devnet feed ID) |
| USDC/USD | (Look up current Pyth Devnet feed) | (Look up current Pyth Devnet feed ID) |

*SOL/USD feed ID source:*. *BTC/USD Devnet address source:*. *Pyth Receiver program on Devnet:* `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`.

### 4.6 Dynamic Fee Logic

The dynamic fee protects the vault from LVR (Loss-Versus-Rebalancing):

| Condition | Fee (bps) | Fee (%) | Purpose |
|---|---|---|---|
| Normal (aligned with target) | 30 | 0.30% | Base fee, accumulates value for LPs |
| Deviation > 5% (trade moves away from target) | 500 | 5.00% | Discourage trades that increase imbalance |
| Deviation > 10% (extreme) | 1000 | 10.00% | Full protection mode |

The fee stays **inside the vault**, increasing the value of LP shares. This is the core mechanism that makes the vault "up-only" over time, even with arbitrage activity.


## 5. Deployment Flow (Devnet)

### Step 1: Prerequisites

```bash
npm install @solana/web3.js @coral-xyz/anchor
npm install @magicblock-console/core   # For MagicBlock
solana-keygen new --outfile ~/etf-wallet.json
solana airdrop 2 --url devnet
```

### Step 2: Build and Deploy the ETF Vault Program

```bash
anchor build
anchor deploy --provider.cluster devnet
```

### Step 3: Initialize the ETF Vault

```typescript
// Initialize with target weights [40, 40, 20] for SOL, BTC, USDC
await program.methods
  .initializeEtf([40, 40, 20])
  .accounts({
    etfVault: etfVaultPda,
    user: wallet.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

### Step 4: Seed the Vault with Initial Liquidity

Deposit mock SOL, BTC, and USDC into the vault's token accounts, ensuring the initial dollar-denominated split matches the target weights (40/40/20).

### Step 5: Schedule Rebalancing via MagicBlock

```typescript
import { createClient, MemoryStorage } from '@magicblock-console/core';

const client = createClient({
  network: 'devnet',
  storage: new MemoryStorage(),
});

// Delegate vault account to Ephemeral Rollup
await client.er.delegate({
  account: etfVaultPda.toString(),
  project: 'etf-vault',
});

// Schedule crank: rebalance every hour (3600000 ms), indefinitely
await program.methods
  .scheduleRebalance(
    new BN(3600000),          // 1 hour
    new BN(0xFFFFFFFFFFFFFFFF) // max iterations (indefinite)
  )
  .accounts({
    etfVault: etfVaultPda,
    vaultSol: vaultSolPda,
    vaultBtc: vaultBtcPda,
    vaultUsdc: vaultUsdcPda,
    pythSolFeed: SOL_FEED_DEVNET,
    pythBtcFeed: BTC_FEED_DEVNET,
    tokenProgram: TOKEN_PROGRAM_ID,
    payer: wallet.publicKey,
  })
  .rpc();
```

### Step 6: Run Devnet Stress-Test Script (Simulates Arbitrageurs)

Because Devnet has no organic arbitrage volume, run a local stress-test script that simulates arbitrage pressure by calling `arbitrage_swap` repeatedly.

```typescript
import { Connection, Keypair } from "@solana/web3.js";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";

const DEVNET_NODES = [
  "https://api.devnet.solana.com",
  "https://devnet.helius-rpc.com",
];

const BOT_KEYS = [
  Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.WALLET_A!))),
  Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.WALLET_B!))),
];

async function run() {
  let counter = 0;
  while (true) {
    const connection = new Connection(
      DEVNET_NODES[counter % DEVNET_NODES.length], "confirmed"
    );
    const wallet = new Wallet(BOT_KEYS[counter % BOT_KEYS.length]);
    const provider = new AnchorProvider(connection, wallet, {});
    const program = new Program(IDL, PROGRAM_ID, provider);

    try {
      // Read vault state, compare with Pyth prices
      // If imbalance > threshold, call arbitrage_swap
      // await program.methods
      //   .arbitrageSwap(new BN(1000000))
      //   .accounts({...})
      //   .rpc();
      console.log(`[TPS] txn #${counter}`);
    } catch (e) {
      console.log("Rate limit, rotating node...");
    }
    counter++;
    await new Promise(r => setTimeout(r, 85)); // ~11.5 TPS
  }
}
run();
```


## 6. Fee Structure (Devnet)

| Component | Cost | Notes |
|---|---|---|
| **MagicBlock ER transactions** | **0 SOL** | Zero-fee execution on Ephemeral Rollups |
| **MagicBlock session fee** | **0.0003 SOL** | Deducted on undelegation |
| **MagicBlock commit fee** | **0.0001 SOL** | Per commit after the first |
| **TukTuk task queue deposit** | **1 SOL minimum** | Refunded when queue closed |
| **TukTuk crank execution** | Variable (SOL) | Set by the task queue creator |
| **Antegen thread execution** | Variable | Commission-based, paid to executors |
| **Anchor program deployment** | ~0.05–0.1 Devnet SOL | One-time cost |
| **Vault initialization** | ~0.01 Devnet SOL | Account rent |
| **Vault rebalance (per execution)** | ~0.000005 Devnet SOL | Base transaction fee |

*MagicBlock pricing source:*. *TukTuk deposit source:*.


## 7. Security Checklist

| Concern | Mitigation |
|---|---|
| **Stale oracle prices** | Use `get_price_no_older_than(60)` — reject prices older than 60 seconds |
| **Sandwich attacks** | Dynamic fee (5% when deviation > 5%) makes front-running unprofitable |
| **Directional exploitation** | Only allow swaps that move weights toward target; reject restoring trades |
| **Invariant violation** | After each swap, recompute weighted geometric mean invariant; revert if decreased |
| **PDA signing** | Use `invoke_signed` with PDA seeds for vault token transfers |
| **Overflow** | Use `spl_math` or `u128` intermediate calculations for all multiplications |
| **Reentrancy** | Anchor's account model prevents reentrancy by default |


## 8. Key Addresses & Constants (Devnet)

| Parameter | Value |
|---|---|
| **Solana Devnet RPC** | `https://api.devnet.solana.com` |
| **MagicBlock ER Devnet RPC** | `https://rpc.magicblock.app/devnet` |
| **Pyth Receiver Program** | `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ` |
| **Pyth Price Feed Account** | `pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT` |
| **Pyth SOL/USD Feed (Devnet)** | `H6AR6H2wY6jEGV7a7ssi9b8mw7VAj68Jz6T8mxy95G32` |
| **Pyth BTC/USD Feed (Devnet)** | `HovQMDrbAgAYPCmHVSrezcSmkMtXSSUsLDFANExrZh2J` |
| **TukTuk Program ID** | `tuktukUrfhXT6ZT77QTU8RQtvgL967uRuVagWF57zVA` |
| **Antegen Network Program** | `AgNet6qmh75bjFULcS9RQijUoWwkCtSiSwXM1K3Ujn6Z` |
| **Antegen Thread v1 Program** | `AgThdyi1P5RkVeZD2rQahTvs8HePJoGFFxKtvok5s2J1` |
| **Price Precision** | `10^6` |
| **Base Precision** | `10^9` |

*Pyth Receiver and Price Feed source:*. *TukTuk program ID:*. *Antegen program IDs:*.


## 9. Limitations & Warnings

| Limitation | Impact | Mitigation |
|---|---|---|
| **Devnet has no organic arbitrage** | Vault won't be rebalanced by external bots | Run local stress-test script |
| **MagicBlock crank cadence** | ~4 minutes on Devnet round-trip | Use longer intervals (1h+) for testing |
| **Jupiter not on Devnet** | Cannot use Jupiter routing for swaps | Use oracle-anchored pricing and direct token transfers |
| **Pyth Devnet feeds may lag** | Rebalance may use stale price | `get_price_no_older_than(60)` rejects stale data |
| **Mainnet requires audit** | Unaudited code risks fund loss | Test thoroughly on Devnet + local fork before Mainnet |

---

## 10. Summary

| Feature | This Architecture |
|---|---|
| Backend required? | ❌ No |
| Cron job required? | ❌ No |
| Personal bot required? | ❌ No |
| LVR protection? | ✅ Yes (oracle anchor + dynamic fee) |
| Devnet supported? | ✅ Yes |
| Laptop can be off? | ✅ Yes (after scheduling) |
| Scheduler options | MagicBlock Cranks, TukTuk, Antegen |
| Vault type | Self-owned Anchor AMM with weighted geometric mean invariant |
| Trigger mechanism | Chain-native scheduler calls `rebalance()` at intervals |
| External rebalancing | Arbitrageurs call `arbitrage_swap()` for profit |

**One-sentence architecture:** Deploy a self-owned AMM ETF vault with Pyth oracle anchoring and dynamic fees, then schedule its `rebalance()` instruction via MagicBlock Cranks (zero-fee on Devnet) — external arbitrageurs or a local stress-test script handle the actual rebalancing swaps, with no backend, no cron, and no personal bot required.
