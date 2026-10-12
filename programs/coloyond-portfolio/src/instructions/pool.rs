use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token::{self, Burn, MintTo, TransferChecked};
use etf_oracle::{validate_feed_by_id, OracleLimits};

use super::{CrankRebalance, Deposit, InitializePool, UpdateConfig, Withdraw};
use crate::errors::PortfolioError;
use crate::pda;
use crate::state::{
    assert_only_swap_legs_moved, assert_swap_narrows, basket_total, basket_values,
    basket_weights_bps, leg_value, min_swap_out, min_swap_out_value, pro_rata_payout,
    shares_for_deposit, AssetConfig, AssetInit, CrankPolicy, EtfPool, SwapParam,
    JUPITER_PROGRAM_ID, MAX_SCALE_POWER, POOL_ASSETS_MAX,
};
use crate::token_layout;

/// The price window the pool is willing to read. It is deliberately narrower
/// than a feeder's own range so every accepted price can be shifted into the
/// pool's value unit without an overflow path.
const MIN_PRICE_EXPONENT: i32 = -(MAX_SCALE_POWER as i32);
const MAX_PRICE_EXPONENT: i32 = 0;

/// The oracle policy one pool read runs under.
fn oracle_limits(pool: &EtfPool) -> OracleLimits {
    OracleLimits {
        maximum_age_seconds: pool.policy.max_staleness_secs,
        maximum_confidence_bps: pool.policy.max_confidence_bps,
        minimum_exponent: MIN_PRICE_EXPONENT,
        maximum_exponent: MAX_PRICE_EXPONENT,
    }
}

/// Read a token account from an account the caller supplied, refusing anything
/// that is not a classic SPL token account of the given program.
fn load_token_account(
    info: &AccountInfo,
    token_program: &Pubkey,
) -> Result<token_layout::TokenAccountView> {
    require_keys_eq!(
        *info.owner,
        *token_program,
        PortfolioError::InvalidTokenAccount
    );
    let data = info.try_borrow_data()?;
    token_layout::read_token_account(&data)
        .ok_or_else(|| error!(PortfolioError::InvalidTokenAccount))
}

fn load_mint(info: &AccountInfo, token_program: &Pubkey) -> Result<token_layout::MintView> {
    require_keys_eq!(
        *info.owner,
        *token_program,
        PortfolioError::InvalidTokenAccount
    );
    let data = info.try_borrow_data()?;
    token_layout::read_mint(&data).ok_or_else(|| error!(PortfolioError::InvalidTokenAccount))
}

fn read_balance(info: &AccountInfo, token_program: &Pubkey) -> Result<u64> {
    Ok(load_token_account(info, token_program)?.amount)
}

/// Read one leg's price, requiring the exact feed account the pool stored and
/// the feed id inside it.
fn read_feed(
    info: &AccountInfo,
    expected_account: &Pubkey,
    feed_id: &[u8; 32],
    clock: &Clock,
    limits: OracleLimits,
) -> Result<(i64, i32, u64)> {
    require_keys_eq!(
        *info.key,
        *expected_account,
        PortfolioError::FeedNotAdmitted
    );
    let data = info.try_borrow_data()?;
    let price = validate_feed_by_id(*feed_id, *info.owner, &data, clock, limits)
        .map_err(|_| error!(PortfolioError::OracleRejected))?;
    Ok((
        i64::try_from(price.mantissa).map_err(|_| error!(PortfolioError::OracleRejected))?,
        price.exponent,
        price.confidence,
    ))
}

/// Validate one `AssetInit` against its live accounts and turn it into the
/// config the pool stores.
///
/// This is the admission gate. A leg only joins the basket when its Pyth
/// account is owned by the Receiver program, carries exactly the feed id the
/// initializer named, and yields a live, Fully verified, in-window price; and
/// when its custody account really is a token account of that mint, owned by
/// the pool's vault PDA. `previous` is the leg this one replaces, so a config
/// change can keep a leg's price history unless its feed actually changed.
#[allow(clippy::too_many_arguments)]
fn build_asset(
    init: &AssetInit,
    feed_info: &AccountInfo,
    custody_info: &AccountInfo,
    vault: &Pubkey,
    token_program: &Pubkey,
    clock: &Clock,
    limits: OracleLimits,
    previous: Option<&AssetConfig>,
) -> Result<AssetConfig> {
    let (fresh_price, exponent, confidence) =
        read_feed(feed_info, &init.pyth_feed, &init.feed_id, clock, limits)?;

    require_keys_eq!(
        *custody_info.key,
        init.vault_token_account,
        PortfolioError::InvalidVaultTokenAccount
    );
    let custody = load_token_account(custody_info, token_program)?;
    require!(
        custody.owner == vault.to_bytes(),
        PortfolioError::InvalidVaultTokenOwner
    );
    require!(
        custody.mint == init.mint.to_bytes(),
        PortfolioError::AssetMintMismatch
    );

    let keep = previous.filter(|previous| {
        previous.feed_id == init.feed_id
            && previous.pyth_feed == init.pyth_feed
            && previous.last_price != 0
    });
    let (last_price, last_price_exponent, last_confidence) = match keep {
        Some(previous) => (
            previous.last_price,
            previous.last_price_exponent,
            previous.last_confidence,
        ),
        None => (fresh_price, exponent, confidence),
    };

    Ok(AssetConfig {
        pyth_feed: init.pyth_feed,
        feed_id: init.feed_id,
        mint: init.mint,
        vault_token_account: init.vault_token_account,
        target_weight_bps: init.target_weight_bps,
        last_price,
        last_price_exponent,
        last_confidence,
    })
}

/// Bring one pool into existence.
///
/// The basket's feeds and custody accounts arrive as `remaining_accounts`,
/// feeds first then custody accounts, one per leg in basket order. Both are
/// validated here and the feeds seed the price cache, so the pool can price its
/// very first deposit and does not need a bootstrap crank.
pub fn initialize_pool<'info>(
    ctx: Context<'_, '_, 'info, 'info, InitializePool<'info>>,
    pool_id: u64,
    assets: Vec<AssetInit>,
    policy: CrankPolicy,
) -> Result<()> {
    let admin = ctx.accounts.admin.key();
    let vault = ctx.accounts.vault.key();
    let token_program = ctx.accounts.token_program.key();
    let clock = Clock::get()?;
    let limits = OracleLimits {
        maximum_age_seconds: policy.max_staleness_secs,
        maximum_confidence_bps: policy.max_confidence_bps,
        minimum_exponent: MIN_PRICE_EXPONENT,
        maximum_exponent: MAX_PRICE_EXPONENT,
    };

    // The share mint is the pool's only claim on its assets, so it must already
    // have the vault PDA as its mint authority, and must be unfreezable: the
    // program issues shares, and nobody can lock a holder out of them.
    let share_mint_info = ctx.accounts.share_mint.to_account_info();
    let share_mint = load_mint(&share_mint_info, &token_program)?;
    require!(
        share_mint.is_initialized,
        PortfolioError::InvalidTokenAccount
    );
    require!(
        share_mint.mint_authority == Some(vault.to_bytes()),
        PortfolioError::InvalidAssetConfig
    );
    require!(
        share_mint.freeze_authority.is_none(),
        PortfolioError::InvalidAssetConfig
    );

    let remaining = ctx.remaining_accounts;
    require!(
        remaining.len() == assets.len() * 2,
        PortfolioError::WeightLengthMismatch
    );
    let mut configs = Vec::with_capacity(assets.len());
    for (index, init) in assets.iter().enumerate() {
        configs.push(build_asset(
            init,
            &remaining[index],
            &remaining[assets.len() + index],
            &vault,
            &token_program,
            &clock,
            limits,
            None,
        )?);
    }

    let mut pool = EtfPool::new(
        ctx.bumps.pool,
        pool_id,
        admin,
        ctx.accounts.share_mint.key(),
        vault,
        configs,
        policy,
    )?;
    // The prices read during admission are the pool's first prices.
    pool.last_crank_unix_timestamp = clock.unix_timestamp;
    ctx.accounts.pool.set_inner(pool);
    Ok(())
}

/// Replace the admin's crank policy and, optionally, the basket's feeds,
/// weights and custody accounts.
///
/// `new_assets` must list the same mints in the same order as the current
/// basket, so the pool's composition can never change under its holders; only a
/// leg whose feed actually changed has its cached price dropped.
pub fn update_config<'info>(
    ctx: Context<'_, '_, 'info, 'info, UpdateConfig<'info>>,
    owner_op_sequence: u64,
    policy: CrankPolicy,
    paused: bool,
    new_assets: Vec<AssetInit>,
) -> Result<()> {
    let admin = ctx.accounts.admin.key();
    let token_program = ctx.accounts.token_program.key();
    let remaining = ctx.remaining_accounts;
    let clock = Clock::get()?;
    let pool = &mut ctx.accounts.pool;

    pool.assert_admin(&admin)?;
    pool.assert_owner_sequence(owner_op_sequence)?;
    EtfPool::assert_policy_valid(&policy)?;

    if !new_assets.is_empty() {
        require!(
            new_assets.len() == pool.assets.len(),
            PortfolioError::WeightLengthMismatch
        );
        require!(
            remaining.len() == new_assets.len() * 2,
            PortfolioError::WeightLengthMismatch
        );
        let limits = OracleLimits {
            maximum_age_seconds: policy.max_staleness_secs,
            maximum_confidence_bps: policy.max_confidence_bps,
            minimum_exponent: MIN_PRICE_EXPONENT,
            maximum_exponent: MAX_PRICE_EXPONENT,
        };
        let mut configs = Vec::with_capacity(new_assets.len());
        for (index, init) in new_assets.iter().enumerate() {
            let previous = pool.assets[index];
            // Same mints, same order: a config change re-configures the basket,
            // it never swaps one leg's asset for another.
            require_keys_eq!(previous.mint, init.mint, PortfolioError::AssetMintMismatch);
            configs.push(build_asset(
                init,
                &remaining[index],
                &remaining[new_assets.len() + index],
                &pool.vault,
                &token_program,
                &clock,
                limits,
                Some(&previous),
            )?);
        }
        EtfPool::assert_assets_valid(&configs)?;
        pool.assets = configs;
    }

    pool.policy = policy;
    pool.paused = paused;
    pool.bump_owner_sequence()?;
    Ok(())
}

/// Add value to the pool and mint shares for it.
///
/// The trailing accounts are triples in basket order: the asset mint, the
/// depositor's token account, then the pool vault's custody account.
pub fn deposit<'info>(
    ctx: Context<'_, '_, 'info, 'info, Deposit<'info>>,
    amounts: Vec<u64>,
) -> Result<()> {
    let pool = &ctx.accounts.pool;
    pool.assert_running()?;

    let legs = pool.assets.len();
    require!(amounts.len() == legs, PortfolioError::WeightLengthMismatch);
    let remaining = ctx.remaining_accounts;
    require!(
        remaining.len() == legs * 3,
        PortfolioError::WeightLengthMismatch
    );

    let clock = Clock::get()?;
    pool.assert_cache_fresh(clock.unix_timestamp)?;

    let token_program = ctx.accounts.token_program.key();
    let depositor = ctx.accounts.depositor.key();
    let vault = pool.vault;
    let prices = pool.cached_prices();
    require!(
        prices.iter().all(|(price, _)| *price > 0),
        PortfolioError::UnpriceableBasket
    );

    let mut balances = Vec::with_capacity(legs);
    let mut deposits = Vec::with_capacity(legs);
    let mut decimals = Vec::with_capacity(legs);
    for (index, asset) in pool.assets.iter().enumerate() {
        let mint_info = &remaining[index * 3];
        let source_info = &remaining[index * 3 + 1];
        let custody_info = &remaining[index * 3 + 2];

        require_keys_eq!(
            *mint_info.key,
            asset.mint,
            PortfolioError::AssetMintMismatch
        );
        decimals.push(load_mint(mint_info, &token_program)?.decimals);

        let source = load_token_account(source_info, &token_program)?;
        require!(
            source.mint == asset.mint.to_bytes(),
            PortfolioError::AssetMintMismatch
        );
        require!(
            source.owner == depositor.to_bytes(),
            PortfolioError::InvalidVaultTokenOwner
        );
        require!(
            source.amount >= amounts[index],
            PortfolioError::InsufficientDeposit
        );

        require_keys_eq!(
            *custody_info.key,
            asset.vault_token_account,
            PortfolioError::InvalidVaultTokenAccount
        );
        let custody = load_token_account(custody_info, &token_program)?;
        require!(
            custody.mint == asset.mint.to_bytes(),
            PortfolioError::AssetMintMismatch
        );
        require!(
            custody.owner == vault.to_bytes(),
            PortfolioError::InvalidVaultTokenOwner
        );

        balances.push(custody.amount);
        deposits.push(amounts[index]);
    }

    // The deposit is priced against the pool's own cached prices, and mints the
    // same fraction of the existing supply that it adds to the pool's value.
    let pool_values = basket_values(&balances, &prices).ok_or(PortfolioError::UnpriceableBasket)?;
    let pool_value = basket_total(&pool_values).ok_or(PortfolioError::MathOverflow)?;
    let deposit_values =
        basket_values(&deposits, &prices).ok_or(PortfolioError::UnpriceableBasket)?;
    let deposit_value = basket_total(&deposit_values).ok_or(PortfolioError::MathOverflow)?;
    let shares = shares_for_deposit(ctx.accounts.share_mint.supply, pool_value, deposit_value)
        .ok_or(PortfolioError::InsufficientDeposit)?;

    let pool_key = pool.key();
    let bump_bytes = [pool.bump];
    let signer_seeds: &[&[u8]] = &[pda::VAULT_SEED, pool_key.as_ref(), &bump_bytes[..]];

    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.share_mint.to_account_info(),
                to: ctx.accounts.depositor_shares.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            &[signer_seeds],
        ),
        shares,
    )?;
    for index in 0..legs {
        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: remaining[index * 3 + 1].clone(),
                    mint: remaining[index * 3].clone(),
                    to: remaining[index * 3 + 2].clone(),
                    authority: ctx.accounts.depositor.to_account_info(),
                },
            ),
            amounts[index],
            decimals[index],
        )?;
    }
    Ok(())
}

/// Burn shares and take the same fraction of every leg, so the pool's ratio
/// never shifts and an exit is always possible, paused or not.
///
/// The trailing accounts are triples in basket order: the asset mint, the pool
/// vault's custody account, then the withdrawer's token account.
pub fn withdraw<'info>(
    ctx: Context<'_, '_, 'info, 'info, Withdraw<'info>>,
    share_amount: u64,
) -> Result<()> {
    let pool = &ctx.accounts.pool;
    require!(share_amount > 0, PortfolioError::InvalidShareAmount);

    let legs = pool.assets.len();
    let remaining = ctx.remaining_accounts;
    require!(
        remaining.len() == legs * 3,
        PortfolioError::WeightLengthMismatch
    );

    let supply = ctx.accounts.share_mint.supply;
    require!(supply > 0, PortfolioError::EmptyPool);

    let token_program = ctx.accounts.token_program.key();
    let withdrawer = ctx.accounts.withdrawer.key();
    let vault = pool.vault;

    // Burn first: the payout is then priced against the supply the withdrawer
    // was actually part of, and the same shares cannot be redeemed twice.
    token::burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.share_mint.to_account_info(),
                from: ctx.accounts.withdrawer_shares.to_account_info(),
                authority: ctx.accounts.withdrawer.to_account_info(),
            },
        ),
        share_amount,
    )?;

    let pool_key = pool.key();
    let bump_bytes = [pool.bump];
    let signer_seeds: &[&[u8]] = &[pda::VAULT_SEED, pool_key.as_ref(), &bump_bytes[..]];

    for (index, asset) in pool.assets.iter().enumerate() {
        let mint_info = &remaining[index * 3];
        let custody_info = &remaining[index * 3 + 1];
        let destination_info = &remaining[index * 3 + 2];

        require_keys_eq!(
            *mint_info.key,
            asset.mint,
            PortfolioError::AssetMintMismatch
        );
        let decimals = load_mint(mint_info, &token_program)?.decimals;

        require_keys_eq!(
            *custody_info.key,
            asset.vault_token_account,
            PortfolioError::InvalidVaultTokenAccount
        );
        let custody = load_token_account(custody_info, &token_program)?;
        require!(
            custody.mint == asset.mint.to_bytes(),
            PortfolioError::AssetMintMismatch
        );
        require!(
            custody.owner == vault.to_bytes(),
            PortfolioError::InvalidVaultTokenOwner
        );

        let destination = load_token_account(destination_info, &token_program)?;
        require!(
            destination.mint == asset.mint.to_bytes(),
            PortfolioError::AssetMintMismatch
        );
        require!(
            destination.owner == withdrawer.to_bytes(),
            PortfolioError::InvalidVaultTokenOwner
        );

        let payout = pro_rata_payout(custody.amount, share_amount, supply)
            .ok_or(PortfolioError::MathOverflow)?;
        if payout == 0 {
            continue;
        }
        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: custody_info.clone(),
                    mint: mint_info.clone(),
                    to: destination_info.clone(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                &[signer_seeds],
            ),
            payout,
            decimals,
        )?;
    }
    Ok(())
}

/// The permissionless crank.
///
/// Anyone may sign, pay the fee and supply routes, but they cannot change
/// policy: the venue is pinned, the gate comes from the admin's stored policy,
/// every swap must narrow the basket's imbalance, and each swap must return at
/// least the caller's own quote minus a capped slippage. A cranker can therefore
/// move at most the basket's existing drift, and never past a target weight.
///
/// The trailing accounts are, in order: the Pyth feeds (basket order), the
/// vault's custody accounts (basket order), then the venue accounts that each
/// `SwapParam` slices by offset and count.
pub fn crank_rebalance<'info>(
    ctx: Context<'_, '_, 'info, 'info, CrankRebalance<'info>>,
    swaps: Vec<SwapParam>,
) -> Result<()> {
    // The venue is pinned: a permissionless cranker must not be able to name a
    // program that would take the pool's token authority.
    require_keys_eq!(
        ctx.accounts.venue_program.key(),
        JUPITER_PROGRAM_ID,
        PortfolioError::WrongVenue
    );
    require!(
        ctx.accounts.venue_program.to_account_info().executable,
        PortfolioError::WrongVenue
    );

    let venue_program = ctx.accounts.venue_program.key();
    let token_program = ctx.accounts.token_program.key();
    let vault_key = ctx.accounts.vault.key();
    let remaining = ctx.remaining_accounts;
    let clock = Clock::get()?;
    let pool = &mut ctx.accounts.pool;

    pool.assert_running()?;
    let legs = pool.assets.len();
    require!(
        remaining.len() >= legs * 2,
        PortfolioError::WeightLengthMismatch
    );
    let limits = oracle_limits(pool);

    // Every leg's price is re-validated on every crank, whether or not it is
    // traded: that is also how the cache is kept honest.
    let mut fresh = Vec::with_capacity(legs);
    for (index, asset) in pool.assets.iter().enumerate() {
        fresh.push(read_feed(
            &remaining[index],
            &asset.pyth_feed,
            &asset.feed_id,
            &clock,
            limits,
        )?);
    }
    let prices: Vec<(i64, i32)> = fresh
        .iter()
        .map(|(price, exponent, _)| (*price, *exponent))
        .collect();

    let moved = pool
        .any_price_moved_enough(&prices)
        .ok_or(PortfolioError::WeightLengthMismatch)?;
    pool.crank_gate_open(pool.cadence_elapsed(clock.unix_timestamp), moved)?;

    let mut balances = Vec::with_capacity(legs);
    for (index, asset) in pool.assets.iter().enumerate() {
        let custody_info = &remaining[legs + index];
        require_keys_eq!(
            *custody_info.key,
            asset.vault_token_account,
            PortfolioError::InvalidVaultTokenAccount
        );
        let custody = load_token_account(custody_info, &token_program)?;
        require!(
            custody.mint == asset.mint.to_bytes(),
            PortfolioError::AssetMintMismatch
        );
        require!(
            custody.owner == vault_key.to_bytes(),
            PortfolioError::InvalidVaultTokenOwner
        );
        balances.push(custody.amount);
    }

    let values = basket_values(&balances, &prices).ok_or(PortfolioError::UnpriceableBasket)?;
    let total = basket_total(&values).ok_or(PortfolioError::MathOverflow)?;

    // An empty swap list is a price refresh: a fresh pool, or a pool whose legs
    // are already at target, still gets its cache and cadence stamped.
    if !swaps.is_empty() {
        require!(total > 0, PortfolioError::UnpriceableBasket);
        require!(swaps.len() <= POOL_ASSETS_MAX, PortfolioError::TooManySwaps);
        let mut weights = basket_weights_bps(&values).ok_or(PortfolioError::UnpriceableBasket)?;
        pool.assert_rebalance_worthwhile(&weights)?;

        let pool_key = pool.key();
        let bump_bytes = [pool.bump];
        let signer_seeds: &[&[u8]] = &[pda::VAULT_SEED, pool_key.as_ref(), &bump_bytes[..]];

        for swap in swaps.iter() {
            let sell = usize::from(swap.sell_asset);
            let buy = usize::from(swap.buy_asset);
            require!(sell < legs && buy < legs, PortfolioError::WrongDirection);

            let min_out = min_swap_out(swap.quoted_out_amount, swap.slippage_bps)
                .ok_or(PortfolioError::SlippageTooHigh)?;

            let start = legs * 2 + usize::from(swap.accounts_start);
            let end = start
                .checked_add(usize::from(swap.accounts_count))
                .ok_or(PortfolioError::MathOverflow)?;
            require!(end <= remaining.len(), PortfolioError::WeightLengthMismatch);
            let venue_infos = &remaining[start..end];

            let accounts: Vec<AccountMeta> = venue_infos
                .iter()
                .map(|info| AccountMeta {
                    pubkey: *info.key,
                    // Only the vault PDA is promoted to a signer, and only
                    // through this program's own seeds.
                    is_signer: info.is_signer || *info.key == vault_key,
                    is_writable: info.is_writable,
                })
                .collect();
            let instruction = Instruction {
                program_id: venue_program,
                accounts,
                data: swap.route_data.clone(),
            };

            let sell_before = balances[sell];
            let buy_before = balances[buy];

            invoke_signed(&instruction, venue_infos, &[signer_seeds])?;

            // Re-read the whole basket: the venue is invoked with the vault PDA
            // as the signer, so a route that reaches any custody account the
            // swap did not name has to be refused, not merely left unpriced.
            let mut after = Vec::with_capacity(legs);
            for index in 0..legs {
                after.push(read_balance(&remaining[legs + index], &token_program)?);
            }
            assert_only_swap_legs_moved(&balances, &after, sell, buy)?;
            let sell_after = after[sell];
            let buy_after = after[buy];
            // A declared swap has to actually trade: the sell leg must lose
            // units, and the buy leg must gain at least the quoted floor.
            let sold = sell_before
                .checked_sub(sell_after)
                .ok_or(PortfolioError::WrongDirection)?;
            require!(sold > 0, PortfolioError::WrongDirection);
            let gained = buy_after
                .checked_sub(buy_before)
                .ok_or(PortfolioError::SwapUnderfilled)?;
            require!(gained >= min_out, PortfolioError::SwapUnderfilled);

            // Two floors, both capped by the same slippage: the caller's own
            // quote, and the value of what the pool gave away at the pool's own
            // prices. The second is what stops a bad route from being "quoted"
            // into existence.
            let sold_value = leg_value(sold, prices[sell].0, prices[sell].1)
                .ok_or(PortfolioError::UnpriceableBasket)?;
            let gained_value = leg_value(gained, prices[buy].0, prices[buy].1)
                .ok_or(PortfolioError::UnpriceableBasket)?;
            let floor_value = min_swap_out_value(sold_value, swap.slippage_bps)
                .ok_or(PortfolioError::SlippageTooHigh)?;
            require!(gained_value >= floor_value, PortfolioError::SwapUnderfilled);

            // Re-price from the live balances and require the trade to have
            // narrowed the gap without crossing either target.
            balances = after;
            let after_values =
                basket_values(&balances, &prices).ok_or(PortfolioError::UnpriceableBasket)?;
            let after_weights =
                basket_weights_bps(&after_values).ok_or(PortfolioError::UnpriceableBasket)?;
            assert_swap_narrows(&pool.assets, &weights, &after_weights, sell, buy)?;
            weights = after_weights;
        }
    }

    for (index, (price, exponent, confidence)) in fresh.iter().enumerate() {
        pool.record_price(index, *price, *exponent, *confidence);
    }
    pool.last_crank_unix_timestamp = clock.unix_timestamp;
    Ok(())
}
