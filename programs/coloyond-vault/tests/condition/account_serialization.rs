use super::*;

fn rule(nonce: u64, observation: Option<ConditionObservation>) -> ConditionalRule {
    ConditionalRule {
        version: CONDITION_VERSION,
        enabled: false,
        nonce,
        expected_revisions: ConditionRevisions {
            target: 1,
            configuration: 1,
        },
        authorized_target_revision: 2,
        target_bps: [6_000, 4_000],
        created_at: 100,
        created_slot: 10,
        expires_at: 1_000,
        expires_slot: 1_000,
        predicate: ConditionPredicate::Schedule {
            asset_index: 0,
            not_before_unix_timestamp: 200,
            not_before_slot: 20,
        },
        last_observation: observation,
        pending_activation: false,
    }
}

fn bounds() -> ConditionBounds {
    ConditionBounds {
        maximum_observation_age_seconds: 30,
        minimum_observation_separation_seconds: 5,
        minimum_observation_separation_slots: 5,
        maximum_rule_lifetime_seconds: 900,
        maximum_rule_lifetime_slots: 900,
        maximum_schedule_delay_seconds: 100,
        maximum_schedule_delay_slots: 100,
        maximum_hysteresis_bps: 500,
    }
}

fn encoded(state: &ConditionState) -> Vec<u8> {
    let mut bytes = Vec::new();
    state.try_serialize(&mut bytes).unwrap();
    bytes
}

fn assert_shrinking_transition_clears_stale_tail(previous: &ConditionState, next: &ConditionState) {
    let previous_bytes = encoded(previous);
    let next_bytes = encoded(next);
    assert!(previous_bytes.len() > next_bytes.len());
    assert!(previous_bytes[next_bytes.len()..]
        .iter()
        .any(|byte| *byte != 0));

    let mut account_data = vec![0; ConditionState::SPACE];
    account_data[..previous_bytes.len()].copy_from_slice(&previous_bytes);

    next.clear_serialized_tail(&mut account_data).unwrap();
    account_data[..next_bytes.len()].copy_from_slice(&next_bytes);

    assert_eq!(&account_data[..next_bytes.len()], next_bytes);
    assert!(account_data[next_bytes.len()..]
        .iter()
        .all(|byte| *byte == 0));

    let mut account_data_ref = account_data.as_slice();
    let decoded = ConditionState::try_deserialize(&mut account_data_ref).unwrap();
    assert_eq!(encoded(&decoded), next_bytes);
}

#[test]
fn pending_to_active_serialization_clears_the_pending_rule_tail() {
    let mut previous = ConditionState::uninitialized();
    previous.initialize(7, Pubkey::new_unique());
    previous.sequence = 1;
    previous.next_nonce = 1;
    previous.pending = Some(PendingConditionRule {
        rule: rule(1, None),
        bounds: bounds(),
        activate_after_slot: 15,
    });

    let pending = previous.pending.as_ref().unwrap().clone();
    let mut active_rule = pending.rule;
    active_rule.enabled = true;
    let mut next = previous.clone();
    next.active_rule = Some(active_rule);
    next.active_bounds = Some(pending.bounds);
    next.pending = None;
    next.sequence += 1;

    assert_shrinking_transition_clears_stale_tail(&previous, &next);
}

#[test]
fn replacing_an_observed_active_rule_with_an_unobserved_rule_clears_its_tail() {
    let observation = ConditionObservation {
        asset_index: 0,
        price_q18: 123,
        publish_time: 250,
        observed_at: 251,
        slot: 30,
    };
    let mut previous = ConditionState::uninitialized();
    previous.initialize(7, Pubkey::new_unique());
    previous.active_rule = Some(rule(1, Some(observation)));
    previous.active_bounds = Some(bounds());
    previous.pending = Some(PendingConditionRule {
        rule: rule(2, None),
        bounds: bounds(),
        activate_after_slot: 40,
    });

    let pending = previous.pending.as_ref().unwrap().clone();
    let mut active_rule = pending.rule;
    active_rule.enabled = true;
    let mut next = previous.clone();
    next.active_rule = Some(active_rule);
    next.pending = None;

    assert_shrinking_transition_clears_stale_tail(&previous, &next);
}
