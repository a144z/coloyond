//! State and pure math for the single-account ETF pool.
//!
//! One `EtfPool` account replaces the earlier registry / vault / authority /
//! custody / controller / admission set: the basket, its target weights, the
//! cached Pyth prices and the permissionless crank policy all live together,
//! and the pool's `vault` PDA is the only token authority.
//!
//! Every rule the on-chain handlers enforce is a `pub` method or free function
//! here, so the no-validator scenario suite exercises exactly the code that
//! runs on-chain.

use anchor_lang::prelude::*;

use crate::errors::PortfolioError;

/// At least two legs, or it is not a portfolio.
pub const POOL_ASSETS_MIN: usize = 2;
/// Upper bound on basket size, so one crank stays inside a single packet.
pub const POOL_ASSETS_MAX: usize = 10;
/// Weights and every ratio in this program are basis points of this.
pub const WEIGHTS_SUM_BPS: u64 = 10_000;

/// The most a single swap may lose against its own quote.
pub const SWAP_MAX_SLIPPAGE_BPS: u16 = 500;

/// Widest decimal-exponent span the pool will rescale across.
pub const MAX_SCALE_POWER: u32 = 18;

/// Decimal places the pool's own value unit uses. Prices arrive on a feeder's
/// own exponent, so a leg's value is normalised into micro-dollars; that keeps
/// the sizes small enough for a u64 share supply while staying exact to a
/// millionth of a dollar.
pub const POOL_VALUE_DECIMALS: u8 = 6;

/// Gate mode: open the crank on cadence OR on a price move.
pub const GATE_OR: u8 = 0;
/// Gate mode: open the crank only when cadence AND a price move agree.
pub const GATE_AND: u8 = 1;

/// The only venue a crank may route through: Jupiter's aggregator. Pinning it
/// is what stops a permissionless cranker from naming an arbitrary "venue" and
/// handing it the pool's token authority.
pub const JUPITER_PROGRAM_ID: Pubkey = pubkey!("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");

/// One basket leg: where its price comes from, where its tokens live, and what
/// share of the pool it should hold.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub struct AssetConfig {
    /// Pyth Receiver account that carries this asset's price.
    pub pyth_feed: Pubkey,
    /// The 32-byte Pyth feed id that account must contain, so a swapped-in feed
    /// account cannot silently reprice the leg.
    pub feed_id: [u8; 32],
    /// SPL mint of the asset.
    pub mint: Pubkey,
    /// The pool vault's token account for this asset. The program only requires
    /// that the vault PDA owns it and its mint matches; it does not assume it is
    /// the canonical associated token account.
    pub vault_token_account: Pubkey,
    /// Target weight in basis points of 10_000.
    pub target_weight_bps: u16,
    /// Cached Pyth mantissa from the last successful crank (0 = never priced).
    pub last_price: i64,
    /// Cached Pyth exponent for `last_price`.
    pub last_price_exponent: i32,
    /// Cached Pyth confidence for `last_price`.
    pub last_confidence: u64,
}

/// One basket leg as the initializer supplies it, before any price is cached.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct AssetInit {
    pub pyth_feed: Pubkey,
    pub feed_id: [u8; 32],
    pub mint: Pubkey,
    pub vault_token_account: Pubkey,
    pub target_weight_bps: u16,
}

/// One venue swap the crank should make: sell an overweight leg, buy an
/// underweight one, against the caller's own quote.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct SwapParam {
    /// Index of the leg the pool gives away.
    pub sell_asset: u8,
    /// Index of the leg the pool receives.
    pub buy_asset: u8,
    /// Opaque venue instruction data for this route.
    pub route_data: Vec<u8>,
    /// Raw units of `buy_asset` the caller expects out.
    pub quoted_out_amount: u64,
    /// Shortfall the caller will tolerate against its own quote.
    pub slippage_bps: u16,
    /// Offset into the crank's venue accounts where this route's slice begins.
    pub accounts_start: u8,
    /// How many venue accounts this route uses.
    pub accounts_count: u8,
}

/// The owner-set policy that decides when the permissionless crank may run.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub struct CrankPolicy {
    /// Seconds that must pass before a cadence-gated crank may run.
    pub min_crank_interval_secs: u64,
    /// Basis points a basket price must move to open the price gate.
    pub min_price_change_bps: u16,
    /// Drift worth a crank; 0 disables the drift check.
    pub min_rebalance_bps: u16,
    /// How old a cached price may be before a deposit refuses to use it.
    pub max_staleness_secs: u64,
    /// How wide a Pyth confidence interval may be, in basis points.
    pub max_confidence_bps: u16,
    /// `GATE_OR` or `GATE_AND`.
    pub gate_mode: u8,
}

/// The whole pool: basket, prices and crank policy in one account.
#[account]
pub struct EtfPool {
    pub bump: u8,
    pub pool_id: u64,
    pub admin: Pubkey,
    /// Share mint, created before the pool with the `vault` PDA as its mint
    /// authority and no freeze authority.
    pub share_mint: Pubkey,
    /// Token authority PDA; owns every custody account and mints shares.
    pub vault: Pubkey,
    pub assets: Vec<AssetConfig>,
    /// Unix time of the last successful crank (0 = never cranked).
    pub last_crank_unix_timestamp: i64,
    pub policy: CrankPolicy,
    /// True when deposits and cranks are closed; exits stay open either way.
    pub paused: bool,
    /// Monotonic sequence guarding the admin's configure calls.
    pub owner_op_sequence: u64,
}

impl EtfPool {
    /// Worst-case account size: the 8-byte discriminator, every fixed field,
    /// and the basket at its maximum length. Borsh prefixes a `Vec` with a u32
    /// and each `AssetConfig` is fixed size, so this is an exact upper bound.
    pub const SPACE: usize = 8             // discriminator
        + 1                                // bump
        + 8                                // pool_id
        + 32                               // admin
        + 32                               // share_mint
        + 32                               // vault
        + 4 + POOL_ASSETS_MAX * AssetConfig::INIT_SPACE // assets
        + 8                                // last_crank_unix_timestamp
        + CrankPolicy::INIT_SPACE          // policy
        + 1                                // paused
        + 8; // owner_op_sequence

    #[allow(clippy::too_many_arguments)]
    pub fn new(
        bump: u8,
        pool_id: u64,
        admin: Pubkey,
        share_mint: Pubkey,
        vault: Pubkey,
        assets: Vec<AssetConfig>,
        policy: CrankPolicy,
    ) -> Result<Self> {
        Self::assert_assets_valid(&assets)?;
        Self::assert_policy_valid(&policy)?;
        Ok(Self {
            bump,
            pool_id,
            admin,
            share_mint,
            vault,
            assets,
            last_crank_unix_timestamp: 0,
            policy,
            paused: false,
            owner_op_sequence: 1,
        })
    }

    /// Basket shape: 2..=10 legs, a live feed, mint and weight on each, no
    /// duplicate mints, and weights summing to exactly 10_000.
    pub fn assert_assets_valid(assets: &[AssetConfig]) -> Result<()> {
        require!(
            assets.len() >= POOL_ASSETS_MIN,
            PortfolioError::NotEnoughAssets
        );
        require!(
            assets.len() <= POOL_ASSETS_MAX,
            PortfolioError::TooManyAssets
        );
        let mut sum: u64 = 0;
        for (index, asset) in assets.iter().enumerate() {
            require!(
                asset.pyth_feed != Pubkey::default()
                    && asset.feed_id != [0u8; 32]
                    && asset.mint != Pubkey::default()
                    && asset.vault_token_account != Pubkey::default()
                    && asset.target_weight_bps > 0,
                PortfolioError::InvalidAssetConfig
            );
            for earlier in &assets[..index] {
                require!(
                    earlier.mint != asset.mint,
                    PortfolioError::DuplicateAssetMint
                );
            }
            sum = sum
                .checked_add(u64::from(asset.target_weight_bps))
                .ok_or(PortfolioError::MathOverflow)?;
        }
        require!(sum == WEIGHTS_SUM_BPS, PortfolioError::WeightsSumMismatch);
        Ok(())
    }

    pub fn assert_policy_valid(policy: &CrankPolicy) -> Result<()> {
        require!(
            policy.gate_mode == GATE_OR || policy.gate_mode == GATE_AND,
            PortfolioError::InvalidGateMode
        );
        Ok(())
    }

    pub fn assert_admin(&self, signer: &Pubkey) -> Result<()> {
        require_keys_eq!(self.admin, *signer, PortfolioError::UnauthorizedPoolAdmin);
        Ok(())
    }

    pub fn assert_running(&self) -> Result<()> {
        require!(!self.paused, PortfolioError::PoolPaused);
        Ok(())
    }

    pub fn assert_owner_sequence(&self, expected: u64) -> Result<()> {
        require!(
            expected == self.owner_op_sequence,
            PortfolioError::OwnerSequenceMismatch
        );
        Ok(())
    }

    /// Consume the current sequence number, so a configure call can be applied
    /// exactly once.
    pub fn bump_owner_sequence(&mut self) -> Result<()> {
        self.owner_op_sequence = self
            .owner_op_sequence
            .checked_add(1)
            .ok_or(PortfolioError::MathOverflow)?;
        Ok(())
    }

    /// Seconds since the last successful crank, or `None` if the clock moved
    /// backwards.
    pub fn elapsed_seconds(&self, now: i64) -> Option<u64> {
        u64::try_from(now.checked_sub(self.last_crank_unix_timestamp)?).ok()
    }

    pub fn cadence_elapsed(&self, now: i64) -> bool {
        self.elapsed_seconds(now)
            .is_some_and(|age| age >= self.policy.min_crank_interval_secs)
    }

    /// True when any leg's fresh price has moved at least
    /// `min_price_change_bps` from the cached one.
    ///
    /// A leg that was never priced (fresh pool, or a feed that was just swapped)
    /// has no history to compare, and the pool cannot be priced at all until a
    /// crank seeds it. Such a leg therefore opens the gate by itself, or an
    /// `GATE_AND` pool could never bootstrap and a feed swap could wedge it.
    pub fn any_price_moved_enough(&self, fresh: &[(i64, i32)]) -> Option<bool> {
        if fresh.len() != self.assets.len() {
            return None;
        }
        for (asset, (price, exponent)) in self.assets.iter().zip(fresh.iter()) {
            if asset.last_price == 0 {
                return Some(true);
            }
            if let Some(delta) = price_delta_bps(
                asset.last_price,
                asset.last_price_exponent,
                *price,
                *exponent,
            ) {
                if delta >= u128::from(self.policy.min_price_change_bps) {
                    return Some(true);
                }
            }
        }
        Some(false)
    }

    /// The permissionless crank gate. `GATE_OR` opens on either trigger;
    /// `GATE_AND` needs both. The error names the trigger the caller is missing,
    /// so a keeper can tell "wait" from "nothing to do".
    pub fn crank_gate_open(&self, cadence_elapsed: bool, any_price_moved: bool) -> Result<()> {
        match self.policy.gate_mode {
            GATE_AND => {
                require!(cadence_elapsed, PortfolioError::CrankTooSoon);
                require!(any_price_moved, PortfolioError::PriceChangeBelowThreshold);
                Ok(())
            }
            _ => {
                require!(
                    cadence_elapsed || any_price_moved,
                    PortfolioError::RebalanceThresholdNotMet
                );
                Ok(())
            }
        }
    }

    /// Largest absolute distance between a leg's current weight and its target.
    pub fn worst_weight_excess_bps(&self, weights_bps: &[u128]) -> Option<u128> {
        if weights_bps.len() != self.assets.len() {
            return None;
        }
        let mut worst = 0u128;
        for (asset, weight) in self.assets.iter().zip(weights_bps.iter()) {
            let gap = weight.abs_diff(u128::from(asset.target_weight_bps));
            if gap > worst {
                worst = gap;
            }
        }
        Some(worst)
    }

    /// A crank with nothing to do should not be paid for. When a minimum drift
    /// is configured, at least one leg must be that far from target.
    pub fn assert_rebalance_worthwhile(&self, weights_bps: &[u128]) -> Result<()> {
        if self.policy.min_rebalance_bps == 0 {
            return Ok(());
        }
        let worst = self
            .worst_weight_excess_bps(weights_bps)
            .ok_or(PortfolioError::WeightLengthMismatch)?;
        require!(
            worst >= u128::from(self.policy.min_rebalance_bps),
            PortfolioError::RebalanceExcessTooSmall
        );
        Ok(())
    }

    /// A cached price is only good for `max_staleness_secs`; a deposit priced
    /// from an older cache would be trading against a stale basket.
    pub fn assert_cache_fresh(&self, now: i64) -> Result<()> {
        let age = u64::try_from(
            now.checked_sub(self.last_crank_unix_timestamp)
                .ok_or(PortfolioError::MathOverflow)?,
        )
        .map_err(|_| PortfolioError::StalePriceCache)?;
        require!(
            age <= self.policy.max_staleness_secs,
            PortfolioError::StalePriceCache
        );
        Ok(())
    }

    /// Overwrite the cached price of one leg after a validated read.
    pub fn record_price(&mut self, index: usize, price: i64, exponent: i32, confidence: u64) {
        if let Some(asset) = self.assets.get_mut(index) {
            asset.last_price = price;
            asset.last_price_exponent = exponent;
            asset.last_confidence = confidence;
        }
    }

    /// The cached `(price, exponent)` of every leg, in basket order.
    pub fn cached_prices(&self) -> Vec<(i64, i32)> {
        self.assets
            .iter()
            .map(|asset| (asset.last_price, asset.last_price_exponent))
            .collect()
    }
}

/// `10^power`, capped so a rescale can never represent more precision than the
/// program is willing to reason about.
pub fn pow_10(power: u32) -> Option<u128> {
    if power > MAX_SCALE_POWER {
        return None;
    }
    let mut value = 1u128;
    for _ in 0..power {
        value = value.checked_mul(10)?;
    }
    Some(value)
}

/// Scale `value` from one decimal exponent to another. Only scaling up is
/// allowed (a finer exponent to a coarser one); anything else would have to
/// discard precision, so it reports `None` instead of rounding.
pub fn rescale(value: u128, from: i32, to: i32) -> Option<u128> {
    let shift = from.checked_sub(to)?;
    if shift < 0 {
        return None;
    }
    value.checked_mul(pow_10(u32::try_from(shift).ok()?)?)
}

/// Absolute percentage move between a cached price and a fresh one, in basis
/// points. `None` when the cached price is unset, when the exponent span is
/// unusable, or on overflow.
pub fn price_delta_bps(
    last_price: i64,
    last_exponent: i32,
    now_price: i64,
    now_exponent: i32,
) -> Option<u128> {
    let shared = last_exponent.min(now_exponent);
    let last = rescale(u128::try_from(last_price).ok()?, last_exponent, shared)?;
    let now = rescale(u128::try_from(now_price).ok()?, now_exponent, shared)?;
    if last == 0 {
        return None;
    }
    now.abs_diff(last)
        .checked_mul(u128::from(WEIGHTS_SUM_BPS))?
        .checked_div(last)
}

/// One leg's value in the pool's own unit (micro-dollars), floored.
///
/// A price carries its feeder's exponent, so it is shifted into the pool's
/// value unit. Shifting down divides, which floors at a fraction of a
/// micro-dollar; that is the only rounding in the pool's valuation, and the
/// same floor is applied to the basket and to every deposit, so the ratio
/// between them stays fair.
pub fn leg_value(balance: u64, price: i64, exponent: i32) -> Option<u128> {
    let mantissa = u128::try_from(price).ok()?;
    let scaled = u128::from(balance).checked_mul(mantissa)?;
    let shift = exponent.checked_add(i32::from(POOL_VALUE_DECIMALS))?;
    if shift >= 0 {
        scaled.checked_mul(pow_10(u32::try_from(shift).ok()?)?)
    } else {
        let divisor = pow_10(u32::try_from(shift.checked_neg()?).ok()?)?;
        scaled.checked_div(divisor)
    }
}

/// Each leg's value in the pool's unit. A basket that cannot be valued (a
/// non-positive price, an exponent too far away, overflow) yields `None`, and
/// the caller must treat that as "cannot price this basket", never as zero.
pub fn basket_values(balances: &[u64], prices: &[(i64, i32)]) -> Option<Vec<u128>> {
    if balances.len() != prices.len() {
        return None;
    }
    let mut values = Vec::with_capacity(prices.len());
    for (balance, (price, exponent)) in balances.iter().zip(prices.iter()) {
        values.push(leg_value(*balance, *price, *exponent)?);
    }
    Some(values)
}

/// Sum of a basket's leg values, or `None` on overflow.
pub fn basket_total(values: &[u128]) -> Option<u128> {
    values
        .iter()
        .try_fold(0u128, |acc, value| acc.checked_add(*value))
}

/// Each leg's share of the basket in basis points, floored. `None` when the
/// basket holds no value.
pub fn basket_weights_bps(values: &[u128]) -> Option<Vec<u128>> {
    let total = basket_total(values)?;
    if total == 0 {
        return None;
    }
    let mut weights = Vec::with_capacity(values.len());
    for value in values {
        weights.push(
            value
                .checked_mul(u128::from(WEIGHTS_SUM_BPS))?
                .checked_div(total)?,
        );
    }
    Some(weights)
}

/// Shares to mint for a deposit.
///
/// The first deposit mints one share per unit of value. A later deposit mints
/// the same fraction of the existing supply that it adds to the pool's value,
/// so the price of a share never moves for the holders who were already in.
pub fn shares_for_deposit(supply: u64, pool_value: u128, deposit_value: u128) -> Option<u64> {
    if deposit_value == 0 {
        return None;
    }
    let shares = if supply == 0 {
        deposit_value
    } else {
        if pool_value == 0 {
            return None;
        }
        u128::from(supply)
            .checked_mul(deposit_value)?
            .checked_div(pool_value)?
    };
    if shares == 0 {
        return None;
    }
    u64::try_from(shares).ok()
}

/// Raw units of one leg that `share_amount` of the `supply` may redeem, floored.
/// Held at u128 so a whale-sized basket cannot wrap the u64 multiply.
pub fn pro_rata_payout(balance: u64, share_amount: u64, supply: u64) -> Option<u64> {
    if supply == 0 {
        return None;
    }
    let payout = u128::from(balance)
        .checked_mul(u128::from(share_amount))?
        .checked_div(u128::from(supply))?;
    u64::try_from(payout).ok()
}

/// The least the vault will accept from a swap: the caller's quote reduced by
/// its own slippage tolerance, floored. `None` when the tolerance exceeds the
/// program's cap, so a caller can never quote away the whole output.
pub fn min_swap_out(quoted_out_amount: u64, slippage_bps: u16) -> Option<u64> {
    if slippage_bps > SWAP_MAX_SLIPPAGE_BPS {
        return None;
    }
    let kept_bps = u128::from(WEIGHTS_SUM_BPS) - u128::from(slippage_bps);
    let numerator = u128::from(quoted_out_amount).checked_mul(kept_bps)?;
    u64::try_from(numerator / u128::from(WEIGHTS_SUM_BPS)).ok()
}

/// The least *value* a swap may return, measured against the pool's own fresh
/// prices rather than the caller's quote. A permissionless cranker cannot quote
/// its way into a cheaper trade - the floor is the value of what the pool gave
/// away, less the same capped slippage - so the most any single swap can lose is
/// the slippage on the drift it corrected.
pub fn min_swap_out_value(sold_value: u128, slippage_bps: u16) -> Option<u128> {
    if slippage_bps > SWAP_MAX_SLIPPAGE_BPS {
        return None;
    }
    let kept_bps = u128::from(WEIGHTS_SUM_BPS) - u128::from(slippage_bps);
    sold_value
        .checked_mul(kept_bps)?
        .checked_div(u128::from(WEIGHTS_SUM_BPS))
}

/// A declared swap may only move the two legs it names.
///
/// The venue is invoked with the pool's vault PDA as the signer, so a
/// hand-crafted route could reach a custody account the swap never declared.
/// Comparing the whole basket before and after closes that: any other leg
/// changing means value left the pool somewhere the slippage floors were not
/// watching.
pub fn assert_only_swap_legs_moved(
    before: &[u64],
    after: &[u64],
    sell: usize,
    buy: usize,
) -> Result<()> {
    require!(
        before.len() == after.len(),
        PortfolioError::WeightLengthMismatch
    );
    for (index, (before, after)) in before.iter().zip(after.iter()).enumerate() {
        if index == sell || index == buy {
            continue;
        }
        require!(before == after, PortfolioError::SwapMovedOtherLeg);
    }
    Ok(())
}

/// A swap may only narrow the basket's imbalance.
///
/// Before it, the leg being sold must sit at or above its target and the leg
/// being bought at or below its own; afterwards neither may have crossed to the
/// far side. Together with the pinned venue and the per-swap slippage cap, this
/// bounds how much value a permissionless cranker can move: at most the
/// existing imbalance, and never past the target.
pub fn assert_swap_narrows(
    assets: &[AssetConfig],
    weights_before: &[u128],
    weights_after: &[u128],
    sell: usize,
    buy: usize,
) -> Result<()> {
    require!(sell != buy, PortfolioError::WrongDirection);
    let sell_target = u128::from(
        assets
            .get(sell)
            .ok_or(PortfolioError::WrongDirection)?
            .target_weight_bps,
    );
    let buy_target = u128::from(
        assets
            .get(buy)
            .ok_or(PortfolioError::WrongDirection)?
            .target_weight_bps,
    );
    let sell_before = *weights_before
        .get(sell)
        .ok_or(PortfolioError::WrongDirection)?;
    let buy_before = *weights_before
        .get(buy)
        .ok_or(PortfolioError::WrongDirection)?;
    require!(
        sell_before >= sell_target && buy_before <= buy_target,
        PortfolioError::WrongDirection
    );
    let sell_after = *weights_after
        .get(sell)
        .ok_or(PortfolioError::WrongDirection)?;
    let buy_after = *weights_after
        .get(buy)
        .ok_or(PortfolioError::WrongDirection)?;
    require!(
        sell_after >= sell_target && buy_after <= buy_target,
        PortfolioError::SwapOvershoot
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(byte: u8) -> Pubkey {
        Pubkey::new_from_array([byte; 32])
    }

    fn asset(mint_byte: u8, weight: u16, feed_byte: u8) -> AssetConfig {
        AssetConfig {
            pyth_feed: feed(feed_byte),
            feed_id: [feed_byte; 32],
            mint: feed(mint_byte),
            vault_token_account: feed(mint_byte.wrapping_add(100)),
            target_weight_bps: weight,
            last_price: 0,
            last_price_exponent: 0,
            last_confidence: 0,
        }
    }

    fn policy() -> CrankPolicy {
        CrankPolicy {
            min_crank_interval_secs: 60,
            min_price_change_bps: 100,
            min_rebalance_bps: 0,
            max_staleness_secs: 3_600,
            max_confidence_bps: 100,
            gate_mode: GATE_OR,
        }
    }

    fn pool(assets: Vec<AssetConfig>, policy: CrankPolicy) -> EtfPool {
        EtfPool::new(1, 7, feed(9), feed(8), feed(7), assets, policy).unwrap()
    }

    fn priced(mint_byte: u8, weight: u16, price: i64) -> AssetConfig {
        let mut a = asset(mint_byte, weight, mint_byte);
        a.last_price = price;
        a.last_price_exponent = -8;
        a
    }

    #[test]
    fn asset_config_is_fifteen_fixed_fields() {
        // 4 pubkeys, two of them 32-byte arrays, plus 2+8+4+8 scalar bytes.
        assert_eq!(AssetConfig::INIT_SPACE, 32 * 4 + 2 + 8 + 4 + 8);
    }

    #[test]
    fn pool_state_round_trips_inside_its_reserved_space() {
        // The longest legal basket: ten legs at an even 1_000 bps each. Byte
        // zero is the "unset" sentinel, so the legs start at one.
        let assets: Vec<AssetConfig> = (1..=POOL_ASSETS_MAX as u8)
            .map(|i| asset(i, 1_000, i))
            .collect();
        let full = pool(assets, policy());

        let mut bytes = vec![0u8; EtfPool::SPACE];
        let mut output: &mut [u8] = &mut bytes;
        full.try_serialize(&mut output).unwrap();
        let written = EtfPool::SPACE - output.len();
        assert!(
            written <= EtfPool::SPACE,
            "a full basket must fit inside the reserved space"
        );
        assert!(
            EtfPool::SPACE - written <= 8,
            "the reserved space should not carry more than a few bytes of slack"
        );

        // The bytes the handler will persist read back as the same pool.
        let mut reader: &[u8] = &bytes[..written];
        let round_tripped = EtfPool::try_deserialize(&mut reader).unwrap();
        assert_eq!(round_tripped.assets, full.assets);
        assert_eq!(round_tripped.policy, full.policy);
        assert_eq!(round_tripped.admin, full.admin);
        assert_eq!(round_tripped.owner_op_sequence, full.owner_op_sequence);
    }

    #[test]
    fn assets_must_be_a_two_to_ten_leg_basket_that_sums_to_ten_thousand() {
        assert!(EtfPool::assert_assets_valid(&[asset(1, 10_000, 1)]).is_err());
        let too_many: Vec<AssetConfig> = (0..(POOL_ASSETS_MAX as u8 + 1))
            .map(|i| asset(i, 100, i))
            .collect();
        assert!(EtfPool::assert_assets_valid(&too_many).is_err());
        assert!(EtfPool::assert_assets_valid(&[asset(1, 5_000, 1), asset(2, 5_000, 2)]).is_ok());
        assert!(EtfPool::assert_assets_valid(&[asset(1, 5_000, 1), asset(2, 4_999, 2)]).is_err());
        // A repeated mint is rejected even when the weights balance.
        assert!(EtfPool::assert_assets_valid(&[asset(1, 5_000, 1), asset(1, 5_000, 2)]).is_err());
        // A zero weight is not a leg.
        assert!(EtfPool::assert_assets_valid(&[asset(1, 10_000, 1), asset(2, 0, 2)]).is_err());
    }

    #[test]
    fn gate_matrix_matches_the_configured_mode() {
        let mut or_pool = pool(vec![asset(1, 5_000, 1), asset(2, 5_000, 2)], policy());
        assert!(or_pool.crank_gate_open(true, false).is_ok());
        assert!(or_pool.crank_gate_open(false, true).is_ok());
        assert!(or_pool.crank_gate_open(true, true).is_ok());
        assert!(or_pool.crank_gate_open(false, false).is_err());

        let mut and_policy = policy();
        and_policy.gate_mode = GATE_AND;
        let and_pool = pool(vec![asset(1, 5_000, 1), asset(2, 5_000, 2)], and_policy);
        assert!(and_pool.crank_gate_open(true, true).is_ok());
        assert!(and_pool.crank_gate_open(false, true).is_err());
        assert!(and_pool.crank_gate_open(true, false).is_err());
        assert!(and_pool.crank_gate_open(false, false).is_err());
        or_pool.policy.gate_mode = 9;
        assert!(EtfPool::assert_policy_valid(&or_pool.policy).is_err());
    }

    #[test]
    fn price_delta_ignores_the_exponent_difference() {
        assert_eq!(
            price_delta_bps(1_000_000_000, -8, 1_010_000_000, -8),
            Some(100)
        );
        assert_eq!(
            price_delta_bps(1_000_000_000, -8, 990_000_000, -8),
            Some(100)
        );
        assert_eq!(price_delta_bps(1_000_000_000, -8, 1_010_000, -5), Some(100));
        assert_eq!(price_delta_bps(0, -8, 1, -8), None);
        assert!(price_delta_bps(1_000_000_000, -8, 1, -100).is_none());
    }

    #[test]
    fn any_price_moved_enough_only_opens_when_one_leg_passes_the_threshold() {
        let mut p = pool(
            vec![priced(1, 5_000, 100_000_000), priced(2, 5_000, 100_000_000)],
            policy(),
        );
        // A 100 bps threshold: a one-percent move hits it, smaller ones do not.
        assert_eq!(
            p.any_price_moved_enough(&[(101_000_000, -8), (100_100_000, -8)]),
            Some(true)
        );
        assert_eq!(
            p.any_price_moved_enough(&[(100_009_000, -8), (100_001_000, -8)]),
            Some(false)
        );
        assert_eq!(p.any_price_moved_enough(&[(1, -8)]), None);
        // A leg that was never priced opens the gate by itself: the pool cannot
        // be valued until a crank seeds it.
        p.assets[0].last_price = 0;
        assert_eq!(
            p.any_price_moved_enough(&[(999_999_999, -8), (1, -8)]),
            Some(true)
        );
    }

    #[test]
    fn cadence_and_staleness_read_the_clock_forward_only() {
        let mut p = pool(vec![asset(1, 5_000, 1), asset(2, 5_000, 2)], policy());
        p.last_crank_unix_timestamp = 1_000;
        assert!(!p.cadence_elapsed(1_059));
        assert!(p.cadence_elapsed(1_060));
        assert!(p.cadence_elapsed(9_999));
        assert!(p.elapsed_seconds(999).is_none());
        assert!(p.assert_cache_fresh(1_000 + 3_600).is_ok());
        assert!(p.assert_cache_fresh(1_000 + 3_601).is_err());
    }

    #[test]
    fn values_normalise_across_exponents_into_the_pool_unit() {
        // Two legs of equal real value on different exponents: 1 unit at
        // mantissa 1.5e8 with exponent -8, and 1 unit at 1.5e9 with exponent
        // -9, are both 1.5 micro-dollars.
        let values = basket_values(&[1, 1], &[(150_000_000, -8), (1_500_000_000, -9)]).unwrap();
        assert_eq!(values, vec![1_500_000, 1_500_000]);
        let weights = basket_weights_bps(&values).unwrap();
        assert_eq!(weights, vec![5_000, 5_000]);
        // A one-dollar leg priced at exponent -8 is exactly a million micro-dollars.
        assert_eq!(leg_value(1, 100_000_000, -8), Some(1_000_000));
        // A span wider than the cap refuses to value rather than guessing.
        assert!(basket_values(&[1, 1], &[(1, -8), (1, -100)]).is_none());
        // A length mismatch is a bug, not a zero.
        assert!(basket_values(&[1, 1], &[(1, -8)]).is_none());
        assert!(basket_weights_bps(&[0, 0]).is_none());
    }

    #[test]
    fn deposit_shares_track_the_pool_price() {
        // First deposit: one share per unit of value.
        assert_eq!(shares_for_deposit(0, 0, 1_000), Some(1_000));
        // A pool holding 4_000 of value with 2_000 shares: a 1_000 deposit
        // mints 500 shares, exactly its fraction.
        assert_eq!(shares_for_deposit(2_000, 4_000, 1_000), Some(500));
        // Rounding is down, and a deposit too small to buy a share is refused
        // rather than minted as zero.
        assert_eq!(shares_for_deposit(3, 10, 1), None);
        assert_eq!(shares_for_deposit(0, 0, 0), None);
        assert_eq!(shares_for_deposit(5, 0, 10), None);
    }

    #[test]
    fn pro_rata_payouts_keep_the_pool_ratio() {
        // A quarter of the supply redeems a quarter of every leg.
        assert_eq!(pro_rata_payout(400, 25, 100), Some(100));
        assert_eq!(pro_rata_payout(999, 1, 3), Some(333));
        assert_eq!(pro_rata_payout(1, 1, 3), Some(0));
        assert_eq!(pro_rata_payout(1, 1, 0), None);
        // A balance large enough to wrap the u64 multiply stays exact at u128.
        assert_eq!(
            pro_rata_payout(u64::MAX, u64::MAX, u64::MAX),
            Some(u64::MAX)
        );
    }

    #[test]
    fn min_swap_out_floors_the_quote_and_caps_slippage() {
        assert_eq!(min_swap_out(1_000, 0), Some(1_000));
        assert_eq!(min_swap_out(1_000, 100), Some(990));
        assert_eq!(min_swap_out(999, 500), Some(949));
        assert_eq!(min_swap_out(1_000, SWAP_MAX_SLIPPAGE_BPS + 1), None);
        assert_eq!(min_swap_out(1_000, 10_000), None);
        // The value floor is the same shape, in the pool's own unit.
        assert_eq!(min_swap_out_value(2_000, 0), Some(2_000));
        assert_eq!(min_swap_out_value(2_000, 250), Some(1_950));
        assert_eq!(min_swap_out_value(0, 100), Some(0));
        assert_eq!(min_swap_out_value(2_000, SWAP_MAX_SLIPPAGE_BPS + 1), None);
    }

    #[test]
    fn swaps_may_only_narrow_the_gap() {
        let assets = vec![asset(1, 5_000, 1), asset(2, 5_000, 2)];
        // Selling the overweight leg into the underweight one is allowed.
        assert!(assert_swap_narrows(&assets, &[6_000, 4_000], &[5_500, 4_500], 0, 1).is_ok());
        // Selling the underweight leg is not.
        assert!(assert_swap_narrows(&assets, &[6_000, 4_000], &[6_500, 3_500], 1, 0).is_err());
        // Overshooting past the target is not allowed, even in the right direction.
        assert!(assert_swap_narrows(&assets, &[6_000, 4_000], &[4_000, 6_000], 0, 1).is_err());
        // A leg to itself is never a swap.
        assert!(assert_swap_narrows(&assets, &[6_000, 4_000], &[6_000, 4_000], 0, 0).is_err());
    }

    #[test]
    fn a_swap_may_not_move_an_undeclared_leg() {
        let before = [1_000u64, 1_000, 1_000];
        // Only the named legs may change.
        assert!(assert_only_swap_legs_moved(&before, &[900, 1_100, 1_000], 0, 1).is_ok());
        // A route that also drains a third custody account is
        // refused even though the named legs look fine.
        assert!(assert_only_swap_legs_moved(&before, &[900, 1_100, 1], 0, 1).is_err());
        // The same applies to a leg the route quietly tops up.
        assert!(assert_only_swap_legs_moved(&before, &[900, 1_100, 2_000], 0, 1).is_err());
        // Shape mismatches are refused rather than silently zipped short.
        assert!(assert_only_swap_legs_moved(&before, &[900, 1_100], 0, 1).is_err());
    }

    #[test]
    fn rebalance_is_not_worthwhile_below_the_configured_drift() {
        let mut p = pool(vec![asset(1, 5_000, 1), asset(2, 5_000, 2)], policy());
        // min_rebalance_bps == 0 disables the check entirely.
        assert!(p.assert_rebalance_worthwhile(&[9_000, 1_000]).is_ok());
        p.policy.min_rebalance_bps = 100;
        assert!(p.assert_rebalance_worthwhile(&[5_100, 4_900]).is_ok());
        assert!(p.assert_rebalance_worthwhile(&[5_099, 4_901]).is_err());
        assert_eq!(p.worst_weight_excess_bps(&[5_200, 4_800]), Some(200));
    }

    #[test]
    fn owner_sequence_only_moves_forward() {
        let mut p = pool(vec![asset(1, 5_000, 1), asset(2, 5_000, 2)], policy());
        assert_eq!(p.owner_op_sequence, 1);
        assert!(p.assert_owner_sequence(1).is_ok());
        assert!(p.assert_owner_sequence(2).is_err());
        p.bump_owner_sequence().unwrap();
        assert_eq!(p.owner_op_sequence, 2);
        assert!(p.assert_owner_sequence(1).is_err());
        assert!(p.assert_admin(&feed(9)).is_ok());
        assert!(p.assert_admin(&feed(10)).is_err());
    }

    #[test]
    fn paused_closes_deposits_and_cranks_only() {
        let mut p = pool(vec![asset(1, 5_000, 1), asset(2, 5_000, 2)], policy());
        assert!(p.assert_running().is_ok());
        p.paused = true;
        assert!(p.assert_running().is_err());
    }
}
