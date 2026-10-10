# ETF v1 S5B math work log

**Status:** implementation in progress; S5B is not accepted and S5E remains blocked on review and remaining evidence.

## Current math profile candidate

- Pure `no_std` Rust crate with no new dependencies; no Anchor, token, RPC, oracle parser, wallet, or scheduler coupling.
- Two or three assets; target weights sum to 10,000 bps and each weight is at least 100 bps.
- Mint decimals are limited to 0–9; positive price exponents are rejected and negative price exponents are bounded to `[-17, 0]`.
- Oracle-marked values are normalized to integer `10^-12 USD` units, rounding down. Nonzero values below that resolution fail closed. The scale and bounds are a candidate selected by S5B implementation, pending independent review and contract freeze.
- Total-variation target deviation is projected to basis points with ceiling rounding. Trade direction compares the exact rational deviations using a 256-bit cross product, rather than rounded display bps.
- Exact-in weighted-mean quote permits at most 30% of input reserve and 30% of output reserve. Curve input is floored after fee; the gross input, including retained fee, remains in custody. Quote output is rounded down.
- The fixed-point power implementation uses Q64 arithmetic with conservative intermediate rounding. The permitted domain follows from the 30% input cap and 100 bps minimum weight; unsupported values and arithmetic overflow fail closed.

## Evidence added in this package

- High-precision reference outputs generated independently with Python `Decimal` at 90-digit precision for equal and unequal weights, 100/9,800 bps boundary weights, multiple fees, and larger reserve/input values.
- Golden tests require the implementation never to exceed the integer-floor reference and to remain within one token base unit for the tested vectors.
- A combined equal-weight case proves a nontrivial retained-fee quote can preserve the exact reserve product and strictly improve value-weight deviation under equal oracle prices.
- Existing valuation tests cover decimal/exponent normalization, scale underflow, unsupported values, total-variation rounding and exact strict-improvement comparison.
- `U256` edge tests cover zero, max-by-one and max-by-max products.
- Cross-limb `U256` products are checked against independent fixed-width reference values.

## Quote conservatism argument and independent review

For a supported exact-in swap, the gross input is at most 30% of the input reserve and the fee-adjusted input is no larger than gross. Therefore the exact reserve ratio `B_in / (B_in + net_in)` is at least `10/13`. The weight ratio is at most 99 because weights sum to 10,000 bps and every weight is at least 100 bps. Thus `-ln(base) × weight_in / weight_out < -ln(10/13) × 99 < 26`, the documented exponential domain.

The implementation rounds the reserve ratio up, the lower bound for `-ln(base)` down, and the exponent down. Its atanh-series terms round down and the omitted terms are nonnegative. For `exp(-z)`, it reduces `z` by flooring division by 256, evaluates the alternating Taylor series through even degree 12 on an argument below 0.102, and rounds positive terms and each of eight squarings up. These directions produce an upper bound for the curve power; subtracting from one and multiplying the output reserve with floor rounding produces an output no larger than the exact weighted-curve result. Because gross input is retained while only fee-adjusted input is priced, ideal invariant nondecrease follows for exact custody deltas. This is a mathematical argument for the bounded quote construction, not a substitute for broader implementation/property evidence or on-chain custody tests.

An independent read-only code review found no arithmetic unsoundness in the inspected quote/deviation paths and agreed the conservative-rounding argument is plausible over this domain. It also confirmed the important remaining gaps: the general weighted-invariant/deviation derivation and tests are missing; Decimal references cover only selected points; fixed-point error bounds need broader boundary/property coverage; candidate constants need contract review; and target-runtime compute, custody/share backing, and integration evidence are still outstanding. The current exact invariant test remains the two-asset equal-weight reserve product only. The Python standard-library reference generator at `crates/etf-math/tests/reference_weighted_decimal.py` makes the selected golden vector calculation reproducible.

## Open S5B acceptance work

- Broader generated boundary/property vectors for fixed-point bounds, monotonicity and error propagation.
- General weighted-invariant comparisons beyond the exact equal-weight product case; prove reserve-unit/exponent/oracle-price behavior across admitted pools.
- Demonstrate useful swaps under realistic oracle-price and target-weight states across the supported weight/decimal envelope, including separation of invariant preservation from custody/share backing and value-weight improvement.
- Measure compute units in the target Solana program/runtime and confirm the final fixed-scale/share formula contract.
- Review whether the 100 bps minimum weight and 30% input/output caps are economically and operationally acceptable before S5E.

The weighted invariant is a quote/custody relationship, not USD NAV, asset solvency, share backing, or a return guarantee. Those properties require separate accounting and risk checks. No Devnet or funded-use claim follows from this pure-math evidence.
