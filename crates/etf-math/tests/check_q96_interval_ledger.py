#!/usr/bin/env python3
"""Exact-integer checks for the rational constants in q96-interval-proof.md.

This checker verifies the proof's cited numerical ledger and source constants.
It does not prove the transcendental inequalities or their correspondence to
every operation; those remain the reviewed analytical proof's responsibility.
"""

import math
import re
from fractions import Fraction
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
WEIGHTED_RS = ROOT / "crates/etf-math/src/weighted.rs"
VALUE_RS = ROOT / "crates/etf-math/src/value.rs"


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def read_source_constants():
    weighted_patterns = {
        "q96_bits": r"const Q96: u128 = 1_u128 << (\d+);",
        "max_exp": r"const MAX_EXP_ARGUMENT_Q96: u128 = (\d+) \* Q96;",
        "reduction_bits": r"const EXP_RANGE_REDUCTION_BITS: u32 = (\d+);",
        "exp_terms": r"const EXP_TAYLOR_TERMS: u32 = (\d+);",
        "log_terms": r"const LOG_ODD_TERMS: u32 = (\d+);",
        "maximum_input_ratio_bps": r"pub const MAX_IN_RATIO_BPS: u16 = ([0-9_]+);",
    }
    value_patterns = {
        "basis_points": r"pub const BASIS_POINTS: u16 = ([0-9_]+);",
        "minimum_weight_bps": r"pub const MIN_WEIGHT_BPS: u16 = ([0-9_]+);",
    }
    sources = {
        **{name: (WEIGHTED_RS, pattern) for name, pattern in weighted_patterns.items()},
        **{name: (VALUE_RS, pattern) for name, pattern in value_patterns.items()},
    }
    values = {}
    for name, (path, pattern) in sources.items():
        match = re.search(pattern, path.read_text())
        require(match is not None, f"missing Rust source constant: {name}")
        values[name] = int(match.group(1).replace("_", ""))
    return values


def check_source_anchors():
    weighted = " ".join(WEIGHTED_RS.read_text().split())
    value = " ".join(VALUE_RS.read_text().split())
    require(
        "let denominator = u128::from(balance_in) + u128::from(amount_in_after_fee);"
        in weighted,
        "quote denominator no longer matches the proof input",
    )
    require(
        "let base = ratio_q96_up(u128::from(balance_in), denominator)?;" in weighted,
        "quote base no longer rounds upward as analyzed",
    )
    require(
        "u128::from(amount_in) * u128::from(BASIS_POINTS) > u128::from(balance_in) * u128::from(MAX_IN_RATIO_BPS)"
        in weighted,
        "quote input cap no longer matches the proof domain",
    )
    require(
        "for index in 0..LOG_ODD_TERMS {" in weighted,
        "logarithm series term count no longer matches the proof",
    )
    require(
        "for degree in 1..=EXP_TAYLOR_TERMS {" in weighted,
        "exponential Taylor degree no longer matches the proof",
    )
    require(
        "let reduced = z >> EXP_RANGE_REDUCTION_BITS;" in weighted,
        "exponential range reduction no longer matches the proof",
    )
    require(
        "if z > MAX_EXP_ARGUMENT_Q96 {" in weighted,
        "exponential helper no longer enforces the proved domain",
    )
    require(
        "for _ in 0..EXP_RANGE_REDUCTION_BITS {" in weighted,
        "exponential squaring count no longer matches the proof",
    )
    require(
        "weights.iter().any(|weight| *weight < MIN_WEIGHT_BPS)" in value
        and "sum::<u32>() != u32::from(BASIS_POINTS)" in value,
        "weight validation no longer matches the proof domain",
    )


def main():
    source = read_source_constants()
    check_source_anchors()
    require(source == {
        "q96_bits": 96,
        "max_exp": 26,
        "reduction_bits": 8,
        "exp_terms": 12,
        "log_terms": 16,
        "basis_points": 10_000,
        "minimum_weight_bps": 100,
        "maximum_input_ratio_bps": 3_000,
    }, f"proof/source constants diverged: {source}")

    maximum_weight_ratio = source["basis_points"] // source["minimum_weight_bps"] - 1
    require(maximum_weight_ratio == 99, "conservative maximum weight ratio changed")
    require(
        Fraction(source["maximum_input_ratio_bps"], source["basis_points"])
        == Fraction(3, 10),
        "input-ratio domain changed",
    )
    require(Fraction(1, 1) / (1 + Fraction(3, 10)) == Fraction(10, 13), "reserve ratio changed")

    # ln(13/10) < 26/99 follows when the degree-3 Taylor lower bound for
    # exp(26/99) already exceeds 13/10.
    x = Fraction(26, 99)
    exp_lower = 1 + x + x**2 / 2 + x**3 / 6
    require(exp_lower > Fraction(13, 10), "domain logarithm inequality failed")

    # Exact Q-scaled atanh tail bound from the proof.
    log_tail_num = 2**97 * 3**33 * 529
    log_tail_den = 23**33 * 33 * 520
    require(log_tail_num < log_tail_den, "scaled log tail is not below one Q-unit")

    # Base quantization contributes less than 3Q before the log derivative;
    # series rounding is <60Q after the final multiply by two.
    derivative_bound = Fraction(2, 1) / (1 - Fraction(3, 23) ** 2)
    require(derivative_bound == Fraction(529, 260), "atanh derivative bound changed")
    log_input_loss = 3 * derivative_bound
    require(log_input_loss < Fraction(6105, 1000), "log input-loss ledger failed")
    series_rounding = sum(
        Fraction(2 * j, 2 * j + 1) + 1 for j in range(1, source["log_terms"])
    )
    require(series_rounding < 30, "atanh series rounding is not below 30 Q-units")
    require(
        log_input_loss + 1 + 2 * series_rounding < 68,
        "total log deficit is not below 68 Q-units",
    )

    exponent_loss = 68 * maximum_weight_ratio + 1
    require(exponent_loss == 6_733, "exponent-floor loss ledger changed")
    reduction_loss = Fraction(exponent_loss, 2**source["reduction_bits"]) + 1
    require(reduction_loss < 28, "range-reduction loss is not below 28 Q-units")

    exp_tail_num = 32 * 13**13
    exp_tail_den = math.factorial(13)
    exp_tail_ceiling = 1_556_444
    require(exp_tail_num < exp_tail_ceiling * exp_tail_den, "scaled exp Taylor tail bound failed")
    exp_term_rounding = sum(2 * degree for degree in range(1, source["exp_terms"] + 1))
    require(exp_term_rounding == 156, "Taylor recurrence rounding ledger changed")
    reduced_exp_error = exp_tail_ceiling + exp_term_rounding + 28
    require(reduced_exp_error == 1_556_628, "reduced exponential error ledger changed")

    squaring_count = source["reduction_bits"]
    power_error = 2**squaring_count * reduced_exp_error + (2**squaring_count - 1)
    require(power_error == 398_497_023, "eight-squaring error recurrence changed")
    require(power_error < 2**29, "eight-squaring error exceeds 2^29 Q-units")
    require(
        Fraction(2**64 * 2**29, 2**source["q96_bits"]) == Fraction(1, 8),
        "output shortfall scale changed",
    )

    print(
        "Q96 interval numeric ledger checks passed: "
        f"source={source}, log_tail_num<den={log_tail_num < log_tail_den}, "
        f"exp_tail_num<{exp_tail_ceiling}*den={exp_tail_num < exp_tail_ceiling * exp_tail_den}, "
        f"exponent_loss={exponent_loss}, reduced_exp_error={reduced_exp_error}, "
        f"power_error={power_error} < 2^29, output_shortfall<1/8 base unit"
    )


if __name__ == "__main__":
    main()
