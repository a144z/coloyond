# S5D2 — ETF v1 AMM fee and depth economics

**Status:** candidate sensitivity model implemented; fee amendment and S5D2 acceptance remain open. This evidence contains modeled assumptions only, not Devnet measurements or a recommendation for funded use.

## Reproduction

Run `python3 -m unittest discover -s tools/rebalancing/etf-economics/tests -p 'test_*.py' -v` and `python3 tools/rebalancing/etf-economics/run.py` from the repository root. The standard-library model writes an ignored `results.csv` with 12,096 deterministic fixed-fee scenarios, refreshes the tracked `dynamic_results.csv` with 1,728 bounded-dynamic-vs-fixed scenarios, and writes `depth_sweep_results.csv` with 27 fixed-notional depth comparisons. Both scenario grids model a two-asset, equal-weight constant-mean pool at initial $1 oracle marks and include both relative-price directions. The full inputs and equations are documented in the tool README and source. Seventeen model tests pass, including invalid-input rejection, break-even minimality, reverse-direction accounting, bounded dynamic-fee monotonicity, and a bidirectional comparative-statics grid that verifies break-even is nondecreasing with fee, uncertainty haircut and transaction cost while retaining threshold minimality.

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

## Decision and remaining evidence

The model now rejects negative transaction costs, external moves and uncertainty haircuts instead of allowing an impossible subsidy or inverted price signal. Break-even tests verify the returned integer move is profitable and the immediately preceding move is not in both directions; a fixed-depth/input property grid independently varies fees, haircuts and transaction costs and confirms nondecreasing thresholds in both directions. Tests also check reverse-direction accounting, nonpositive-price rejection, and the dynamic candidate's bounds and monotonicity over the integer signal range. A separate 10,001-move grid confirms that increasing the uncertainty haircut never raises the illustrative fee and that the fee returns to its 5 bps base once the haircut covers the move. These are input-domain and model-property checks only; they select no fee or transaction-cost policy.

- No fixed or dynamic fee is approved. The blueprint's 30/500/1,000 bps table remains a proposal, not an accepted policy.
- The candidate comparison is hypothetical and two-asset only. It does not test an on-chain rule, use observed oracle-relative state, prove net LP benefit, model strategic oracle manipulation, or establish a useful dynamic policy versus fixed fees. The added 3/4/10 bps haircut points merely reuse one transient confidence observation as sensitivity inputs. No such rule should be added to the contract based on this model alone.
- Inputs are not measured executable Devnet depth, confirmed route cost, oracle cadence/uncertainty, order flow, withdrawals, or a three-asset strategy. The Devnet synthetic-mint market is not evidence for production asset liquidity.
- Before an S5D2 fee amendment, combine accepted S5B math and S5C oracle limits with real executable-depth and transaction-cost observations, model adverse selection and withdrawals, compare fixed against a precisely specified bounded dynamic policy (or justify rejecting dynamic fees), then review the exact fee bounds and rationale.
- S5E remains gated on the reviewed fee amendment. Until then, no “up-only,” guaranteed arbitrage profit, or LVR-protection claim is supported.
