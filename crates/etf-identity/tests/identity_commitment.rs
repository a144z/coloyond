use coloyond_etf_identity::{EtfAssetConfigV1, EtfPoolConfigV1, OracleModeV1};

fn asset(seed: u8, weight_bps: u16, oracle_mode: OracleModeV1) -> EtfAssetConfigV1 {
    EtfAssetConfigV1 {
        mint: [seed; 32],
        token_program: [seed + 1; 32],
        decimals: 6,
        oracle_mode,
        oracle_program: [seed + 2; 32],
        oracle_account: [seed + 3; 32],
        feed_id: [seed + 4; 32],
        target_weight_bps: weight_bps,
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
        initial_governance_authority: [41; 32],
        initial_emergency_guardian: [42; 32],
        governance_delay_seconds: 86_400,
    }
}

fn assert_identity_changes(mutate: impl FnOnce(&mut EtfPoolConfigV1)) {
    let baseline = sample_config();
    let baseline_bytes = baseline.canonical_bytes().unwrap();
    let baseline_hash = baseline.config_hash().unwrap();
    let baseline_id = baseline.strategy_id().unwrap();
    let baseline_pool_seeds = baseline.pool_pda_seeds().unwrap();

    let mut changed = baseline;
    mutate(&mut changed);
    assert_ne!(changed.canonical_bytes().unwrap(), baseline_bytes);
    assert_ne!(changed.config_hash().unwrap(), baseline_hash);
    assert_ne!(changed.strategy_id().unwrap(), baseline_id);
    let changed_pool_seeds = changed.pool_pda_seeds().unwrap();
    assert_eq!(changed_pool_seeds[0], baseline_pool_seeds[0]);
    assert_ne!(changed_pool_seeds[1], baseline_pool_seeds[1]);
}

#[test]
fn every_valid_configuration_field_is_committed_to_identity() {
    let mutations: [fn(&mut EtfPoolConfigV1); 22] = [
        |c| c.assets[0].mint = [51; 32],
        |c| c.assets[0].token_program = [52; 32],
        |c| c.assets[0].decimals = 9,
        |c| c.assets[0].oracle_mode = OracleModeV1::ReceiverFull,
        |c| c.assets[0].oracle_program = [53; 32],
        |c| c.assets[0].oracle_account = [54; 32],
        |c| c.assets[0].feed_id = [55; 32],
        |c| {
            c.assets[0].target_weight_bps += 1;
            c.assets[1].target_weight_bps -= 1;
        },
        |c| c.assets[1].mint = [56; 32],
        |c| c.assets[1].token_program = [57; 32],
        |c| c.assets[1].decimals = 9,
        |c| c.assets[1].oracle_mode = OracleModeV1::PushFeed,
        |c| c.assets[1].oracle_program = [58; 32],
        |c| c.assets[1].oracle_account = [59; 32],
        |c| c.assets[1].feed_id = [60; 32],
        |c| {
            c.assets[1].target_weight_bps += 1;
            c.assets[0].target_weight_bps -= 1;
        },
        |c| c.math_version += 1,
        |c| c.fee_policy_id = [61; 32],
        |c| c.fee_policy_params.push(0xdd),
        |c| c.risk_policy_id = [62; 32],
        |c| c.risk_policy_params.push(0x50),
        |c| c.governance_delay_seconds += 1,
    ];

    for mutate in mutations {
        assert_identity_changes(mutate);
    }
    assert_identity_changes(|c| c.initial_governance_authority = [63; 32]);
    assert_identity_changes(|c| c.initial_emergency_guardian = [64; 32]);
}

#[test]
fn asset_order_is_identity_bearing_and_unsupported_versions_fail_closed() {
    assert_identity_changes(|c| c.assets.swap(0, 1));

    let mut unsupported = sample_config();
    unsupported.protocol_version = 2;
    assert!(unsupported.canonical_bytes().is_err());
}
