# ETF custody and oracle observer

This is a read-only diagnostic, not an automatic swap executor. The previous
poller could not start and its `--send` option never submitted transactions.
The legacy Anchor `rebalance` entry previously changed only a timestamp; it
now rejects without mutating state. A cooldown alone does not prevent theft.

```sh
python bot/bot.py --rpc https://api.devnet.solana.com --pool <POOL> --once
python -m unittest discover -s bot -p 'test_*.py'
```

No Python dependencies or signer are required. Each poll reloads the pool,
pool-bound target weights, share-mint authority, custody balances, and Pyth
updates. It validates receiver ownership, discriminator, feed ID, Full
verification, exponent, age (60 seconds), and confidence (100 basis points).
Custody and oracle reads share a `getMultipleAccounts` context, and freshness
uses the RPC's block time. Sub-token amounts retain their fractional value.
Failures are reported as blocked; a one-shot failure exits nonzero.

`--send` is explicitly rejected. Eligibility does not mean a swap exists or
that funds have moved. Discovery through token-account ownership is diagnostic;
a future execution adapter must also verify exact custody PDAs, the accepted
deployment and pool lifecycle, and reread configuration atomically before CPI.
A RPC can lie about read-only observations; on-chain checks remain mandatory.

The independent `packages/keeper` auction submitter is a different program
path. It is not wired to this ETF and is not proof of autonomous ETF swaps.
