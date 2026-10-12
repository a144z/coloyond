# Coloyond — your mix, your rhythm

One canonical 62-second product film, 1920×1080, 30fps. Warm paper, precise typography and the supplied Coloyond prism/rays form the visual language. This revision replaces the screenshot chapters with one persistent, frame-controlled UI demonstration.

## What moves

- Camera pushes from the whole phone into the target-mix component at **1.58×**, holds through the interaction, then pulls back.
- Cursor drags WSOL **60 → 75 → 45 → 60%**. Handle, filled track, percentage, complementary dUSD weight and allocation strip update together. A visible click changes LOCK to LOCKED.
- Add Asset opens a bottom drawer; selecting tBTC changes the mix to **60 / 30 / 10**, preserving the locked weight.
- Review opens the allocation sheet. It explicitly requires wallet connection/signing; the film does not imply a submitted transaction.
- The original portfolio expansion, wallet route, wrap-sheet click and System navigation remain. During beats 56–81, the phone is held on the left while a new right-side example shows 40% SOL / 20% ETH / 40% cash, SOL +20% / ETH −20%, value drift, trade flows and restored target weights.
- Layout shifts across the canvas: review and system move the device left and typography right. Other moves include horizontal routes, vertical sheets, card expansion, camera tracking and scrolling to controls.
- Text uses letter-by-letter masked rises, opposing horizontal entrances, split-line translations and directional masks. Slider-linked type tracks the gesture. Brand rays become parallel allocation bands, then re-form the prism fan for the closing title.

The UI is a motion presentation model matching `/app` styling and controls, not a recording of live transactions. Portfolio values/status are labeled demonstrations. Capture fixtures remain available separately for app QA.

## Uploaded music and frequency analysis

The active soundtrack is **the user's uploaded recording**, preserved byte-for-byte as `public/audio/coloyond-uploaded-music.m4a`. It replaces the earlier synthesized score. The original is 62.016 seconds, stereo AAC at 48kHz. The film retains **0.9 gain**, the original edge fades, and no voiceover or additional soundtrack. Packaging compensates measured codec delay and trims the stereo stream so the final video, audio and container are all exactly **62.000 seconds**. No ducking or loudness normalization is applied.

`analyze_music.py` decodes a mono 16kHz analysis copy and computes a 1024-sample STFT with 128-sample hops (8ms). Positive spectral flux is measured in bass **40–180Hz**, mid **180–2000Hz** and high **2000–7500Hz** bands. A weighted onset curve fits tempo and phase near the nominal 96 BPM brief. The strongest estimated grid is **99.62 BPM**, phase **0.128s**. This is a signal-derived estimate, not a claim that every percussion hit is perfectly periodic.

Primary gestures, camera arrivals and typography entrances use that estimated beat grid. Continuous gestures span multiple beats. Per-frame bass energy adds a restrained pulse to the rays; high-band energy changes the small accent diamond. The complete band envelopes, estimated beats and transient times are checked in at `analysis/music-analysis.json`; `music.ts` is the deterministic render input. The film keeps the recording's patient pace rather than adding a drop or excessive bounces.

| Beat | Approx. time | Action |
| --- | ---: | --- |
| 14 | 8.56s | Click Create portfolio |
| 20–30 | 12.17–18.20s | Drag right, left, then settle |
| 32 | 19.40s | Lock 60% |
| 36 / 41 | 21.81 / 24.82s | Open picker / select tBTC |
| 47 | 28.44s | Review |
| 60 | 36.27s | Open existing portfolio |
| 68 / 74 | 41.08 / 44.70s | Wallet / Wrap SOL |
| 82 | 49.52s | System |
| 91–102 | 54.94–61.56s | Prism and closing title |

## Research and chosen skills

Reviewed primary studio process and product-film case studies, then applied the principles to Coloyond rather than copying their artwork:

- [Ordinary Folk's process](https://www.ordinaryfolk.co/process): message/storyboard first, personality through movement, and audio considered from the beginning. Applied through an action-and-response storyboard, restrained easing and audio-timed gestures.
- [Webflow: A New Era of No-Code](https://www.ordinaryfolk.co/project/webflow-a-new-era-of-no-code): a product film developed from an established visual language. Applied through Coloyond's own four rays and allocation colors.
- [Introducing Spline](https://www.ordinaryfolk.co/project/introducing-spline): a product-led brand piece with published styleframes and separate design, animation and sound credits. Applied through explicit visual planning and separate audio analysis.
- [Motion shared-layout guidance](https://motion.dev/docs/react-layout-animations): continuous transforms and shared identity informed the persistent device/header and card expansion.
- [Official Remotion skills](https://www.remotion.dev/docs/ai/skills), source [remotion-dev/skills](https://github.com/remotion-dev/skills): reviewed best-practices, create, markup/timing/layout/audio, studio and render. These are upstream-maintained skills, not an invented popularity ranking.
- [Remotion animation guidance](https://www.remotion.dev/docs/animating-properties) and [audio frequency guidance](https://www.remotion.dev/docs/visualize-audio): every animation derives from `useCurrentFrame`, including the spectrum response. No real-time CSS/Framer Motion timers are used in the exporter; the motion style remains reproducible frame by frame.

## Reproduce

```sh
npm ci
npm run video:studio
npm run video:render
npm run video:package # FFmpeg + Python, NumPy, SciPy
npm run test:video-camera
npm run test:video-motion
npm run test:video-export
# Optional: regenerate the checked-in analysis (FFmpeg, Python, NumPy and SciPy required)
python remotion/analyze_music.py
# Separate real-app UI verification / captures
npm run test:mobile
```

Rendering accepts `--browser-executable=/path/to/chrome`. Output: `remotion/out/coloyond-mobile.mp4`. Published artifact: `releases/coloyond-mobile-showcase.mp4`. The uploaded audio, brand image and analysis are checked in, so normal rendering does not require Python, external audio downloads or an analysis rerun.

## Right-side counterbalance choreography

The original `a1572c6` film is the source baseline. Thirteen UI/motion functions and its exact Audio JSX are hash-checked by `test:video-motion`: Home, Mix, Active, Wallet, System, sheets, cursor, geometry, brand, buttons, title, tag and allocation strip. Music timing data is unchanged. The first 33 seconds retain the original scene sequence; the phone's later camera rail stays on the left to create room for the new right-side chapter. The percentage unit now has a 16px gap.

| Beat | Action |
| --- | --- |
| 56–58 | Split-line headline, colored rule and example enter on the right |
| 58–60 | SOL/ETH price charts slide into place; 40/20/40 target mix |
| 60–65 | SOL rises 20%, ETH falls 20%; value bar drifts to 46.15/15.38/38.46 |
| 65–69 | Hold drift, reveal sell/buy cards and directional trade paths |
| 69–75 | Sell $64 SOL; buy $48 ETH and add $16 cash; bar and amounts return to targets |
| 75–79.5 | Hold restored 40/20/40 value weights at $416/$208/$416 |
| 79.5–81 | Exit smoothly into original System chapter and closing prism |

The complete 100%-allocated example starts at $1,000 and grows to $1,040 after those price changes. `rebalance-scene.tsx` imports the same deterministic model as the app's explorer. It is fee-free and clearly labeled **not a recorded trade**. ETH denotes synthetic devnet tETH. The phone's existing portfolio walkthrough is a separate presentation example.

There is one active renderer and one published film. Previous versions are recoverable only through Git history/tags. `analysis/render-inputs.json` inventories all required render inputs, and `analysis/export-verification.json` records exact duration, stream details, artifact hashes and post-packaging music correlation. The normal render uses only committed assets and npm dependencies; no temporary file, narration model, remote asset or credential is required.
