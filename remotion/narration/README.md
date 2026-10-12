# Narration and captions

The committed `../public/audio/coloyond-narration.wav` is a complete 62-second PCM stem. Normal Remotion rendering requires no speech service, model download or credentials. It contains a generic natural synthetic voice (Kokoro `af_heart`), not a recorded human presenter.

`script.json` contains editorial windows and spoken pronunciation overrides. `generate.py` generates the WAV, timed TypeScript captions, SRT/VTT, readable transcript and voice checks. The music remains a separate, unmodified uploaded source; Remotion smoothly ducks it underneath speech.

Optional regeneration:

```sh
python -m pip install kokoro-onnx numpy
# Obtain kokoro-v1.0.onnx and voices-v1.0.bin from upstream:
# https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0
export COLOYOND_VOICE_MODEL=/path/to/kokoro-v1.0.onnx
export COLOYOND_VOICE_BANK=/path/to/voices-v1.0.bin
python remotion/narration/generate.py
cp remotion/narration/transcript.md docs/submission/demo-transcript.md
cp remotion/narration/captions.srt releases/coloyond-mobile-showcase.srt
cp remotion/narration/captions.vtt releases/coloyond-mobile-showcase.vtt
```

FFmpeg must be installed for pitch-preserving pacing of cues that exceed their allotted window. The model is Apache-2.0 according to upstream; review upstream voice/model terms before substituting another model. Model binaries and private credentials are not included. Regenerating narration can change phoneme timing; inspect captions and rerender/package the film afterward.
