import React from 'react';
import { AbsoluteFill, Composition, Img, interpolate, registerRoot, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

const scenes = [
  { image: '01-portfolios.png', eyebrow: '01 / YOUR PORTFOLIOS', title: 'A mix of\nyour own.', body: 'Choose your assets. Set your balance.\nKeep every portfolio within reach.', tag: 'SOLANA DEVNET', color: '#ef4444' },
  { image: '02-create.png', eyebrow: '02 / BUILD YOUR MIX', title: 'Set the\nbalance.', body: 'Start with SOL and build a portfolio\naround the assets you choose.', tag: 'WSOL · dUSD · tBTC · tETH', color: '#2563eb' },
  { image: '03-mix.png', eyebrow: '03 / MAKE IT PRECISE', title: 'Slide.\nLock. Adjust.', body: 'Fine-tune allocation with sliders.\nPin a weight while the others move.', tag: 'EXACT WEIGHTS · ONE MIX', color: '#facc15' },
  { image: '04-assets.png', eyebrow: '04 / EXPLORE ASSETS', title: 'Find your\nnext asset.', body: 'An asset picker built for a phone.\nSee what your vault can execute.', tag: 'SEARCH · SELECT · ALLOCATE', color: '#7c3aed' },
  { image: '06-active.png', eyebrow: '05 / STAY IN CONTROL', title: 'Your portfolio.\nAt a glance.', body: 'Target weights, current allocation,\nand scheduled task status together.', tag: 'ILLUSTRATIVE DEVNET DATA', color: '#ef4444' },
  { image: '07-detail.png', eyebrow: '06 / THE WHOLE PICTURE', title: 'See what\nyou hold.', body: 'Inspect holdings and SPL shares.\nPause or resume your scheduled task.', tag: 'ILLUSTRATIVE DEVNET DATA', color: '#2563eb' },
  { image: '08-edit.png', eyebrow: '07 / KEEP IT YOURS', title: 'Change\nthe mix.', body: 'Retarget your portfolio in a sheet.\nReview before signing on Solana.', tag: 'ILLUSTRATIVE DEVNET DATA', color: '#facc15' },
  { image: '09-wallet.png', eyebrow: '08 / YOUR WALLET', title: 'Everything\nwithin reach.', body: 'Check balances, wrap SOL,\nand open your next portfolio.', tag: 'ILLUSTRATIVE DEVNET DATA', color: '#7c3aed' },
  { image: '05-system.png', eyebrow: '09 / SYSTEM STATUS', title: 'Know the\nworking parts.', body: 'Check connectivity, price observations,\nand the status behind your vaults.', tag: 'LIVE STATUS · NO HIDDEN STATE', color: '#2563eb' },
];
const LENGTH=150;
function Scene({ data, index }: { data: typeof scenes[number]; index: number }) {
  const frame=useCurrentFrame(); const {fps}=useVideoConfig();
  const entrance=spring({frame,fps,config:{damping:22,stiffness:90}});
  const fade=interpolate(frame,[0,12,LENGTH-12,LENGTH],[0,1,1,0],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
  return <AbsoluteFill style={{opacity:fade, padding:'105px 115px', display:'flex', flexDirection:'row', alignItems:'center', gap:105}}>
    <div style={{width:825,transform:`translateY(${(1-entrance)*30}px)`}}>
      <div style={{fontFamily:'monospace',fontSize:21,letterSpacing:3,color:'#6e6b65',marginBottom:36}}>{data.eyebrow}</div>
      <h1 style={{fontSize:104,lineHeight:1.02,letterSpacing:-7,fontWeight:700,whiteSpace:'pre-line',margin:'0 0 38px'}}>{data.title}</h1>
      <div style={{display:'flex',height:10,width:380,gap:6,marginBottom:40}}>{['#ef4444','#2563eb','#facc15','#7c3aed'].map((color,i)=><div key={color} style={{background:color,width:[170,100,65,45][i],borderRadius:6}} />)}</div>
      <p style={{whiteSpace:'pre-line',fontSize:29,lineHeight:1.6,color:'#6e6b65',marginBottom:45}}>{data.body}</p>
      <span style={{fontFamily:'monospace',fontSize:17,letterSpacing:1.5,background:'#e8e4dc',border:'1px solid #d8d4ca',borderRadius:12,padding:'16px 20px'}}>{data.tag}</span>
    </div>
    <div style={{position:'relative',width:390,height:844,flexShrink:0,background:'#efece6',border:'12px solid #222',borderRadius:48,overflow:'hidden',boxSizing:'content-box',boxShadow:'0 35px 70px #14141426',transform:`translateY(${(1-entrance)*70}px) rotate(${interpolate(frame,[0,LENGTH],[-1.5,1.5])}deg)`}}>
      <Img src={staticFile('screens/'+data.image)} style={{width:'100%',height:'100%',objectFit:'cover'}} />
    </div>
    <div style={{position:'absolute',bottom:60,left:115,right:115,display:'flex',gap:8}}>{scenes.map((_,i)=><div key={i} style={{height:3,flex:1,background:i<=index?data.color:'#d8d4ca'}} />)}</div>
  </AbsoluteFill>;
}
function Showcase() {
 const frame=useCurrentFrame();
 return <AbsoluteFill style={{background:'#efece6',color:'#141414',fontFamily:'Arial, sans-serif'}}>
   <div style={{position:'absolute',top:40,left:115,fontSize:28,fontWeight:700,letterSpacing:-1}}>coloyond <span style={{color:'#7c3aed'}}>✳</span></div>
   <div style={{position:'absolute',top:46,right:115,fontSize:16,fontFamily:'monospace',color:'#6e6b65'}}>MOBILE / WEB + ANDROID</div>
   {scenes.map((data,index)=><Sequence key={data.image} from={index*LENGTH} durationInFrames={LENGTH}><Scene data={data} index={index}/></Sequence>)}
   {frame>=scenes.length*LENGTH?<AbsoluteFill style={{justifyContent:'center',alignItems:'center'}}><div style={{fontSize:120,fontWeight:700,letterSpacing:-7}}>coloyond ✳</div><div style={{fontSize:38,marginTop:20}}>A mix of your own.</div><div style={{fontSize:22,fontFamily:'monospace',color:'#6e6b65',marginTop:55}}>/app · Android · Solana devnet</div><div style={{fontSize:17,color:'#6e6b65',marginTop:80}}>Test assets. Illustrative balances. Transactions require your signature.</div></AbsoluteFill>:null}
 </AbsoluteFill>;
}
registerRoot(()=> <Composition id="MobileShowcase" component={Showcase} durationInFrames={1500} fps={30} width={1920} height={1080}/>);
