use super::*;

const CREATED_AT: i64 = 900;
const CREATED_SLOT: u64 = 10;

fn bounds() -> ConditionBounds {
    ConditionBounds {
        maximum_observation_age_seconds: 30,
        minimum_observation_separation_seconds: 5,
        minimum_observation_separation_slots: 5,
        maximum_rule_lifetime_seconds: 300,
        maximum_rule_lifetime_slots: 300,
        maximum_schedule_delay_seconds: 120,
        maximum_schedule_delay_slots: 120,
        maximum_hysteresis_bps: 1_000,
    }
}

fn now(unix_timestamp: i64, slot: u64) -> ConditionNow {
    ConditionNow {
        unix_timestamp,
        slot,
        target_revision: 4,
        configuration_revision: 7,
    }
}

fn observation(
    price_q18: u128,
    publish_time: i64,
    _observed_at: i64,
    _slot: u64,
) -> ConditionSample {
    ConditionSample {
        asset_index: 0,
        price_q18,
        publish_time,
    }
}

fn rule(predicate: ConditionPredicate) -> ConditionalRule {
    ConditionalRule {
        version: CONDITION_VERSION,
        enabled: true,
        nonce: 12,
        expected_revisions: ConditionRevisions {
            target: 4,
            configuration: 7,
        },
        authorized_target_revision: 5,
        target_bps: [6_000, 4_000],
        created_at: CREATED_AT,
        created_slot: CREATED_SLOT,
        expires_at: 1_100,
        expires_slot: 210,
        predicate,
        last_observation: None,
        pending_activation: false,
    }
}

fn above_rule() -> ConditionalRule {
    rule(ConditionPredicate::PriceCross {
        asset_index: 0,
        direction: CrossingDirection::Above,
        threshold_q18: 100,
        hysteresis_bps: 500,
    })
}

#[test]
fn schedule_is_bounded_and_authorizes_only_the_published_target() {
    let mut rule = rule(ConditionPredicate::Schedule {
        asset_index: 0,
        not_before_unix_timestamp: 1_000,
        not_before_slot: 30,
    });
    assert_eq!(
        observe_condition(
            &mut rule,
            observation(100, 995, 1_000, 30),
            now(1_000, 30),
            bounds()
        ),
        Ok(ObservationStatus::Ready)
    );

    let authorized = activate_condition(&mut rule, 12, now(1_000, 30), bounds()).unwrap();
    assert_eq!(authorized.target_bps, [6_000, 4_000]);
    assert_eq!(authorized.target_revision, 5);
    assert_eq!(authorized.configuration_revision, 7);
    assert_eq!(authorized.consumed_nonce, 12);
    assert!(!rule.enabled);
}

#[test]
fn schedule_delay_and_rule_lifetime_must_fit_explicit_policy_bounds() {
    let mut too_far = rule(ConditionPredicate::Schedule {
        asset_index: 0,
        not_before_unix_timestamp: 1_021,
        not_before_slot: 31,
    });
    assert_eq!(
        observe_condition(
            &mut too_far,
            observation(100, 995, 1_000, 30),
            now(1_000, 30),
            bounds()
        ),
        Err(ConditionError::InvalidPredicate)
    );

    let mut too_long = rule(ConditionPredicate::Schedule {
        asset_index: 0,
        not_before_unix_timestamp: 1_000,
        not_before_slot: 30,
    });
    too_long.expires_at = 1_201;
    assert_eq!(
        observe_condition(
            &mut too_long,
            observation(100, 995, 1_000, 30),
            now(1_000, 30),
            bounds()
        ),
        Err(ConditionError::InvalidRule)
    );
}

#[test]
fn price_cross_requires_two_fresh_distinct_pyth_observations_and_both_gaps() {
    let mut rule = above_rule();
    assert_eq!(
        observe_condition(
            &mut rule,
            observation(90, 990, 1_000, 30),
            now(1_000, 30),
            bounds()
        ),
        Ok(ObservationStatus::Waiting)
    );
    assert_eq!(
        observe_condition(
            &mut rule,
            observation(101, 1_005, 1_005, 34),
            now(1_005, 34),
            bounds()
        ),
        Err(ConditionError::ObservationTooClose)
    );
    assert_eq!(
        observe_condition(
            &mut rule,
            observation(101, 1_004, 1_004, 35),
            now(1_004, 35),
            bounds()
        ),
        Err(ConditionError::ObservationTooClose)
    );
    assert_eq!(
        observe_condition(
            &mut rule,
            observation(101, 1_005, 1_005, 35),
            now(1_005, 35),
            bounds()
        ),
        Ok(ObservationStatus::Ready)
    );
    assert!(rule.pending_activation);
}

#[test]
fn activation_rejects_a_newer_verified_price_that_reverses_the_crossing() {
    let mut rule = above_rule();
    observe_condition(
        &mut rule,
        observation(90, 990, 1_000, 30),
        now(1_000, 30),
        bounds(),
    )
    .unwrap();
    assert_eq!(
        observe_condition(
            &mut rule,
            observation(101, 1_005, 1_005, 35),
            now(1_005, 35),
            bounds(),
        ),
        Ok(ObservationStatus::Ready)
    );

    assert_eq!(
        validate_current_condition(
            &rule,
            observation(99, 1_010, 1_010, 40),
            now(1_010, 40),
            bounds(),
        ),
        Err(ConditionError::NotTriggered)
    );
    assert_eq!(
        validate_current_condition(
            &rule,
            observation(102, 1_010, 1_010, 40),
            now(1_010, 40),
            bounds(),
        ),
        Ok(())
    );
}

#[test]
fn replayed_or_stale_pyth_publish_times_are_rejected() {
    let mut rule = above_rule();
    observe_condition(
        &mut rule,
        observation(90, 990, 1_000, 30),
        now(1_000, 30),
        bounds(),
    )
    .unwrap();
    assert_eq!(
        observe_condition(
            &mut rule,
            observation(101, 990, 1_005, 35),
            now(1_005, 35),
            bounds()
        ),
        Err(ConditionError::OracleReplay)
    );
    assert_eq!(
        observe_condition(
            &mut rule,
            observation(101, 970, 1_005, 35),
            now(1_005, 35),
            bounds()
        ),
        Err(ConditionError::StaleObservation)
    );
}

#[test]
fn future_and_pre_rule_pyth_observations_are_rejected() {
    let mut future = above_rule();
    assert_eq!(
        observe_condition(
            &mut future,
            observation(100, 1_001, 1_000, 30),
            now(1_000, 30),
            bounds()
        ),
        Err(ConditionError::FuturePublishTime)
    );
    let mut pre_rule = above_rule();
    assert_eq!(
        observe_condition(
            &mut pre_rule,
            observation(100, 899, 1_000, 30),
            now(1_000, 30),
            bounds()
        ),
        Err(ConditionError::FuturePublishTime)
    );
}

#[test]
fn hysteresis_blocks_small_crossings_and_revokes_a_reversed_pending_cross() {
    let mut jitter = above_rule();
    observe_condition(
        &mut jitter,
        observation(98, 990, 1_000, 30),
        now(1_000, 30),
        bounds(),
    )
    .unwrap();
    assert_eq!(
        observe_condition(
            &mut jitter,
            observation(101, 1_005, 1_005, 35),
            now(1_005, 35),
            bounds()
        ),
        Ok(ObservationStatus::Waiting)
    );

    let mut reversed = above_rule();
    observe_condition(
        &mut reversed,
        observation(90, 990, 1_000, 30),
        now(1_000, 30),
        bounds(),
    )
    .unwrap();
    assert_eq!(
        observe_condition(
            &mut reversed,
            observation(101, 1_005, 1_005, 35),
            now(1_005, 35),
            bounds()
        ),
        Ok(ObservationStatus::Ready)
    );
    assert_eq!(
        observe_condition(
            &mut reversed,
            observation(99, 1_010, 1_010, 40),
            now(1_010, 40),
            bounds()
        ),
        Ok(ObservationStatus::Revoked)
    );
    assert_eq!(
        activate_condition(&mut reversed, 12, now(1_010, 40), bounds()),
        Err(ConditionError::NotTriggered)
    );
}

#[test]
fn below_cross_uses_the_symmetric_hysteresis_band() {
    let mut rule = rule(ConditionPredicate::PriceCross {
        asset_index: 0,
        direction: CrossingDirection::Below,
        threshold_q18: 100,
        hysteresis_bps: 500,
    });
    observe_condition(
        &mut rule,
        observation(105, 990, 1_000, 30),
        now(1_000, 30),
        bounds(),
    )
    .unwrap();
    assert_eq!(
        observe_condition(
            &mut rule,
            observation(100, 1_005, 1_005, 35),
            now(1_005, 35),
            bounds()
        ),
        Ok(ObservationStatus::Ready)
    );
}

#[test]
fn target_and_configuration_revisions_must_match_exactly() {
    let mut target_mismatch = above_rule();
    assert_eq!(
        observe_condition(
            &mut target_mismatch,
            observation(90, 990, 1_000, 30),
            ConditionNow {
                target_revision: 5,
                ..now(1_000, 30)
            },
            bounds(),
        ),
        Err(ConditionError::StaleTargetRevision)
    );

    let mut config_mismatch = above_rule();
    assert_eq!(
        observe_condition(
            &mut config_mismatch,
            observation(90, 990, 1_000, 30),
            ConditionNow {
                configuration_revision: 8,
                ..now(1_000, 30)
            },
            bounds(),
        ),
        Err(ConditionError::StaleConfigurationRevision)
    );
}

#[test]
fn exact_expiry_boundary_rejects_observation_and_activation() {
    let mut rule = rule(ConditionPredicate::Schedule {
        asset_index: 0,
        not_before_unix_timestamp: 1_000,
        not_before_slot: 30,
    });
    observe_condition(
        &mut rule,
        observation(100, 995, 1_000, 30),
        now(1_000, 30),
        bounds(),
    )
    .unwrap();
    assert_eq!(
        observe_condition(
            &mut rule,
            observation(100, 1_100, 1_100, 100),
            now(1_100, 100),
            bounds(),
        ),
        Err(ConditionError::RuleExpired)
    );
    assert_eq!(
        activate_condition(&mut rule, 12, now(1_100, 100), bounds()),
        Err(ConditionError::RuleExpired)
    );
}

#[test]
fn nonce_mismatch_and_reactivation_replay_fail_closed() {
    let mut rule = rule(ConditionPredicate::Schedule {
        asset_index: 0,
        not_before_unix_timestamp: 1_000,
        not_before_slot: 30,
    });
    observe_condition(
        &mut rule,
        observation(100, 995, 1_000, 30),
        now(1_000, 30),
        bounds(),
    )
    .unwrap();
    assert_eq!(
        activate_condition(&mut rule, 11, now(1_000, 30), bounds()),
        Err(ConditionError::NonceMismatch)
    );
    activate_condition(&mut rule, 12, now(1_000, 30), bounds()).unwrap();
    assert_eq!(rule.nonce, 13);
    assert_eq!(
        activate_condition(&mut rule, 12, now(1_000, 30), bounds()),
        Err(ConditionError::NonceMismatch)
    );
    assert_eq!(
        activate_condition(&mut rule, 13, now(1_000, 30), bounds()),
        Err(ConditionError::RuleDisabled)
    );
}

#[test]
fn malformed_predicates_and_arithmetic_overflow_are_rejected() {
    let mut invalid_asset = rule(ConditionPredicate::PriceCross {
        asset_index: 2,
        direction: CrossingDirection::Above,
        threshold_q18: 100,
        hysteresis_bps: 500,
    });
    assert_eq!(
        observe_condition(
            &mut invalid_asset,
            observation(100, 995, 1_000, 30),
            now(1_000, 30),
            bounds()
        ),
        Err(ConditionError::InvalidPredicate)
    );

    let mut overflow = rule(ConditionPredicate::PriceCross {
        asset_index: 0,
        direction: CrossingDirection::Above,
        threshold_q18: u128::MAX,
        hysteresis_bps: 500,
    });
    observe_condition(
        &mut overflow,
        observation(1, 990, 1_000, 30),
        now(1_000, 30),
        bounds(),
    )
    .unwrap();
    assert_eq!(
        observe_condition(
            &mut overflow,
            observation(u128::MAX, 1_005, 1_005, 35),
            now(1_005, 35),
            bounds()
        ),
        Err(ConditionError::ArithmeticOverflow)
    );
}
