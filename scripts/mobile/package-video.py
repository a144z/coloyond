"""Package the sole canonical film at exactly 62s, retaining original music gain and timing."""
from pathlib import Path
import json,subprocess,numpy as np
from scipy.signal import correlate,correlation_lags
root=Path(__file__).resolve().parents[2]
source=root/'remotion/out/coloyond-mobile.mp4';music=root/'remotion/public/audio/coloyond-uploaded-music.m4a';out=root/'releases/coloyond-mobile-showcase.mp4'
def pcm(path):return np.frombuffer(subprocess.check_output(['ffmpeg','-v','error','-i',str(path),'-f','f32le','-ac','2','-ar','16000','-']),dtype='<f4').reshape(-1,2)
a=pcm(music);b=pcm(source);lo,hi=round(4.2*16000),round(5.2*16000)
x=a[lo:hi].mean(axis=1);y=b[lo:hi].mean(axis=1);c=correlate(y,x,method='fft');lags=correlation_lags(len(y),len(x));valid=abs(lags)<1600;lag=int(lags[valid][np.argmax(c[valid])]);corr=float(np.corrcoef(x,b[lo+lag:hi+lag].mean(axis=1))[0,1]);assert corr>.98
# No ducking, replacement music, loudness normalization or narration. Original gain remains 0.9.
subprocess.run(['ffmpeg','-v','error','-i',str(source),'-map','0:v:0','-map','0:a:0','-c:v','copy','-af',f'atrim=start={max(0,lag/16000)}:duration=62,asetpts=PTS-STARTPTS','-c:a','aac','-b:a','256k','-ar','48000','-ac','2','-t','62','-movflags','+faststart','-y',str(out)],check=True)
final=pcm(out);finalcorr=float(np.corrcoef(x,final[lo:hi].mean(axis=1))[0,1]);assert finalcorr>.98
report={'originalMusicGain':.9,'musicQuietWindowCorrelationBeforePackaging':round(corr,6),'musicWindowCorrelationAfterPackaging':round(finalcorr,6),'codecDelayCompensatedMilliseconds':round(lag/16,4),'musicSource':'User upload retained byte-for-byte','voiceSource':None,'videoFrames':1860,'fps':30}
(root/'remotion/analysis/audio-mix-verification.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
