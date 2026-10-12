# Coloyond

**Your portfolio as one picture.** A shareable, visual portfolio composition built for the mobile web and powered by Solana.

## Copy-ready project description

Coloyond turns a portfolio allocation into a composition you can share. Build your mix with exact percentages, responsive sliders and target locks; generate a 1200×1500 PNG whose colors and geometry follow the allocation; then send an unsigned remix link so someone else can make it their own. Orbit, Prism and Stack artwork gives every mix a recognizable visual identity.

The shipped product is a React/TypeScript mobile web app at `/app`, packaged as a Gradle-built Capacitor Android APK using the same production UI. Native bridges handle PNG file sharing. Wallet-approved actions create and manage devnet vaults, deposit assets, redeem SPL shares and update targets or scheduling. The execution source implements independent cranking, ER planning and authenticated atomic SPL settlement. A read-only proof snapshot documents an executable devnet program and successful historical settlements, including multi-leg rebalances with token-balance readbacks.

The 62-second film keeps the product’s component zooms, clicks, two-way slider gestures, kinetic typography and uploaded music. Its new price-shock illustration shows SOL rising, ETH falling, and selling excess SOL to restore a complete 40/20/40 value mix. The video has a readable visual transcript; a separate actual production-browser recording proves exact editing, PNG export and recipient remix loading.

Coloyond connects a practical portfolio desk to a creative remix loop: compose, export, share, open, remix and return to inspect. This repeat-use hypothesis is testable through export activation, recipient remix completion and week-one return visits; user retention has not yet been measured.

## Submission links — open these first

| Evidence | Link | What to inspect |
| --- | --- | --- |
| Product film | [62-second MP4](../../releases/coloyond-mobile-showcase.mp4) + [timed visual transcript](demo-transcript.md) | Component zooms, sliders, navigation, beat-timed rebalance explanation; music-only, no spoken narration |
| Actual working UI | [Production browser recording](evidence/actual-mobile-flow.mp4) + [readable action transcript](evidence/actual-mobile-flow-transcript.md) | Exact 40/20/40 editing, locks, real PNG download, artwork remix and recipient draft loading |
| Installable app | [Android 1.1.3 APK](../../releases/coloyond-android-debug.apk) + [build/signature evidence](evidence/implementation-verification.json) | Gradle-built signed debug APK; same `/app` UI, Android 8+ |
| On-chain execution | [Readable settlement receipts](receipts.md) + [raw RPC snapshot](evidence/deployment-read.json) | Executable devnet program, successful metadata/logs and pre/post SPL balances |
| Code review | [Reviewed boundaries and tests](code-review.md) | Signing intent, pending-confirmation recovery, account validation, oracle checks and share-link boundaries |
| Film source | [One canonical Remotion source](../../remotion/README.md) | All source/assets/music/analysis committed; original-motion regression and exact export verification |

## One architecture, accurately described

**React + TypeScript → Capacitor/Gradle Android → wallet-approved Solana devnet vault actions → independently operated scheduling/cranking → authenticated SPL settlement.** The shared UI also generates portfolio PNGs and unsigned remix links locally. Kotlin/Jetpack Compose is a retired prototype, not the shipped APK. Glider is not the execution dependency; the historical manual handoff is not presented as an integration.

## Implemented scope and release boundaries

The product implements vault deposit/redemption and supported scheduled devnet execution. It is not a general instant mainnet buy/sell app. Devnet dUSD/tBTC/tETH are synthetic, unbacked test assets. The browser recording is genuine unsigned UI execution, not physical-device MWA approval. Android compilation/signature verification does not establish installation on a physical phone. The review is a scoped project review, not an independent security audit.

New Pyth age/confidence hardening passes four Rust host tests and an SBF build; its compiled [upgrade review packet](../../releases/pending-upgrade/review-packet.json) is available but **not deployed**. Source-to-current-bytecode parity, genuine device wallet approval/sharing and continued operator liveness remain explicit acceptance checks. Existing historical settlements must not be presented as proof that these new protections are active.

## Reproduce the proof

```sh
npm ci
npm run test:proof            # 16 focused source tests
npm run typecheck
npm run test:mobile           # actual controls, PNG/remix flow, responsive widths
npm run test:video-motion     # original motion + music settings retained; rebalance math
npm run test:video-camera
npm run test:video-export     # exact 62s, stereo soundtrack, committed-input inventory
python scripts/submission/probe-deployment.py  # read-only public RPC
```

See the [complete proof guide](README.md) and [Android build instructions](../../apps/android/README.md). The actual recording, on-chain evidence and promotional animation each have separate scopes, so reviewers can verify claims without guessing.
