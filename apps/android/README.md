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
