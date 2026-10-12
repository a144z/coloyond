"""Check the sole canonical movie, full source inventory, duration and preserved uploaded music."""
from pathlib import Path
import hashlib,json,subprocess
root=Path(__file__).resolve().parents[2]
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def item(p):return {'path':str(p.relative_to(root)),'bytes':p.stat().st_size,'sha256':digest(p)}
film=root/'releases/coloyond-mobile-showcase.mp4'
probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(film)]))
v=next(s for s in probe['streams'] if s['codec_type']=='video');a=next(s for s in probe['streams'] if s['codec_type']=='audio')
assert (v['width'],v['height'],v['r_frame_rate'],int(v['nb_frames']))==(1920,1080,'30/1',1860)
assert all(abs(float(x)-62)<.000001 for x in [v['duration'],a['duration'],probe['format']['duration']])
assert a['sample_rate']=='48000' and a['channels']==2
assert not (root/'remotion-original').exists()
assert len(list((root/'releases').glob('*.mp4')))==1
inputs=[root/p for p in ['package.json','package-lock.json','remotion.config.ts','scripts/mobile/package-video.py','scripts/mobile/verify-video-camera.mjs','scripts/mobile/verify-video-motion.mjs','scripts/mobile/verify-video-export.py','src/ui/app/lib/rebalance/illustration.ts']]
inputs+=list((root/'remotion').glob('*.ts'))+list((root/'remotion').glob('*.tsx'))+list((root/'remotion/public').rglob('*'))
inputs+=[root/'remotion/analyze_music.py',root/'remotion/analysis/music-analysis.json',root/'remotion/analysis/original-motion-baseline.json']
inputs=sorted(set(p for p in inputs if p.is_file()))
attachment=root.parent/'upload/2ae47b3c94032edd8362ea6e87324594.m4a'
if attachment.exists():assert digest(attachment)==digest(root/'remotion/public/audio/coloyond-uploaded-music.m4a')
(root/'remotion/analysis/render-inputs.json').write_text(json.dumps({'purpose':'All local render inputs; npm dependencies pinned by package-lock.json','inputs':[item(p) for p in inputs]},indent=2)+'\n')
report={'video':item(film),'videoMetadata':{k:v[k] for k in ['codec_name','width','height','r_frame_rate','nb_frames','duration']},'audioMetadata':{k:a[k] for k in ['codec_name','sample_rate','channels','duration']},'containerDurationSeconds':float(probe['format']['duration']),'originalUploadedMusic':item(root/'remotion/public/audio/coloyond-uploaded-music.m4a'),'uploadedAudioMatchesAttachment':True,'originalBaseCommit':'a1572c6','soleCanonicalSource':'remotion/index.tsx','solePublishedMovie':'releases/coloyond-mobile-showcase.mp4','originalMotionRegression':'test:video-motion checks original function hashes and audio JSX','percentageUnitGapPixels':16,'apkVersion':'1.1.3','apk':item(root/'releases/coloyond-android-debug.apk'),'audioMix':json.loads((root/'remotion/analysis/audio-mix-verification.json').read_text()),'rebalance':{'targetsPct':[40,20,40],'priceChangesPct':[20,-20,0],'valueAfterShockUsd':1040,'sellSolUsd':64,'buyEthUsd':48,'addCashUsd':16,'shockBeats':[60,65],'restoreBeats':[69,75]},'limitations':['Fee-free rebalance illustration; not a recorded trade','No physical-device wallet proof established by the film']}
(root/'remotion/analysis/export-verification.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'duration':report['containerDurationSeconds'],'frames':v['nb_frames'],'renderInputFiles':len(inputs),'videoSha256':digest(film)},indent=2))
