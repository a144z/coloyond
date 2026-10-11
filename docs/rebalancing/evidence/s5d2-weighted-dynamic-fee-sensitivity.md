# S5D2 — three-asset weighted dynamic-fee sensitivity

**Status:** candidate-only synthetic comparison. It chooses no fee schedule, signal source, execution policy, or production parameter and clears no S5A/S5C/S5E/CP5 gate.

## Question and method

How does the existing bounded dynamic-fee candidate compare with fixed 5, 30, and 100 bps in otherwise identical three-asset weighted-mean scenarios?

The replay covers 1,800 scenarios: all six ordered SOL/BTC/USDC pairs, six matched pre-shock notionals ($100–$5,000 against a hypothetical $100,000 NAV), five relative moves (10–2,500 bps), five confidence haircuts (0–100 bps), and both output-appreciates/input-depreciates directions. Initial reserves are 400 SOL, 0.8 BTC, and 20,000 USDC at $100/$50,000/$1 marks and 40/40/20 weights. All trade sizes remain at or below the candidate 3,000-bps input-reserve cap.

The comparison calls the existing `bounded_dynamic_fee_bps` formula unchanged: `max(5, min(100, 5 + floor(max(0, move - haircut - 25) / 100) * 10))`. Each candidate fee and each fixed fee uses the same gross input amount and weighted quote helper. The external mark shock is reduced by the assumed haircut, the resulting swap legs are marked at those shocked prices, and $1/$5 transaction costs are subtracted only from trader net PnL. The fee amount is separately valued in the input asset. Pool swap-leg mark change is the exact opposite of trader gross mark PnL; this excludes the price move on reserves held before the swap.

## Results

The dynamic candidate produced 5, 35, 45, 85, 95, or 100 bps in this grid. It exceeded fixed 5 bps in 1,080 scenarios and equaled it in 720; it exceeded fixed 30 bps in 1,080 and was below it in 720; it equaled fixed 100 bps in 360 and was below it in 1,440. These are counts from the complete Cartesian sensitivity grid, not market frequencies.

At the assumed $1 transaction cost, scenarios with positive trader net PnL changed from 906 to 892 versus fixed 5 bps, 894 to 892 versus fixed 30 bps, and 888 to 892 versus fixed 100 bps. At $5, the corresponding counts were 832 to 832, 832 to 832, and 798 to 832. The result illustrates that a higher fee can retain more value in the pool while removing marginal arbitrage profitability; it does not establish actual keeper or arbitrageur participation.

The full reproducible 1,800-row comparison is [`weighted_dynamic_fee_sensitivity_results.csv`](../../../tools/rebalancing/etf-economics/weighted_dynamic_fee_sensitivity_results.csv), SHA-256 `a2749c7f7f7a71aadb91fd9ffcbcc6eb437e20c7d9dbe54598ea906ad560dd96`.

## Reproduction and limits

Run `python3 tools/rebalancing/etf-economics/weighted_dynamic_fee_sensitivity.py` and `python3 -m unittest discover -s tools/rebalancing/etf-economics/tests -p 'test_weighted_dynamic_fee_sensitivity.py' -v` from the repository root. Seven focused tests cover the complete grid, same-case fee comparisons, matched notional, fee boundedness/monotonicity, fee and PnL accounting, invalid inputs, and deterministic output.

The move is a hypothetical signal input, not an approved on-chain state or oracle rule. The haircut, static reserves, point shock, and $1/$5 transaction costs are assumptions. This model has no latency or update process, manipulation, route or executable-depth data, scheduler, target-runtime compute, SPL CPI, or transaction evidence. It is not a three-asset performance forecast or LVR guarantee.
