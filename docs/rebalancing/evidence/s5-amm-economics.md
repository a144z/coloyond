# S5D2 — ETF v1 AMM fee and depth economics

**Status:** candidate sensitivity model implemented; fee amendment and S5D2 acceptance remain open. This evidence contains modeled assumptions only, not Devnet measurements or a recommendation for funded use.

## Reproduction

Run `python3 -m unittest discover -s tools/rebalancing/etf-economics/tests -v` and `python3 tools/rebalancing/etf-economics/run.py` from the repository root. The standard-library model writes an ignored `results.csv` with 3,024 deterministic scenarios. It models a two-asset, equal-weight constant-mean pool at initial $1 oracle marks; the full inputs and equations are documented in the tool README and source.

The grid varies assumed pool depth ($10k/$100k/$1m), trade size (10/50/100/500 bps of depth), fixed fees (5/10/30/50/100/500/1,000 bps), external moves (10/30/100/500 bps), uncertainty haircuts (5/25/100 bps), and external transaction costs ($0.01/$0.10/$1.00). The model reports trader net PnL, pool mark change, and the smallest integer external move that clears the modeled fee, haircut, and cost.

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

## Decision and remaining evidence

- No fixed or dynamic fee is approved. The blueprint's 30/500/1,000 bps table remains a proposal, not an accepted policy.
- The current model evaluates fixed fee points only. It does not yet compare an on-chain bounded dynamic-fee rule against a fixed fee under the same observed state transitions; no such rule should be added to the contract based on this model alone.
- Inputs are not measured executable Devnet depth, confirmed route cost, oracle cadence/uncertainty, order flow, withdrawals, or a three-asset strategy. The Devnet synthetic-mint market is not evidence for production asset liquidity.
- Before an S5D2 fee amendment, combine accepted S5B math and S5C oracle limits with real executable-depth and transaction-cost observations, model adverse selection and withdrawals, compare fixed against a precisely specified bounded dynamic policy (or justify rejecting dynamic fees), then review the exact fee bounds and rationale.
- S5E remains gated on the reviewed fee amendment. Until then, no “up-only,” guaranteed arbitrage profit, or LVR-protection claim is supported.
