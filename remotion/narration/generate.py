"""Generate a natural synthetic narrator and readable timed captions; retain the user's music separately.
Needs kokoro-onnx/NumPy, local model/voice files. Models are not committed.
"""
from pathlib import Path
import json,os,wave,subprocess,numpy as np
from kokoro_onnx import Kokoro
ROOT=Path(__file__).resolve().parents[1];script=json.loads((ROOT/'narration/script.json').read_text());sr=24000
k=Kokoro(os.environ['COLOYOND_VOICE_MODEL'],os.environ['COLOYOND_VOICE_BANK'])
track=np.zeros(sr*62,dtype=np.float32);captions=[];metrics=[]
for i,part in enumerate(script):
 text=part.get('spoken',part['text']);window=part['end']-part['start'];samples,sample_rate=k.create(text,voice='af_heart',speed=1.04,lang='en-us');assert sample_rate==sr
 duration=len(samples)/sr
 if duration>window:
  # Mild pitch-preserving pacing only when needed to stay within the editorial slot.
  ratio=duration/(window-.06)
  if ratio>1.3:raise RuntimeError(f'Narration {i} needs a shorter script, ratio {ratio}')
  raw=subprocess.check_output(['ffmpeg','-v','error','-f','f32le','-ar',str(sr),'-ac','1','-i','pipe:0','-af',f'atempo={ratio}', '-f','f32le','pipe:1'],input=np.asarray(samples,dtype='<f4').tobytes());samples=np.frombuffer(raw,dtype='<f4').copy();duration=len(samples)/sr
 start=round(part['start']*sr);end=start+len(samples);assert end<=round(part['end']*sr)+2
 # Very short edge fades eliminate joins without clipping words.
 fade=min(120,len(samples)//4);samples[:fade]*=np.linspace(0,1,fade);samples[-fade:]*=np.linspace(1,0,fade)
 track[start:end]=samples
 captions.append({'start':part['start'],'end':round(part['start']+duration,4),'text':part['text']})
 metrics.append({'part':i+1,'start':part['start'],'duration':round(duration,4),'words':len(part['text'].split())})
 print(i+1,round(duration,2),part['text'],flush=True)
peak=np.max(np.abs(track));track*=.85/max(peak,1e-6)
with wave.open(str(ROOT/'public/audio/coloyond-narration.wav'),'wb') as out:out.setnchannels(1);out.setsampwidth(2);out.setframerate(sr);out.writeframes((np.clip(track,-1,1)*32767).astype('<i2').tobytes())
def stamp(s,vtt=False):
 ms=round(s*1000);h=ms//3600000;m=ms//60000%60;sec=ms//1000%60;return f'{h:02}:{m:02}:{sec:02}{"." if vtt else ","}{ms%1000:03}'
(ROOT/'narration/captions.ts').write_text('export const CAPTIONS = '+json.dumps(captions,ensure_ascii=False,indent=2)+' as const;\n')
(ROOT/'narration/captions.srt').write_text('\n\n'.join(f'{i+1}\n{stamp(p["start"])} --> {stamp(p["end"])}\n{p["text"]}' for i,p in enumerate(captions))+'\n')
(ROOT/'narration/captions.vtt').write_text('WEBVTT\n\n'+'\n\n'.join(f'{stamp(p["start"],True)} --> {stamp(p["end"],True)}\n{p["text"]}' for p in captions)+'\n')
(ROOT/'narration/voice-verification.json').write_text(json.dumps({'voice':'Kokoro af_heart; generic natural synthetic narrator, not a recorded human presenter','sampleRate':sr,'durationSeconds':62,'source':'script.json','parts':metrics},indent=2)+'\n')
lines=['# Coloyond — readable demo transcript','', '62-second promotion. Generic natural synthetic narration over the user-supplied music. Rebalance segment is a fee-free illustration, not a recorded on-chain transaction.','']
for p in captions:lines += [f'**{p["start"]:.2f}–{p["end"]:.2f}s** — {p["text"]}','']
(ROOT/'narration/transcript.md').write_text('\n'.join(lines))
