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
- A reproducible deterministic envelope generator now produces exactly 1,036 two-asset vectors spanning reserve scales through `10^18`, weight extremes, balanced/skewed reserves, five input ratios and five fee levels. Tests require no overpayment and cap the algorithmic shortfall below the ideal integer-floor output at one part per billion using ceiling division; the current run's worst relative shortfall is at most 11 parts per trillion. The largest absolute shortfall was 114 base units at the largest reserve scale, so a one-base-unit global bound is not claimed. This comparison excludes the fractional remainder between continuous output and its integer floor.
- A separate exact-integer reference generator produces exactly 1,024 two/three-asset valuation vectors, including totals up to the implementation's checked range. It validates rounded-up display deviation and strict pre/post deviation improvement against arbitrary-precision exact rational comparisons.
- A third independent generator produces exactly 256 selected three-asset exact-in swaps. It varies target weights in 1,000-bps increments, mint decimals from `{0, 3, 6, 9}`, oracle marks at exponent `-8`, trade sizes, fees and asset pairs; vectors begin from target-marked reserves, deliberately perturb two assets, and retain only swaps whose USD deviation strictly improves when the **same marks** are used before and after that swap. Python Decimal quote floors and arbitrary-precision weighted-pair products are recorded independently. Rust rechecks every quote, retained-fee pair invariant and exact normalized-USD drift transition; all 256 pass with zero sampled quote shortfall. These are selected vectors, not exhaustive property coverage, and they do not model a price move within an individual swap transition.
- The original small-point golden tests remain within one token base unit of the independent integer-floor references.
- For a two-asset exact-in trade, invariant preservation reduces to `(B_in + net_in)^w_in * (B_out - amount_out)^w_out >= B_in^w_in * B_out^w_out`; rearranging yields the weighted-mean exact output formula used by the reference vectors. The conservative upper bound on the curve power and floor-rounded output never exceed that formula; gross input is at least net input, so a retained fee only increases the actual input reserve. Unchanged assets cancel from the multi-asset invariant comparison. This argument covers the bounded input/weight domain recorded above, subject to actual custody deltas matching the quote.
- A concrete unequal-weight three-asset case verifies pairwise invariant nondecrease with retained fee and strict USD-weight drift improvement after an oracle price move; a separate equal-weight case also covers exact reserve-product preservation.
- Existing valuation tests cover decimal/exponent normalization, scale underflow, unsupported values, total-variation rounding and exact strict-improvement comparison.
- `U256` multiplication is checked against exactly 320 deterministic exact vectors generated independently with Python's arbitrary-precision integers, including edge, single-limb and cross-limb values.

## Quote conservatism argument and independent review

For a supported exact-in swap, the gross input is at most 30% of the input reserve and the fee-adjusted input is no larger than gross. Therefore the exact reserve ratio `B_in / (B_in + net_in)` is at least `10/13`. The weight ratio is at most 99 because weights sum to 10,000 bps and every weight is at least 100 bps. Thus `-ln(base) × weight_in / weight_out < -ln(10/13) × 99 < 26`, the documented exponential domain.

The implementation rounds the reserve ratio up, the lower bound for `-ln(base)` down, and the exponent down. Its atanh-series terms round down and the omitted terms are nonnegative. For `exp(-z)`, it reduces `z` by flooring division by 256, evaluates the alternating Taylor series through even degree 12 on an argument below 0.102, and rounds positive terms and each of eight squarings up. These directions produce an upper bound for the curve power; subtracting from one and multiplying the output reserve with floor rounding produces an output no larger than the exact weighted-curve result. Because gross input is retained while only fee-adjusted input is priced, ideal invariant nondecrease follows for exact custody deltas. This is a mathematical argument for the bounded quote construction, not a substitute for broader implementation/property evidence or on-chain custody tests.

An independent read-only code review found no arithmetic unsoundness in the inspected quote/deviation paths and agreed the conservative-rounding argument is plausible over this domain. Since that review, generated coverage has been expanded: exact deviation vectors now cover two and three assets, and 256 generated three-asset swaps span varied oracle marks and mint decimals while checking pairwise invariant nondecrease with retained fee plus same-snapshot drift improvement. These additions narrow, but do not close, the general evidence gap: 100-bps minimum-weight and full supported-boundary coverage remain open; fixed-point error bounds need broader boundary/property coverage; candidate constants need contract review; and target-runtime compute, custody/share backing, and integration evidence remain outstanding. The Python standard-library generators make the selected calculations reproducible.

## Open S5B acceptance work

- Further property/boundary vectors for fixed-point monotonicity and error propagation; the 1,024 deviation vectors now cover two/three-asset state and large-value cross products.
- Extend the 256 three-asset trade vectors to 100-bps weight boundaries and full supported precision/error boundaries; add separate custody/share-backing accounting. These vectors cover mathematical quote and marked-drift behavior, not real token CPI accounting.
- Measure compute units in the target Solana program/runtime and confirm the final fixed-scale/share formula contract.
- Review whether the 100 bps minimum weight and 30% input/output caps are economically and operationally acceptable before S5E.

The weighted invariant is a quote/custody relationship, not USD NAV, asset solvency, share backing, or a return guarantee. Those properties require separate accounting and risk checks. No Devnet or funded-use claim follows from this pure-math evidence.
