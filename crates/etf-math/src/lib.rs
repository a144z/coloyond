#![no_std]

//! Pure, checked weighted-portfolio math for ETF v1.

#[cfg(test)]
extern crate std;

mod shares;
mod value;
mod weighted;
mod wide;

pub use shares::{
    initial_shares_from_nav, quote_proportional_deposit, quote_proportional_redeem, DepositQuote,
    RedeemQuote, SHARE_MINT_DECIMALS,
};
pub use value::{
    deviation_bps, is_strict_deviation_improvement, normalize_usd_value, MathError, BASIS_POINTS,
    MAX_ABS_PRICE_EXPONENT, MAX_ASSETS, MAX_MINT_DECIMALS, MIN_ASSETS, MIN_WEIGHT_BPS,
    USD_VALUE_SCALE,
};
pub use weighted::{quote_exact_in, SwapQuote, MAX_IN_RATIO_BPS, MAX_OUT_RATIO_BPS};
