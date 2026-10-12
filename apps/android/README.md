# Coloyond Android — packaged mobile portfolio desk

The installable app now opens the same React mobile product as the website's `/app` route. Capacitor serves the bundled Vite assets locally at `https://localhost/app`; network requests are used for Solana RPC and market data. There is no remote website dependency for the UI.

The previous Kotlin/Compose prototype remains under `app/src/legacy/java` for reference. The shipped source set is `app/src/capacitor/java`; it uses Capacitor `BridgeActivity` and the App/StatusBar plugins. Previous native unit tests belong to the prototype and are excluded from this product build.

## Build

Install JDK **21** (required by Capacitor 8), Android SDK Platform 37.0 and Build Tools 36.0.0. Export `JAVA_HOME` and `ANDROID_HOME` for your installations. The committed wrapper uses Gradle 9.7.1 and AGP 9.3.2.

From the repository root:

```sh
npm ci
npm run typecheck
npm run android:apk
```

`android:apk` builds the web app, syncs Capacitor and assembles the signed debug APK:

`apps/android/app/build/outputs/apk/debug/app-debug.apk`

For native lint:

```sh
cd apps/android
./gradlew :app:lintDebug --console=plain
```

Install on Android 8/API 26 or newer:

```sh
adb install -r apps/android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.coloyond/.MainActivity
```

The debug APK is installable and automatically signed with the builder's debug key. Store distribution requires a private release signing configuration; keys are never committed.

## Mobile behavior

- `/app` starts with portfolios and supports create, wallet, system, vault detail and all transaction sheets.
- Hardware Back pops the app's screen stack; at root it exits the app.
- Status and navigation surfaces follow the warm paper theme.
- Wallet connection uses the existing Solana Mobile Wallet Adapter and requires a compatible installed wallet. Device-wallet setup/import is the same devnet-only flow as the web app.
- Token transactions, automation and prices use the existing implementation. This packaging change does not establish a new on-chain deployment.
- Browser interaction checks are available as `npm run test:mobile` after `npx playwright install chromium`, or with `CHROME_PATH` set to a local Chrome executable.

Real-device wallet association, transaction signing and end-to-end rebalance execution need a funded devnet wallet and are separate from build verification.

## Brand assets

The supplied root `coloyond.jpg` is the canonical artwork for the launcher, web header, favicon, wallet identity and video. Run `python scripts/mobile/brand-assets.py` from the repository root (Pillow required) to regenerate the technical icon sizes. The native full-color drawable preserves the original image; the Android themed icon uses a monochrome mask derived from it.
