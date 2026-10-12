"""Original 96 BPM ambient electronic score + synchronized interface sound design."""
from pathlib import Path
import numpy as np
import wave
SR=48000; DURATION=62; BEAT=60/96
rng=np.random.default_rng(819)
out=np.zeros((SR*DURATION,2),dtype=np.float64)
def note(n): return 440*2**((n-69)/12)
def put(signal,start,pan=0):
    offset=int(start*SR); count=min(len(signal),len(out)-offset)
    if count<=0:return
    signal=signal[:count]
    out[offset:offset+count,0]+=signal*np.sqrt((1-pan)/2)
    out[offset:offset+count,1]+=signal*np.sqrt((1+pan)/2)
def tone(freq,length,kind='pad'):
    t=np.arange(int(SR*length))/SR
    if kind=='pad':
        env=np.minimum(t/0.8,1)*np.minimum((length-t)/1.6,1)
        return env*(np.sin(2*np.pi*freq*t)+.32*np.sin(2*np.pi*freq*1.003*t)+.12*np.sin(2*np.pi*freq*2*t))*.018
    env=(1-np.exp(-t*70))*np.exp(-t*4.2)
    return env*(np.sin(2*np.pi*freq*t)+.2*np.sin(2*np.pi*freq*2*t)+.06*np.sin(2*np.pi*freq*3*t))*.075
# Am9, Fmaj7, Cmaj9, Gsus: a restrained, warm four-chord bed.
chords=[[45,57,60,64,71],[41,53,57,60,64],[48,60,64,67,74],[43,55,60,62,67]]
for bar in range(25):
    start=bar*4*BEAT; chord=chords[bar%4]
    for i,n in enumerate(chord[1:]):put(tone(note(n),4*BEAT+.7),start,[-.45,.3,-.2,.5][i])
    for beat in [0,2]:
        t=np.arange(int(SR*.55))/SR
        bass=np.sin(2*np.pi*note(chord[0])*t)*(1-np.exp(-t*70))*np.exp(-t*5)*.10
        put(bass,start+beat*BEAT)
    for step in [0,1.5,2.5,3.5]:
        n=chord[1+int(step)%4]+12
        put(tone(note(n),.8,'pluck'),start+step*BEAT,(-.3 if int(step)%2 else .3))
    if start>3 and start<57:
        for beat in [0,2]:
            t=np.arange(int(SR*.2))/SR
            kick=np.sin(2*np.pi*(45*t+50*.018*(1-np.exp(-t/.018))))*np.exp(-t*28)*.095
            put(kick,start+beat*BEAT)
        for step in np.arange(.5,4,.5):
            t=np.arange(int(SR*.055))/SR;noise=rng.normal(0,1,len(t));noise=np.concatenate(([0],np.diff(noise)))
            put(noise*np.exp(-t*95)*.012,start+step*BEAT,.25)
# Bespoke editorial swishes and touch ticks, aligned to composition keyframes.
for scene in range(9):
    start=3+scene*6
    t=np.arange(int(SR*.32))/SR;noise=rng.normal(0,1,len(t))
    smooth=np.convolve(noise,np.ones(9)/9,mode='same')
    put(smooth*np.sin(np.pi*t/.32)**2*.045,start,-.2)
    for delay in [2.8,4.7]:
        t=np.arange(int(SR*.10))/SR
        tick=(np.sin(2*np.pi*1100*t)+.25*np.sin(2*np.pi*1650*t))*np.exp(-t*65)*.035
        put(tick,start+delay,.1)
# Gentle stereo echo, soft saturation, and a polished entrance/exit envelope.
for delay,gain in [(.1875,.12),(.375,.075)]:
    shift=int(SR*delay);out[shift:]+=out[:-shift,::-1]*gain
out=np.tanh(out*1.4)
env=np.minimum(np.arange(len(out))/SR/1.8,1)*np.minimum((DURATION-np.arange(len(out))/SR)/2.8,1)
out*=env[:,None]
peak=np.max(np.abs(out));out*=.62/max(peak,1e-9)
path=Path(__file__).parent/'public/audio/coloyond-original-score.wav'
with wave.open(str(path),'wb') as f:
    f.setnchannels(2);f.setsampwidth(2);f.setframerate(SR);f.writeframes((out*32767).astype('<i2').tobytes())
print(f'Original stereo score: {path}, {DURATION}s, 48kHz; peak {np.max(np.abs(out)):.3f}')
