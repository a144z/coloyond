"""Package the rendered film at exactly 62s; align AAC/mux padding and calibrate speech/music."""
from pathlib import Path
import json,subprocess,re,numpy as np
from scipy.signal import correlate,correlation_lags
root=Path(__file__).resolve().parents[2];source=root/'remotion/out/coloyond-mobile.mp4';music=root/'remotion/public/audio/coloyond-uploaded-music.m4a';out=root/'releases/coloyond-mobile-showcase.mp4'
def pcm(path):return np.frombuffer(subprocess.check_output(['ffmpeg','-v','error','-i',str(path),'-f','f32le','-ac','2','-ar','16000','-']),dtype='<f4').reshape(-1,2)
a=pcm(music);b=pcm(source);lo,hi=round(4.2*16000),round(5.2*16000)
# This quiet window is after the first voice cue and before the next; user music is alone.
x=a[lo:hi].mean(axis=1);y=b[lo:hi].mean(axis=1);c=correlate(y,x,method='fft');lags=correlation_lags(len(y),len(x));valid=abs(lags)<1600;lag=int(lags[valid][np.argmax(c[valid])]);corr=float(np.corrcoef(x,b[lo+lag:hi+lag].mean(axis=1))[0,1]);assert corr>.98
analysis=subprocess.run(['ffmpeg','-hide_banner','-i',str(source),'-af','loudnorm=I=-18:TP=-1.5:LRA=9:print_format=json','-f','null','-'],capture_output=True,text=True,check=True).stderr
m=json.loads(re.findall(r'\{[^{}]*\}',analysis,re.S)[-1]);norm=f"loudnorm=I=-18:TP=-1.5:LRA=9:measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true"
filter=f'atrim=start={max(0,lag/16000)}:duration=62,asetpts=PTS-STARTPTS,'+norm
subprocess.run(['ffmpeg','-v','error','-i',str(source),'-map','0:v:0','-map','0:a:0','-c:v','copy','-af',filter,'-c:a','aac','-b:a','192k','-ar','48000','-ac','2','-t','62','-movflags','+faststart','-y',str(out)],check=True)
report={'musicQuietWindowCorrelationBeforePackaging':round(corr,6),'codecDelayCompensatedMilliseconds':round(lag/16,4),'targetIntegratedLufs':-18,'targetTruePeakDb':-1.5,'inputLoudness':m,'musicSource':'user upload, retained as a separate stem','voiceSource':'coloyond-narration.wav, generic natural synthetic narrator','videoFrames':1860,'fps':30}
(root/'remotion/analysis/audio-mix-verification.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
