# coloyond

coloyond is being designed for the Solana mobile hackathon: select an existing managed strategy token, generate an abstract expression with an optional caption, and share or remix it. Existing protocols manage underlying holdings; supported purchases and sales use Jupiter's managed swap flow.

- [Reviewed product specification](docs/superpowers/specs/2026-10-09-coloyond-strategy-cards-design.md)
- [Implementation plan and launch gates](docs/superpowers/plans/2026-10-09-coloyond-managed-strategies.md)
- [Offline interactive design preview](docs/design/coloyond-strategy-cards.html)
- [Design image](docs/design/coloyond-strategy-cards.png)

The product integration is planned, not implemented. No live vault, keeper coverage, Jupiter route, or native wallet flow is verified yet. The design preview uses illustrative artwork, IDs, and financial facts.

## Native Android build

The Kotlin + Jetpack Compose scaffold is in [`apps/android`](apps/android/README.md), with a devnet Mobile Wallet Adapter connect/sign-message/disconnect demo. See its README for prerequisites, SDK paths, checks, and device installation.

From the repository root, with JDK 17 and Android SDK Platform 37/Build Tools 36.0.0 configured:

```sh
cd apps/android
./gradlew :app:assembleDebug --console=plain
```

APK: `apps/android/app/build/outputs/apk/debug/app-debug.apk`. Open `apps/android` directly in Android Studio.

The current browser application is the earlier **coloyond** React/Vite routing prototype. LI.FI and deBridge provide quotes; the execution view uses simulated steps. It does not establish real signing, on-chain settlement, or atomic cross-chain rollback. Its sample balances and signatures are presentation data.

## Prototype commands

```sh
npm install
npm run dev
npm run dev:cli
npm run typecheck
npm run build
```

The [design spec](docs/superpowers/specs/2026-10-09-coloyond-strategy-cards-design.md) and [implementation plan](docs/superpowers/plans/2026-10-09-coloyond-managed-strategies.md) target this Kotlin app. They supersede the earlier React Native/Expo plan. The current Android starter does not embed the Vite app or execute the planned financial strategies.
