import React from 'react';
import { AbsoluteFill, Audio, Composition, Easing, Img, interpolate, registerRoot, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

const PAPER='#efece6', INK='#141414', MUTED='#6e6b65';
const COLORS=['#ef4444','#2563eb','#facc15','#7c3aed'];
const INTRO=90, CHAPTER=180, END=150, TOTAL=1860;
const chapters=[
 {image:'01-portfolios.png',label:'01 / A MIX OF YOUR OWN',words:['Your assets.','Your rhythm.'],copy:'A portfolio desk made for the way you move.',action:'Create portfolio',point:[195,408],focus:[.5,.46],accent:0},
 {image:'02-create.png',label:'02 / CREATE',words:['Start with','a balance.'],copy:'Choose your assets. Give your mix a name.',action:'Choose your mix',point:[194,660],focus:[.5,.7],accent:1},
 {image:'03-mix.png',label:'03 / ALLOCATE',words:['Slide it.','Lock it.'],copy:'Exact weights. A balance that stays yours.',action:'Pin the weight',point:[326,566],focus:[.5,.76],accent:2},
 {image:'04-assets.png',label:'04 / EXPLORE',words:['Find the','right fit.'],copy:'Explore the assets your vault can execute.',action:'Explore assets',point:[200,440],focus:[.5,.55],accent:3},
 {image:'06-active.png',label:'05 / PORTFOLIOS',words:['Your mix.','In motion.'],copy:'Allocation and task status. Together at a glance.',action:'Open portfolio',point:[200,600],focus:[.5,.55],accent:0,sample:true},
 {image:'07-detail.png',label:'06 / INSPECT',words:['Every asset.','A clear view.'],copy:'Inspect your holdings and scheduled task.',action:'See the detail',point:[198,470],focus:[.5,.44],accent:1,sample:true},
 {image:'08-edit.png',label:'07 / REFINE',words:['A new plan?','Change the mix.'],copy:'Retarget in a sheet. Review before you sign.',action:'Adjust your target',point:[228,549],focus:[.5,.64],accent:2,sample:true},
 {image:'09-wallet.png',label:'08 / WALLET',words:['One wallet.','Within reach.'],copy:'Your balances and next move, in one place.',action:'Navigate to wallet',point:[195,798],focus:[.5,.39],accent:3,sample:true,nav:1},
 {image:'05-system.png',label:'09 / SYSTEM',words:['Stay informed.','Keep moving.'],copy:'Connectivity, prices, and the working parts.',action:'Check system status',point:[320,798],focus:[.5,.45],accent:1,nav:2},
];
const ease=Easing.bezier(.22,1,.36,1);
const tween=(f:number,a:number,b:number,x:number,y:number)=>interpolate(f,[a,b],[x,y],{extrapolateLeft:'clamp',extrapolateRight:'clamp',easing:ease});
function Touch({frame,x,y}:{frame:number;x:number;y:number}) {
 const pulse=(frame-84)/24;
 if(pulse<0||pulse>1)return null;
 return <div style={{position:'absolute',left:x,top:y,width:0,height:0,zIndex:9}}>
  <div style={{position:'absolute',width:18,height:18,left:-9,top:-9,background:INK,border:'3px solid white',borderRadius:'50%',boxShadow:'0 2px 8px #0004',opacity:1-pulse*.65}}/>
  <div style={{position:'absolute',width:64,height:64,left:-32,top:-32,border:`2px solid ${INK}`,borderRadius:'50%',transform:`scale(${.25+pulse})`,opacity:1-pulse}}/>
 </div>;
}
function Allocation({frame}:{frame:number}) {
 const w=tween(frame,45,96,60,70);const b=100-w;
 const lock=spring({frame:frame-100,fps:30,config:{damping:15}});
 return <div style={{width:590,padding:30,background:'#faf8f5',border:'1px solid #d8d4ca',borderRadius:24,boxShadow:'0 18px 40px #1414140b'}}>
  <div style={{display:'flex',justifyContent:'space-between',font:'14px monospace',letterSpacing:2,color:MUTED,marginBottom:24}}><span>TARGET MIX</span><span>{w.toFixed(0)} / {b.toFixed(0)}</span></div>
  <div style={{display:'flex',height:14,borderRadius:10,overflow:'hidden',marginBottom:24}}><div style={{width:`${w}%`,background:COLORS[0]}}/><div style={{flex:1,background:COLORS[1]}}/></div>
  <div style={{display:'flex',alignItems:'center',gap:14,fontSize:22}}><span style={{width:12,height:12,borderRadius:8,background:COLORS[0]}}/> <b>WSOL</b><span style={{marginLeft:'auto',fontFamily:'monospace'}}>{w.toFixed(0)}%</span><span style={{padding:'9px 14px',borderRadius:10,font:'12px monospace',background:frame>=100?INK:PAPER,color:frame>=100?'white':INK,transform:`scale(${frame>=100?.92+lock*.08:1})`}}>{frame>=100?'LOCKED':'LOCK'}</span></div>
  <div style={{position:'relative',height:42,marginTop:10}}><div style={{position:'absolute',top:19,height:5,width:'100%',background:'#e8e4dc',borderRadius:8}}/><div style={{position:'absolute',top:19,height:5,width:`${w}%`,background:COLORS[0],borderRadius:8}}/><div style={{position:'absolute',left:`${w}%`,top:7,width:28,height:28,borderRadius:20,background:PAPER,border:'2px solid #141414',transform:'translateX(-50%)'}}/><Touch frame={frame-2} x={530*w/100} y={21}/></div>
 </div>;
}
function Chapter({index}:{index:number}) {
 const frame=useCurrentFrame();const {fps}=useVideoConfig();const data=chapters[index];
 const previous=chapters[data.nav===1?4:data.nav===2?7:Math.max(0,index-1)];
 const enter=spring({frame,fps,config:{damping:24,stiffness:105}});
 const exit=tween(frame,158,180,0,1);
 const camera=data.nav!==undefined?tween(frame,114,140,0,1)*(1-tween(frame,155,177,0,1)):tween(frame,42,85,0,1)*(1-tween(frame,128,166,0,1));
 const zoom=1+camera*.12;
 const screenZoom=1+camera*.20;
 const transitionStart=data.nav!==undefined?90:0;
 const contentX=tween(frame,transitionStart,transitionStart+24,390,0);
 const sheet=index===3||index===6;
 const floating=tween(frame,45,74,0,1)*(1-tween(frame,139,165,0,1));
 const accent=COLORS[data.accent];
 return <AbsoluteFill>
  <div style={{position:'absolute',left:115,top:205,width:770,opacity:1-exit,transform:`translateY(${-exit*28}px)`}}>
   <div style={{font:'17px monospace',letterSpacing:3,color:MUTED,marginBottom:35,opacity:enter,transform:`translateY(${(1-enter)*22}px)`}}>{data.label}</div>
   {data.words.map((word,i)=>{const p=spring({frame:frame-8-i*7,fps,config:{damping:22,stiffness:110}});return <div key={word} style={{overflow:'hidden',paddingBottom:6}}><div style={{fontSize:index===6?85:98,fontWeight:700,lineHeight:1.04,letterSpacing:-5,transform:`translateY(${(1-p)*115}%)`}}>{word}</div></div>})}
   <div style={{height:6,width:100+230*enter,background:accent,borderRadius:5,margin:'32px 0'}}/>
   <div style={{fontSize:27,lineHeight:1.5,color:MUTED,maxWidth:660,opacity:tween(frame,26,50,0,1),transform:`translateY(${tween(frame,26,50,18,0)}px)`}}>{data.copy}</div>
   {index===2?<div style={{marginTop:36,opacity:floating,transform:`translateY(${(1-floating)*35}px)`}}><Allocation frame={frame}/></div>:<div style={{marginTop:40,display:'inline-flex',alignItems:'center',gap:12,background:'#faf8f5',border:'1px solid #d8d4ca',borderRadius:14,padding:'15px 22px',opacity:tween(frame,58,84,0,1)}}><span style={{height:8,width:8,borderRadius:5,background:accent}}/><span style={{fontSize:17}}>{data.action}</span><span style={{fontSize:23,transform:`translateX(${tween(frame,84,120,0,7)}px)`}}>↗</span></div>}
  </div>
  <div style={{position:'absolute',left:1100-camera*42,top:125,width:360,height:779,transform:`translateX(${index===0?(1-enter)*160:0}px) scale(${zoom}) rotate(${(index===0?(1-enter)*5:0)-camera*1.4}deg)`,transformOrigin:'50% 50%',border:'11px solid #202020',borderRadius:46,overflow:'hidden',boxSizing:'content-box',background:PAPER,boxShadow:`0 ${28+camera*20}px ${65+camera*25}px #14141428`}}>
   <div style={{position:'absolute',inset:0,transform:`scale(${screenZoom})`,transformOrigin:`${data.focus[0]*100}% ${data.focus[1]*100}%`}}>
    <Img src={staticFile('screens/'+previous.image)} style={{position:'absolute',width:'100%',height:'100%',objectFit:'cover',transform:sheet?'none':`translateX(${-tween(frame,transitionStart,transitionStart+24,0,115)}px)`}}/>
    <div style={{position:'absolute',inset:0,overflow:'hidden',transform:sheet?`translateY(${contentX*2}px)`:`translateX(${contentX}px)`,boxShadow:'-15px 0 25px #14141412'}}><Img src={staticFile('screens/'+data.image)} style={{width:'100%',height:'100%',objectFit:'cover'}}/></div>
    {data.nav===undefined?<Touch frame={frame} x={data.point[0]*360/390} y={data.point[1]*779/844}/>:null}
   </div>
   {data.nav!==undefined?<div style={{position:'absolute',bottom:2,left:10,right:10,height:59,boxSizing:'border-box',display:'flex',gap:5,background:PAPER,padding:7,opacity:tween(frame,18,32,0,1)}}>{['Portfolios','Wallet','System'].map((name,i)=><div key={name} style={{flex:1,borderRadius:10,display:'flex',justifyContent:'center',alignItems:'center',fontSize:11,fontWeight:600,background:i===(frame<90?(data.nav===1?0:1):data.nav)?INK:'transparent',color:i===(frame<90?(data.nav===1?0:1):data.nav)?'white':MUTED,transform:i===data.nav?`scale(${1+.06*Math.sin(Math.PI*tween(frame,78,108,0,1))})`:undefined}}>{name}</div>)}<Touch frame={frame} x={(data.nav+.5)*(340/3)} y={28}/></div>:null}
  </div>
  <div style={{position:'absolute',right:145,top:140,font:'12px monospace',letterSpacing:2,color:MUTED,writingMode:'vertical-rl'}}>DESIGNED TO MOVE WITH YOU</div>
  {data.sample||(data.nav===2&&frame<114)?<div style={{position:'absolute',bottom:87,left:115,font:'12px monospace',letterSpacing:1.5,color:MUTED}}>ILLUSTRATIVE DEVNET DATA</div>:null}
  <div style={{position:'absolute',left:115,right:115,bottom:55,display:'flex',gap:8}}>{chapters.map((_,i)=><div key={i} style={{flex:1,height:3,background:'#d8d4ca',overflow:'hidden',borderRadius:4}}><div style={{width:i<index?'100%':i===index?`${frame/CHAPTER*100}%`:'0%',height:'100%',background:accent}}/></div>)}</div>
 </AbsoluteFill>;
}
function BrandScene({outro=false}:{outro?:boolean}) {
 const frame=useCurrentFrame();const {fps}=useVideoConfig();const p=spring({frame,fps,config:{damping:23,stiffness:85}});
 return <AbsoluteFill style={{alignItems:'center',justifyContent:'center'}}>
  <Img src={staticFile('coloyond.jpg')} style={{width:160,height:160,objectFit:'cover',borderRadius:28,marginBottom:35,opacity:p,transform:`translateY(${(1-p)*80}px) scale(${.85+p*.15}) rotate(${-8*(1-p)}deg)`}} />
  <div style={{overflow:'hidden'}}><div style={{fontSize:126,fontWeight:700,letterSpacing:-8,transform:`translateY(${(1-p)*160}%)`}}>Coloyond</div></div>
  <div style={{fontSize:outro?42:33,letterSpacing:-1,marginTop:25,opacity:tween(frame,24,50,0,1)}}>{outro?'Make room for your own mix.':'A mix of your own. In motion.'}</div>
  {outro?<><div style={{marginTop:38,background:INK,color:PAPER,padding:'19px 38px',borderRadius:16,font:'22px monospace',opacity:tween(frame,42,66,0,1)}}>/app → Web + Android</div><div style={{position:'absolute',bottom:85,fontSize:15,color:MUTED}}>Solana devnet · Test assets · Illustrative balances · Transactions require your signature</div></>:<div style={{font:'14px monospace',letterSpacing:4,color:MUTED,marginTop:42,opacity:p}}>YOUR ASSETS. YOUR BALANCE. YOUR NEXT MOVE.</div>}
 </AbsoluteFill>;
}
function Showcase() {
 const frame=useCurrentFrame();
 return <AbsoluteFill style={{background:PAPER,color:INK,fontFamily:'Arial, sans-serif',overflow:'hidden'}}>
  <Audio src={staticFile('audio/coloyond-original-score.wav')} volume={f=>interpolate(f,[0,45,TOTAL-90,TOTAL],[0,.8,.8,0],{extrapolateLeft:'clamp',extrapolateRight:'clamp'})}/>
  <div style={{position:'absolute',width:950,height:950,borderRadius:'50%',background:'radial-gradient(circle,#d8d4ca66,transparent 68%)',right:-250,top:-120,transform:`translateY(${Math.sin(frame/150)*25}px)`}}/>
  <Sequence durationInFrames={INTRO}><BrandScene/></Sequence>
  {frame>=INTRO&&frame<INTRO+chapters.length*CHAPTER?<><div style={{position:'absolute',top:42,left:115,fontSize:27,fontWeight:700,letterSpacing:-1}}><Img src={staticFile('coloyond.jpg')} style={{width:32,height:32,borderRadius:7,marginRight:10,verticalAlign:'middle'}}/>Coloyond</div><div style={{position:'absolute',top:48,left:450,font:'13px monospace',letterSpacing:2,color:MUTED}}>A PORTFOLIO DESK. IN YOUR POCKET.</div></>:null}
  {chapters.map((_,i)=><Sequence key={i} from={INTRO+i*CHAPTER} durationInFrames={CHAPTER}><Chapter index={i}/></Sequence>)}
  <Sequence from={INTRO+chapters.length*CHAPTER} durationInFrames={END}><BrandScene outro/></Sequence>
 </AbsoluteFill>;
}
registerRoot(()=> <Composition id="MobileShowcase" component={Showcase} durationInFrames={TOTAL} fps={30} width={1920} height={1080}/>);
