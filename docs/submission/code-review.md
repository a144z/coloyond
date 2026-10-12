# Code review and test evidence

This is a scoped implementation review by the project assistant, not an independent security audit. Current financial scope is devnet test assets, not mainnet custody.

## Reviewed execution path

| Boundary | Production code | Evidence / change |
| --- | --- | --- |
| Real owner approval | `src/ui/wallet/SolanaWalletProvider.tsx`, `src/ui/app/MobileApp.tsx` | MWA adapter and Wallet Standard context are wired. Runtime signer is not persisted. Physical MWA approval remains untested here. |
| Exact signed message | `src/ui/app/lib/solana/tx-core.ts` | Rejects a modified wallet-returned message and invalid/missing required signatures before sending. Six cryptographic/transport tests pass with disposable local keys and mocked RPC. |
| Ambiguous confirmation | `tx-core.ts`, `tx.ts`, Wallet screen | Persists the signed message/signature before network I/O. An unresolved result blocks another send; reconciliation checks history, message readback and blockhash expiry. A confirmed status alone cannot imply successful intent. Wallet exposes Check confirmation. No automatic blind resend. |
| Account authenticity | `vault-state.ts`, `vault-feed-registry.ts` | Decoder checks discriminator/length, owner-derived Vault State PDA, share-mint PDA, supported unique mints, decimals, exact oracle account/feed ID and 10,000 bps targets. Spoof/size/identity tests pass. |
| Precise weights | `WeightSliders.tsx` | Removed premature integer rounding of raw shares. The 40/20/40 locked example is exact, 100% clears other unlocked shares, and fractional targets survive edit initialization. Three focused regressions pass. |
| Rebalance math | `lib/rebalance/illustration.ts` | One fee-free model is used by the real app explorer and Remotion. Four tests cover value conservation, target restoration, reverse shock, already-balanced and invalid inputs. It does not construct or submit a trade. |
| Independent execution | `coloyond-beta/programs/coloyond-execution/src/lib.rs`, cranker/smoke scripts | Source contains Hydra/ER planning and authenticated atomic base-layer SPL settlement. Read-only RPC evidence establishes executable deployment and successful historical settlements with token balances; it does not establish source-binary parity or future liveness. |
| Oracle hardening | The same Rust source | New source uses Pyth `get_price_no_older_than`, a 90-second age bound, a 5-second future bound, Full verification and ≤1% confidence/price. Four Rust host tests pass, including seven boundary assertions in the new oracle case. **This source change has not been deployed or independently matched to deployed bytecode.** |
| Sharing boundary | `PortfolioArt.tsx`, `portfolio-card.ts`, `remix-link.ts`, `native-share.ts` | PNGs exclude addresses/balances. Remix URLs import unsigned targets only. Actual PNG download and new-tab remix load pass browser checks; the file-share handoff is mocked and the Android chooser still needs a device test. |

## Reproduce

```sh
npm ci
npm run test:proof       # 16 tests: signing, decoder, illustration and exact weight editor
npm run typecheck
CHROME_PATH=/path/to/chrome npm run test:mobile
npm run test:video-camera
cargo test --manifest-path coloyond-beta/Cargo.toml --locked
python scripts/submission/probe-deployment.py   # read-only current RPC observation
npx playwright install ffmpeg
CHROME_PATH=/path/to/chrome npm run evidence:record
npm run android:apk
```

Browser recording is actual `/app` execution, with network requests blocked and an explicit recording-only annotation. It demonstrates an unsigned draft, exact weights, model price shocks, target restoration, real PNG generation/download, visual remix and recipient URL loading. It does **not** show a real wallet approving a transaction. See [the recording](evidence/actual-mobile-flow.mp4) and [its readable transcript](evidence/actual-mobile-flow-transcript.md).

## Remaining release proof

A funded compatible Android wallet and the actual upgrade authority are not available in this environment. Prepare and review a reproducible SBF build/upgrade packet, have the authority sign the deployment, and verify its resulting bytecode/hash plus successful and rejected calls. Separately record genuine MWA connection/approval/signature/post-state and Android PNG sharing on a device. Do not replace these with simulated wallet footage or describe the host-tested source guard as already deployed.
