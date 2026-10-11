use anchor_lang::prelude::*;

pub const POOL_SEED: &[u8] = b"etf_pool_v1";
pub const POOL_STATE_SEED: &[u8] = b"etf_pool_state_v1";
pub const AUTHORITY_SEED: &[u8] = b"etf_authority_v1";
pub const SHARE_MINT_SEED: &[u8] = b"etf_share_v1";
pub const CUSTODY_SEED: &[u8] = b"etf_custody_v1";
pub const ASSET_STATE_SEED: &[u8] = b"etf_asset_v1";

pub fn pool(config_hash: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[POOL_SEED, config_hash], &crate::ID)
}

pub fn pool_state(pool: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[POOL_STATE_SEED, pool.as_ref()], &crate::ID)
}

pub fn authority(pool: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[AUTHORITY_SEED, pool.as_ref()], &crate::ID)
}

pub fn share_mint(pool: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[SHARE_MINT_SEED, pool.as_ref()], &crate::ID)
}

pub fn custody(pool: &Pubkey, asset_index: u8) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[CUSTODY_SEED, pool.as_ref(), &[asset_index]], &crate::ID)
}

pub fn asset_state(pool: &Pubkey, asset_index: u8) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[ASSET_STATE_SEED, pool.as_ref(), &[asset_index]],
        &crate::ID,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pool_and_related_pdas_match_the_contract_seed_domains() {
        let hash = [7; 32];
        let (pool_key, _) = pool(&hash);
        assert_eq!(
            pool_key,
            Pubkey::find_program_address(&[b"etf_pool_v1", &hash], &crate::ID).0
        );
        assert_ne!(authority(&pool_key).0, share_mint(&pool_key).0);
        assert_ne!(custody(&pool_key, 0).0, custody(&pool_key, 1).0);
        assert_ne!(asset_state(&pool_key, 0).0, asset_state(&pool_key, 1).0);
    }
}
