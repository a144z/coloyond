//! Pure transition helpers for deposit and redemption.
//!
//! S1F supplies the Anchor account contexts and SPL Token CPIs. These helpers
//! deliberately expose no callable entrypoint: transfers, share mint/burn,
//! quote validation and state changes must be composed in one transaction.

use anchor_lang::prelude::Result;

use crate::{
    accounting::{self, DepositQuote, RedemptionQuote},
    state::Vault,
};

pub fn plan_deposit(
    vault: &mut Vault,
    actual_custody_amounts: [u64; 2],
    max_amounts: [u64; 2],
    min_shares_out: u64,
) -> Result<DepositQuote> {
    // Read token-account balances inside the same instruction that performs
    // the transfers. This makes unsolicited transfers holder backing before
    // calculating the incoming share price.
    accounting::sync_donation(vault, actual_custody_amounts)?;
    accounting::quote_deposit(vault, max_amounts, min_shares_out)
}

/// Call only after both inbound asset transfers and share mint CPI are staged
/// in the same instruction. A runtime error at any point rolls everything back.
pub fn record_deposit(vault: &mut Vault, quote: DepositQuote) -> Result<()> {
    accounting::apply_deposit(vault, quote)
}

pub fn plan_redemption(
    vault: &mut Vault,
    actual_custody_amounts: [u64; 2],
    shares_to_burn: u64,
) -> Result<RedemptionQuote> {
    accounting::sync_donation(vault, actual_custody_amounts)?;
    accounting::quote_redemption(vault, shares_to_burn)
}

/// Call only after the share burn and both outbound transfers are staged in
/// the same instruction. A failed CPI rolls the token and state changes back.
pub fn record_redemption(
    vault: &mut Vault,
    shares_to_burn: u64,
    quote: RedemptionQuote,
) -> Result<()> {
    accounting::apply_redemption(vault, shares_to_burn, quote)
}
