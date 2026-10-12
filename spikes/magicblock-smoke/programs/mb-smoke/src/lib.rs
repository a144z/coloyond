//! Throwaway MagicBlock smoke test for issue #38. Not a product program.
//!
//! S1: a crank on the Ephemeral Rollup (ER) increments a delegated counter.
//! S2: a crank runs `tick`, which commits the counter and schedules an L1 action.
//!     No wallet signs at runtime: the delegated program PDA `auth` signs through
//!     invoke_signed. The builder marks the payer writable, so `auth` is writable.
//! S3: the L1 action moves 1 base unit of an SPL token out of a PDA-owned account.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;
use ephemeral_rollups_sdk::anchor::{action, commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::crank::{ScheduleCrankCpi, ScheduleTaskArgs};
use ephemeral_rollups_sdk::ephem::{CallHandler, MagicIntentBundleBuilder};
use ephemeral_rollups_sdk::{ActionArgs, ShortAccountMeta};

declare_id!("A9mTMCnEVm8PfoDBipSVnGeUwqWXQfs3XhXPQHi5CEEN");

pub const COUNTER_SEED: &[u8] = b"counter";
pub const L1_SEED: &[u8] = b"l1";
pub const AUTH_SEED: &[u8] = b"auth";
pub const VAULT_SEED: &[u8] = b"vault";
pub const CONFIG_SEED: &[u8] = b"config";
pub const ACTION_ESCROW_INDEX: u8 = 255;
pub const TOKEN_PROGRAM_ID: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct ScheduleArgs {
    pub task_id: i64,
    pub execution_interval_millis: i64,
    pub iterations: i64,
}

#[ephemeral]
#[program]
pub mod mb_smoke {
    use super::*;

    /// L1. Creates the counter, the L1 receipt and the token config.
    pub fn initialize(ctx: Context<Initialize>, source: Pubkey, destination: Pubkey) -> Result<()> {
        ctx.accounts.counter.count = 0;
        ctx.accounts.l1.hits = 0;
        ctx.accounts.l1.last_count = 0;
        ctx.accounts.config.source = source;
        ctx.accounts.config.destination = destination;
        Ok(())
    }

    /// L1. Delegates the counter PDA to the ER validator in remaining_accounts[0].
    pub fn delegate(ctx: Context<DelegateCounter>) -> Result<()> {
        ctx.accounts.delegate_pda(
            &ctx.accounts.payer,
            &[COUNTER_SEED],
            DelegateConfig {
                validator: ctx.remaining_accounts.first().map(|acc| acc.key()),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    /// L1. Delegates the auth PDA, so the ER accepts it as a writable commit payer.
    pub fn delegate_auth(ctx: Context<DelegateAuth>) -> Result<()> {
        ctx.accounts.delegate_pda(
            &ctx.accounts.payer,
            &[AUTH_SEED],
            DelegateConfig {
                validator: ctx.remaining_accounts.first().map(|acc| acc.key()),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    /// ER, S1 crank target. Permissionless on purpose.
    pub fn increment(ctx: Context<Increment>) -> Result<()> {
        ctx.accounts.counter.count += 1;
        msg!("S1 count {}", ctx.accounts.counter.count);
        Ok(())
    }

    /// ER. Schedules `increment`.
    pub fn schedule_increment<'info>(
        ctx: Context<'info, ScheduleIncrement<'info>>,
        args: ScheduleArgs,
    ) -> Result<()> {
        let ix = Instruction {
            program_id: crate::ID,
            accounts: vec![AccountMeta::new(ctx.accounts.counter.key(), false)],
            data: anchor_lang::InstructionData::data(&crate::instruction::Increment {}),
        };
        ScheduleCrankCpi {
            payer: &ctx.accounts.payer,
            magic_program: &&ctx.accounts.magic_program,
            instruction_accounts: &[
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.counter.to_account_info(),
            ],
            args: ScheduleTaskArgs {
                task_id: args.task_id,
                execution_interval_millis: args.execution_interval_millis,
                iterations: args.iterations,
                instructions: vec![ix],
            },
        }
        .invoke()?;
        Ok(())
    }

    /// ER, S2 crank target. Runs with no transaction signer of ours.
    /// Increments, commits the counter, and schedules `l1_hit` on the base layer.
    /// The program PDA `auth` is the commit payer and the action escrow authority.
    pub fn tick(ctx: Context<Tick>) -> Result<()> {
        ctx.accounts.counter.count += 1;
        msg!("S2 tick count {}", ctx.accounts.counter.count);
        ctx.accounts.counter.exit(&crate::ID)?;

        let (l1, _) = Pubkey::find_program_address(&[L1_SEED], &crate::ID);
        let (vault, _) = Pubkey::find_program_address(&[VAULT_SEED], &crate::ID);
        let config = &ctx.accounts.config;
        let meta = |key: Pubkey, is_writable: bool| ShortAccountMeta {
            pubkey: key.to_bytes().into(),
            is_writable,
        };
        let action = CallHandler {
            destination_program: crate::ID,
            accounts: vec![
                meta(l1, true),
                meta(ctx.accounts.counter.key(), false),
                meta(vault, false),
                meta(config.source, true),
                meta(config.destination, true),
                meta(TOKEN_PROGRAM_ID, false),
            ],
            args: ActionArgs::new(anchor_lang::InstructionData::data(
                &crate::instruction::L1Hit {},
            )),
            escrow_authority: ctx.accounts.auth.to_account_info(),
            compute_units: 200_000,
        };

        let auth_bump = [ctx.bumps.auth];
        MagicIntentBundleBuilder::new(
            ctx.accounts.auth.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        // A delegated payer must name the validator's magic fee vault
        // (magic-program intent_bundles/schedule/mod.rs, try_get_fee_vault).
        .magic_fee_vault(ctx.accounts.magic_fee_vault.to_account_info())
        .commit(&[ctx.accounts.counter.to_account_info()])
        .add_post_commit_actions([action])
        .build_and_invoke_signed(&[&[AUTH_SEED, &auth_bump]])?;
        Ok(())
    }

    /// ER. Schedules `tick`. The scheduled instruction carries no signer accounts.
    pub fn schedule_tick<'info>(
        ctx: Context<'info, ScheduleTick<'info>>,
        args: ScheduleArgs,
    ) -> Result<()> {
        let ix = Instruction {
            program_id: crate::ID,
            accounts: vec![
                AccountMeta::new(ctx.accounts.counter.key(), false),
                AccountMeta::new(ctx.accounts.auth.key(), false),
                AccountMeta::new_readonly(ctx.accounts.config.key(), false),
                AccountMeta::new(ctx.accounts.magic_fee_vault.key(), false),
                AccountMeta::new_readonly(ctx.accounts.magic_program.key(), false),
                AccountMeta::new(ctx.accounts.magic_context.key(), false),
            ],
            data: anchor_lang::InstructionData::data(&crate::instruction::Tick {}),
        };
        ScheduleCrankCpi {
            payer: &ctx.accounts.payer,
            magic_program: &&ctx.accounts.magic_program,
            instruction_accounts: &[
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.counter.to_account_info(),
                ctx.accounts.auth.to_account_info(),
                ctx.accounts.config.to_account_info(),
                ctx.accounts.magic_fee_vault.to_account_info(),
                ctx.accounts.magic_context.to_account_info(),
            ],
            args: ScheduleTaskArgs {
                task_id: args.task_id,
                execution_interval_millis: args.execution_interval_millis,
                iterations: args.iterations,
                instructions: vec![ix],
            },
        }
        .invoke()?;
        Ok(())
    }

    /// L1, post-commit action. Only the delegation program can sign for the escrow
    /// derived from `auth`, so only `tick`'s commit path can reach this.
    pub fn l1_hit(ctx: Context<L1Hit>) -> Result<()> {
        let data = ctx.accounts.counter.try_borrow_data()?;
        require!(data.len() >= 16, SmokeError::BadCounter);
        let count = u64::from_le_bytes(data[8..16].try_into().unwrap());
        drop(data);

        let l1 = &mut ctx.accounts.l1;
        l1.hits += 1;
        l1.last_count = count;
        msg!("S2 l1_hit hits {} committed count {}", l1.hits, count);

        // S3: move 1 base unit, signed by the never-delegated vault PDA.
        let mut transfer = vec![3u8];
        transfer.extend_from_slice(&1u64.to_le_bytes());
        let ix = Instruction {
            program_id: TOKEN_PROGRAM_ID,
            accounts: vec![
                AccountMeta::new(ctx.accounts.source.key(), false),
                AccountMeta::new(ctx.accounts.destination.key(), false),
                AccountMeta::new_readonly(ctx.accounts.vault.key(), true),
            ],
            data: transfer,
        };
        invoke_signed(
            &ix,
            &[
                ctx.accounts.source.to_account_info(),
                ctx.accounts.destination.to_account_info(),
                ctx.accounts.vault.to_account_info(),
                ctx.accounts.token_program.to_account_info(),
            ],
            &[&[VAULT_SEED, &[ctx.bumps.vault]]],
        )?;
        msg!("S3 moved 1 unit");
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init_if_needed, payer = user, space = 8 + 8, seeds = [COUNTER_SEED], bump)]
    pub counter: Account<'info, Counter>,
    #[account(init_if_needed, payer = user, space = 8 + 16, seeds = [L1_SEED], bump)]
    pub l1: Account<'info, L1Receipt>,
    #[account(init_if_needed, payer = user, space = 8 + 64, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, TokenConfig>,
    #[account(init_if_needed, payer = user, space = 8, seeds = [AUTH_SEED], bump)]
    pub auth: Account<'info, Auth>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateCounter<'info> {
    pub payer: Signer<'info>,
    /// CHECK: the counter PDA
    #[account(mut, del, seeds = [COUNTER_SEED], bump)]
    pub pda: UncheckedAccount<'info>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateAuth<'info> {
    pub payer: Signer<'info>,
    /// CHECK: the auth PDA
    #[account(mut, del, seeds = [AUTH_SEED], bump)]
    pub pda: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Increment<'info> {
    #[account(mut, seeds = [COUNTER_SEED], bump)]
    pub counter: Account<'info, Counter>,
}

#[derive(Accounts)]
pub struct ScheduleIncrement<'info> {
    /// CHECK: used for CPI
    pub magic_program: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: passed to CPI; unchecked so Anchor does not re-serialize stale data
    #[account(mut, seeds = [COUNTER_SEED], bump)]
    pub counter: UncheckedAccount<'info>,
    /// CHECK: used for CPI
    pub program: UncheckedAccount<'info>,
}

#[commit]
#[derive(Accounts)]
pub struct Tick<'info> {
    #[account(mut, seeds = [COUNTER_SEED], bump)]
    pub counter: Account<'info, Counter>,
    /// CHECK: delegated program PDA; signs via invoke_signed as payer and escrow authority
    #[account(mut, seeds = [AUTH_SEED], bump)]
    pub auth: UncheckedAccount<'info>,
    #[account(seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, TokenConfig>,
    /// CHECK: validator magic fee vault; the magic program checks it
    #[account(mut)]
    pub magic_fee_vault: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ScheduleTick<'info> {
    /// CHECK: used for CPI
    pub magic_program: UncheckedAccount<'info>,
    /// CHECK: magic context, passed through to the scheduled instruction
    #[account(mut)]
    pub magic_context: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: passed to CPI
    #[account(mut, seeds = [COUNTER_SEED], bump)]
    pub counter: UncheckedAccount<'info>,
    /// CHECK: delegated program PDA
    #[account(mut, seeds = [AUTH_SEED], bump)]
    pub auth: UncheckedAccount<'info>,
    /// CHECK: config PDA
    #[account(seeds = [CONFIG_SEED], bump)]
    pub config: UncheckedAccount<'info>,
    /// CHECK: validator magic fee vault, forwarded to `tick`
    #[account(mut)]
    pub magic_fee_vault: UncheckedAccount<'info>,
    /// CHECK: used for CPI
    pub program: UncheckedAccount<'info>,
}

#[action]
#[derive(Accounts)]
pub struct L1Hit<'info> {
    #[account(mut, seeds = [L1_SEED], bump)]
    pub l1: Account<'info, L1Receipt>,
    /// CHECK: committed counter; owner is the delegation program while delegated
    #[account(seeds = [COUNTER_SEED], bump)]
    pub counter: UncheckedAccount<'info>,
    /// CHECK: token authority PDA, never delegated
    #[account(seeds = [VAULT_SEED], bump)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: checked by the token program; vault must own it
    #[account(mut)]
    pub source: UncheckedAccount<'info>,
    /// CHECK: checked by the token program
    #[account(mut)]
    pub destination: UncheckedAccount<'info>,
    /// CHECK: SPL Token program
    #[account(address = TOKEN_PROGRAM_ID)]
    pub token_program: UncheckedAccount<'info>,
    /// CHECK: must be the auth PDA
    #[account(seeds = [AUTH_SEED], bump)]
    pub escrow_auth: UncheckedAccount<'info>,
    /// CHECK: only the delegation program can sign for this escrow
    #[account(
        signer,
        address = ephemeral_rollups_sdk::pda::ephemeral_balance_pda_from_payer(
            &escrow_auth.key(),
            ACTION_ESCROW_INDEX,
        ),
    )]
    pub escrow: UncheckedAccount<'info>,
}

#[account]
pub struct Counter {
    pub count: u64,
}

#[account]
pub struct Auth {}

#[account]
pub struct L1Receipt {
    pub hits: u64,
    pub last_count: u64,
}

#[account]
pub struct TokenConfig {
    pub source: Pubkey,
    pub destination: Pubkey,
}

#[error_code]
pub enum SmokeError {
    #[msg("Counter data is too short")]
    BadCounter,
}
