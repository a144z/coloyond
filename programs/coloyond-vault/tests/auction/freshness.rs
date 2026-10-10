use crate::instructions::auction_handlers::publish_times_not_older;

#[test]
fn an_unchanged_but_fresh_feed_can_price_multiple_partial_fills() {
    assert!(publish_times_not_older([1_000, 1_000], [1_000, 1_000]));
    assert!(publish_times_not_older([1_001, 1_003], [1_000, 1_003]));
}

#[test]
fn a_feed_observation_cannot_regress_after_a_fill() {
    assert!(!publish_times_not_older([999, 1_000], [1_000, 1_000]));
    assert!(!publish_times_not_older([1_000, 999], [1_000, 1_000]));
}
