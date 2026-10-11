# coloyond ETF rebalance bot

Minimal Python rebalance poller for `programs/coloyond-etf`. It reads the ETF's
`EtfWeightsV1` PDA (which holds the current `target_weights`, the
`rebalance_interval_seconds` cooldown and the `last_rebalance_unix_timestamp`)
plus the pinned Pyth Devnet price accounts, decides whether an on-chain
`rebalance` instruction would currently be accepted, and (when `--send` is
given) submits it.

The rules live entirely on-chain. The bot's job is only: (a) notice the
deviation and (b) submit `rebalance` at the right moment. The bot cannot
rug the pool because the program rejects it if the on-chain cooldown has
not elapsed.

## Layout

- `bot.py` — main entry point.
- `weights_logic.py` — pure deviation + cooldown math (unit tested below, no
  network needed).
- `test_bot.py` — `unittest`-based tests (stdlib-only).
- `requirements.txt` — pinned direct deps.

## Running

```powershell
python -m pip install -r bot/requirements.txt
python bot/bot.py --rpc https://api.devnet.us.solana.com --pool <POOL_PUBKEY>
```

Pass `--send` to actually broadcast a rebalance when the deviation crosses
the threshold and the cooldown has elapsed.

## Testing

```powershell
python -m unittest discover -s bot -p "test_*.py"
```
