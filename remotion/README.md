# Mobile app showcase

50-second 1920×1080 / 30fps Remotion composition featuring captures of the actual `/app` UI, nine feature scenes, animated device framing, scene titles, allocation colors, progress markers and an ending card.

```sh
npm ci
npm run test:mobile      # captures the app and verifies the main interaction paths
npm run video:studio
npm run video:render
```

The capture script starts Vite itself. Set `CHROME_PATH` to an installed Chrome/Chromium executable. The rendering command can also receive `--browser-executable=/path/to/chrome`. Output: `remotion/out/coloyond-mobile.mp4`. Screens are checked in for reproducible renders; regenerate them after UI changes.

Portfolio balances and state in the active portfolio, detail, weight editor and wallet captures are **presentation fixtures**, injected only into the capture browser. The video labels these scenes illustrative devnet data. The script does not connect a real wallet or submit transactions. Live app source has no demo bypass.
