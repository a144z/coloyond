# S5G live Devnet frontend read — 11 October 2026

**Result:** the integrated `/etf-devnet` route completed a real browser RPC read. This proves frontend-to-RPC read wiring for the observed accounts only. It does not prove wallet connection, ETF transaction construction, signing, deployment, pool initialization, seed, swap, or policy admission.

## Observed browser session

| Field | Observation |
|---|---|
| Route | `http://127.0.0.1:5173/etf-devnet` |
| RPC endpoint | `https://api.devnet.solana.com` |
| Commitment | `confirmed` |
| Genesis | `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` — matched the pinned Devnet hash |
| Account snapshot slot | `509794095` |
| Client read time | `2026-10-11 13:18:31 Asia/Hong_Kong` |
| Program / pool | Not configured / not deployed |
| Connected wallet | None |
| Signature / transaction | None; this screen is read-only |

## Exact account facts rendered by the page

- WSOL mint `So11111111111111111111111111111111111111112`: classic SPL Token owner, 82-byte mint layout, 9 decimals, zero supply, no mint or freeze authority reported.
- Test USD mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`: classic SPL Token owner, 82-byte mint layout, 6 decimals, supply `16286767455804391005`, active mint authority `GrNg1XM2ctzeE2mXxXCfhcTUbejM8Z4z4wNVTy2FjMEz`, and active freeze authority `CJtyoKSLrktozQzjERTiK3btQtiTK3nN4QrqGHLidyCT`. The page labels it synthetic, unbacked, and not redeemable as USDC.
- SOL/USD feed `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE`: Receiver owner `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`, 134 bytes, expected feed ID, `Full`, publish age 281 seconds, confidence ceiling 5 bps.
- BTC/USD feed `4cSM2e6rvbGQUFiJbqytoVMi5GgghSMr8LwVrT9VPSPo`: same Receiver owner/layout and expected feed ID, `Full`, publish age 281 seconds, confidence ceiling 8 bps. The screen identifies it as an unpaired feed candidate; no BTC mint is admitted.
- USD/USD feed `Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX`: same Receiver owner/layout and expected feed ID, `Full`, publish age 281 seconds, confidence ceiling 10 bps. The page says this reference does not establish Test USD backing.

The current read used observed chain time `1791695910` and feed publish time `1791695629`. Freshness/confidence policy is explicitly **unconfigured**. The screen does not apply or invent a limit, and no risk-increasing transaction is eligible from this observation. All candidate assets remain **not admitted**.

## Reproduction and validation

- `npm run dev -- --host 127.0.0.1 --port 5173`; open `/etf-devnet`. The visible route loaded and completed the above live RPC request.
- `npm run typecheck -- --pretty false` — passed.
- `npm run build` — passed; Vite reported the existing large JavaScript chunk warning.
- `npm --prefix packages/etf-client run typecheck` — passed.
- `npm --prefix packages/etf-client test` — 31 passed. The sandbox initially denied `tsx`'s temporary IPC socket; rerunning the same test command with execution permission passed.
- `cargo test --locked --offline -p coloyond-etf-identity -p coloyond-etf-math -p coloyond-etf-oracle` — passed.
- `git diff --check` — passed.

## Manual wallet/RPC check

1. Start the app and open `http://127.0.0.1:5173/etf-devnet`.
2. Confirm the displayed endpoint and expected/actual genesis hashes, then click **Refresh live RPC state** and verify the returned slot.
3. Verify both candidate mint addresses, decimals, token-program owner and authorities. Keep the Test USD synthetic/unbacked disclosure visible.
4. Verify each feed account, Receiver owner, expected and embedded feed ID, `Full` level, publish age and unconfigured policy status. Do not proceed with a risk-increasing action while policy is unconfigured or feeds are stale.
5. If using the wallet-read portion, connect a wallet set to Devnet and verify its address and candidate-token balances are read from RPC. Wallet connection was not exercised in this evidence run.

There is no transaction button on this screen. No wallet signature is requested and no submitted, timed-out, or confirmed transaction state is claimed here.
