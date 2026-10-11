# Q96 weighted quote interval proof (review draft)

**Status:** source-level interval derivation and the weighted-invariant consequence below were independently reviewed with no correctness defect found. This is not an external audit. Pure quote compute has an isolated SBF baseline; S5B and S5E remain blocked on integrated target-runtime, custody/CPI, broader boundary, and product-policy evidence.

This note analyzes `crates/etf-math/src/weighted.rs` at the current revision. It proves a conservative interval for the implemented pairwise exact-in quote over that function's accepted input domain, then derives how a conservative pairwise quote preserves the multi-asset weighted geometric-mean reserve invariant under explicit custody-delta assumptions. It does not establish oracle-price, value-drift, share-backing, SPL CPI, or integrated SBF runtime properties.

## Domain and notation

Let `Q = 2^96`, `b` be the input reserve, `c` the output reserve, and `d` the integer fee-adjusted input returned by the implementation. The ideal pairwise curve output is

```text
Y = c * (1 - x^r)
x = b / (b + d)
r = weight_in / weight_out
```

All three-asset calls use this same pairwise exponent; this note proves only that local quote formula. The implementation validates positive reserves and input, weights of at least 100 bps summing to 10,000, and a gross-input cap of 30% of `b`. It also checks that `b + amount_in` fits `u64`, so `b + d <= u64::MAX`. Therefore:

- `x >= 10/13` and `x < 1`;
- the integer weight ratio is at most 99 (at most 98 for three assets, but 99 is used below);
- `0 < Y < c <= 2^64 - 1`;
- the Q96 base is `q = ceil(Q*x)`, so `q/Q >= x` and `q/Q - x < 1/Q`.

The exact fee-adjusted input `d` is used in both the implementation and the reference expression. Fee rounding is therefore outside the approximation error below.

## Log lower bound

For `f(t) = (1-t)/(1+t)`, `-ln(t) = 2*atanh(f(t))`. On the domain above, `0 <= f(x) <= 3/23` and `|f'(t)| = 2/(1+t)^2 <= 2`. The implementation first rounds the base up to `q/Q`, then rounds `Q*f(q/Q)` down to integer `y`. Thus `y/Q` is no greater than `f(x)` and is less by less than `3/Q`: under `1/Q` from the base rounding propagated through `f`, plus under `1/Q` from the ratio floor.

The derivative of `2*atanh(y)` is `2/(1-y^2) <= 529/260 < 2.035`. Replacing `f(x)` with `y/Q` loses less than `6.105/Q` in the logarithm.

The 16-term positive atanh series is a lower bound. Its omitted tail is bounded by

```text
2 * sum(j >= 16, y^(2j+1)/(2j+1))
  <= 2*y^33 / (33*(1-y^2))
  <= 2*(3/23)^33 / (33*(1-(3/23)^2))
```

and exact integer comparison gives `Q * tail < 1`.
Explicitly, the scaled bound is `2^97 * 3^33 * 529 / (23^33 * 33 * 520) < 1`.

For each of the 15 iterative term updates, flooring `y^2` loses less than one Q-unit in the multiplier and flooring the Q96 product loses less than one more. Therefore term `j` (starting at zero) is below its unrounded power by less than `2*j` Q-units. Flooring each division by `2*j+1` adds less than one Q-unit; the sum of all 16 divided-term losses is less than 30 Q-units (the `j=0` term is exact), or less than 60 Q-units after the final multiply by two. Combining the `6.105` input-rounding loss, `<1` tail, and `<60` series-rounding loss gives a strict total log deficit below 68 Q-units.

## Exponent lower bound

Multiplication by the integer weight ratio followed by floor division loses less than one additional Q-unit. Since the ratio is at most 99, the code's integer exponent `z` satisfies

```text
0 <= Q*(-ln(x))*r - z < 68*99 + 1 = 6,733 Q-units.
```

The right-shift by eight bits computes `a = floor(z/256)` in Q96 units. Its distance below the exact exponent divided by 256 is less than `6,733/256 + 1 < 28` Q-units. Since `|d exp(-t)/dt| <= 1` for `t >= 0`, this shift contributes less than 28 Q-units to the reduced exponential interval.

The exponent bound also justifies the approximation range: `-ln(x) <= ln(13/10)` and `r <= 99`, so the exact exponent is less than 26. One exact check is `ln(13/10) < 26/99`, which follows from `e^(26/99) > 1 + 26/99 + (26/99)^2/2 + (26/99)^3/6 > 13/10`. Hence the production quote path has `z < 26Q`, and the reduced argument is at most `26/256 = 13/128 < 0.102`.

## Exponential upper bound and error ledger

For `0 <= a <= 13/128`, the alternating Taylor series for `exp(-a)` decreases term-by-term. Its degree-12 partial sum is an upper bound, with truncation error less than `a^13/13!`. The private exponential helper enforces `0 <= z <= 26Q`; the inclusive endpoint is covered by the same Taylor bound, and the first Q-unit above it returns `PowerDomain`. The public quote path remains strictly below that endpoint by the reserve and weight-ratio proof above. In Q-units, the maximum tail is

```text
Q * (13/128)^13 / 13!
  = 32 * 13^13 / 13!
  < 1,556,444,
```

where the last inequality is the integer comparison `32*13^13 < 1,556,444*13!`.

Each fixed-point multiply and integer divide in a Taylor-term recurrence rounds in the indicated direction by strictly less than one Q-unit. The recurrence's term interval at degree `n` is therefore within `2*n` Q-units of the exact term. Summing this conservative bound for degrees 1 through 12 contributes less than `sum(2*n, n=1..12) = 156` Q-units. Including the exponent-reduction gap, the computed reduced upper bound differs from the exact reduced exponential by less than

```text
1,556,444 + 156 + 28 = 1,556,628 Q-units.
```

The implementation then performs eight upward-rounded squarings. For an upper approximation and its exact value both in `[0,1]`, one squaring maps an error bound `E` Q-units to less than `2*E + 1` Q-units: the product difference is bounded by `(u-v)*(u+v) <= 2*(u-v)`, and the upward product rounding adds less than one Q-unit. After eight steps:

```text
E_power < 2^8 * 1,556,628 + (2^8 - 1)
        = 398,497,023
        < 2^29 Q-units.
```

Clamping an upper result to `Q` cannot invalidate the upper bound because the exact exponential is at most one. The helper rounding directions preserve `power_upper >= x^r` throughout.

## Output and rounding consequence

The implementation computes `floor(c * (Q - power_upper) / Q)`. Since `power_upper >= x^r`, this quote cannot exceed `floor(Y)`. Its real-valued shortfall from `Y` is less than

```text
c * E_power / Q < 2^64 * 2^29 / 2^96 = 1/8 base unit.
```

Two real values less than one unit apart have floors that differ by at most one. Therefore the returned amount is no more than one base unit below the exact integer curve floor. The separate `NoOutput` rule may reject a zero result; checked-in policy permits that only for exact floors of zero or one. Output-ratio and custody checks can reject a quote but do not increase it.

## Arithmetic-width checks to review with the helpers

- `ratio_q96_parts` doubles a remainder smaller than its denominator. For the initial reserve ratio, the checked custody sum bounds the denominator by `u64::MAX`; for the log ratio, the denominator is at most `2Q`. Both doubled remainders fit `u128` (the larger is below `2^98`).
- Every Q96 multiply has operands at most `Q`, so its `U256` product is below `Q^2 = 2^192`; the shifted result fits `u128` and is at most `Q` after the helper's domain checks.
- `log_abs_lower * weight_in < 2,600Q < 2^108`, so the checked multiply fits `u128` before division by the minimum 100-bps output weight.
- The final `c * (Q - power_upper)` product is below `2^160`; shifting by 96 yields a value below `u64::MAX`.
- The low-level limb multiplication and carry bounds in `U256::mul_u128` are checked separately by the full-width big-integer vector suite. Those tests corroborate implementation behavior but are not a substitute for the algebra above.

## Whole-pool weighted invariant consequence

Let the pool invariant be `K = product(R_i ^ w_i)` for positive reserves `R_i` and positive target weights `w_i` (the weights sum to 10,000 bps). For a swap from input reserve `b` to output reserve `c`, let `g` be gross input, `d` the fee-adjusted curve input (`0 <= d <= g`), and `u` the quoted output. The pairwise exact-in curve bound proves

```text
(b + d)^w_in * (c - u)^w_out >= b^w_in * c^w_out
```

because `u` is no greater than the exact curve output. If the actual input token-account credit is `G >= d`, the actual output debit is no greater than `u`, and all other reserves and weights remain unchanged, positivity of both weights makes the actual pair product at least this bound. Every untouched asset factor cancels from the before/after comparison, so the full multi-asset `K` cannot decrease. This argument applies to a three-asset pool and, algebraically, to any asset count with exactly one input and one output reserve changed. Retaining the fee in the input reserve (`G >= d`) only strengthens the inequality.

These are transaction-state assumptions, not facts established by the quote function. In particular, integrated SPL CPI must reconcile actual input credit and output debit with these bounds; this project currently supports classic SPL Token only and excludes Token-2022 transfer fees/hooks. The derivation does not prove that a swap improves oracle-marked USD target-weight deviation, that an oracle is authentic/fresh, or that share backing and program account updates are correct.

## Review checklist and limits

- [x] Independently verify each derivative, tail, fixed-point rounding, and error-propagation inequality against the current implementation.
- [x] Independently verify the strict integer comparisons for both series tails and all cited intermediate ranges.
- [x] Reconcile the proof's accepted domain with the public function validation and all callers.
- [x] Independently review the whole-pool weighted-invariant derivation and its assumptions for multi-asset swaps.
- [ ] Measure the integrated ETF instruction on SBF after S5E exists, including account/oracle/CPI work; the isolated quote baseline is recorded separately in `s5-sbf-math-bench.md`.
- [ ] Reconcile the invariant assumptions against actual integrated SPL CPI deltas and program state updates.

Until integrated runtime, custody/CPI, broader-boundary, and policy evidence pass, treat Q96 as a reviewed and measured candidate, not an accepted S5B implementation.
