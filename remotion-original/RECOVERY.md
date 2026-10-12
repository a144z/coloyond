# Exact original recovery

Source: commit `a1572c6`. Every original `remotion/` file was restored byte-for-byte under this directory; `recovery.json` records hashes. The full original repository snapshot is also published as branch `promo-original-17mb` and tag `promo-continuous-music-v1`.

```sh
npm ci
npm run video:studio
npm run video:render
```

Default commands use this directory's entry point and public assets. Rendering writes `remotion-original/out/coloyond-mobile.mp4`. The exact historical export is `releases/coloyond-original-17mb.mp4`, also restored as `releases/coloyond-mobile-showcase.mp4`: 18,053,642 bytes (17.2 MiB), H.264 1080p/30fps, 1,860 frames, stereo uploaded music. Its 62-second video timeline has original AAC/container padding to 62.058667 seconds. No re-encoding or artificial padding was used to match the file size.

`README.md` in this folder is the historical guide, preserved unchanged; its old `remotion/` paths refer to this directory in the recovered main-branch layout. The original movie has background music and no voiceover. Newer narrated/rebalance source remains separately in `remotion/` and at tag `promo-narrated-rebalance-v3`.
