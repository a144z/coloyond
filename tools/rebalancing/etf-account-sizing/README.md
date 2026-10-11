# ETF v1 provisional account sizing

Run the dependency-free checks with:

```sh
python3 -m unittest discover -s tools/rebalancing/etf-account-sizing -v
python3 tools/rebalancing/etf-account-sizing/size.py --assets 2 --fee-params-bytes 3 --risk-params-bytes 4 --account-fixed-field-widths 1 32 8
```

The config formula follows the current S5A draft wire document. Account wrapper
field widths are caller inputs, because the `EtfPool` / `EtfAsset` byte layouts
have not been frozen. This tool does not choose a maximum policy payload, config
ceiling, account ceiling, or rent budget.
