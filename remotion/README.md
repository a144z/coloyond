# Coloyond motion promotion

62-second 1920×1080 / 30fps Remotion promotion. The warm portfolio-desk design is carried through the graphics, typography and sound.

## Editorial motion

- Three-second brand opening with individually choreographed allocation blocks.
- Nine feature chapters with staggered masked type, animated progress rails and feature callouts.
- A continuous device position between chapters, horizontal screen pushes and vertical sheet entrances.
- Eased camera moves and screen magnification focused on the relevant controls.
- Touch dots, expanding tap rings, animated bottom navigation and a live allocation graphic that moves 60→70% before locking.
- Five-second animated brand ending and a Web + Android call to action.

## Sound

`public/audio/coloyond-original-score.wav` is an original 62-second stereo electronic score, synthesized by `soundtrack.py`: 96 BPM, warm four-chord pads, plucked melody, a restrained bass/percussion bed, stereo echoes, and editorial swishes/touch sounds synchronized to chapter and gesture frames. There are no licensed third-party recordings or external music dependencies. Music fades at the opening and ending; no voiceover is included.

## Reproduce

```sh
npm ci
npm run test:mobile
python remotion/soundtrack.py    # optional: regenerate the score; needs numpy
npm run video:studio
npm run video:render
```

The capture script starts Vite. Install Playwright Chromium or set `CHROME_PATH` to your local Chrome executable. Rendering also accepts `--browser-executable=/path/to/chrome`.

Output: `remotion/out/coloyond-mobile.mp4`. The deliverable is checked in at `releases/coloyond-mobile-showcase.mp4`. UI captures and original soundtrack are checked in so the render is reproducible.

The footage uses actual `/app` captures. Active portfolio/detail/edit/wallet balances are explicitly labeled **illustrative devnet data**, injected only into the capture browser. The animated allocation inset is explanatory motion graphics. Neither the capture workflow nor video signs or submits transactions; the live application has no fixture bypass.
