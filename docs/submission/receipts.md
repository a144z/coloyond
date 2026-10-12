# Observed Solana devnet execution receipts

Read-only observation: **2026-10-12T22:39:15Z**. Program: [`HT7c9346N1o1TRzttWEHTg6mf7gyB1qNeV6K9VBKdN2d`](https://explorer.solana.com/address/HT7c9346N1o1TRzttWEHTg6mf7gyB1qNeV6K9VBKdN2d?cluster=devnet).

Executable: **True** · deployed slot **510345284** · 6 successful settlement transactions in the captured sample.

The raw snapshot includes complete signatures, successful transaction metadata, settlement logs and pre/post SPL balances. These are historical on-chain observations, not simulated video frames. They do not prove APK/MWA origin, current operator uptime or that the newly hardened source matches the deployed binary.

| Receipt | Slot | Observed settlement |
| --- | ---: | --- |
| [Settlement 1](https://explorer.solana.com/tx/67JZVhQKNLPT9WZX1EjeSTgGL6KXjW7vG7JscpRuTY8zu5r47YNhCaPtjosqoYL6fcGqzYDJ4iGYAAuWhxZpbrme?cluster=devnet) | 510413215 | Base-layer SPL rebalance settled atomically: nonce 5, 1 legs |
| [Settlement 2](https://explorer.solana.com/tx/4GpPFeihN4TiPP8PtdwiMS7B7TvEu4kDdFgeMh3LPuihSNAS9EWLtzjLGf59W9fgoYcpMcFvcnk5dbXpdF1bBo76?cluster=devnet) | 510411575 | Base-layer SPL rebalance settled atomically: nonce 1, 3 legs |
| [Settlement 3](https://explorer.solana.com/tx/4jtRbZ1KmZLuJkqvVefj95DUfnFSKT2wa51znGRRdEiVHCwT94P6csA8nf1RAq4n44HQoSD71Dfz8jDudNdiCrcu?cluster=devnet) | 510339120 | Base-layer SPL rebalance settled atomically: nonce 1, 1 legs |
| [Settlement 4](https://explorer.solana.com/tx/61faSsiSQMVrTGhZmFUSwZLkpeK3UDW6ybKbkR4qUrjGHkbtLKGrKpR4T1KBht2ajB3c1QU9RCvs8phNk7CyhCNU?cluster=devnet) | 510336334 | Base-layer SPL rebalance settled atomically: nonce 1, 1 legs |
| [Settlement 5](https://explorer.solana.com/tx/27RJc5BoWPbTUPkwqKyETFkY3Cqeu3HtDFSuhfG1GduqQjRhpfiKnvFygDWxV32G5ubAPjS7butjp8RRvfmeiygR?cluster=devnet) | 510335924 | Base-layer SPL rebalance settled atomically: nonce 1, 1 legs |
| [Settlement 6](https://explorer.solana.com/tx/3Wnoq3H7CfMW7PLbhqEQPYXqV3mfKUabGmqDeY6W74kVSb1L1rBsMDxdLoH2yMhhbFCrwXXLUnrdbrmkHZgN95ix?cluster=devnet) | 510335683 | Base-layer SPL rebalance settled atomically: nonce 1, 3 legs |

## Inspect an actual token-state change

[Open this successful multi-leg transaction](https://explorer.solana.com/tx/4GpPFeihN4TiPP8PtdwiMS7B7TvEu4kDdFgeMh3LPuihSNAS9EWLtzjLGf59W9fgoYcpMcFvcnk5dbXpdF1bBo76?cluster=devnet). The table derives integer base-unit deltas from its captured pre/post SPL token balances; it does not infer target percentages or profit.

| Account index | Mint | Pre amount | Post amount | Delta (base units) |
| ---: | --- | ---: | ---: | ---: |
| 1 | `2VnSReFZw6pXAsANhSNFqwjqiEd22ihSehLY6RVXXy8M` | 996026 | 990672 | -5354 |
| 3 | `5zPzxpfy9bBvhXDQ4cwQGY2zX97RwrrUkadK186HXZSX` | 0 | 156567 | +156567 |
| 4 | `DQZn9b9uNUZdE3AJoGoZ9hmC2NzaWxTZRo4gnNLzyuSv` | 0 | 5207797 | +5207797 |
| 5 | `2VnSReFZw6pXAsANhSNFqwjqiEd22ihSehLY6RVXXy8M` | 0 | 5354 | +5354 |
| 6 | `DQZn9b9uNUZdE3AJoGoZ9hmC2NzaWxTZRo4gnNLzyuSv` | 465219734 | 460011937 | -5207797 |
| 7 | `So11111111111111111111111111111111111111112` | 755739907 | 882559890 | +126819983 |
| 10 | `5zPzxpfy9bBvhXDQ4cwQGY2zX97RwrrUkadK186HXZSX` | 29156764 | 29000197 | -156567 |
| 13 | `So11111111111111111111111111111111111111112` | 200000000 | 73180017 | -126819983 |

## Reproduce read-only observation

```sh
python scripts/submission/probe-deployment.py
```

[Full raw RPC snapshot](evidence/deployment-read.json) · [Execution source](../../coloyond-beta/programs/coloyond-execution/src/lib.rs) · [Scope and source review](code-review.md).
