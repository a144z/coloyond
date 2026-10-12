# Coloyond — submission proof

**Current shipped stack: React + TypeScript mobile web, packaged with Capacitor in a Gradle Android APK.** Kotlin/Jetpack Compose under `apps/android/app/src/legacy*` is historical reference, not the shipped UI. The current portfolio execution program is `coloyond-beta/programs/coloyond-execution`, ID `HT7c9346N1o1TRzttWEHTg6mf7gyB1qNeV6K9VBKdN2d`. The older ETF/auction research programs and Glider-only release plans are separate work, not the active `/app` implementation.

## Start with evidence, not roadmap prose

| Claim | Concrete evidence | What this establishes / limit |
| --- | --- | --- |
| Mobile flow and PNG sharing | [`scripts/mobile/capture.mjs`](../../scripts/mobile/capture.mjs), [actual UI captures](../../remotion/public/screens), [card renderer](../../src/ui/app/lib/art/portfolio-card.ts), [card guide](../mobile/portfolio-cards.md) | Browser flow, actual PNG generation/download and a mocked file-share handoff. Not a physical-phone chooser test. |
| Installable Android | [APK](../../releases/coloyond-android-debug.apk), [Gradle configuration](../../apps/android/app/build.gradle.kts), [verification](../mobile/verification.md) | Compiled, lint-checked and signature-verified debug APK. Physical wallet association/signing remains a device acceptance item. |
| Wallet integration | [MWA adapter](../../src/ui/wallet/SolanaWalletProvider.tsx), [wallet bridge](../../src/ui/app/MobileApp.tsx), [sign/send/confirm](../../src/ui/app/lib/solana/tx.ts) | Real SDK integration and transaction path in code. An SDK import or mocked signer is not a live MWA approval video. |
| A deployed devnet program exists | [timestamped RPC evidence](evidence/deployment-read.json), [read-only reproduction script](../../scripts/submission/probe-deployment.py) | Verified devnet genesis, executable Upgradeable Loader program, ProgramData address, deployment slot and upgrade authority. Source-to-binary correspondence is not independently established. |
| Successful vault execution exists | The same [RPC evidence](evidence/deployment-read.json) includes independently retrievable signatures, successful metadata, settlement logs and pre/post SPL balances | Observed historical devnet settlements, including multi-leg rebalances. This is stronger than a roadmap, but does not prove current keeper uptime or that those signatures originated from this APK/MWA. |
| Automated execution is implemented | [contract](../../coloyond-beta/programs/coloyond-execution/src/lib.rs), [Hydra scheduling client](../../src/ui/app/lib/solana/execution.ts), [cranker](../../coloyond-beta/scripts/run-vault-cranker.mjs), [closed-loop smoke harness](../../coloyond-beta/scripts/smoke-closed-loop.mjs) | Schedule/ER planning, authenticated Magic Action, atomic base-layer SPL settlement, replay/slippage/liquidity controls. Continued automation needs a funded, running operator and suitable data/liquidity. |
| Generative remix loop | [PNG/UI renderer](../../src/ui/app/components/ui/PortfolioArt.tsx), [validated remix URLs](../../src/ui/app/lib/art/remix-link.ts) | Compose → generate → share → unsigned draft → remix. No fabricated retention statistics or claim of viral reach. |

## Architecture everyone should describe consistently

1. **One product UI:** React `/app` in desktop/mobile browsers and the Capacitor Android WebView. Android packages the same production Vite assets; App, StatusBar, Filesystem and Share are native bridges.
2. **Wallet-owned setup/actions:** wallet approval signs initialization, deposit, redemption, target/cadence edits and pause/resume. The device-wallet option is devnet-only and must not be confused with external MWA.
3. **On-chain custody:** Vault State and authority PDAs, standard SPL asset accounts and one transferable share mint per vault. The devnet market includes synthetic/unbacked dUSD, tBTC and tETH.
4. **Independent automation:** Hydra/cranker invokes ER planning. Authenticated Magic Actions settle supported trades atomically on the base layer. The open app only refreshes displays; it is not the automation service.
5. **Creative layer:** deterministic target-weight geometry, local 1200×1500 PNG rendering, file sharing and unsigned remix URLs. Artwork never grants custody or signing authority.

**Glider is not in the current execution path.** No Glider API partnership, embedded trading integration or Glider-powered rebalance is claimed. The prior manual external handoff was a retired product direction. Instant general wallet buy/sell is also not offered by this build; the implemented financial path is vault deposit/redemption and scheduled, supported devnet basket execution. Mainnet routing/liquidity are not implied by synthetic test assets.

## Review finding that must remain visible

The execution source at the beginning of this review checked Pyth owner, feed identity and Full verification but used `get_price_unchecked`, without enforcing observation age/confidence. An executable program and successful transactions are not a security audit. Hardening source requires host tests, a fresh SBF build, authorized upgrade and post-upgrade readback before new source protections can be called deployed. Keep these scopes separate. The program has an upgrade authority; it is not immutable.

## Product loop and retention hypothesis

The completed share/remix loop gives users an immediate creative result without funding a vault. A recipient opens a draft, changes the mix, generates a new identity and shares it onward. A vault owner can return to inspect drift, confirmed settlements and holdings, or revise targets and regenerate artwork. These are repeat-use reasons, not measured retention. Track opt-in activation (first export), recipient draft/remix completion, and week-one return-to-inspect/export in a pilot; do not invent engagement numbers for a hackathon deck.

## Demo acceptance

The 62-second promotion is an explanation, not a substitute for transaction proof. Submit it with a plain-text timed transcript and SRT/VTT captions. Mark price-shock animations as illustrations. Keep a separate actual-UI recording and test report accessible. For the remaining device acceptance, use a real compatible Android wallet, record connection → exact transaction review → approval → RPC signature → post-state readback, then repeat PNG sharing into an installed app. Never simulate that footage and call it a real wallet handoff.
