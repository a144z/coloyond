"""Spectral-onset / tempo-grid analysis of the user's uploaded music, no audio edits."""
from pathlib import Path
import subprocess, json, numpy as np
from scipy.signal import stft, find_peaks
ROOT=Path(__file__).parent; SR=16000; HOP=128
source=ROOT/'public/audio/coloyond-uploaded-music.m4a'
raw=subprocess.check_output(['ffmpeg','-v','error','-i',str(source),'-f','f32le','-ac','1','-ar',str(SR),'-'])
x=np.frombuffer(raw,dtype='<f4');freq,t,z=stft(x,SR,nperseg=1024,noverlap=1024-HOP,boundary=None)
mag=np.abs(z);bands={};flux={}
for name,lo,hi in [('bass',40,180),('mid',180,2000),('high',2000,7500)]:
 m=mag[(freq>=lo)&(freq<hi)]
 e=np.sqrt((m*m).mean(axis=0));bands[name]=e
 onset=np.r_[0,np.maximum(np.diff(m,axis=1),0).mean(axis=0)]
 flux[name]=onset/(np.percentile(onset,95)+1e-9)
onset=.55*flux['bass']+.3*flux['mid']+.15*flux['high']
# Fit a constant musical grid near the user's 96 BPM brief, rather than assume it.
best=(-1,None,None)
for bpm in np.arange(90,102.001,.02):
 period=60/bpm
 for phase in np.arange(0,period,.008):
  grid=np.arange(phase,len(x)/SR,period);grid=grid[(grid>2)&(grid<len(x)/SR-2)]
  score=np.mean(np.interp(grid,t,onset))
  if score>best[0]:best=(float(score),float(bpm),float(phase))
score,bpm,phase=best;period=60/bpm;beats=np.arange(phase,len(x)/SR,period)
peaks,_=find_peaks(onset,distance=int(.20*SR/HOP),prominence=.12)
frames=np.arange(1860)/30
framebands={name:np.round(np.clip(np.interp(frames,t,e)/(np.percentile(e,95)+1e-9),0,1),4).tolist() for name,e in bands.items()}
report={'source':'coloyond-uploaded-music.m4a','durationSeconds':len(x)/SR,'nominalBpm':96,'fittedBpm':round(bpm,3),'phaseSeconds':round(phase,4),'gridScore':round(score,5),'beatSeconds':np.round(beats,4).tolist(),'beatFrames':[round(v*30) for v in beats],'onsetSeconds':np.round(t[peaks],4).tolist(),'analysis':{'sampleRate':SR,'fftSamples':1024,'hopSamples':HOP,'bandsHz':{'bass':[40,180],'mid':[180,2000],'high':[2000,7500]},'method':'Positive spectral flux; constant grid fit over 90–102 BPM. Beat grid is estimated, not a guarantee that every beat has a transient.'},'envelopes':framebands}
(ROOT/'analysis/music-analysis.json').write_text(json.dumps(report,indent=2)+'\n')
(ROOT/'music.ts').write_text('export const MUSIC = '+json.dumps(report,separators=(',',':'))+' as const;\n')
print(json.dumps({k:report[k] for k in ['durationSeconds','fittedBpm','phaseSeconds','gridScore']},indent=2))
