//! Minimal classic-SPL layout readers.
//!
//! The basket's custody accounts and asset mints arrive as
//! `remaining_accounts`, so each one is read straight from its raw bytes and
//! validated explicitly rather than trusted through a typed `Account` wrapper.
//! Only the classic SPL Token layouts are accepted, so a token-2022 extension
//! (transfer fee, interest bearing) cannot change the pool's math silently.

/// Byte length of a classic SPL token account.
pub const SPL_TOKEN_ACCOUNT_LEN: usize = 165;
/// Byte length of a classic SPL mint account.
pub const SPL_MINT_LEN: usize = 82;

/// The bytes a token account exposes that this program cares about.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TokenAccountView {
    pub mint: [u8; 32],
    pub owner: [u8; 32],
    pub amount: u64,
}

/// The bytes a mint exposes that this program cares about.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MintView {
    pub mint_authority: Option<[u8; 32]>,
    pub supply: u64,
    pub decimals: u8,
    pub is_initialized: bool,
    pub freeze_authority: Option<[u8; 32]>,
}

fn read_u32(data: &[u8], offset: usize) -> Option<u32> {
    let bytes: [u8; 4] = data.get(offset..offset + 4)?.try_into().ok()?;
    Some(u32::from_le_bytes(bytes))
}

fn read_u64(data: &[u8], offset: usize) -> Option<u64> {
    let bytes: [u8; 8] = data.get(offset..offset + 8)?.try_into().ok()?;
    Some(u64::from_le_bytes(bytes))
}

fn read_array32(data: &[u8], offset: usize) -> Option<[u8; 32]> {
    data.get(offset..offset + 32)?.try_into().ok()
}

/// Read a `COption<Pubkey>`: a little-endian u32 tag followed by the key when
/// the tag is 1. Any other tag is a layout this program does not understand.
fn read_coption(data: &[u8], offset: usize) -> Option<Option<[u8; 32]>> {
    match read_u32(data, offset)? {
        0 => Some(None),
        1 => Some(Some(read_array32(data, offset + 4)?)),
        _ => None,
    }
}

/// Parse a classic SPL token account, or `None` if the layout is not it.
pub fn read_token_account(data: &[u8]) -> Option<TokenAccountView> {
    if data.len() != SPL_TOKEN_ACCOUNT_LEN {
        return None;
    }
    Some(TokenAccountView {
        mint: read_array32(data, 0)?,
        owner: read_array32(data, 32)?,
        amount: read_u64(data, 64)?,
    })
}

/// Parse a classic SPL mint, or `None` if the layout is not it.
pub fn read_mint(data: &[u8]) -> Option<MintView> {
    if data.len() != SPL_MINT_LEN {
        return None;
    }
    Some(MintView {
        mint_authority: read_coption(data, 0)?,
        supply: read_u64(data, 36)?,
        decimals: *data.get(44)?,
        is_initialized: *data.get(45)? != 0,
        freeze_authority: read_coption(data, 46)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A valid token account for `mint`/`owner`/`amount`, plus one spare byte so
    /// the length check can be shown to matter.
    fn token_account(mint: u8, owner: u8, amount: u64) -> Vec<u8> {
        let mut data = vec![0u8; SPL_TOKEN_ACCOUNT_LEN];
        data[0..32].copy_from_slice(&[mint; 32]);
        data[32..64].copy_from_slice(&[owner; 32]);
        data[64..72].copy_from_slice(&amount.to_le_bytes());
        data
    }

    fn mint(mint_authority: Option<u8>, supply: u64, decimals: u8) -> Vec<u8> {
        let mut data = vec![0u8; SPL_MINT_LEN];
        if let Some(byte) = mint_authority {
            data[0..4].copy_from_slice(&1u32.to_le_bytes());
            data[4..36].copy_from_slice(&[byte; 32]);
        }
        data[36..44].copy_from_slice(&supply.to_le_bytes());
        data[44] = decimals;
        data[45] = 1;
        data
    }

    #[test]
    fn reads_a_classic_token_account() {
        let view = read_token_account(&token_account(5, 6, 1_234)).unwrap();
        assert_eq!(view.mint, [5u8; 32]);
        assert_eq!(view.owner, [6u8; 32]);
        assert_eq!(view.amount, 1_234);
        // A wrong-sized buffer is not a token account.
        assert!(read_token_account(&token_account(5, 6, 1)[..164]).is_none());
    }

    #[test]
    fn reads_a_classic_mint() {
        let view = read_mint(&mint(Some(7), 42, 9)).unwrap();
        assert_eq!(view.mint_authority, Some([7u8; 32]));
        assert_eq!(view.supply, 42);
        assert_eq!(view.decimals, 9);
        assert!(view.is_initialized);
        assert_eq!(view.freeze_authority, None);
        // An absent authority is read as absent, not as a zero key.
        assert_eq!(read_mint(&mint(None, 0, 6)).unwrap().mint_authority, None);
        // An unknown COption tag is rejected rather than misread.
        let mut broken = mint(Some(7), 0, 9);
        broken[0..4].copy_from_slice(&9u32.to_le_bytes());
        assert!(read_mint(&broken).is_none());
        assert!(read_mint(&[0u8; 81]).is_none());
    }
}
