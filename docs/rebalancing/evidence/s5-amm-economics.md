# S5D2 — ETF v1 AMM fee and depth economics

**Status:** candidate sensitivity model implemented; fee amendment and S5D2 acceptance remain open. This evidence contains modeled assumptions only, not Devnet measurements or a recommendation for funded use.

**Gate sequencing:** this model is candidate analysis, not a fee/policy freeze. S5B can receive an independent parameterized core-math review before final S5A policy selection; S5C establishes oracle account-mode/parser facts, while production freshness/confidence/risk limits remain S5A decisions. S5D2 may compare explicit candidate assumptions in parallel, then propose an amendment using accepted math findings, S5C evidence and required real executable-depth/cost observations. S5A owns the final contract/policy freeze. S5E remains gated until that freeze includes the actual contract, oracle/risk and fee/economics decisions; no candidate value or current model result is accepted by this note.

## Reproduction

Run `python3 -m unittest discover -s tools/rebalancing/etf-economics/tests -p 'test_*.py' -v`, `python3 tools/rebalancing/etf-economics/run.py`, and `python3 tools/rebalancing/etf-economics/quote_band_matrix.py` from the repository root. The standard-library model writes an ignored `results.csv` with 12,096 deterministic fixed-fee scenarios, refreshes the tracked `dynamic_results.csv` with 1,728 bounded-dynamic-vs-fixed scenarios, writes `depth_sweep_results.csv` with 27 fixed-notional depth comparisons, and adds twelve candidate-band rows each to `quote_band_matrix_results.csv` (29,106 moderate-reserve rows) and `near_u64_quote_band_matrix_results.csv` (60 selected high-reserve rows). The original scenario grids model a two-asset, equal-weight constant-mean pool at initial $1 oracle marks and include both relative-price directions. The full inputs and equations are documented in the tool README and source. Twenty-six model tests pass, including exact non-boolean integer validation for all basis-point inputs, non-finite Decimal rejection, invalid-input rejection, break-even minimality, reverse-direction accounting, bounded dynamic-fee monotonicity, a bidirectional comparative-statics grid, exact rational USD parity under sub-picodollar differences, and quote-band boundary/count/monotonicity checks.

The fixed-fee grid varies assumed pool depth ($10k/$100k/$1m), trade size (10/50/100/500 bps of depth), fixed fees (5/10/30/50/100/500/1,000 bps), external moves (10/30/100/500 bps), uncertainty haircuts (3/4/5/10/25/100 bps), external transaction costs ($0.01/$0.10/$1.00), and both relative-price directions. The 3/4/10 bps points match the single refreshed Devnet confidence sample only; they are not a measured distribution or policy. In the `input_depreciates` direction, the same input-token quantity is valued at the initial $1 mark before the shock, so actual input USD value is lower after applying the modeled move; the two directions therefore do not represent identical post-shock USD notionals. The model reports conservative input/output marks, trader net PnL, pool mark change, and the smallest integer external move that clears the modeled fee, haircut, and cost.

## Illustrative break-even sensitivity

For a hypothetical $100,000 pool, a $500 trade (50 bps of pool depth), a 25 bps uncertainty haircut, and $0.10 transaction cost, modeled break-even external moves are:

| Fixed fee | Break-even external move |
|---:|---:|
| 5 bps | 133 bps |
| 10 bps | 138 bps |
| 30 bps | 158 bps |
| 50 bps | 178 bps |
| 100 bps | 229 bps |
| 500 bps | 654 bps |
| 1,000 bps | 1,239 bps |

These values are reproducible outputs for this one assumed case. Across the grid, break-even increases with the fee, haircut, and transaction cost, while deeper pools reduce price impact for a fixed trade size. High fees protect the pool against some adverse selection by making trades uneconomic sooner, but also suppress trades that could move a genuinely mispriced pool toward its current oracle mark. The model does not prove net LP benefit or eliminate LVR/MEV.

## Bounded dynamic-fee comparison (candidate only)

The deliberately simple candidate uses `min(100, 5 + 10 × floor(max(0, move − haircut − 25) / 100))` bps. This turns the hypothetical conservative external-move signal into a fee, with a 25 bps deadband, a 5 bps base and a 100 bps cap. It is not a selected production rule: the scenario provides no validated on-chain oracle-gap input, so this only measures economics if the signal were available and truthful. The 1,728 rows compare candidate trader PnL/pool mark change and break-even with fixed 5, 30 and 100 bps in both directions, including each fixed fee's own break-even column. Candidate fees range 5–45 bps in this grid; the cap is not reached. For the $100,000 depth / $500 initial-mark trade / 500 bps move / 25 bps haircut / $0.10 cost example, the output-appreciates candidate is 45 bps with a modeled 173 bps break-even; corresponding fixed-fee break-evens are 133, 158 and 229 bps. These are scenario outputs only, not evidence that one policy is better.

## Fixed-notional depth sweep

`depth_sweep_results.csv` compares $10/$100/$500 initial-mark trades at each of the three assumed depths and fees of 5/30/100 bps (27 rows). It reports the constant-mean output, post-fee spot output, and AMM price impact excluding the explicit fee. At a $100 trade and 30 bps fee, modeled impact is approximately 195.50 bps at $10k depth, 19.90 bps at $100k depth, and 1.99 bps at $1m depth. These are analytic hypothetical pool depths, not observed venue liquidity or quotes.

## S5B marked-NAV loss and candidate quote-band sensitivity

`quote_band_matrix.py` reads the checked-in S5B vector corpus (SHA-256 `b2237b7004bab5f52fcc8d8471e6bf63d71a8ffc1a7101926e7bff4a34da0fc1`) and compares gross input with exact fee-adjusted curve output using exact rational USD values, `amount * raw_price / 10^(decimals + exponent_magnitude)`, with no intermediate truncation. It screens whether fee-adjusted output value is within a **symmetric absolute parity band** of gross input value: `abs(output_usd - input_usd) / input_usd <= band_bps / 10,000`. This ratio includes curve impact and the fee; it is not a standalone oracle-feed deviation or confidence check. Bands are 0/5/10/25/50/100/250/500/1,000/2,500/5,000/10,000 bps. The source corpus is conditioned: it contains one first-qualifying drift-improving input size for each weight partition and ordered asset pair after the generator’s custody, invariant and reference-agreement filters. Counts therefore describe this selected finite sample, not a distribution of all possible trades or market activity. Two runs produce the same report SHA-256: `0fa0bbbfac0131a53ccac0c8bedf3fa8e4dcbcf82a94ef54783b4231572c4942`. The 0-bps result accepts one moderate-reserve case because its values are exactly equal; the near-`u64` result accepts none. New tests verify that distinct sub-picodollar values do not alias into parity, exact parity survives scale changes, and band boundaries remain inclusive. This is one candidate interpretation of an oracle-marked input/output parity screen, not a contract-frozen quote-validity rule; it uses point marks and generated values, with no Pyth confidence interval, confidence haircut, freshness latency, live route or transaction cost.

| Candidate absolute band | Accepted / 29,106 | Accepted swaps that reduce marked NAV | Maximum NAV loss among accepted |
|---:|---:|---:|---:|
| 25 bps | 7 | 4 | 1 bps |
| 100 bps | 16 | 10 | 1 bps |
| 500 bps | 787 | 764 | 56 bps |
| 1,000 bps | 4,282 | 4,218 | 96 bps |
| 2,500 bps | 29,106 | 28,999 | 109 bps |

The maximum-loss columns use ceiling basis-point rounding. The pure-math near-`u64` drift test reports its maximum with floor rounding (107 bps), while the near-`u64` band sensitivity rounds the same sampled loss up (108 bps).

A separate 60-case selected near-`u64` report uses the pinned vector SHA-256 `93de5c6d2dd345102c8b4ff7364bde812fb8d79825147f56f56f8e10f7370fb6`; its output SHA-256 is `ae89371771b80db8cbdd66d7c7e9d6013d0b330c7e6e7ab0f33385aeb0f35231`. Bands through 500 bps accept none, 1,000 bps accepts one case (one NAV loss, 82 bps maximum), and 2,500 bps accepts all 60 (all 60 NAV losses, 108 bps maximum). The results are reported separately from the moderate-reserve corpus so the two finite samples are not pooled. The 25/100-bps rows permit very few swaps in this generated matrix; wider bands admit more modeled NAV-loss cases. This is a protection/availability sensitivity, not proof that a tight band is useful under real market conditions or that a symmetric ratio is the right guard. It shows that deviation improvement and weighted-invariant preservation do not themselves guarantee nonnegative oracle-marked NAV. S5B reviews core-math correctness over parameterized domains; S5C supplies oracle-mode/parser evidence. S5A must still select and freeze the quote comparison, confidence treatment, cumulative loss limit and fee interaction after reviewing S5D2 sensitivities and real executable-depth/cost observations. No threshold is selected here.

## Decision and remaining evidence

The model rejects non-finite or nonpositive depth/input values, non-finite or negative transaction costs, negative external moves and negative uncertainty haircuts instead of allowing undefined arithmetic, an impossible subsidy or an inverted price signal. Break-even tests verify the returned integer move is profitable and the immediately preceding move is not in both directions; a fixed-depth/input property grid independently varies fees, haircuts and transaction costs and confirms nondecreasing thresholds in both directions. Tests also check reverse-direction accounting, nonpositive-price rejection, and the dynamic candidate's bounds and monotonicity over the integer signal range. A separate 10,001-move grid confirms that increasing the uncertainty haircut never raises the illustrative fee and that the fee returns to its 5 bps base once the haircut covers the move. These are input-domain and model-property checks only; they select no fee or transaction-cost policy.

- No fixed or dynamic fee is approved. The blueprint's 30/500/1,000 bps table remains a proposal, not an accepted policy.
- The candidate comparison is hypothetical and two-asset only. It does not test an on-chain rule, use observed oracle-relative state, prove net LP benefit, model strategic oracle manipulation, or establish a useful dynamic policy versus fixed fees. The added 3/4/10 bps haircut points merely reuse one transient confidence observation as sensitivity inputs. No such rule should be added to the contract based on this model alone.
- Inputs are not measured executable Devnet depth, confirmed route cost, oracle cadence/uncertainty, order flow, withdrawals, or a three-asset strategy. The Devnet synthetic-mint market is not evidence for production asset liquidity.
- Before the final S5A policy freeze, combine the independently reviewed, parameterized S5B core math and S5C oracle evidence with the selected oracle/risk limits and real executable-depth/transaction-cost observations. S5D2 can run candidate fee sensitivities before those decisions; its amendment should then model adverse selection and withdrawals, compare fixed against a precisely specified bounded dynamic policy (or justify rejecting dynamic fees), and record proposed fee bounds and rationale for S5A review.
- S5E remains gated on the final accepted S5A contract/policy freeze, including actual oracle/risk and fee/economics decisions, as well as its named math/oracle prerequisites. Until then, no “up-only,” guaranteed arbitrage profit, or LVR-protection claim is supported.

## Bounded three-asset candidate sensitivity (supplemental)

`tools/rebalancing/etf-economics/three_asset_sensitivity.py` adds a separate 576-row CSV grid over all six ordered pairs in a hypothetical SOL/BTC/USDC pool. BTC is a notional model label; no backing, mint, or Devnet BTC asset is claimed. Assumptions are reserves of 400 SOL / 0.8 BTC / 20,000 USDC, marks of $100 / $50,000 / $1, and weights 40/40/20. It varies trade sizes (1/10/50/100 bps of input reserve), fees (5/30/100 bps), relative price moves (0/25/100/500 bps), and both output-appreciates and input-depreciates directions. The third asset remains unchanged by the swap. Candidate weighted-mean exact-in quotes use Decimal precision 50; the reported PnL excludes external transaction costs and price-shock revaluation of pre-existing reserves. `pool_mark_change_usd` is only the swap leg valued at post-shock marks (`gross input value − output value`), exactly opposite trader PnL; it is not the pool's total NAV change across the shock.

For the illustrative SOL-to-USDC case (4 SOL input, 100 bps move), 5/30/100 bps fees return approximately 393.885/392.914/390.196 USDC. Under the output-appreciates shock, modeled trader PnL is about -$2.176/-$3.157/-$5.902; under input-depreciates it is -$2.115/-$3.086/-$5.804. These values show only this finite sensitivity's curve impact and fee arithmetic. They do not establish a profitable arbitrage threshold, executable depth, strategy performance, contract parity, or a fee decision. Five focused tests cover accounting identity in both directions, fee/trade-size response, deeper-pool impact, all ordered pairs, and invalid/non-finite inputs. Neither this supplemental model nor the prior two-asset model selects a fee or quote band; S5A policy freeze and S5E gating remain as stated above.

## Pro-rata in-kind withdrawal accounting sensitivity (supplemental)

`tools/rebalancing/etf-economics/withdrawal_sensitivity.py` models a pro-rata in-kind redemption after shocking exactly one asset mark. The fixed synthetic basket is 400 SOL at $100, 0.8 BTC at $50,000, and 20,000 USDC at $1 (initial NAV $100,000), with 10,000 shares. Its deterministic 48-case grid crosses each of the three shocked assets with -5,000/-1,000/+1,000/+5,000 bps (-50/-10/+10/+50%) and redemption fractions of 100/1,000/5,000/9,000 bps (1/10/50/90%). Decimal precision is fixed at 50 digits and rounding is explicitly half-even; all inputs are finite and bounded. There is no redemption fee, oracle policy, execution cost, or token-amount rounding assumption.

This is explicitly a shock-then-redemption calculation at fractional token precision. Each redemption transfers the same fraction of every asset reserve as the redeemed share fraction. Tests verify per-asset reserve conservation, `pre-redemption NAV = holder redemption value + remaining pool NAV`, exact accounting residual of zero, and unchanged NAV/share across redemption for all 48 cases. Example outputs:

| One-asset mark shock | Redemption | Shocked NAV | Holder value | Remaining NAV | NAV/share before → after |
|---|---:|---:|---:|---:|---:|
| SOL -50% | 90% | $80,000 | $72,000 | $8,000 | $8 → $8 |
| BTC +50% | 1% | $120,000 | $1,200 | $118,800 | $12 → $12 |
| USDC -10% | 50% | $98,000 | $49,000 | $49,000 | $9.80 → $9.80 |

Three focused standard-library tests pass, including all asset/shock/fraction combinations and invalid/non-finite input rejection. This demonstrates accounting sensitivity only. Integer base-unit floors are analyzed separately below; this fractional-precision model does not include them or transfer fees, is not oracle-price validation, and proves no production contract/CPI behavior or live executable depth. S5A policy decisions and S5E gating remain unchanged.

## Integer-base-unit in-kind floor sensitivity (supplemental)

`tools/rebalancing/etf-economics/in_kind_floor_sensitivity.py` calculates the exact integer floor `payout = floor(reserve_base_units × redeemed_share_units / total_share_units)` independently for USDC/BTC/SOL decimal scales 6/8/9. Its 15 synthetic cases cross three fixed reserve magnitudes with redemptions of 1, 100,000, 333,333, 500,000, or 999,999 out of 1,000,000 share units. Inputs are bounded to u64 reserves and share supply. Each row reports the exact divmod remainder/denominator plus an 80-significant-digit Decimal representation of dust in base units and token units. Five focused tests verify per-asset conservation, no overdraw, dust below one base unit including the u64 boundary, grid coverage, and invalid-input rejection.

This finite model covers the integer-floor arithmetic only. It does not exercise Anchor account constraints, SPL CPI behavior, transfer fees, token-account rounding outside the stated formula, compute limits, or a production redemption. ETF v1 excludes Token-2022; adding it later requires an explicit transfer-fee and extension review. S5A policy decisions and S5E gates remain unchanged.
