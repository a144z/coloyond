# S2 Localnet auction workbench transaction evidence

**Run date:** 11 October 2026  
**Status:** SBF transaction sequence passed through the Localnet adapter; CP2b's browser-wallet checkpoint remains pending.  
**Cluster:** Solana Localnet  
**Genesis:** `61S2BuiCWrV3ocrh85kkgLbLB91JyCEcs1oP9bQ8zcQ4`  
**Program:** `FN7uGX34qyijmVX69gqEkMugWjE5Sjso8Pe7gWU6B2N6`  
**Throwaway test wallet:** `7tgxXEBF6DoGNj9ajfwVg1uj8JjddPTeNYNxvFLm8iT2`

The run started the repository's compiled vault SBF program on a reset validator, signed transactions with a disposable Localnet keypair through the workbench adapter, confirmed each signature, and read the vault, intent and SPL token accounts back over RPC. The keypair file stayed under `/private/tmp`; no wallet secret is included here.

## Transactions

| Action | Confirmed signature | Result and RPC state |
|---|---|---|
| Start | `3ZsYWjYRT2pvbXfeiMk619nd9frFZK6w6ZCoqqEVYgHq5gyCuYXLcUpBVh9jQtku5WbVnHfuPfVq2bH2abUtCPvm` | Accepted; sequence `0 → 1`; active sell amount `1,000,000,000` base units. |
| Duplicate start | `2vDH5xwjRYg6Rm2kQVwz5U2tt3XhjoFWQhMBaDLh9unZcYvNaRXBo16XPGX3B7MRCvuL53UWo43GHBZUn85u3Cvb` | Rejected (`Custom 0`); monitored token balances, sequence and intent amount unchanged. |
| Wrong feed | `2rArWMRXsTPfc4GZuJqWn8rciiypexJ3hN1G5fsLs4bXCddQN6KDRy3fHnKPv7w3Bckv2yrG91mqXiAtfJruRrKu` | Rejected (`Custom 2012`); monitored state unchanged. |
| Adverse price | `3MKWxtUbVY58sGx1QJgbLSMxjkUPgnhVmuJYQgiUu4x938ZfZjgJssjotyADNcGdUjA5vHHXdsXzgZrNRR4WuwtS` | Rejected (`Custom 6010`); monitored state unchanged. |
| Oversize fill | `cZpnY3dFDY1DiAsMTCaU2DkwZ6wkiu3jck69n7gAvRZfQPxif4Nv7821EFppSo5QzJVq2wsVSE1wmyeSfzJayQQ` | Rejected (`Custom 6010`); monitored state unchanged. |
| First partial fill | `4iLusgQ2bYtJ8VaGRdk41C4TYZRU9isZecmyB2XiDu7mWGM4ahNa6py1fWHSUVMMwDtdPcFViqEmBpfQpxm46Ctt` | Accepted; sequence `1 → 2`; custody WSOL `−500,000,000`, custody USDC `+51,000,000`; taker deltas are the exact opposites. Remaining sell amount `500,000,000`. |
| Replay | `5iXUhDNUU1rFD1ypA8wKPaqR9bDRomqeZEU5W5VTXymX2TAzBsAniPDv8abxvoKbV79hVJ3JGULjYKv8Amt5LuKJ` | Rejected (`Custom 0`); monitored state unchanged. |
| Second partial fill | `2K7zzP5MihckGCCW6kbuM8oP65dsrWfsFXF6zbhkxYM2wWGK4UgSm89yCJqrGC72wnBNv3tT45M8FQPPPTtN5TY9` | Accepted; sequence `2 → 3`; same exact opposite token deltas; remaining sell amount `0`. |
| Finish | `42vHCrpNWPEeXnx1NF2Rv9P2p58MSbF6PpyrJoXDqKpyp8sApyCWmipnUa9o2kUkLBe4QuU1sB6upPmQM9uQPtsf` | Accepted; sequence `3 → 4`; intent closed; no token-account delta. |

All rejected actions reached the validator and confirmed with unchanged monitored token balances and intent state. Transaction fees are Localnet-only and are not included in SPL deltas.

## Limits and next evidence

The mint-account bytes and Pyth-shaped oracle observations were synthetic Localnet fixtures. They do not prove live Pyth authenticity, Devnet feed availability, market liquidity, keeper liveness or fee economics. The run called the workbench adapter directly with a disposable keypair; it did **not** exercise the browser's visible click path or an imported browser wallet. Therefore CP2b remains unaccepted until the interactive browser wallet walkthrough in the sprint checklist is completed and its receipts are reconciled against RPC.
