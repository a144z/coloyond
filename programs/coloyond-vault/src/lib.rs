use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, TransferChecked};
use coloyond_etf_oracle::{
    decode_fixed_feed_account, validate_fixed_feed, OracleLimits, PinnedFeed,
};
pub mod math;

// NEW ABI. Never upgrade an old auction deployment in place.
declare_id!("FN7uGX34qyijmVX69gqEkMugWjE5Sjso8Pe7gWU6B2N6");
pub const MAX_ASSETS: usize = 2;
pub const ATA_PROGRAM: Pubkey = pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
pub const WSOL: Pubkey = pubkey!("So11111111111111111111111111111111111111112");
pub const TEST_USDC: Pubkey = pubkey!("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

#[program]
pub mod coloyond_vault {
    use super::*;
    pub fn create_vault(
        ctx: Context<CreateVault>,
        id: u64,
        mints: Vec<Pubkey>,
        weights: Vec<u16>,
        cooldown: u32,
        threshold: u16,
    ) -> Result<()> {
        let assets = allocation(&mints, &weights)?;
        policy(cooldown, threshold)?;
        let v = &mut ctx.accounts.vault;
        v.owner = ctx.accounts.owner.key();
        v.id = id;
        v.bump = ctx.bumps.vault;
        v.revision = 0;
        v.cooldown = cooldown;
        v.threshold = threshold;
        v.paused = false;
        v.last_rebalance = 0;
        v.executions = 0;
        v.assets = assets;
        Ok(())
    }
    pub fn update_allocation<'info>(
        ctx: Context<'_, '_, 'info, 'info, ManageVault<'info>>,
        revision: u64,
        mints: Vec<Pubkey>,
        weights: Vec<u16>,
        cooldown: u32,
        threshold: u16,
        paused: bool,
    ) -> Result<()> {
        let v = &mut ctx.accounts.vault;
        require!(revision == v.revision, VaultError::StaleRevision);
        let assets = allocation(&mints, &weights)?;
        policy(cooldown, threshold)?;
        require!(
            ctx.remaining_accounts.len() == v.assets.len(),
            VaultError::InvalidAccounts
        );
        let key = v.key();
        let id = v.id.to_le_bytes();
        let bump = [v.bump];
        let seeds: &[&[u8]] = &[b"vault", v.owner.as_ref(), &id, &bump];
        for (asset, custody) in v.assets.iter().zip(ctx.remaining_accounts) {
            let balance = custody_balance(custody, &key, asset)?;
            if !mints.contains(&asset.mint) {
                require!(balance == 0, VaultError::NonEmptyAsset);
                token::close_account(CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    CloseAccount {
                        account: custody.clone(),
                        destination: ctx.accounts.owner.to_account_info(),
                        authority: v.to_account_info(),
                    },
                    &[seeds],
                ))?;
            }
        }
        v.assets = assets;
        v.cooldown = cooldown;
        v.threshold = threshold;
        v.paused = paused;
        v.revision = v.revision.checked_add(1).ok_or(VaultError::Arithmetic)?;
        Ok(())
    }
    pub fn deposit<'info>(
        ctx: Context<'_, '_, 'info, 'info, ManageVault<'info>>,
        revision: u64,
        amounts: Vec<u64>,
    ) -> Result<()> {
        move_owner_tokens(ctx, revision, amounts, false)
    }
    pub fn withdraw<'info>(
        ctx: Context<'_, '_, 'info, 'info, ManageVault<'info>>,
        revision: u64,
        amounts: Vec<u64>,
    ) -> Result<()> {
        move_owner_tokens(ctx, revision, amounts, true)
    }
    pub fn close_vault<'info>(ctx: Context<'_, '_, 'info, 'info, CloseVault<'info>>) -> Result<()> {
        let v = &ctx.accounts.vault;
        require!(
            ctx.remaining_accounts.len() == v.assets.len(),
            VaultError::InvalidAccounts
        );
        let key = v.key();
        let id = v.id.to_le_bytes();
        let bump = [v.bump];
        let seeds: &[&[u8]] = &[b"vault", v.owner.as_ref(), &id, &bump];
        for (asset, custody) in v.assets.iter().zip(ctx.remaining_accounts) {
            require!(
                custody_balance(custody, &key, asset)? == 0,
                VaultError::NonEmptyAsset
            );
            token::close_account(CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                CloseAccount {
                    account: custody.clone(),
                    destination: ctx.accounts.owner.to_account_info(),
                    authority: v.to_account_info(),
                },
                &[seeds],
            ))?;
        }
        Ok(())
    }
    /// Inventory-backed fill. No arbitrary CPI, delegate, keeper authority,
    /// configurable destination, or cached reserve is accepted.
    pub fn rebalance<'info>(
        ctx: Context<'_, '_, 'info, 'info, Rebalance<'info>>,
        revision: u64,
        sell_index: u8,
        buy_index: u8,
        sold: u64,
        paid: u64,
    ) -> Result<()> {
        let v = &mut ctx.accounts.vault;
        require!(revision == v.revision, VaultError::StaleRevision);
        require!(!v.paused, VaultError::Paused);
        let clock = Clock::get()?;
        require!(
            clock.unix_timestamp
                >= v.last_rebalance
                    .checked_add(i64::from(v.cooldown))
                    .ok_or(VaultError::Arithmetic)?,
            VaultError::Cooldown
        );
        let s = usize::from(sell_index);
        let b = usize::from(buy_index);
        require!(
            s < v.assets.len() && b < v.assets.len() && s != b,
            VaultError::InvalidAsset
        );
        require!(
            ctx.remaining_accounts.len() == v.assets.len() * 3 + 2,
            VaultError::InvalidAccounts
        );
        let key = v.key();
        let mut balances = Vec::new();
        let mut prices = Vec::new();
        let mut intervals = Vec::new();
        for (i, asset) in v.assets.iter().enumerate() {
            validate_mint(&ctx.remaining_accounts[i * 3], asset)?;
            balances.push(custody_balance(
                &ctx.remaining_accounts[i * 3 + 1],
                &key,
                asset,
            )?);
            let oracle = &ctx.remaining_accounts[i * 3 + 2];
            let feed = feed_for(asset.mint)?;
            let update = decode_fixed_feed_account(
                feed,
                oracle.key(),
                *oracle.owner,
                &oracle.try_borrow_data()?,
            )?;
            let price = validate_fixed_feed(
                feed,
                oracle.key(),
                *oracle.owner,
                &update,
                &clock,
                OracleLimits {
                    maximum_age_seconds: 60,
                    maximum_confidence_bps: 100,
                    minimum_exponent: -8,
                    maximum_exponent: 0,
                },
            )?;
            intervals.push(price.confidence_interval(12)?);
            prices.push(price.to_fixed(12)?);
        }
        require!(
            sold > 0 && sold <= balances[s] / 10,
            VaultError::TradeTooLarge
        );
        let weights: Vec<_> = v.assets.iter().map(|a| a.weight).collect();
        let values: Vec<_> = balances
            .iter()
            .enumerate()
            .map(|(i, a)| math::value(*a, prices[i], v.assets[i].decimals, false))
            .collect::<Result<_>>()?;
        let before = math::drift(&values, &weights)?;
        require!(before >= u128::from(v.threshold), VaultError::OnTarget);
        let total = values.iter().try_fold(0u128, |sum, x| {
            sum.checked_add(*x).ok_or(VaultError::Arithmetic)
        })?;
        require!(
            values[s]
                .checked_mul(10_000)
                .ok_or(VaultError::Arithmetic)?
                > total
                    .checked_mul(u128::from(weights[s]))
                    .ok_or(VaultError::Arithmetic)?,
            VaultError::WrongDirection
        );
        require!(
            values[b]
                .checked_mul(10_000)
                .ok_or(VaultError::Arithmetic)?
                < total
                    .checked_mul(u128::from(weights[b]))
                    .ok_or(VaultError::Arithmetic)?,
            VaultError::WrongDirection
        );
        math::verify_payment(
            sold,
            paid,
            intervals[s].upper,
            intervals[b].lower,
            v.assets[s].decimals,
            v.assets[b].decimals,
        )?;
        let keeper_sell = &ctx.remaining_accounts[v.assets.len() * 3];
        let keeper_buy = &ctx.remaining_accounts[v.assets.len() * 3 + 1];
        validate_token(keeper_sell, &ctx.accounts.keeper.key(), &v.assets[s])?;
        validate_token(keeper_buy, &ctx.accounts.keeper.key(), &v.assets[b])?;
        let sell_mint = &ctx.remaining_accounts[s * 3];
        let sell_custody = &ctx.remaining_accounts[s * 3 + 1];
        let buy_mint = &ctx.remaining_accounts[b * 3];
        let buy_custody = &ctx.remaining_accounts[b * 3 + 1];
        // Payment arrives first; a later failure rolls both CPIs back.
        transfer(
            ctx.accounts.token_program.to_account_info(),
            keeper_buy.clone(),
            buy_mint.clone(),
            buy_custody.clone(),
            ctx.accounts.keeper.to_account_info(),
            paid,
            v.assets[b].decimals,
            &[],
        )?;
        let id = v.id.to_le_bytes();
        let bump = [v.bump];
        let seeds: &[&[u8]] = &[b"vault", v.owner.as_ref(), &id, &bump];
        transfer(
            ctx.accounts.token_program.to_account_info(),
            sell_custody.clone(),
            sell_mint.clone(),
            keeper_sell.clone(),
            v.to_account_info(),
            sold,
            v.assets[s].decimals,
            &[seeds],
        )?;
        let after_balances = v
            .assets
            .iter()
            .enumerate()
            .map(|(i, a)| custody_balance(&ctx.remaining_accounts[i * 3 + 1], &key, a))
            .collect::<Result<Vec<_>>>()?;
        require!(
            after_balances[s]
                == balances[s]
                    .checked_sub(sold)
                    .ok_or(VaultError::Arithmetic)?
                && after_balances[b]
                    == balances[b]
                        .checked_add(paid)
                        .ok_or(VaultError::Arithmetic)?,
            VaultError::InvalidAmount
        );
        let after_values = after_balances
            .iter()
            .enumerate()
            .map(|(i, a)| math::value(*a, prices[i], v.assets[i].decimals, false))
            .collect::<Result<Vec<_>>>()?;
        let after = math::drift(&after_values, &weights)?;
        require!(after < before, VaultError::NoImprovement);
        v.last_rebalance = clock.unix_timestamp;
        v.executions = v.executions.checked_add(1).ok_or(VaultError::Arithmetic)?;
        v.last_sell = sell_index;
        v.last_buy = buy_index;
        v.last_sold = sold;
        v.last_paid = paid;
        emit!(Rebalanced {
            vault: key,
            keeper: ctx.accounts.keeper.key(),
            revision,
            sold,
            paid,
            before_bps: before as u16,
            after_bps: after as u16
        });
        Ok(())
    }
}
fn move_owner_tokens<'info>(
    ctx: Context<'_, '_, 'info, 'info, ManageVault<'info>>,
    revision: u64,
    amounts: Vec<u64>,
    withdraw: bool,
) -> Result<()> {
    let v = &ctx.accounts.vault;
    require!(revision == v.revision, VaultError::StaleRevision);
    require!(
        amounts.len() == v.assets.len() && ctx.remaining_accounts.len() == v.assets.len() * 3,
        VaultError::InvalidAccounts
    );
    require!(amounts.iter().any(|a| *a > 0), VaultError::InvalidAmount);
    let key = v.key();
    let id = v.id.to_le_bytes();
    let bump = [v.bump];
    let seeds: &[&[u8]] = &[b"vault", v.owner.as_ref(), &id, &bump];
    for (i, asset) in v.assets.iter().enumerate() {
        let mint = &ctx.remaining_accounts[i * 3];
        let custody = &ctx.remaining_accounts[i * 3 + 1];
        let user = &ctx.remaining_accounts[i * 3 + 2];
        validate_mint(mint, asset)?;
        custody_balance(custody, &key, asset)?;
        validate_token(user, &v.owner, asset)?;
        if amounts[i] == 0 {
            continue;
        }
        if withdraw {
            transfer(
                ctx.accounts.token_program.to_account_info(),
                custody.clone(),
                mint.clone(),
                user.clone(),
                v.to_account_info(),
                amounts[i],
                asset.decimals,
                &[seeds],
            )?;
        } else {
            transfer(
                ctx.accounts.token_program.to_account_info(),
                user.clone(),
                mint.clone(),
                custody.clone(),
                ctx.accounts.owner.to_account_info(),
                amounts[i],
                asset.decimals,
                &[],
            )?;
        }
    }
    Ok(())
}
fn policy(cooldown: u32, threshold: u16) -> Result<()> {
    require!(
        (5..=86_400).contains(&cooldown) && (1..=5_000).contains(&threshold),
        VaultError::InvalidPolicy
    );
    Ok(())
}
fn allocation(mints: &[Pubkey], weights: &[u16]) -> Result<Vec<Asset>> {
    require!(
        !mints.is_empty() && mints.len() <= MAX_ASSETS && mints.len() == weights.len(),
        VaultError::InvalidAllocation
    );
    require!(
        weights.iter().map(|w| u32::from(*w)).sum::<u32>() == 10_000
            && weights.iter().all(|w| *w > 0),
        VaultError::InvalidAllocation
    );
    let mut assets = Vec::new();
    for (i, mint) in mints.iter().enumerate() {
        require!(!mints[..i].contains(mint), VaultError::InvalidAllocation);
        feed_for(*mint)?;
        assets.push(Asset {
            mint: *mint,
            decimals: if *mint == WSOL { 9 } else { 6 },
            weight: weights[i],
        });
    }
    Ok(assets)
}
fn feed_for(mint: Pubkey) -> Result<PinnedFeed> {
    if mint == WSOL {
        Ok(PinnedFeed::SolUsd)
    } else if mint == TEST_USDC {
        Ok(PinnedFeed::UsdcUsd)
    } else {
        err!(VaultError::InvalidAsset)
    }
}
fn validate_mint(info: &AccountInfo, asset: &Asset) -> Result<()> {
    require_keys_eq!(info.key(), asset.mint, VaultError::InvalidAsset);
    require_keys_eq!(*info.owner, token::ID, VaultError::InvalidAccounts);
    let mint = Mint::try_deserialize(&mut &info.try_borrow_data()?[..])?;
    require!(
        mint.decimals == asset.decimals && mint.is_initialized,
        VaultError::InvalidAsset
    );
    Ok(())
}
fn validate_token(info: &AccountInfo, authority: &Pubkey, asset: &Asset) -> Result<TokenAccount> {
    require_keys_eq!(*info.owner, token::ID, VaultError::InvalidAccounts);
    let t = TokenAccount::try_deserialize(&mut &info.try_borrow_data()?[..])?;
    require_keys_eq!(t.mint, asset.mint, VaultError::InvalidAsset);
    require_keys_eq!(t.owner, *authority, VaultError::Unauthorized);
    Ok(t)
}
fn custody_balance(info: &AccountInfo, vault: &Pubkey, asset: &Asset) -> Result<u64> {
    let expected = Pubkey::find_program_address(
        &[vault.as_ref(), token::ID.as_ref(), asset.mint.as_ref()],
        &ATA_PROGRAM,
    )
    .0;
    require_keys_eq!(info.key(), expected, VaultError::InvalidAccounts);
    Ok(validate_token(info, vault, asset)?.amount)
}
#[allow(clippy::too_many_arguments)]
fn transfer<'info>(
    program: AccountInfo<'info>,
    from: AccountInfo<'info>,
    mint: AccountInfo<'info>,
    to: AccountInfo<'info>,
    authority: AccountInfo<'info>,
    amount: u64,
    decimals: u8,
    seeds: &[&[&[u8]]],
) -> Result<()> {
    token::transfer_checked(
        CpiContext::new_with_signer(
            program,
            TransferChecked {
                from,
                mint,
                to,
                authority,
            },
            seeds,
        ),
        amount,
        decimals,
    )
}
#[derive(Accounts)]
#[instruction(id: u64)]
pub struct CreateVault<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(init,payer = owner,space = Vault::SPACE,seeds = [b"vault",owner.key().as_ref(),&id.to_le_bytes()],bump)]
    pub vault: Account<'info, Vault>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct ManageVault<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut,has_one = owner,seeds = [b"vault",vault.owner.as_ref(),&vault.id.to_le_bytes()],bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    pub token_program: Program<'info, Token>,
}
#[derive(Accounts)]
pub struct CloseVault<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut,close = owner,has_one = owner,seeds = [b"vault",vault.owner.as_ref(),&vault.id.to_le_bytes()],bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    pub token_program: Program<'info, Token>,
}
#[derive(Accounts)]
pub struct Rebalance<'info> {
    pub keeper: Signer<'info>,
    #[account(mut,seeds = [b"vault",vault.owner.as_ref(),&vault.id.to_le_bytes()],bump = vault.bump)]
    pub vault: Account<'info, Vault>,
    pub token_program: Program<'info, Token>,
}
#[account]
pub struct Vault {
    pub owner: Pubkey,
    pub id: u64,
    pub bump: u8,
    pub revision: u64,
    pub cooldown: u32,
    pub threshold: u16,
    pub paused: bool,
    pub last_rebalance: i64,
    pub executions: u64,
    pub last_sell: u8,
    pub last_buy: u8,
    pub last_sold: u64,
    pub last_paid: u64,
    pub assets: Vec<Asset>,
}
impl Vault {
    pub const SPACE: usize =
        8 + 32 + 8 + 1 + 8 + 4 + 2 + 1 + 8 + 8 + 1 + 1 + 8 + 8 + 4 + MAX_ASSETS * 35;
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct Asset {
    pub mint: Pubkey,
    pub decimals: u8,
    pub weight: u16,
}
#[event]
pub struct Rebalanced {
    pub vault: Pubkey,
    pub keeper: Pubkey,
    pub revision: u64,
    pub sold: u64,
    pub paid: u64,
    pub before_bps: u16,
    pub after_bps: u16,
}
#[error_code]
pub enum VaultError {
    #[msg("Only the vault owner can manage custody")]
    Unauthorized,
    #[msg("Unsupported or duplicate asset")]
    InvalidAsset,
    #[msg("Weights must be positive and total 10000 bps")]
    InvalidAllocation,
    #[msg("Invalid account address, owner, or order")]
    InvalidAccounts,
    #[msg("Portfolio changed; refresh before retrying")]
    StaleRevision,
    #[msg("Withdraw removed assets first")]
    NonEmptyAsset,
    #[msg("Automation is paused")]
    Paused,
    #[msg("Rebalance cooldown has not elapsed")]
    Cooldown,
    #[msg("No portfolio value")]
    NoValue,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Payment is below the conservative oracle bound")]
    Underpayment,
    #[msg("Rebalance must strictly reduce portfolio drift")]
    NoImprovement,
    #[msg("Sell must be overweight and buy underweight")]
    WrongDirection,
    #[msg("Portfolio is within tolerance")]
    OnTarget,
    #[msg("Trade exceeds 10% of sold reserve")]
    TradeTooLarge,
    #[msg("Invalid cooldown or drift threshold")]
    InvalidPolicy,
    #[msg("Checked arithmetic failed")]
    Arithmetic,
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_unique_allocations() {
        assert!(allocation(&[WSOL, TEST_USDC], &[5000, 5000]).is_ok());
        assert!(allocation(&[WSOL], &[10000]).is_ok());
        assert!(allocation(&[WSOL, WSOL], &[5000, 5000]).is_err());
        assert!(allocation(&[WSOL, TEST_USDC], &[0, 10000]).is_err());
        assert!(allocation(&[Pubkey::new_unique()], &[10000]).is_err());
    }
    #[test]
    fn bounded_policy() {
        assert!(policy(5, 1).is_ok());
        assert!(policy(4, 100).is_err());
        assert!(policy(30, 0).is_err());
    }
}
