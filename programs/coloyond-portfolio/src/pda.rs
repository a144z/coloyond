//! Program-derived addresses for the ETF pool.

use anchor_lang::prelude::*;

/// Seeds of the single pool state account: `[POOL_SEED, admin, pool_id_le]`.
pub const POOL_SEED: &[u8] = b"etf_pool";
/// Seeds of the pool's token authority: `[VAULT_SEED, pool]`.
pub const VAULT_SEED: &[u8] = b"etf_vault";

/// The pool account for one admin and one `pool_id`.
pub fn pool(admin: &Pubkey, pool_id: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[POOL_SEED, admin.as_ref(), &pool_id.to_le_bytes()],
        &crate::ID,
    )
}

/// The token authority that owns every custody account and mints shares. It
/// holds no data of its own, so it can never be used to take the pool's assets
/// anywhere except through a token transfer the program itself signs.
pub fn vault(pool: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[VAULT_SEED, pool.as_ref()], &crate::ID)
}
