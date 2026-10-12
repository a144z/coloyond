"""Package the supplied Coloyond artwork into website and Android icon sizes."""
from pathlib import Path
from shutil import copyfile
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
source=ROOT/'coloyond.jpg'
image=Image.open(source).convert('RGB')
public=ROOT/'public';copyfile(source,public/'coloyond.jpg')
for name,size in [('favicon.png',64),('coloyond-icon.png',192),('apple-touch-icon.png',180)]:
    image.resize((size,size),Image.Resampling.LANCZOS).save(public/name)
res=ROOT/'apps/android/app/src/main/res'
(res/'drawable-nodpi').mkdir(exist_ok=True)
copyfile(source,res/'drawable-nodpi/coloyond_logo.jpg')
# Android themed icons use a monochrome alpha mask of the same supplied artwork.
mask=image.split()[0]
from PIL import ImageChops
mask=ImageChops.darker(ImageChops.darker(*image.split()[:2]),image.split()[2])
mask=mask.point(lambda x: max(0,min(255,(205-x)*8)))
mono=Image.new('RGBA',image.size,(255,255,255,0));mono.putalpha(mask)
mono.save(res/'drawable-nodpi/coloyond_monochrome.png')
for density,size in [('mdpi',48),('hdpi',72),('xhdpi',96),('xxhdpi',144),('xxxhdpi',192)]:
    for name in ['ic_launcher','ic_launcher_round']:
        image.resize((size,size),Image.Resampling.LANCZOS).save(res/f'mipmap-{density}/{name}.webp',lossless=True)
(ROOT/'remotion/public/coloyond.jpg').write_bytes(source.read_bytes())
print('Packaged exact supplied artwork for web, Android and Remotion.')
