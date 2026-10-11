# S5D2 — asymmetric oracle-confidence profile sensitivity

**Status:** candidate-only endpoint sensitivity. No oracle limit, policy, or contract behavior is selected by this report. It does not clear S5C, S5A, S5E, or CP5.

## Question and method

Does strict target-weight deviation improvement in the selected S5B quote corpus survive independently chosen low/high confidence endpoints when each asset has a different confidence ratio?

The model replays the 29,106-row S5B drift corpus at SHA-256 `b2237b7004bab5f52fcc8d8471e6bf63d71a8ffc1a7101926e7bff4a34da0fc1`. It uses each row's exact reference curve output and applies the same endpoint marks before and after the swap. Integer arithmetic floors each USD mark at the existing `10^-12 USD` scale, and strict weighted-error improvement uses cross multiplication. For each three-asset confidence profile, all eight independent low/high endpoint combinations are evaluated.

Profiles `4/7/9`, `4/8/10`, and `4/9/9` bps are observation-shaped inputs based on recorded Devnet snapshots. The scenario corpus does not record per-row confidence metadata, so these are not historical row-by-row replay. Each profile is also widened coordinatewise by factors 2, 5, and 10. These are finite sensitivity points, not a distribution or proposed threshold. “Robust” means only that all eight corners in this calculation improve; it does not establish improvement throughout the continuous box.

## Results

All 12 profile/multiplier combinations retained strict improvement at all eight corners for all 29,106 selected rows (232,848 of 232,848 corner checks each). The widest tested endpoints are 40/70/90, 40/80/100, and 40/90/90 bps. The selected corpus was conditioned on point-mark improvement, so this result applies only to that finite sample. It is not a guarantee for arbitrary trades, live Devnet feeds, the conservative Q96 quote, or an on-chain acceptance rule.

The reproducible CSV lists every profile and endpoint width: [`oracle_confidence_profile_sensitivity_results.csv`](../../../tools/rebalancing/etf-economics/oracle_confidence_profile_sensitivity_results.csv), SHA-256 `2820e90ea22a7673d4873784c67edaa338a0f5cfa794595735557de06bde6958`.

## Reproduction and limits

Run `python3 tools/rebalancing/etf-economics/oracle_confidence_profile_sensitivity.py` and `python3 -m unittest discover -s tools/rebalancing/etf-economics/tests -p 'test_oracle_confidence_profile_sensitivity.py' -v` from the repository root. Six focused tests cover complete endpoint enumeration, exact asymmetric pre/post mark arithmetic, zero-profile parity, invalid inputs, coordinatewise widening over the full pinned corpus, source identity, and deterministic CSV output.

This offline model does not verify Pyth accounts, freshness, confidence policy, continuous-box extrema, price manipulation, conservative runtime quotes, executable depth, fees, scheduler behavior, SBF compute, SPL CPI, or wallet transactions. S5C risk policy and all S5A/S5E gates remain open.
