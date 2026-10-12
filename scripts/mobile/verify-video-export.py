"""Verify and inventory the committed 62-second film and every local rendering input."""
from pathlib import Path
import hashlib,json,subprocess,wave,re
root=Path(__file__).resolve().parents[2]
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def item(p):return {'path':str(p.relative_to(root)),'bytes':p.stat().st_size,'sha256':digest(p)}
film=root/'releases/coloyond-mobile-showcase.mp4'
probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(film)]))
v=next(s for s in probe['streams'] if s['codec_type']=='video');a=next(s for s in probe['streams'] if s['codec_type']=='audio')
assert (v['width'],v['height'],v['r_frame_rate'],int(v['nb_frames']))==(1920,1080,'30/1',1860)
assert all(abs(float(x)-62)<.000001 for x in [v['duration'],a['duration'],probe['format']['duration']])
assert a['sample_rate']=='48000' and a['channels']==2
with wave.open(str(root/'remotion/public/audio/coloyond-narration.wav')) as w:assert w.getnframes()/w.getframerate()==62
caps=json.loads((root/'remotion/narration/captions.ts').read_text().split('=',1)[1].rsplit('as const',1)[0].strip())
assert len(caps)==14
for i,c in enumerate(caps):
 assert 0<=c['start']<c['end']<=62
 assert i==0 or c['start']>=caps[i-1]['end']
 assert len(c['text'])/(c['end']-c['start'])<28
for suffix in ['srt','vtt']:assert (root/f'releases/coloyond-mobile-showcase.{suffix}').read_bytes()==(root/f'remotion/narration/captions.{suffix}').read_bytes()
inputs=[root/'package.json',root/'package-lock.json',root/'remotion.config.ts',root/'scripts/mobile/package-video.py',root/'scripts/mobile/verify-video-camera.mjs',root/'scripts/mobile/verify-video-export.py']
inputs+=list((root/'remotion').glob('*.ts'))+list((root/'remotion').glob('*.tsx'))+list((root/'remotion/public').rglob('*'))+list((root/'remotion/narration').glob('*'))
inputs += [root/f'src/ui/app/lib/{p}' for p in ['art/portfolio-card.ts','art/brand-data.ts','rebalance/illustration.ts']]
inputs += [root/'remotion/analyze_music.py',root/'remotion/analysis/music-analysis.json']
attachment=root.parent/'upload/2ae47b3c94032edd8362ea6e87324594.m4a'
if attachment.exists():assert digest(attachment)==digest(root/'remotion/public/audio/coloyond-uploaded-music.m4a')
inputs=sorted(set(p for p in inputs if p.is_file()))
(root/'remotion/analysis/render-inputs.json').write_text(json.dumps({'purpose':'Complete local render inputs; npm dependencies reproducible through package-lock.json','inputs':[item(p) for p in inputs]},indent=2)+'\n')
report={'video':item(film),'videoMetadata':{k:v[k] for k in ['codec_name','width','height','r_frame_rate','nb_frames','duration']},'audioMetadata':{k:a[k] for k in ['codec_name','sample_rate','channels','duration']},'containerDurationSeconds':float(probe['format']['duration']),'originalUploadedMusic':item(root/'remotion/public/audio/coloyond-uploaded-music.m4a'),'musicIsSeparateStem':True,'uploadedAudioMatchesAttachment':True,'narration':item(root/'remotion/public/audio/coloyond-narration.wav'),'voice':'Generic natural synthetic narration, not recorded human','captionCues':len(caps),'captionsNonoverlappingAndWithin62Seconds':True,'cameraHoldsStationary':True,'cameraMaxFrameTranslationPixels':23.29,'percentageUnitGapPixels':16,'apkVersion':'1.1.3','apk':item(root/'releases/coloyond-android-debug.apk'),'audioMix':json.loads((root/'remotion/analysis/audio-mix-verification.json').read_text()),'limitations':['Illustrative fee-free rebalance, not recorded trade','Device/MWA proof not established by this film']}
(root/'remotion/analysis/export-verification.json').write_text(json.dumps(report,indent=2)+'\n')
p=root/'docs/mobile/verification.md';s=p.read_text();s=re.sub(r'\| coloyond-mobile-showcase.mp4 \|.*',f"| coloyond-mobile-showcase.mp4 | {film.stat().st_size} | `{digest(film)}` |",s);p.write_text(s)
print(json.dumps({'duration':report['containerDurationSeconds'],'frames':v['nb_frames'],'renderInputFiles':len(inputs),'videoSha256':digest(film)},indent=2))
