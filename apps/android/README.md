# coloyond Android scaffold

Native Kotlin + Jetpack Compose starter generated with Solana Mobile's `kotlin-compose-minimal` template. The app contains a Mobile Wallet Adapter demo for connecting, signing a message, and disconnecting on **devnet**. It does not implement the strategy cards, vault integration, Jupiter swaps, or rebalancing features yet.

The application ID is `com.coloyond`. Open this directory (`apps/android`) as the project in Android Studio.

## Toolchain

- JDK 17, selected by `gradle/gradle-daemon-jvm.properties`.
- Android SDK Platform 37, Build Tools 36.0.0, and Platform Tools (`adb`). Install them through Android Studio's SDK Manager.
- Gradle 9.7.1 via the committed wrapper, Android Gradle Plugin 9.3.2, Kotlin/Compose compiler 2.4.10, Compose BOM 2026.08.00.
- Android 8.0/API 26 or newer to run the APK.
- Network access for the first Gradle/dependency/SDK download. Node/npm is only needed for the optional scaffold/doctor commands, not for Gradle builds.

The Java 17 daemon setting follows the sibling `neonmemoir-android` setup and the [AGP 9.3 compatibility requirements](https://developer.android.com/build/releases/agp-9-3-0-release-notes). Do not replace the wrapper or independently upgrade the pinned versions to solve an environment issue.

## Build a debug APK

From the repository root on Linux/WSL, with the SDK in its standard location:

```sh
cd apps/android
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export ANDROID_HOME="$HOME/Android/Sdk"
./gradlew :app:assembleDebug --console=plain
```

If these SDK packages are missing and command-line tools are already installed, install the exact packages with:

```sh
"$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" "platforms;android-37.0" "build-tools;36.0.0" "platform-tools"
```

Set `JAVA_HOME` to your actual JDK 17 installation if it differs. On macOS the usual setup is `export JAVA_HOME="$(/usr/libexec/java_home -v 17)"` and `export ANDROID_HOME="$HOME/Library/Android/sdk"`. Windows users can open the project in Android Studio or use `gradlew.bat` with their JDK/SDK paths configured.

Alternatively, create a local `apps/android/local.properties` containing `sdk.dir=/absolute/path/to/Android/sdk`. That file is gitignored. Keep machine-specific SDK paths out of committed Gradle files. If `ANDROID_SDK_ROOT` is also set, it must refer to the same SDK as `ANDROID_HOME`.

The debug APK is written to:

```text
apps/android/app/build/outputs/apk/debug/app-debug.apk
```

It is automatically signed with your local debug key. Build output and signing keys are ignored by Git. A publishing-ready signed release is not configured in this scaffold.

## Checks

From `apps/android`, using the same environment:

```sh
./gradlew :app:testDebugUnitTest :app:lintDebug --console=plain
```

The generated unit test is a template sanity check, not proof of wallet or product behavior. Instrumented tests require a connected Android device/emulator:

```sh
./gradlew :app:connectedDebugAndroidTest --console=plain
```

## Install and run

Start an emulator or connect a phone with USB debugging enabled, then run from `apps/android`:

```sh
adb devices
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.coloyond/.MainActivity
```

With multiple devices, add `-s DEVICE_SERIAL` after `adb`. For Android Studio, select a device and run the `app` configuration.

Install a Mobile Wallet Adapter-compatible wallet, such as Solflare, to exercise the wallet demo. Keep it on devnet. Message signing does not require a funded account. The template's `https://yourdapp.com` connection identity is a placeholder in `MainViewModel.kt`; replace its website and icon with verified app-owned metadata before treating wallet identity verification as complete. The current project has no verified identity host or device/wallet smoke-test result.

## Scaffold provenance

The generator was run on 9 October 2026:

```sh
npx solana-mobile@latest doctor
npx solana-mobile@latest create coloyond -t kotlin-compose-minimal --skip-git
```

The generated project was staged under `scratchpad/kotlin-scaffold/coloyond`, then moved here for version control. Generator-installed agent metadata is local tooling and excluded from the app source commit.

## Verified build

On 9 October 2026, Linux/WSL with JDK 17 completed:

```sh
./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug --console=plain
```

The debug APK was produced, the single generated unit test passed, and lint completed successfully. APK inspection confirmed `com.coloyond`, minimum SDK 26, target SDK 37, and the `MainActivity` launcher. No device was connected, so APK installation, instrumented tests, and real wallet interactions were not exercised.

## Base infra — Solana Mobile hackathon ruleset pass

The app now carries the base library the demo path will stand on. Each piece cites its ruleset number; the description file lives outside the repo on the author's desktop.

- `di/AppContainer.kt` + `ColoyondApplication.kt` — one hand-wired composition root, no DI framework (10, 23).
- `config/AppConfig.kt` — dedicated RPC endpoint placeholder, wallet `ConnectionIdentity`, connect/read timeouts, 3-attempt 1s→8s backoff (16, 17, 35).
- `core/rpc/` — `RpcTransport` seam, `HttpRpcTransport` (`HttpURLConnection`, no new dependency), `SolanaRpc` (getBalance + signature status verification), `withRetry`/`RetryPolicy` (17, 21).
- `core/storage/` — `PrefsStore` (mock-mode flag; keys live with the wallet/Keystore, never in plaintext prefs) and `PendingIntentStore` (intent saved before sending, checked on Activity reload) (19, 21).
- `wallet/` — `WalletState` lifecycle; `WalletGateway` seam (20); `MwaWalletGateway` for the Intent-based MWA→Phantom path (33, 35); `MockWalletGateway` for the no-wallet fallback (37, 43); `WalletRepository` enforces connect and sign as separate taps, never fails silently, and verifies transaction signatures on-chain (36, 21, 41).
- "Sign transaction" builds a devnet Memo-program transaction with a fresh blockhash and asks the wallet to sign and send it. The connected account needs devnet SOL for the fee. The app then polls `getSignatureStatuses` for about 10 seconds.
- Manifest — `INTERNET` permission (11), `allowBackup=false` (13), `networkSecurityConfig` that permits cleartext only to `localhost`/`127.0.0.1` for the MWA local association (12), `launchMode="singleTop"` (15), and `android:name=".ColoyondApplication"`.
- Gradle — JitPack repository in `settings.gradle.kts` (4); AndroidX/Jetifier lines in `gradle.properties` (5, no-ops on AGP 9, kept for the checklist).
- `proguard-rules.pro` — Solana-only keep/dontwarn rules; deliberately no Web3j or BouncyCastle (14, 40).

Deliberate omissions: no `rpc-core` dependency (its pinned version tracks the older clientlib line; the in-repo transport satisfies rule 17 — ruleset 10 wins), no BouncyCastle force (no Etheream-side stack, rule 40), and `compileSdk`/`targetSdk` stay on 37 because the AGP 9.3 scaffold build above already verified them (rule 2 permits 35+ once every dependency is confirmed).

Demo path (41): Connect Wallet against the Mock MWA Wallet (lock-screen PIN set) or real Phantom, then Sign Message, then Sign Transaction. If the device wallet misbehaves on-site, the Demo Mode toggle (43) fakes wallet calls with preset results. The `yourdapp.com` identity host (35) is still a placeholder and must become app-owned metadata before wallet identity verification counts.
