# S2C — read-only solver and transaction probe

**Result: BLOCKED / NOT PASSED.** This package adds a reproducible, wallet-free probe harness, but this run did not establish executable WSOL/USDC depth, a direct venue route, safe profitable spread, transaction landing cost, or an independently funded taker. It records no market-liquidity or fee claims. No wallet/keypair was read, no signature was produced, and no transaction was sent.

## What was implemented

`tools/rebalancing/solver-probe/probe.py` has two explicit operations:

- `status` reads the genesis hash first and requires it to match the selected mainnet/devnet cluster before reading finalized slot/health and canonical WSOL/USDC mint account owner, decimals and supply. On 11 October 2026, the public Devnet endpoint and independent OnFinality endpoint returned `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` at adjacent slots, matching the Solana SDK genesis constant. The current Solana [`getGenesisHash` documentation example](https://solana.com/docs/rpc/http/getgenesishash) prints `GH7ome...`; the probes follow the live endpoint consensus and record this documentation discrepancy. A mismatch still fails closed.
- `simulate` accepts an unsigned base64 transaction, refuses any non-zero signature byte, reads the base fee, and calls `simulateTransaction` with signature verification off and recent blockhash replacement on. It reports bytes, transaction version, static/lookup key slots, compute-budget settings, simulated CU, logs, and RPC error.

This is transaction-shape tooling, not a route finder or an auction executor. The simulator does not resolve address lookup table pubkeys, and RPC simulation is not a landed transaction or proof of token deltas/depth. The generic probe makes no Jupiter dependency. Any future venue adapter must produce both-direction, size-ladder quotes directly from verified pool state; a Router quote alone is not independent venue evidence.

The expected S2D ABI is `fill_auction(expected_intent_sequence, sell_amount, gross_buy_amount, bounty_amount)`. The fill records a per-fill bounty-claim liability; it has no inline bounty recipient or payout account. This package does not add the Anchor fill instruction or a client ABI.

## Reproduction and observed result

Run package tests:

```sh
python3 -m unittest discover -s tools/rebalancing/solver-probe -p 'test_*.py' -v
```

Result on 10 Oct 2026: **8 tests passed** for legacy/v0 message parsing, lookup-index accounting, compute-budget parsing, signature detection, malformed shortvec rejection, URL credential redaction, and acceptance/rejection of expected cluster genesis hashes.

Attempted read-only Devnet admission check:

```sh
SOLANA_RPC_URL=https://api.devnet.solana.com \
  python3 tools/rebalancing/solver-probe/probe.py status --cluster devnet
```

Result: `BLOCKED`, `getGenesisHash` could not resolve the public RPC hostname (`nodename nor servname provided, or not known`). The cluster could not be verified; no slot, mint account, owner, decimals, or supply was returned. Mainnet RPC, direct Orca/Meteora/Raydium pool state, route quotes, pool depth, an unsigned route-plus-fill simulation, a fill landing, realized fees, and solver net returns were not measured in this run. A failure to reach RPC does not indicate that the assets or pools are absent.

### Current Devnet identity and mint read — 11 October 2026

After the probe pin was aligned to the active cluster, a read-only retry completed at finalized slot `509699404` (2026-10-10 23:01:46 UTC). The RPC returned genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`, health `ok`, canonical WSOL with classic SPL Token ownership and 9 decimals, and Devnet USDC with classic SPL Token ownership and 6 decimals. The public RPC and independent OnFinality endpoint reported the same genesis at slots `509698933` and `509698943`; the Solana SDK constant agrees. Solana's current `getGenesisHash` documentation example prints `GH7ome...`, which conflicts with these live responses; current probes pin observed endpoint identity and fail closed for a different hash. The retry read no wallet and signed or sent no transaction. It does not establish executable DEX depth, route quotes, transaction costs, fills or solver profitability.

## What the result does and does not prove

| Evidence | Status |
|---|---|
| Transaction parser behavior | Locally tested; 5 focused tests pass |
| Finalized Devnet WSOL/USDC mint state | Read-only live evidence at slot `509699404`; no market-depth or route evidence |
| Direct DEX pool IDs/state and size-ladder depth | Not measured |
| Jupiter Router build | Not attempted; it is optional and does not establish independent depth |
| Safe-price spread and no-bid economics | Not computable: live route/oracle inputs and approved auction bounds are absent |
| Complete `fill_auction` transaction simulation | Not run: no RPC route/program deployment available in this environment |
| CU, account slots, serialized bytes, fee quote | Harness implemented; no representative composed transaction supplied |
| Landing cost / realized execution | Not measured; simulation cannot prove landing |
| Separately funded WSOL/USDC taker | Not demonstrated; no live transaction was submitted |

The manifest and S0F keep funded entry disabled and leave fee/bounty, auction loss, oracle age/confidence/depeg, and pilot parameters unset. This package sets no defaults or safe spread threshold. Keep no-bid behavior fail-closed until live venue and oracle facts are available and the complete transaction passes the frozen program checks. S0D/S2C therefore remain blocked; this implementation does not clear either admission gate.

## Future operator capture

Use an operator-controlled RPC URL, without saving its credential-bearing URL in evidence:

```sh
SOLANA_RPC_URL='https://your-rpc.example' \
  python3 tools/rebalancing/solver-probe/probe.py status --cluster devnet \
  --output /tmp/solver-devnet-status.json
```

After a route builder and deployed S2D program can produce a complete unsigned transaction, save only its unsigned serialized bytes as base64 and run:

```sh
SOLANA_RPC_URL='https://your-rpc.example' \
  python3 tools/rebalancing/solver-probe/probe.py simulate \
  --transaction /tmp/unsigned-fill.txt --output /tmp/solver-simulation.json
```

Keep route evidence separate and include RPC context slot/time, both directions, measured sizes, pool addresses and read slots, consumed input/output, venue fees/impact/minimum output, all route and fill accounts, LUTs, logs, simulated CU, byte/account limits, and the no-route/insufficient-depth result. A later actual Devnet fill belongs to its separately authorized S2E experiment and must use isolated test wallets; this evidence does not claim one occurred.
