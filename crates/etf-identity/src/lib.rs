//! Canonical ETF v1 pool-configuration wire encoding and content identity.
//!
//! This crate owns only protocol-neutral encoding primitives. Policy payloads
//! remain opaque until their separate S5C/S5D2 amendments define strict inner
//! schemas; the checked-in vector is synthetic and fixture-only.

use borsh::{BorshDeserialize, BorshSerialize};
use sha2::{Digest, Sha256};

pub const CONFIG_DOMAIN: &[u8] = b"coloyond:etf:config:v1";
pub const CONFIG_VERSION_V1: u8 = 1;
pub const CONFIG_HASH_BYTES: usize = 32;

#[derive(Clone, Debug, BorshDeserialize, BorshSerialize, PartialEq, Eq)]
pub struct EtfPoolConfigV1 {
    pub protocol_version: u8,
    pub assets: Vec<EtfAssetConfigV1>,
    pub math_version: u16,
    pub fee_policy_id: [u8; 32],
    pub fee_policy_params: Vec<u8>,
    pub risk_policy_id: [u8; 32],
    pub risk_policy_params: Vec<u8>,
    pub governance_delay_seconds: u64,
}

#[derive(Clone, Debug, BorshDeserialize, BorshSerialize, PartialEq, Eq)]
pub struct EtfAssetConfigV1 {
    pub mint: [u8; 32],
    pub token_program: [u8; 32],
    pub decimals: u8,
    pub oracle_mode: OracleModeV1,
    pub oracle_program: [u8; 32],
    pub oracle_account: [u8; 32],
    pub feed_id: [u8; 32],
    pub target_weight_bps: u16,
}

/// Borsh enum discriminants are the protocol tags: 0 is fixed Push Feed and
/// 1 is Receiver Full. Never reorder these variants.
#[derive(Clone, Copy, Debug, BorshDeserialize, BorshSerialize, PartialEq, Eq)]
pub enum OracleModeV1 {
    PushFeed,
    ReceiverFull,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum IdentityError {
    UnsupportedVersion,
    InvalidAssetCount,
    DuplicateMint,
    InvalidWeights,
    Serialization,
}

impl EtfPoolConfigV1 {
    pub fn validate(&self) -> Result<(), IdentityError> {
        if self.protocol_version != CONFIG_VERSION_V1 {
            return Err(IdentityError::UnsupportedVersion);
        }
        if !(2..=3).contains(&self.assets.len()) {
            return Err(IdentityError::InvalidAssetCount);
        }
        for index in 0..self.assets.len() {
            if self.assets[index + 1..]
                .iter()
                .any(|asset| asset.mint == self.assets[index].mint)
            {
                return Err(IdentityError::DuplicateMint);
            }
        }
        let weight_sum = self
            .assets
            .iter()
            .try_fold(0_u32, |sum, asset| {
                sum.checked_add(u32::from(asset.target_weight_bps))
            })
            .ok_or(IdentityError::InvalidWeights)?;
        if weight_sum != 10_000 {
            return Err(IdentityError::InvalidWeights);
        }
        Ok(())
    }

    pub fn canonical_bytes(&self) -> Result<Vec<u8>, IdentityError> {
        self.validate()?;
        borsh::to_vec(self).map_err(|_| IdentityError::Serialization)
    }

    /// `maximum_bytes` must come from the caller's reviewed account/input-size
    /// limit. S5A has not frozen a production config-size ceiling.
    pub fn from_canonical_bytes(bytes: &[u8], maximum_bytes: usize) -> Result<Self, IdentityError> {
        if bytes.len() > maximum_bytes {
            return Err(IdentityError::Serialization);
        }
        preflight_vector_lengths(bytes)?;
        let config = Self::try_from_slice(bytes).map_err(|_| IdentityError::Serialization)?;
        config.validate()?;
        Ok(config)
    }

    pub fn config_hash(&self) -> Result<[u8; CONFIG_HASH_BYTES], IdentityError> {
        let bytes = self.canonical_bytes()?;
        let mut hasher = Sha256::new();
        hasher.update(CONFIG_DOMAIN);
        hasher.update(bytes);
        Ok(hasher.finalize().into())
    }

    pub fn strategy_id(&self) -> Result<String, IdentityError> {
        let hash = self.config_hash()?;
        let mut output = String::with_capacity(5 + hash.len() * 2);
        output.push_str("etf1:");
        for byte in hash {
            use std::fmt::Write;
            write!(&mut output, "{byte:02x}").expect("String writing is infallible");
        }
        Ok(output)
    }

    /// PDA seeds without a program ID. An address cannot be derived until the
    /// deployment's program ID is pinned; callers must not invent one here.
    pub fn pool_pda_seeds(&self) -> Result<[Vec<u8>; 2], IdentityError> {
        Ok([b"etf_pool_v1".to_vec(), self.config_hash()?.to_vec()])
    }
}

/// Reject impossible vector prefixes before Borsh allocates from attacker- or
/// network-supplied lengths. The fixed asset record is 164 bytes in v1.
fn preflight_vector_lengths(bytes: &[u8]) -> Result<(), IdentityError> {
    let mut offset = 0_usize;
    let version = *bytes.get(offset).ok_or(IdentityError::Serialization)?;
    if version != CONFIG_VERSION_V1 {
        return Err(IdentityError::UnsupportedVersion);
    }
    offset += 1;
    let asset_count = read_u32(bytes, &mut offset)? as usize;
    if !(2..=3).contains(&asset_count) {
        return Err(IdentityError::InvalidAssetCount);
    }
    advance(bytes, &mut offset, asset_count * 164)?;
    advance(bytes, &mut offset, 2 + 32)?;
    let fee_length = read_u32(bytes, &mut offset)? as usize;
    advance(bytes, &mut offset, fee_length)?;
    advance(bytes, &mut offset, 32)?;
    let risk_length = read_u32(bytes, &mut offset)? as usize;
    let risk_section_length = risk_length
        .checked_add(8)
        .ok_or(IdentityError::Serialization)?;
    advance(bytes, &mut offset, risk_section_length)?;
    if offset != bytes.len() {
        return Err(IdentityError::Serialization);
    }
    Ok(())
}

fn read_u32(bytes: &[u8], offset: &mut usize) -> Result<u32, IdentityError> {
    let end = offset.checked_add(4).ok_or(IdentityError::Serialization)?;
    let value = bytes
        .get(*offset..end)
        .ok_or(IdentityError::Serialization)?;
    *offset = end;
    Ok(u32::from_le_bytes(
        value.try_into().map_err(|_| IdentityError::Serialization)?,
    ))
}

fn advance(bytes: &[u8], offset: &mut usize, count: usize) -> Result<(), IdentityError> {
    let end = offset
        .checked_add(count)
        .ok_or(IdentityError::Serialization)?;
    if end > bytes.len() {
        return Err(IdentityError::Serialization);
    }
    *offset = end;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn asset(seed: u8, weight: u16, oracle_mode: OracleModeV1) -> EtfAssetConfigV1 {
        EtfAssetConfigV1 {
            mint: [seed; 32],
            token_program: [seed + 1; 32],
            decimals: 6,
            oracle_mode,
            oracle_program: [seed + 2; 32],
            oracle_account: [seed + 3; 32],
            feed_id: [seed + 4; 32],
            target_weight_bps: weight,
        }
    }

    fn sample_config() -> EtfPoolConfigV1 {
        EtfPoolConfigV1 {
            protocol_version: 1,
            assets: vec![
                asset(1, 4_000, OracleModeV1::PushFeed),
                asset(11, 6_000, OracleModeV1::ReceiverFull),
            ],
            math_version: 7,
            fee_policy_id: [21; 32],
            fee_policy_params: vec![0xaa, 0xbb, 0xcc],
            risk_policy_id: [31; 32],
            risk_policy_params: vec![0x10, 0x20, 0x30, 0x40],
            governance_delay_seconds: 86_400,
        }
    }

    #[test]
    fn canonical_borsh_bytes_and_domain_hash_match_golden_vector() {
        let config = sample_config();
        let bytes = config.canonical_bytes().unwrap();
        assert_eq!(bytes.len(), 422);
        assert_eq!(hex(&bytes), GOLDEN_CONFIG_BYTES_HEX);
        assert_eq!(hex(&config.config_hash().unwrap()), GOLDEN_CONFIG_HASH_HEX);
        assert_eq!(
            config.strategy_id().unwrap(),
            format!("etf1:{GOLDEN_CONFIG_HASH_HEX}")
        );
        assert_eq!(
            EtfPoolConfigV1::from_canonical_bytes(&bytes, 1_024).unwrap(),
            config
        );
    }

    #[test]
    fn parser_rejects_trailing_bytes_and_invalid_weight_or_version() {
        let config = sample_config();
        let mut bytes = config.canonical_bytes().unwrap();
        bytes.push(0);
        assert_eq!(
            EtfPoolConfigV1::from_canonical_bytes(&bytes, 1_024),
            Err(IdentityError::Serialization)
        );

        let mut invalid = sample_config();
        invalid.protocol_version = 2;
        assert_eq!(invalid.validate(), Err(IdentityError::UnsupportedVersion));
        invalid = sample_config();
        invalid.assets[1].target_weight_bps = 5_999;
        assert_eq!(invalid.validate(), Err(IdentityError::InvalidWeights));

        invalid = sample_config();
        invalid.assets[1].mint = invalid.assets[0].mint;
        assert_eq!(invalid.validate(), Err(IdentityError::DuplicateMint));
    }

    #[test]
    fn parser_bounds_vector_allocations_and_rejects_unknown_oracle_tags() {
        let mut bytes = sample_config().canonical_bytes().unwrap();
        bytes[70] = 2;
        assert_eq!(
            EtfPoolConfigV1::from_canonical_bytes(&bytes, 1_024),
            Err(IdentityError::Serialization)
        );

        let mut bytes = sample_config().canonical_bytes().unwrap();
        let fee_length_offset = 5 + 2 * 164 + 2 + 32;
        bytes[fee_length_offset..fee_length_offset + 4].copy_from_slice(&u32::MAX.to_le_bytes());
        assert_eq!(
            EtfPoolConfigV1::from_canonical_bytes(&bytes, 1_024),
            Err(IdentityError::Serialization)
        );
    }

    #[test]
    fn decoder_requires_an_explicit_size_ceiling_and_does_not_freeze_minimum_weight() {
        let bytes = sample_config().canonical_bytes().unwrap();
        assert_eq!(
            EtfPoolConfigV1::from_canonical_bytes(&bytes, bytes.len() - 1),
            Err(IdentityError::Serialization)
        );
        let mut small_weight = sample_config();
        small_weight.assets[0].target_weight_bps = 1;
        small_weight.assets[1].target_weight_bps = 9_999;
        assert!(small_weight.canonical_bytes().is_ok());
    }

    #[test]
    fn pool_seed_vector_needs_no_unassigned_program_id() {
        let seeds = sample_config().pool_pda_seeds().unwrap();
        assert_eq!(seeds[0], b"etf_pool_v1");
        assert_eq!(hex(&seeds[1]), GOLDEN_CONFIG_HASH_HEX);
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }

    const GOLDEN_CONFIG_BYTES_HEX: &str = "0102000000010101010101010101010101010101010101010101010101010101010101010102020202020202020202020202020202020202020202020202020202020202020600030303030303030303030303030303030303030303030303030303030303030304040404040404040404040404040404040404040404040404040404040404040505050505050505050505050505050505050505050505050505050505050505a00f0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c06010d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f70170700151515151515151515151515151515151515151515151515151515151515151503000000aabbcc1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f04000000102030408051010000000000";
    const GOLDEN_CONFIG_HASH_HEX: &str =
        "0852ddf87df71fb53c07f235c4afbf11c4593ced710807ac208427b0c10ecf72";
}
