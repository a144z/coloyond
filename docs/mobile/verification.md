# Mobile verification — 13 October 2026

- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm run test:mobile`: passed. Checked portfolios/create/wallet/system navigation, exact percentage/slider locking, asset picker, import and Android Back event, deposit, redemption, edit and wrap sheets; no page errors or horizontal page overflow at 320, 360, 430, 768 and 1440px.
- Gradle `:app:assembleDebug :app:lintDebug`: passed; native lint reported 0 errors and 8 advisory warnings. The Android 8.1 navigation-bar attribute is isolated in `values-v27`. The branding refresh subsequently passed a clean `:app:assembleDebug :app:lintDebug` build.
- APK signature verification: passed, APK Signature Scheme v2. Package `com.coloyond`, version 1.1.1, min SDK 26, target SDK 37.
- APK ZIP inspection: production SPA/assets and `https://localhost/app` startup are included; no remote server URL is configured.
- Remotion promotion upgrade: rendered a brand opening, nine feature chapters and closing call to action. Output is 1920×1080 H.264 at 30fps, approximately 62 seconds, with 48kHz stereo AAC audio. Representative detail-zoom and navigation-tap frames inspected visually. Exported audio measured −20.4 dB mean and −6.1 dB peak; no clipping.

## Deliverables

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| coloyond-android-debug.apk | 5652022 | `3dcf536009fbd5f4a2bf1324bf7b3bbd11be545d0270bbbe42ce3f84212ba234` |
| coloyond-mobile-showcase.mp4 | 15908890 | `012b2d95e5cba2877d22383b18717a096b5c59cd1f81085fd096211ac90cfeb1` |

## Limits

No physical Android device or funded wallet was attached. Wallet association/signing, a live on-chain vault creation, and end-to-end rebalance execution were not tested by this UI/packaging change. The video uses explicitly labeled presentation fixtures for portfolio balances; the production app has no fixture mode. The APK is a signed debug installation package, not a store-signed release.

## Promotional motion and sound

The device remains in a continuous position between chapters. Wallet and System transitions follow a visible tap before the screen push; camera moves magnify the relevant controls after navigation. Motion graphics include masked type reveals, allocation blocks, progress rails, touch rings and an animated 60→70% allocation lock. The original 96 BPM electronic score and timed interface sounds are reproducible with `remotion/soundtrack.py`; no external recordings are required.

## Canonical brand artwork

The uploaded `coloyond.jpg` is preserved byte-for-byte in the repository root, web public assets, Remotion assets and the Android drawable packaged into the APK. Website favicons and launcher density variants are generated from it by `scripts/mobile/brand-assets.py`; the themed launcher mask derives from the same artwork. Browser checks verify the mobile and website logo sources and favicon. The APK identifies itself as **Coloyond 1.1.1** (version code 3). The updated promotion retains its verified 48kHz stereo music track.
