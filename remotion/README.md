# Coloyond — your mix, your rhythm

62-second product film, 1920×1080, 30fps. Warm paper, precise typography and the supplied Coloyond prism/rays form the visual language. This revision replaces the screenshot chapters with one persistent, frame-controlled UI demonstration.

## What moves

- Camera pushes from the whole phone into the target-mix component at **1.58×**, holds through the interaction, then pulls back.
- Cursor drags WSOL **60 → 75 → 45 → 60%**. Handle, filled track, percentage, complementary dUSD weight and allocation strip update together. A visible click changes LOCK to LOCKED.
- Add Asset opens a bottom drawer; selecting tBTC changes the mix to **60 / 30 / 10**, preserving the locked weight.
- Review opens the allocation sheet. It explicitly requires wallet connection/signing; the film does not imply a submitted transaction.
- An explicitly illustrative 40% SOL / 20% ETH / 40% cash rebalance replaces the former holdings chapter: SOL rises 20%, ETH falls 20%, value weights drift, then selling $64 SOL and buying $48 ETH plus $16 cash restores the target mix. A visible Share Portfolio Card click opens the card sheet. Remix changes its geometry, and Share PNG presents the ready file. Three different portfolio cards show the shared generative artwork engine.
- Layout shifts across the canvas: review and rebalance move the device left and typography right. Other moves include horizontal routes, vertical sheets, card expansion, camera tracking and scrolling to controls. Camera rails now use symmetric non-overshooting easing and stationary interaction holds, replacing small scale/position reversals. The large percentage has a separate unit with a 16px gap, tabular digits and independent letter spacing.
- Text uses letter-by-letter masked rises, opposing horizontal entrances, split-line translations and directional masks. Slider-linked type tracks the gesture. Brand rays become parallel allocation bands, then re-form the prism fan for the closing title.

The portfolio card SVG/geometry imports the production renderer from `src/ui/app/lib/art/portfolio-card.ts`; the film does not invent unrelated card illustrations. The UI is a motion presentation model matching `/app` styling and controls, not a recording of live transactions. Portfolio values/status are labeled demonstrations. Capture fixtures remain available separately for app QA.

## Uploaded music and frequency analysis

The active soundtrack is **the user's uploaded recording**, preserved byte-for-byte as `public/audio/coloyond-uploaded-music.m4a`. It replaces the earlier synthesized score. The original is 62.016 seconds, stereo AAC at 48kHz. The final export is exactly **62.000 seconds**, with 1,860 video frames. Music stays as a separate stem: smooth speech ducking takes it from 0.34 to 0.16 gain and returns it between sentences; short edge fades preserve the patient ending. The mix is calibrated to −18 LUFS / −1.5 dBTP targets. Natural generic **synthetic** narration (Kokoro af_heart) is added without replacing the music; it is not a recorded human presenter. Burned captions plus external SRT/VTT and a readable transcript are included.

`analyze_music.py` decodes a mono 16kHz analysis copy and computes a 1024-sample STFT with 128-sample hops (8ms). Positive spectral flux is measured in bass **40–180Hz**, mid **180–2000Hz** and high **2000–7500Hz** bands. A weighted onset curve fits tempo and phase near the nominal 96 BPM brief. The strongest estimated grid is **99.62 BPM**, phase **0.128s**. This is a signal-derived estimate, not a claim that every percussion hit is perfectly periodic.

Primary gestures, camera arrivals and typography entrances use that estimated beat grid. Continuous gestures span multiple beats. Per-frame bass energy adds a restrained pulse to the rays; high-band energy changes the small accent diamond. The complete band envelopes, estimated beats and transient times are checked in at `analysis/music-analysis.json`; `music.ts` is the deterministic render input. The film keeps the recording's patient pace rather than adding a drop or excessive bounces.

| Beat | Approx. time | Action |
| --- | ---: | --- |
| 14 | 8.56s | Click Create portfolio |
| 20–30 | 12.17–18.20s | Drag right, left, then settle |
| 32 | 19.40s | Lock 60% |
| 36 / 41 | 21.81 / 24.82s | Open picker / select tBTC |
| 47 | 28.44s | Review |
| 54–78 | 32.65–47.11s | Persistent rebalance chapter; price shock on beats 66–70, restoration on 73–78 |
| 79 / 87 / 90 | 47.71 / 52.52 / 54.33s | Open card / remix artwork / Share PNG |
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
npm run test:video-camera
npm run video:studio
npm run video:render
npm run video:package # FFmpeg, Python, NumPy and SciPy; exact 62s distribution MP4
npm run test:video-export # duration, captions, source inventory and artifact hashes
# Optional: regenerate the checked-in analysis (FFmpeg, Python, NumPy and SciPy required)
python remotion/analyze_music.py
# Separate real-app UI verification / captures
npm run test:mobile
```

Rendering accepts `--browser-executable=/path/to/chrome`. Output: `remotion/out/coloyond-mobile.mp4`. Published artifact: `releases/coloyond-mobile-showcase.mp4`. The uploaded audio, brand image and analysis are checked in, so normal rendering does not require Python, external audio downloads or an analysis rerun.

## Detail checks in the card revision

The camera remains exactly stationary during beats 20–34, 37–44, 47–54 and 67–89. A full-frame numerical scan checks finite, bounded zoom (1–1.58×) and continuous translation; the largest translation step is 23.29px during the deliberate cross-canvas move. The device has no rotation, spring overshoot, periodic shake or sound-reactive scale. Frequency response remains in background accents only. Representative right/left drag, review, card-sheet, artwork-remix and system frames are inspected before the full export.

## Narration, source preservation and proof

`narration/script.json` is the editable spoken script; `captions.ts`, `.srt`, `.vtt` and `transcript.md` carry readable timed text. The checked-in `public/audio/coloyond-narration.wav` makes a normal render self-contained. Optional regeneration uses `narration/generate.py`, `kokoro-onnx`, FFmpeg and externally downloaded upstream model/voice banks; model binaries are not needed to render the committed film. See `narration/README.md`.

All animation comes from committed source: `index.tsx` (zoom/click/drag/typography/brand composition), `camera.ts` (steady rails), `rebalance-scene.tsx` (shared app rebalance math), `music.ts` (analyzed timing) and the checked-in assets. Root `remotion.config.ts` resolves the shared TypeScript modules. `analysis/render-inputs.json` records every render input hash, and `analysis/export-verification.json` records the final artifact checks. No generated temporary file or private model download is required for ordinary rendering.

The prior uploaded-music choreography is preserved in Git history at `a1572c6`; the portfolio-card/stability revision is `78fd81d`. This revision builds on those effects rather than replacing the movie with screenshot transitions. Price/model scenes are explicitly illustrative, fee-free and do not depict a recorded settlement. For real unsigned UI interaction proof, use `docs/submission/evidence/actual-mobile-flow.mp4`; for observed devnet settlement receipts, use the separate submission guide.
