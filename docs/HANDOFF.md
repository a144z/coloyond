# Coloyond — current handoff

The shipped product and verification entry point is [the submission proof](submission/README.md). The UI is React/TypeScript `/app`, packaged through Capacitor and Gradle for Android. The Kotlin/Compose app and Glider-only release are historical references.

Current execution code is `coloyond-beta/programs/coloyond-execution`; `src/ui/app/lib/solana/execution.ts` builds its wallet-signed actions and Hydra schedule. See [timestamped program/transaction evidence](submission/evidence/deployment-read.json). Successful historical devnet settlements exist; device MWA, independent source-to-binary verification and future operator uptime must not be inferred from them.

- [Run the mobile app and Android build](../apps/android/README.md)
- [PNG sharing and remix links](mobile/portfolio-cards.md)
- [Test/build evidence and limits](mobile/verification.md)
- [Retired card/Glider handoff plan](archive/HANDOFF-card-glider-release.md)

Presentation materials must use this stack and evidence scope consistently. No Glider API or mainnet execution is claimed.
