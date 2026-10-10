# coloyond

**New to the project? Start with [docs/HANDOFF.md](docs/HANDOFF.md).** It lists what is done, what to build next for the hackathon, and in what order.

coloyond is an Android app for the Solana mobile hackathon. You choose a token allocation, the app makes an abstract card with an optional caption, and you share or remix the card. To hold the allocation, you set it up yourself in Glider: the app copies the weights and opens glider.fi. coloyond is not affiliated with Glider. The app does not buy or sell anything.

- [Reviewed product specification](docs/superpowers/specs/2026-10-09-coloyond-strategy-cards-design.md)
- [Implementation plan and launch gates](docs/superpowers/plans/2026-10-09-coloyond-managed-strategies.md)
- [Offline interactive design preview](docs/design/coloyond-strategy-cards.html)
- [Design image](docs/design/coloyond-strategy-cards.png)

Status on 10 October 2026:

- The Symmetry and Jupiter probe is done. Symmetry share tokens have no Jupiter route, and the small vaults have no keeper automation, so in-app purchase and sale are deferred. The [probe report](docs/integrations/2026-10-09-symmetry-jupiter-probe.md) has the evidence.
- The app decodes Symmetry V3 vault accounts. The decoder matches the SDK field by field.
- The card drawing, PNG export, sharing and import paths work on an Android 15 emulator.
- The strategy records, the card generator, the remix flow and the Glider handoff are not built yet.

The design preview uses illustrative artwork, IDs and financial facts.

## Native Android build

The Kotlin + Jetpack Compose app is in [`apps/android`](apps/android/README.md). It has a card probe screen and a devnet Mobile Wallet Adapter demo. See its README for prerequisites, SDK paths, checks, and device installation.

From the repository root, with JDK 17 and Android SDK Platform 37/Build Tools 36.0.0 configured:

```sh
cd apps/android
./gradlew :app:assembleDebug --console=plain
```

APK: `apps/android/app/build/outputs/apk/debug/app-debug.apk`. Open `apps/android` directly in Android Studio.

The current browser application is the earlier **coloyond** React/Vite routing prototype. LI.FI and deBridge provide quotes; the execution view uses simulated steps. It does not establish real signing, on-chain settlement, or atomic cross-chain rollback. Its sample balances and signatures are presentation data. Since 10 October 2026 the Portfolio tab also runs the rebalance desk: drift is live arithmetic over sample values, targets can be edited and normalized to a 100% total, and a simulated run reweighs the basket onto target with a fee share kept in a sample reserve (the YieldBasis reflow idea from [the Solana vault SDK survey](docs/integrations/2026-10-10-solana-vault-sdk-survey.md)). The desk stores nothing but the demo profile in local storage, and the same no-backend, no-new-contract, no-shared-key rules apply.

Since 10 October 2026 the Portfolio tab also has a **live Symmetry vault** section. It reads real devnet vaults through `@symmetry-hq/sdk` and the Symmetry V3 program (`BASKT7aKd8n7ibpUbwLP3Wiyxyi3yoiXsxBk4Hpumate`): the vault list, each vault's oracle-priced composition, live drift, automation settings and reserve, and the last keeper execution. Funding the automation reserve and nudging the keeper build real devnet transactions that the wallet signs; the rebalances themselves are executed by Symmetry's permissionless keeper network, not by coloyond, so the holder pays no gas per rebalance. Devnet is the default (test funds only); the mainnet toggle is present but the public mainnet RPC rate-limits this prototype. This is prototype code with no backend, no new contracts and no shared keys, and the actions are demonstrated, not audited.

## Prototype commands

```sh
npm install
npm run dev
npm run dev:cli
npm run typecheck
npm run build
```

The [design spec](docs/superpowers/specs/2026-10-09-coloyond-strategy-cards-design.md) and [implementation plan](docs/superpowers/plans/2026-10-09-coloyond-managed-strategies.md) target this Kotlin app. They supersede the earlier React Native/Expo plan. The Android app does not embed the Vite app.
