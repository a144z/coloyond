# Mobile verification — 13 October 2026

- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm run test:mobile`: passed. Checked portfolios/create/wallet/system navigation, exact percentage/slider locking, asset picker, import and Android Back event, deposit, redemption, edit and wrap sheets; no page errors or horizontal page overflow at 320, 360, 430, 768 and 1440px.
- Gradle `:app:assembleDebug :app:lintDebug`: passed; native lint reported 0 errors and 8 advisory warnings. The Android 8.1 navigation-bar attribute is isolated in `values-v27`. The branding refresh subsequently passed a clean `:app:assembleDebug :app:lintDebug` build.
- APK signature verification: passed, APK Signature Scheme v2. Package `com.coloyond`, version 1.1.1, min SDK 26, target SDK 37.
- APK ZIP inspection: production SPA/assets and `https://localhost/app` startup are included; no remote server URL is configured.
- Remotion continuous UI revision: rendered 1860 frames with visible slider drag, lock, asset selection, review, portfolio expansion, Wallet/Wrap and System navigation. TypeScript checks passed. Ten representative frames inspected; click alignment and headline clipping corrected before export. Output is 1920×1080 H.264 at 30fps, approximately 62 seconds, with 48kHz stereo AAC audio. Uploaded-to-exported waveform correlation is 0.999204 after accounting for 42.31ms AAC/mux delay (less than two video frames). Peak is −1.9 dB; no clipping. Source upload is byte-identical. See `remotion/analysis/export-verification.json`.

## Deliverables

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| coloyond-android-debug.apk | 5652022 | `3dcf536009fbd5f4a2bf1324bf7b3bbd11be545d0270bbbe42ce3f84212ba234` |
| coloyond-mobile-showcase.mp4 | 18053642 | `68008ead47005ed45313d30c82109f15f7f0558c7d59cb9928d3cdb92705bf53` |

## Limits

No physical Android device or funded wallet was attached. Wallet association/signing, a live on-chain vault creation, and end-to-end rebalance execution were not tested by this UI/packaging change. The video uses explicitly labeled presentation fixtures for portfolio balances; the production app has no fixture mode. The APK is a signed debug installation package, not a store-signed release.

## Promotional motion and sound

The film now animates a deterministic UI presentation rather than swapping captured screenshots. The same device/header persists; the camera zooms 1.58× into the allocation component, moves across the canvas, and pulls back for navigation and sheets. WSOL moves 60→75→45→60%, locks, then tBTC selection produces 60/30/10. Values, tracks and handles stay synchronized. Typography uses several frame-driven entrance styles, and rays morph into allocation bands. The supplied 62.016-second recording replaces the synthesized score. STFT spectral flux across bass/mid/high bands fits an estimated 99.62 BPM grid near the nominal 96 BPM brief; primary gestures use that grid and subtle geometry responds to frequency-band energy. The analysis, storyboard, research references and reproduction instructions are in `remotion/README.md`.

## Canonical brand artwork

The uploaded `coloyond.jpg` is preserved byte-for-byte in the repository root, web public assets, Remotion assets and the Android drawable packaged into the APK. Website favicons and launcher density variants are generated from it by `scripts/mobile/brand-assets.py`; the themed launcher mask derives from the same artwork. Browser checks verify the mobile and website logo sources and favicon. The APK identifies itself as **Coloyond 1.1.1** (version code 3). The updated promotion uses the supplied music, verified as 48kHz stereo AAC in the exported film.
