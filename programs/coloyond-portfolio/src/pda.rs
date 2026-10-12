use anchor_lang::prelude::*;

pub const REGISTRY_SEED: &[u8] = b"portfolio_owner_v2";
pub const VAULT_SEED: &[u8] = b"portfolio_vault_v2";
pub const AUTHORITY_SEED: &[u8] = b"portfolio_authority_v2";
pub const CUSTODY_SEED: &[u8] = b"portfolio_custody_v2";
pub const CONTROLLER_SEED: &[u8] = b"portfolio_controller_v2";
pub const ADMISSION_SEED: &[u8] = b"portfolio_admission_v2";

pub fn admission() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[ADMISSION_SEED], &crate::ID)
}

pub fn registry(owner: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[REGISTRY_SEED, owner.as_ref()], &crate::ID)
}

pub fn vault(owner: &Pubkey, nonce: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[VAULT_SEED, owner.as_ref(), &nonce.to_le_bytes()],
        &crate::ID,
    )
}

pub fn authority(vault: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[AUTHORITY_SEED, vault.as_ref()], &crate::ID)
}

pub fn custody(vault: &Pubkey, asset_index: u8) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[CUSTODY_SEED, vault.as_ref(), &[asset_index]], &crate::ID)
}

pub fn controller(vault: &Pubkey, generation: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[CONTROLLER_SEED, vault.as_ref(), &generation.to_le_bytes()],
        &crate::ID,
    )
}
