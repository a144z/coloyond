# Mobile verification — 13 October 2026

- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm run test:mobile`: passed. Checked portfolios/create/wallet/system navigation, exact percentage/slider locking, asset picker, import and Android Back event, deposit, redemption, edit and wrap sheets; no page errors or horizontal page overflow at 320, 360, 430, 768 and 1440px.
- Gradle `:app:assembleDebug :app:lintDebug`: passed; native lint reported 0 errors and 8 advisory warnings. The Android 8.1 navigation-bar attribute is isolated in `values-v27`. The branding refresh subsequently passed a clean `:app:assembleDebug :app:lintDebug` build.
- APK signature verification: passed, APK Signature Scheme v2. Package `com.coloyond`, version 1.1.3, min SDK 26, target SDK 37.
- APK ZIP inspection: production SPA/assets and `https://localhost/app` startup are included; no remote server URL is configured.
- Remotion continuous UI revision: rendered 1860 frames with visible slider drag, lock, asset selection, review, portfolio expansion, card export/remix and System navigation. TypeScript checks passed. Thirteen representative frames inspected; click alignment and headline clipping corrected before export. Output is 1920×1080 H.264 at 30fps, approximately 62 seconds, with 48kHz stereo AAC audio. Uploaded-to-exported waveform correlation is 0.999204 after accounting for 42.31ms AAC/mux delay (less than two video frames). Peak is −1.9 dB; no clipping. Source upload is byte-identical. See `remotion/analysis/export-verification.json`.

## Deliverables

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| coloyond-android-debug.apk | 5793376 | `fb16f23b955c8c1aed35c0d73c220f27dc5badba9a6fbd38c13ef2bf98390b28` |
| coloyond-mobile-showcase.mp4 | 12600577 | `2c636f01a6e4e84d4bfbbc3b400b9890cf4876146781e4c676a553154b958010` |

## Limits

No physical Android device or funded wallet was attached. Wallet association/signing, a live on-chain vault creation, and end-to-end rebalance execution were not tested by this UI/packaging change. The video uses explicitly labeled presentation fixtures for portfolio balances; the production app has no fixture mode. The APK is a signed debug installation package, not a store-signed release.

## Promotional motion and sound

The film now animates a deterministic UI presentation rather than swapping captured screenshots. The same device/header persists; the camera zooms 1.58× into the allocation component, moves across the canvas, and pulls back for navigation and sheets. WSOL moves 60→75→45→60%, locks, then tBTC selection produces 60/30/10. Values, tracks and handles stay synchronized. Typography uses several frame-driven entrance styles, and rays morph into allocation bands. The supplied 62.016-second recording replaces the synthesized score. STFT spectral flux across bass/mid/high bands fits an estimated 99.62 BPM grid near the nominal 96 BPM brief; primary gestures use that grid and subtle geometry responds to frequency-band energy. The analysis, storyboard, research references and reproduction instructions are in `remotion/README.md`.

## Canonical brand artwork

The uploaded `coloyond.jpg` is preserved byte-for-byte in the repository root, web public assets, Remotion assets and the Android drawable packaged into the APK. Website favicons and launcher density variants are generated from it by `scripts/mobile/brand-assets.py`; the themed launcher mask derives from the same artwork. Browser checks verify the mobile and website logo sources and favicon. The APK identifies itself as **Coloyond 1.1.3** (version code 5). The updated promotion uses the supplied music, verified as 48kHz stereo AAC in the exported film.

## Portfolio card and stability revision

Production PNG generation, download signature/dimensions, deterministic artwork, vault/weight/remix differentiation, escaped names, address/balance omission, file-share handoff and new-tab remix-draft loading passed the browser suite. Web Share handoff is mocked; actual Android/iOS OS chooser behavior was not physically tested. Existing mobile checks passed at 320–1440px. Android 1.1.3 assembled and passed lint (0 errors, 8 advisory warnings); its signed APK includes Filesystem and Share plugins, current bundled `/app` assets, and no broad storage permission. Native PNGs use cache files and the Android chooser. Public web remix links on Android require the documented deployment origin; no localhost link is sent.

`npm run test:video-camera` passes all stationary holds and the bounded-motion scan (maximum 24.35px/frame during a deliberate cross-canvas move). There is no device rotation, spring overshoot or audio-driven device scale. Percentage digits and the unit now have a 16px gap and separate typography. The new 62-second render shows share-card preview, artwork remix, PNG handoff and three example portfolio compositions using the production artwork engine.

A final incremental Android rebuild hit duplicate generated resource classes. Clean assembly (`:app:clean :app:assembleDebug`, as used by `npm run android:apk`) and `:app:lintDebug` passed, and the final APK signature and bundled card-sheet copy were rechecked.

## Submission proof implementation iteration

`npm run test:proof`: 16 tests passed (exact weights, signing/reconciliation, account decoder and rebalance model). Root typecheck, production mobile checks, actual unsigned browser recording and clean Android assembly/lint passed. Source oracle hardening passed four Rust host tests. It has not been deployed; see `docs/submission/code-review.md`. The final APK includes pending-signature recovery, the price-shock explorer, precise fractional editor behavior and the current proof-linked landing page.
