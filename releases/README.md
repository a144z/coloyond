# Mobile deliverables

- `coloyond-android-debug.apk`: Coloyond 1.1.1 (`com.coloyond`), Android 8/API 26+, signed debug APK. Bundles the production React `/app` build with Capacitor; no remote website URL is needed for the UI. Live network functions still require internet and Solana devnet connectivity.
- `coloyond-mobile-showcase.mp4`: 62-second, 1920×1080, 30fps H.264 promotional video with animated navigation, touch gestures, detail zooms, allocation motion graphics and an original stereo soundtrack. Portfolio/balance fixtures in the video are labeled illustrative devnet data.

Regenerate the APK with `npm run android:apk` and the video with `npm run test:mobile` followed by `npm run video:render`. Prerequisites are documented in `apps/android/README.md` and `remotion/README.md`.

APK build, lint and signature verification do not substitute for wallet association/signing tests on a physical Android device. This is a debug installation package; store distribution needs your private release signing key.
