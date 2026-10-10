#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct U256 {
    high: u128,
    low: u128,
}

impl U256 {
    pub(crate) fn mul_u128(left: u128, right: u128) -> Self {
        let left_low = left as u64 as u128;
        let left_high = (left >> 64) as u64 as u128;
        let right_low = right as u64 as u128;
        let right_high = (right >> 64) as u64 as u128;

        let low_product = left_low * right_low;
        let cross_left = left_low * right_high;
        let cross_right = left_high * right_low;
        let high_product = left_high * right_high;

        let middle =
            (low_product >> 64) + (cross_left as u64 as u128) + (cross_right as u64 as u128);
        let upper_middle = (cross_left >> 64)
            + (cross_right >> 64)
            + (high_product as u64 as u128)
            + (middle >> 64);
        let highest = (high_product >> 64) + (upper_middle >> 64);

        Self {
            high: (highest << 64) | (upper_middle as u64 as u128),
            low: ((middle as u64 as u128) << 64) | (low_product as u64 as u128),
        }
    }
}

impl Ord for U256 {
    fn cmp(&self, other: &Self) -> core::cmp::Ordering {
        self.high
            .cmp(&other.high)
            .then_with(|| self.low.cmp(&other.low))
    }
}

impl PartialOrd for U256 {
    fn partial_cmp(&self, other: &Self) -> Option<core::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

#[cfg(test)]
mod tests {
    use super::U256;

    #[test]
    fn multiplies_full_width_values() {
        assert_eq!(U256::mul_u128(0, u128::MAX), U256 { high: 0, low: 0 });
        assert_eq!(
            U256::mul_u128(u128::MAX, 1),
            U256 {
                high: 0,
                low: u128::MAX
            }
        );
        assert_eq!(
            U256::mul_u128(u128::MAX, u128::MAX),
            U256 {
                high: u128::MAX - 1,
                low: 1
            }
        );
    }

    #[test]
    fn multiplies_cross_limb_reference_vectors() {
        let vectors = [
            (
                0x0000_0000_0000_0001_0000_0000_0000_0001,
                0x0000_0000_0000_0001_0000_0000_0000_0001,
                0x0000_0000_0000_0000_0000_0000_0000_0001,
                0x0000_0000_0000_0002_0000_0000_0000_0001,
            ),
            (
                0x8000_0000_0000_0000_0123_4567_89ab_cdef,
                0x8000_0000_0000_0000_0123_4567_89ab_cdef,
                0x4000_0000_0000_0000_0123_4567_89ab_cdef,
                0x0001_4b66_dc33_f6ac_dca5_e208_90f2_a521,
            ),
            (
                0x1234_5678_9abc_def0_1234_5678_9abc_def0,
                0xfedc_ba98_7654_3210_fedc_ba98_7654_3210,
                0x121f_a00a_d77d_7422_47ac_c914_0513_b744,
                0x58fa_b207_83af_1222_236d_88fe_5618_cf00,
            ),
        ];

        for (left, right, high, low) in vectors {
            assert_eq!(U256::mul_u128(left, right), U256 { high, low });
        }
    }
}
