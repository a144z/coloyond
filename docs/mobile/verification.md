# Mobile verification — 13 October 2026

- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm run test:mobile`: passed. Checked portfolios/create/wallet/system navigation, exact percentage/slider locking, asset picker, import and Android Back event, deposit, redemption, edit and wrap sheets; no page errors or horizontal page overflow at 320, 360, 430, 768 and 1440px.
- Gradle `:app:assembleDebug :app:lintDebug`: passed; native lint reported 0 errors and 2 advisory warnings. The Android 8.1 navigation-bar attribute is isolated in `values-v27`. Unused launcher overrides were then removed and a final clean `:app:assembleDebug` passed.
- APK signature verification: passed, APK Signature Scheme v2. Package `com.coloyond`, version 1.1.0, min SDK 26, target SDK 37.
- APK ZIP inspection: production SPA/assets and `https://localhost/app` startup are included; no remote server URL is configured.
- Remotion: rendered nine feature scenes plus ending card. Output is 1920×1080 H.264 at 30fps, approximately 50 seconds. Representative frames inspected visually.

## Deliverables

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| coloyond-android-debug.apk | 5130090 | `1e8a9701b76d5da71a64f24e980cd89e7d6e80390f21d74310773688187ccc4a` |
| coloyond-mobile-showcase.mp4 | 13581308 | `313a9cab66a4797cef75c770f224952605e5539320b2d1a00c0641581cb48c77` |

## Limits

No physical Android device or funded wallet was attached. Wallet association/signing, a live on-chain vault creation, and end-to-end rebalance execution were not tested by this UI/packaging change. The video uses explicitly labeled presentation fixtures for portfolio balances; the production app has no fixture mode. The APK is a signed debug installation package, not a store-signed release.
