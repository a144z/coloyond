# S4A economics scenario model

Small standard-library-only tool for reproducible, evidence-tagged screening of candidate auction economics. It is **not** a parameter optimizer, trading bot, executable quote source, or approval to seed/fund a vault.

## Run

From the repository root:

```sh
python3 -m tools.rebalancing.economics --input tools/rebalancing/economics/scenarios.json
python3 -m unittest discover -s tools/rebalancing/economics/tests -v
```

The example bundle is intentionally synthetic and yields `NO_GO`. It exercises quiet, trending and volatile regimes, both incoming bounty-token denominations, rate-limited reserve, competing arrivals, and an empty auction when assumed DEX depth is below minimum. It contains no claimed live quote, reserve, realized fee, or competitor measurement.

## Input replacement

Copy `scenarios.json` to an operator-controlled capture bundle. Keep a separate scenario for each direction because the bounty must be backed by the exact incoming token's reserve. Replace assumptions only with time/slot-bound evidence and retain the raw quote, pool/bin/tick state, composed unsigned transaction simulation, Pyth observation, RPC fee sample, and keeper/solver event records. Set `data_status` to `measured_capture` only when the bundle represents captured data; then supply a stable `capture_id` and `capture_metadata` with `cluster`, `captured_at_utc`, and `source_refs`. A measured screen is still not an approved policy or release gate.

All amounts in the screening calculation are USD marks for readability. The on-chain program transfers raw SPL units and enforces its own checked integer math. S4C must test token-decimal rounding and reserve/liability conservation against actual account deltas.
