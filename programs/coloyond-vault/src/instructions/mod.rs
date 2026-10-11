//! Anchor account contexts and token-moving entry/exit instructions.

use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::{
    auction::{
        AuctionPolicy, BountyClaim, PendingAuctionPolicy, RebalanceIntent,
        AUCTION_POLICY_PROPOSAL_SEED, AUCTION_POLICY_SEED, BOUNTY_CLAIM_SEED,
        REBALANCE_INTENT_SEED,
    },
    condition::{ConditionState, CONDITION_STATE_SEED},
    governance::GovernanceState,
    state::{AssetConfig, Vault, VaultError, ASSET_COUNT, VAULT_VERSION},
};

pub mod auction_handlers;
pub mod condition_handlers;
pub mod entry_exit;
pub mod handlers;
pub mod policy_handlers;

pub const VAULT_SEED: &[u8] = b"vault";
pub const GOVERNANCE_SEED: &[u8] = b"governance";
pub const ASSOCIATED_TOKEN_PROGRAM_ID: Pubkey =
    pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

pub fn associated_token_address(authority: Pubkey, mint: Pubkey, token_program: Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[authority.as_ref(), token_program.as_ref(), mint.as_ref()],
        &ASSOCIATED_TOKEN_PROGRAM_ID,
    )
    .0
}

/// Account wrapper for the frozen governance transition helper. Keeping this
/// separate preserves its pure transition API while giving Anchor a stable PDA.
#[account]
#[derive(InitSpace)]
pub struct GovernanceAccount {
    pub version: u8,
    pub vault: Pubkey,
    pub share_mint: Pubkey,
    pub allowed_mints: [Pubkey; ASSET_COUNT],
    pub governance_authority: Pubkey,
    pub emergency_authority: Pubkey,
    pub min_delay_slots: u64,
    pub configuration_revision: u64,
    pub target_bps: [u16; ASSET_COUNT],
    pub proposal_nonce: u64,
    pub pending: Option<crate::governance::PolicyProposal>,
    pub risk_paused: bool,
}

impl GovernanceAccount {
    pub const SPACE: usize = 8 + Self::INIT_SPACE;

    fn state(&self) -> GovernanceState {
        GovernanceState {
            version: self.version,
            vault: self.vault,
            share_mint: self.share_mint,
            allowed_mints: self.allowed_mints,
            governance_authority: self.governance_authority,
            emergency_authority: self.emergency_authority,
            min_delay_slots: self.min_delay_slots,
            configuration_revision: self.configuration_revision,
            target_bps: self.target_bps,
            proposal_nonce: self.proposal_nonce,
            pending: self.pending,
            risk_paused: self.risk_paused,
        }
    }

    fn store(&mut self, state: GovernanceState) {
        self.version = state.version;
        self.vault = state.vault;
        self.share_mint = state.share_mint;
        self.allowed_mints = state.allowed_mints;
        self.governance_authority = state.governance_authority;
        self.emergency_authority = state.emergency_authority;
        self.min_delay_slots = state.min_delay_slots;
        self.configuration_revision = state.configuration_revision;
        self.target_bps = state.target_bps;
        self.proposal_nonce = state.proposal_nonce;
        self.pending = state.pending;
        self.risk_paused = state.risk_paused;
    }

    fn validate_link(&self, vault: &Vault, vault_key: Pubkey) -> Result<()> {
        require!(
            self.vault == vault_key,
            crate::governance::GovernanceError::InvalidVault
        );
        require!(
            self.version == crate::governance::GOVERNANCE_VERSION,
            crate::governance::GovernanceError::InvalidVault
        );
        require!(
            vault.version == VAULT_VERSION,
            VaultError::InvalidConfiguration
        );
        require!(
            self.share_mint == vault.share_mint,
            crate::governance::GovernanceError::InvalidAssetSet
        );
        require!(
            self.allowed_mints == [vault.assets[0].mint, vault.assets[1].mint],
            crate::governance::GovernanceError::InvalidAssetSet
        );
        require!(
            self.configuration_revision == vault.configuration_revision,
            crate::governance::GovernanceError::StaleRevision
        );
        require!(
            self.target_bps == [vault.assets[0].target_bps, vault.assets[1].target_bps],
            crate::governance::GovernanceError::StaleRevision
        );
        Ok(())
    }
}

/// Seed and bootstrap inputs. Executable auction policy is installed later
/// through the S4C governance timelock.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct VaultInit {
    pub configuration_revision: u64,
    pub target_bps: [u16; ASSET_COUNT],
    pub seed_amounts: [u64; ASSET_COUNT],
    pub reserve_contributions: [u64; ASSET_COUNT],
    pub minimum_locked_shares: u64,
    pub governance_authority: Pubkey,
    pub emergency_authority: Pubkey,
    pub min_delay_slots: u64,
    /// One-time valuation limits, separate from the later auction policy.
    pub maximum_age_seconds: u64,
    pub maximum_confidence_bps: u16,
    pub maximum_usdc_deviation_bps: u16,
}

/// Only the deployed program's upgrade authority may consume the one-time
/// global vault PDA. The vault starts paused; S4C creates auction policy only
/// after its governance timelock. The share mint must already exist with the
/// vault PDA as mint authority and no freeze authority.
#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(
        init,
        payer = seeder,
        space = Vault::SPACE,
        seeds = [VAULT_SEED],
        bump
    )]
    pub vault: Box<Account<'info, Vault>>,
    #[account(
        init,
        payer = seeder,
        space = GovernanceAccount::SPACE,
        seeds = [GOVERNANCE_SEED, vault.key().as_ref()],
        bump
    )]
    pub governance: Box<Account<'info, GovernanceAccount>>,
    #[account(mut)]
    pub share_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub seeder: Signer<'info>,
    pub bootstrap_authority: Signer<'info>,
    pub governance_authority: Signer<'info>,
    pub emergency_authority: Signer<'info>,
    pub program: Program<'info, crate::program::ColoyondVault>,
    #[account(
        constraint = program.programdata_address()? == Some(program_data.key()) @ VaultError::InvalidBootstrapAuthority,
        constraint = program_data.upgrade_authority_address == Some(bootstrap_authority.key()) @ VaultError::InvalidBootstrapAuthority
    )]
    pub program_data: Box<Account<'info, ProgramData>>,
    #[account(mut, token::mint = share_mint, token::authority = seeder)]
    pub seeder_shares: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = mint_a, token::authority = seeder)]
    pub seeder_asset_a: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = mint_b, token::authority = seeder)]
    pub seeder_asset_b: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub custody_a: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub custody_b: Box<Account<'info, TokenAccount>>,
    pub mint_a: Box<Account<'info, Mint>>,
    pub mint_b: Box<Account<'info, Mint>>,
    pub sol_usd: Box<Account<'info, pyth_solana_receiver_sdk::price_update::PriceUpdateV2>>,
    pub usdc_usd: Box<Account<'info, pyth_solana_receiver_sdk::price_update::PriceUpdateV2>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositProportional<'info> {
    #[account(mut, seeds = [VAULT_SEED], bump = vault.bump, has_one = share_mint)]
    pub vault: Account<'info, Vault>,
    #[account(seeds = [GOVERNANCE_SEED, vault.key().as_ref()], bump)]
    pub governance: Account<'info, GovernanceAccount>,
    #[account(mut)]
    pub share_mint: Account<'info, Mint>,
    #[account(mut, token::mint = share_mint, token::authority = depositor)]
    pub user_shares: Account<'info, TokenAccount>,
    pub depositor: Signer<'info>,
    #[account(mut, address = vault.assets[0].custody)]
    pub custody_a: Account<'info, TokenAccount>,
    #[account(mut, address = vault.assets[1].custody)]
    pub custody_b: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint_a, token::authority = depositor)]
    pub user_asset_a: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint_b, token::authority = depositor)]
    pub user_asset_b: Account<'info, TokenAccount>,
    #[account(address = vault.assets[0].mint)]
    pub mint_a: Account<'info, Mint>,
    #[account(address = vault.assets[1].mint)]
    pub mint_b: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RedeemInKind<'info> {
    #[account(mut, seeds = [VAULT_SEED], bump = vault.bump, has_one = share_mint)]
    pub vault: Account<'info, Vault>,
    #[account(seeds = [GOVERNANCE_SEED, vault.key().as_ref()], bump)]
    pub governance: Account<'info, GovernanceAccount>,
    #[account(mut)]
    pub share_mint: Account<'info, Mint>,
    #[account(mut, token::mint = share_mint, token::authority = holder)]
    pub user_shares: Account<'info, TokenAccount>,
    pub holder: Signer<'info>,
    #[account(mut, address = vault.assets[0].custody)]
    pub custody_a: Account<'info, TokenAccount>,
    #[account(mut, address = vault.assets[1].custody)]
    pub custody_b: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint_a, token::authority = holder)]
    pub user_asset_a: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint_b, token::authority = holder)]
    pub user_asset_b: Account<'info, TokenAccount>,
    #[account(address = vault.assets[0].mint)]
    pub mint_a: Account<'info, Mint>,
    #[account(address = vault.assets[1].mint)]
    pub mint_b: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ProposeTargets<'info> {
    #[account(mut, seeds = [VAULT_SEED], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut, seeds = [GOVERNANCE_SEED, vault.key().as_ref()], bump)]
    pub governance: Account<'info, GovernanceAccount>,
    pub governance_authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ActivateTargets<'info> {
    #[account(mut, seeds = [VAULT_SEED], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut, seeds = [GOVERNANCE_SEED, vault.key().as_ref()], bump)]
    pub governance: Account<'info, GovernanceAccount>,
}

#[derive(Accounts)]
pub struct PauseRisk<'info> {
    #[account(mut, seeds = [VAULT_SEED], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut, seeds = [GOVERNANCE_SEED, vault.key().as_ref()], bump)]
    pub governance: Account<'info, GovernanceAccount>,
    pub emergency_authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ResumeRisk<'info> {
    #[account(mut, seeds = [VAULT_SEED], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut, seeds = [GOVERNANCE_SEED, vault.key().as_ref()], bump)]
    pub governance: Account<'info, GovernanceAccount>,
    #[account(seeds = [AUCTION_POLICY_SEED, vault.key().as_ref()], bump)]
    pub auction_policy: Account<'info, AuctionPolicy>,
    pub governance_authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ProposeAuctionPolicy<'info> {
    #[account(seeds = [VAULT_SEED], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(seeds = [GOVERNANCE_SEED, vault.key().as_ref()], bump)]
    pub governance: Account<'info, GovernanceAccount>,
    #[account(
        init,
        payer = governance_authority,
        space = PendingAuctionPolicy::SPACE,
        seeds = [AUCTION_POLICY_PROPOSAL_SEED, vault.key().as_ref()],
        bump
    )]
    pub pending_policy: Account<'info, PendingAuctionPolicy>,
    #[account(seeds = [AUCTION_POLICY_SEED, vault.key().as_ref()], bump)]
    /// CHECK: This canonical PDA must have no data before the one-time initializer executes.
    pub auction_policy: UncheckedAccount<'info>,
    #[account(mut, address = governance.governance_authority)]
    pub governance_authority: Signer<'info>,
    #[account(address = vault.assets[0].custody)]
    pub custody_a: Account<'info, TokenAccount>,
    #[account(address = vault.assets[1].custody)]
    pub custody_b: Account<'info, TokenAccount>,
    #[account(address = vault.assets[0].mint)]
    pub mint_a: Account<'info, Mint>,
    #[account(address = vault.assets[1].mint)]
    pub mint_b: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteAuctionPolicy<'info> {
    #[account(mut, seeds = [VAULT_SEED], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(seeds = [GOVERNANCE_SEED, vault.key().as_ref()], bump)]
    pub governance: Account<'info, GovernanceAccount>,
    #[account(
        init,
        payer = executor,
        space = AuctionPolicy::SPACE,
        seeds = [AUCTION_POLICY_SEED, vault.key().as_ref()],
        bump
    )]
    pub auction_policy: Account<'info, AuctionPolicy>,
    #[account(
        mut,
        seeds = [AUCTION_POLICY_PROPOSAL_SEED, vault.key().as_ref()],
        bump = pending_policy.bump,
        close = vault
    )]
    pub pending_policy: Account<'info, PendingAuctionPolicy>,
    #[account(mut)]
    pub executor: Signer<'info>,
    #[account(address = vault.assets[0].custody)]
    pub custody_a: Account<'info, TokenAccount>,
    #[account(address = vault.assets[1].custody)]
    pub custody_b: Account<'info, TokenAccount>,
    #[account(address = vault.assets[0].mint)]
    pub mint_a: Account<'info, Mint>,
    #[account(address = vault.assets[1].mint)]
    pub mint_b: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelAuctionPolicyProposal<'info> {
    #[account(mut, seeds = [VAULT_SEED], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(seeds = [GOVERNANCE_SEED, vault.key().as_ref()], bump)]
    pub governance: Account<'info, GovernanceAccount>,
    #[account(
        mut,
        seeds = [AUCTION_POLICY_PROPOSAL_SEED, vault.key().as_ref()],
        bump = pending_policy.bump,
        close = vault
    )]
    pub pending_policy: Account<'info, PendingAuctionPolicy>,
    #[account(address = governance.governance_authority)]
    pub governance_authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct StartRebalance<'info> {
    #[account(mut, seeds = [VAULT_SEED], bump = vault.bump)]
    pub vault: Box<Account<'info, Vault>>,
    #[account(seeds = [GOVERNANCE_SEED, vault.key().as_ref()], bump)]
    pub governance: Box<Account<'info, GovernanceAccount>>,
    #[account(seeds = [AUCTION_POLICY_SEED, vault.key().as_ref()], bump)]
    pub auction_policy: Box<Account<'info, AuctionPolicy>>,
    #[account(
        init,
        payer = caller,
        space = RebalanceIntent::SPACE,
        seeds = [REBALANCE_INTENT_SEED, vault.key().as_ref()],
        bump
    )]
    pub rebalance_intent: Box<Account<'info, RebalanceIntent>>,
    #[account(mut, address = vault.assets[0].custody)]
    pub custody_a: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = vault.assets[1].custody)]
    pub custody_b: Box<Account<'info, TokenAccount>>,
    #[account(address = vault.assets[0].mint)]
    pub mint_a: Box<Account<'info, Mint>>,
    #[account(address = vault.assets[1].mint)]
    pub mint_b: Box<Account<'info, Mint>>,
    #[account(address = crate::oracle::SOL_USD_FEED_ACCOUNT)]
    pub sol_usd: Box<Account<'info, pyth_solana_receiver_sdk::price_update::PriceUpdateV2>>,
    #[account(address = crate::oracle::USDC_USD_FEED_ACCOUNT)]
    pub usdc_usd: Box<Account<'info, pyth_solana_receiver_sdk::price_update::PriceUpdateV2>>,
    #[account(mut)]
    pub caller: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(expected_intent_sequence: u64)]
pub struct FillAuction<'info> {
    #[account(mut, seeds = [VAULT_SEED], bump = vault.bump)]
    pub vault: Box<Account<'info, Vault>>,
    #[account(seeds = [GOVERNANCE_SEED, vault.key().as_ref()], bump)]
    pub governance: Box<Account<'info, GovernanceAccount>>,
    #[account(mut, seeds = [AUCTION_POLICY_SEED, vault.key().as_ref()], bump)]
    pub auction_policy: Box<Account<'info, AuctionPolicy>>,
    #[account(mut, seeds = [REBALANCE_INTENT_SEED, vault.key().as_ref()], bump)]
    pub rebalance_intent: Box<Account<'info, RebalanceIntent>>,
    #[account(
        init,
        payer = executor,
        space = BountyClaim::SPACE,
        seeds = [BOUNTY_CLAIM_SEED, vault.key().as_ref(), &expected_intent_sequence.to_le_bytes()],
        bump
    )]
    pub bounty_claim: Box<Account<'info, BountyClaim>>,
    #[account(mut, address = vault.assets[0].custody)]
    pub custody_a: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = vault.assets[1].custody)]
    pub custody_b: Box<Account<'info, TokenAccount>>,
    #[account(address = vault.assets[0].mint)]
    pub mint_a: Box<Account<'info, Mint>>,
    #[account(address = vault.assets[1].mint)]
    pub mint_b: Box<Account<'info, Mint>>,
    #[account(address = crate::oracle::SOL_USD_FEED_ACCOUNT)]
    pub sol_usd: Box<Account<'info, pyth_solana_receiver_sdk::price_update::PriceUpdateV2>>,
    #[account(address = crate::oracle::USDC_USD_FEED_ACCOUNT)]
    pub usdc_usd: Box<Account<'info, pyth_solana_receiver_sdk::price_update::PriceUpdateV2>>,
    #[account(mut)]
    pub taker_in: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub taker_out: Box<Account<'info, TokenAccount>>,
    pub taker: Signer<'info>,
    #[account(mut)]
    pub executor: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

/// An executor can settle only the unique receipt created by its fill. The
/// receipt is closed to its recorded executor, making PDA replay impossible.
#[derive(Accounts)]
#[instruction(expected_intent_sequence: u64)]
pub struct ClaimBounty<'info> {
    #[account(mut, seeds = [VAULT_SEED], bump = vault.bump)]
    pub vault: Box<Account<'info, Vault>>,
    #[account(
        mut,
        close = executor,
        seeds = [BOUNTY_CLAIM_SEED, vault.key().as_ref(), &expected_intent_sequence.to_le_bytes()],
        bump
    )]
    pub bounty_claim: Box<Account<'info, BountyClaim>>,
    #[account(mut, address = vault.assets[0].custody)]
    pub custody_a: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = vault.assets[1].custody)]
    pub custody_b: Box<Account<'info, TokenAccount>>,
    #[account(address = vault.assets[0].mint)]
    pub mint_a: Box<Account<'info, Mint>>,
    #[account(address = vault.assets[1].mint)]
    pub mint_b: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub executor_asset: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub executor: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct FinishOrExpire<'info> {
    #[account(mut, seeds = [VAULT_SEED], bump = vault.bump)]
    pub vault: Box<Account<'info, Vault>>,
    #[account(seeds = [GOVERNANCE_SEED, vault.key().as_ref()], bump)]
    pub governance: Box<Account<'info, GovernanceAccount>>,
    #[account(mut, seeds = [AUCTION_POLICY_SEED, vault.key().as_ref()], bump)]
    pub auction_policy: Box<Account<'info, AuctionPolicy>>,
    #[account(mut, close = caller, seeds = [REBALANCE_INTENT_SEED, vault.key().as_ref()], bump)]
    pub rebalance_intent: Box<Account<'info, RebalanceIntent>>,
    #[account(mut, address = vault.assets[0].custody)]
    pub custody_a: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = vault.assets[1].custody)]
    pub custody_b: Box<Account<'info, TokenAccount>>,
    #[account(address = vault.assets[0].mint)]
    pub mint_a: Box<Account<'info, Mint>>,
    #[account(address = vault.assets[1].mint)]
    pub mint_b: Box<Account<'info, Mint>>,
    #[account(address = crate::oracle::SOL_USD_FEED_ACCOUNT)]
    pub sol_usd: Box<Account<'info, pyth_solana_receiver_sdk::price_update::PriceUpdateV2>>,
    #[account(address = crate::oracle::USDC_USD_FEED_ACCOUNT)]
    pub usdc_usd: Box<Account<'info, pyth_solana_receiver_sdk::price_update::PriceUpdateV2>>,
    #[account(mut)]
    pub caller: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(config: crate::condition::ConditionRuleConfig, bounds: crate::condition::ConditionBounds)]
pub struct ProposeConditionRule<'info> {
    #[account(seeds = [VAULT_SEED], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(seeds = [GOVERNANCE_SEED, vault.key().as_ref()], bump)]
    pub governance: Account<'info, GovernanceAccount>,
    #[account(seeds = [AUCTION_POLICY_SEED, vault.key().as_ref()], bump)]
    pub auction_policy: Account<'info, AuctionPolicy>,
    #[account(
        init_if_needed,
        payer = governance_authority,
        space = ConditionState::SPACE,
        seeds = [CONDITION_STATE_SEED, vault.key().as_ref()],
        bump
    )]
    pub condition_state: Account<'info, ConditionState>,
    #[account(mut)]
    pub governance_authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteConditionRule<'info> {
    #[account(seeds = [VAULT_SEED], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(seeds = [GOVERNANCE_SEED, vault.key().as_ref()], bump)]
    pub governance: Account<'info, GovernanceAccount>,
    #[account(seeds = [AUCTION_POLICY_SEED, vault.key().as_ref()], bump)]
    pub auction_policy: Account<'info, AuctionPolicy>,
    #[account(mut, seeds = [CONDITION_STATE_SEED, vault.key().as_ref()], bump = condition_state.bump)]
    pub condition_state: Account<'info, ConditionState>,
}

#[derive(Accounts)]
pub struct ObserveCondition<'info> {
    #[account(seeds = [VAULT_SEED], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(seeds = [GOVERNANCE_SEED, vault.key().as_ref()], bump)]
    pub governance: Account<'info, GovernanceAccount>,
    #[account(seeds = [AUCTION_POLICY_SEED, vault.key().as_ref()], bump)]
    pub auction_policy: Account<'info, AuctionPolicy>,
    #[account(mut, seeds = [CONDITION_STATE_SEED, vault.key().as_ref()], bump = condition_state.bump)]
    pub condition_state: Account<'info, ConditionState>,
    #[account(address = crate::oracle::SOL_USD_FEED_ACCOUNT)]
    pub sol_usd: Account<'info, pyth_solana_receiver_sdk::price_update::PriceUpdateV2>,
    #[account(address = crate::oracle::USDC_USD_FEED_ACCOUNT)]
    pub usdc_usd: Account<'info, pyth_solana_receiver_sdk::price_update::PriceUpdateV2>,
}

#[derive(Accounts)]
pub struct ActivateCondition<'info> {
    #[account(mut, seeds = [VAULT_SEED], bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut, seeds = [GOVERNANCE_SEED, vault.key().as_ref()], bump)]
    pub governance: Account<'info, GovernanceAccount>,
    #[account(mut, seeds = [AUCTION_POLICY_SEED, vault.key().as_ref()], bump)]
    pub auction_policy: Account<'info, AuctionPolicy>,
    #[account(mut, seeds = [CONDITION_STATE_SEED, vault.key().as_ref()], bump = condition_state.bump)]
    pub condition_state: Account<'info, ConditionState>,
    #[account(seeds = [REBALANCE_INTENT_SEED, vault.key().as_ref()], bump)]
    /// CHECK: The canonical intent PDA is inspected by the handler; a program-owned account means an auction is active.
    pub rebalance_intent: UncheckedAccount<'info>,
    #[account(address = crate::oracle::SOL_USD_FEED_ACCOUNT)]
    pub sol_usd: Account<'info, pyth_solana_receiver_sdk::price_update::PriceUpdateV2>,
    #[account(address = crate::oracle::USDC_USD_FEED_ACCOUNT)]
    pub usdc_usd: Account<'info, pyth_solana_receiver_sdk::price_update::PriceUpdateV2>,
}

pub fn check_custody(
    vault: &Vault,
    vault_key: Pubkey,
    custody_a: &Account<'_, TokenAccount>,
    custody_b: &Account<'_, TokenAccount>,
    mint_a: &Account<'_, Mint>,
    mint_b: &Account<'_, Mint>,
) -> Result<()> {
    require_keys_eq!(vault.authority, vault_key, VaultError::InvalidConfiguration);
    require_keys_eq!(
        custody_a.mint,
        vault.assets[0].mint,
        VaultError::InvalidConfiguration
    );
    require_keys_eq!(
        custody_b.mint,
        vault.assets[1].mint,
        VaultError::InvalidConfiguration
    );
    require_keys_eq!(
        custody_a.key(),
        associated_token_address(
            vault_key,
            vault.assets[0].mint,
            vault.assets[0].token_program
        ),
        VaultError::InvalidConfiguration
    );
    require_keys_eq!(
        custody_b.key(),
        associated_token_address(
            vault_key,
            vault.assets[1].mint,
            vault.assets[1].token_program
        ),
        VaultError::InvalidConfiguration
    );
    require_keys_eq!(
        mint_a.key(),
        vault.assets[0].mint,
        VaultError::InvalidConfiguration
    );
    require_keys_eq!(
        mint_b.key(),
        vault.assets[1].mint,
        VaultError::InvalidConfiguration
    );
    require_keys_eq!(custody_a.owner, vault_key, VaultError::InvalidConfiguration);
    require_keys_eq!(custody_b.owner, vault_key, VaultError::InvalidConfiguration);
    require_keys_eq!(
        vault.assets[0].token_program,
        anchor_spl::token::ID,
        VaultError::InvalidConfiguration
    );
    require_keys_eq!(
        vault.assets[1].token_program,
        anchor_spl::token::ID,
        VaultError::InvalidConfiguration
    );
    require!(
        mint_a.decimals == vault.assets[0].decimals && mint_b.decimals == vault.assets[1].decimals,
        VaultError::InvalidConfiguration
    );
    Ok(())
}

pub fn validate_governance(
    governance: &GovernanceAccount,
    vault: &Vault,
    vault_key: Pubkey,
) -> Result<()> {
    governance.validate_link(vault, vault_key)
}

pub fn asset_configs(
    mints: [Pubkey; 2],
    custody: [Pubkey; 2],
    decimals: [u8; 2],
    target_bps: [u16; 2],
) -> [AssetConfig; 2] {
    [
        AssetConfig {
            mint: mints[0],
            token_program: anchor_spl::token::ID,
            custody: custody[0],
            decimals: decimals[0],
            target_bps: target_bps[0],
        },
        AssetConfig {
            mint: mints[1],
            token_program: anchor_spl::token::ID,
            custody: custody[1],
            decimals: decimals[1],
            target_bps: target_bps[1],
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pda_addresses_match_the_shared_seed_vectors() {
        let (vault, _) = Pubkey::find_program_address(&[VAULT_SEED], &crate::ID);
        assert_eq!(
            vault,
            pubkey!("DVZ7tQAgko19RNUXKcMU1RXtcqff2kT415C6JA49NMMQ")
        );

        let (governance, _) =
            Pubkey::find_program_address(&[GOVERNANCE_SEED, vault.as_ref()], &crate::ID);
        assert_eq!(
            governance,
            pubkey!("HVXEcSutFXZQoJSbefeRHWwdwas7HBMWMvZYvzctddiF")
        );
    }

    #[test]
    fn serialized_vault_space_matches_the_shared_decoder_fixture() {
        assert_eq!(Vault::SPACE, 353);
    }
}
