# Read-only solver probe

This probe captures admission facts and unsigned transaction simulation without using a wallet. It never signs, submits, reads keypair files, or loads `.env` files. Its network calls are limited to Solana JSON-RPC reads, `getFeeForMessage`, and `simulateTransaction` with `sigVerify: false`.

Every RPC response is checked as a JSON-RPC 2.0 envelope with the matching request ID and exactly one result or structured error before the result is used. Malformed envelopes fail as `BLOCKED` probe evidence instead of being mistaken for a successful read. Simulation output is complete only when the RPC returns a `value` object containing the required `err` field.

Run the package tests with:

```sh
python3 -m unittest discover -s tools/rebalancing/solver-probe -p 'test_*.py' -v
```

## Capture cluster facts

Provide an RPC URL explicitly; the tool does not guess endpoints. Use a separately configured public or project RPC without embedding credentials in the saved report:

```sh
SOLANA_RPC_URL='https://your-rpc.example' python3 tools/rebalancing/solver-probe/probe.py status --cluster devnet --output /tmp/solver-devnet-status.json
```

The report records finalized slot, genesis hash, health, canonical manifest mints, mint account owner, token decimals, and supply. It verifies `getGenesisHash` before reading assets; a mismatch stops the run as `BLOCKED`. `BLOCKED` is a valid result and is returned with exit code 2. It means there is no usable measurement from that run. The Devnet pin is the value shown by Solana's current [`getGenesisHash` RPC reference](https://solana.com/docs/rpc/http/getgenesishash), checked 10 October 2026. This differs from reset-era Devnet constants retained in older SDK sources; the probe deliberately fails closed if an RPC reports those older values. The mainnet-beta pin is retained from the upstream Solana SDK's [genesis configuration](https://github.com/solana-labs/solana/blob/master/sdk/src/genesis_config.rs).

## Simulate a complete unsigned candidate

Once the S2D program is deployed to an experimental cluster and a route builder can compose the swap and `fill_auction(expected_intent_sequence, sell_amount, gross_buy_amount, bounty_amount)`, save the *unsigned serialized transaction* as base64 text and run:

```sh
SOLANA_RPC_URL='https://your-rpc.example' python3 tools/rebalancing/solver-probe/probe.py simulate --transaction /tmp/unsigned-fill.txt --output /tmp/solver-simulation.json
```

The fill books an earned bounty claim liability; it has no immediate bounty destination or payout account. The probe rejects any transaction containing a nonzero signature byte. It reports serialized size, legacy/v0 format, static and address-table index counts, compute-budget instructions, fee quote, simulation logs/error and consumed compute units. Compiled program/account indexes must fit the combined static and loaded key count. `accountKeySlots` counts static keys plus every address-table index referenced by the message; the tool does not fetch table contents or independently validate loaded keys. `getFeeForMessage` and simulation do not establish actual landing cost, pool depth, profitable spread, fill success on a future block, or actual post-trade token deltas.

Route-specific direct-pool quotes and landing observations must be recorded separately from this generic transaction simulator. Do not treat a Jupiter quote/build or SDK fixture as independent venue depth. Include both directions and a size ladder, context slot/time, exact pool IDs/state, input consumed, output, fees, price impact, minimum output, all setup/cleanup/CPI accounts, and route errors. Until measured data exist, the solver must abstain. Numeric auction, age, confidence, depeg, fee, bounty, and loss parameters remain unset by S0F and may not be inferred by this probe.
