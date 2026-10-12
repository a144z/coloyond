import React from "react";
import { Easing, interpolate } from "remotion";
import { beat } from "./camera";
import { exampleAssets, rebalanceIllustration } from "../src/ui/app/lib/rebalance/illustration.js";

const INK = "#141414", MUTED = "#747069", PAPER = "#efece6", CARD = "#faf8f5", LINE = "#d8d4ca";
const COLORS = ["#ff4d38", "#184beb", "#ffda23"];
const q = (f: number, a: number, b: number, x = 0, y = 1) => interpolate(f, [beat(a), beat(b)], [x,y], {
  extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(.65,0,.25,1),
});

// Same value-based model as /app; independent 100%-complete example, never a transaction.
export function illustrationAt(frame: number) {
  const shock = q(frame, 60, 65);
  const restored = q(frame, 69, 75);
  const model = rebalanceIllustration(exampleAssets({wsol:40,teth:20,dusd:40}, {wsol:20*shock,teth:-20*shock}));
  return {...model, shock, restored};
}

function NumberPct({value}: {value: number}) {
  return <span style={{display:"inline-flex",alignItems:"baseline",gap:10,fontVariantNumeric:"tabular-nums",fontSize:38,fontWeight:750,letterSpacing:-1.6}}>
    {value.toFixed(1)}<span style={{fontSize:19,fontWeight:500,letterSpacing:0}}>%</span>
  </span>;
}

export function RebalanceScene({frame:f}: {frame: number}) {
  if(f<beat(56)||f>beat(81)) return null;
  const enter=q(f,56,58), exit=q(f,79.5,81), {rows,total,shock,restored}=illustrationAt(f);
  const trade=q(f,67,69), settle=q(f,75,77);
  const status=restored>.99 ? "TARGET VALUE MIX RESTORED" : trade>.5 ? "SELL OVERWEIGHT · BUY UNDERWEIGHT" : shock>.99 ? "PRICES CHANGED. THE WEIGHTS DRIFTED." : "START WITH YOUR TARGET VALUE MIX";
  const phase=(f-beat(69))/Math.max(1,beat(75)-beat(69));
  return <div style={{position:"absolute",left:850,top:145,width:920,color:INK,opacity:enter*(1-exit)}}>
    <div style={{font:"14px monospace",letterSpacing:1.8,color:MUTED,marginBottom:22,transform:`translateX(${(1-enter)*-45}px)`}}>05 / AUTOMATIC REBALANCE</div>
    {["Prices move.","Keep your balance."].map((line,j)=>{
      const p=q(f,56+j*.4,58+j*.4);
      return <div key={line} style={{overflow:"hidden",paddingBottom:7}}><div style={{fontSize:72,fontWeight:750,letterSpacing:-4,lineHeight:1.04,transform:`translate(${(1-p)*(j?-95:95)}px,${(1-p)*90}%)`}}>{line}</div></div>;
    })}
    <div style={{width:220*enter,height:5,background:COLORS[0],margin:"22px 0 23px"}}/>
    <div style={{display:"flex",gap:18,alignItems:"center",marginBottom:20}}>
      {rows.slice(0,2).map((r,j)=><div key={r.id} style={{display:"flex",alignItems:"center",gap:15,border:`1px solid ${LINE}`,borderRadius:12,padding:"12px 18px",background:CARD,transform:`translateX(${(1-q(f,58+j*.3,60+j*.3))*-40}px)`}}>
        <b style={{fontSize:20}}>{r.symbol}</b>
        <svg width="92" height="34" viewBox="0 0 92 34">
          <path d={j===0?"M2 27 L20 23 L35 25 L50 16 L65 19 L90 5":"M2 5 L20 9 L35 7 L50 18 L65 15 L90 27"} fill="none" stroke={COLORS[j]} strokeWidth="2.5" pathLength="1" strokeDasharray="1" strokeDashoffset={1-shock}/>
          <path d="M2 17 H90" stroke={LINE} strokeDasharray="2 5"/>
        </svg>
        <span style={{display:"inline-flex",gap:7,alignItems:"baseline",color:COLORS[j],font:"22px monospace"}}>{j===0?"+":"−"}{(20*shock).toFixed(0)}<span style={{fontSize:14}}>%</span></span>
      </div>)}
      <div style={{font:"12px monospace",color:MUTED,lineHeight:1.7}}>SEPARATE EXAMPLE MIX<br/>40% SOL · 20% ETH · 40% CASH</div>
    </div>
    <div style={{padding:24,borderRadius:18,border:`1px solid ${LINE}`,background:CARD}}>
      <div style={{display:"flex",justifyContent:"space-between",font:"11px monospace",letterSpacing:1.1,color:MUTED,marginBottom:19}}><span>{status}</span><span>${total.toFixed(0)} MODEL VALUE</span></div>
      <div style={{display:"flex",height:42,borderRadius:6,overflow:"hidden"}}>{rows.map((r,j)=><div key={r.id} style={{width:`${r.actualPct*(1-restored)+r.targetPct*restored}%`,background:COLORS[j],position:"relative"}}>
        <div style={{position:"absolute",inset:0,background:"linear-gradient(105deg,transparent,#ffffff45,transparent)",transform:`translateX(${(-1+restored*3)*100}%)`,opacity:trade*(1-settle)}}/>
      </div>)}</div>
      <div style={{display:"flex",marginTop:18,gap:20}}>{rows.map((r,j)=><div key={r.id} style={{flex:1}}>
        <div style={{fontSize:14,fontWeight:700,marginBottom:7}}>{r.id==="dusd"?"CASH / dUSD":r.symbol}</div>
        <NumberPct value={r.actualPct*(1-restored)+r.targetPct*restored}/>
        <div style={{font:"11px monospace",color:MUTED,marginTop:9}}>{r.targetPct}<span style={{marginLeft:5}}>%</span> TARGET · ${(r.value*(1-restored)+r.targetValue*restored).toFixed(0)}</div>
      </div>)}</div>
    </div>
    <div style={{opacity:trade,transform:`translateY(${(1-trade)*22}px)`,marginTop:18}}>
      <svg width="920" height="44" viewBox="0 0 920 44" style={{display:"block"}}>
        <defs><marker id="rebalance-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L6 3 L0 6" fill={INK}/></marker></defs>
        <path d="M143 2 V19 H460 V37 M143 19 H777 V37" stroke={LINE} strokeWidth="1.5" fill="none"/>
        <path d="M143 2 V19 H460 V37" stroke={COLORS[1]} strokeWidth="2" fill="none" pathLength="1" strokeDasharray="1" strokeDashoffset={1-restored} markerEnd={restored>.9?"url(#rebalance-arrow)":undefined}/>
        <path d="M143 19 H777 V37" stroke={COLORS[0]} strokeWidth="1.5" fill="none" pathLength="1" strokeDasharray="1" strokeDashoffset={1-restored}/>
        {phase>=0&&phase<1?[0,.32,.64].map((offset,j)=>{
          const progress=(phase*2+offset)%1;
          return <circle key={j} cx={143+progress*634} cy={19} r={3.5} fill={j===0?COLORS[0]:INK} opacity={Math.sin(progress*Math.PI)}/>;
        }):null}
      </svg>
      <div style={{display:"flex",gap:15}}>{rows.map((r,j)=><div key={r.id} style={{flex:1,padding:"15px 18px",border:`1px solid ${LINE}`,borderRadius:12,background:CARD,transform:`translateX(${(1-q(f,67+j*.35,69+j*.35))*(j?35:-35)}px)`}}>
        <div style={{font:"10px monospace",letterSpacing:1,color:MUTED,marginBottom:10}}>{j===0?"SELL EXCESS SOL":j===1?"BUY MORE ETH":"RESTORE CASH"}</div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",fontSize:25,fontWeight:700}}><span>{r.id==="dusd"?"dUSD":r.symbol}</span><span style={{color:j===2?INK:COLORS[j],fontVariantNumeric:"tabular-nums"}}>${Math.abs(r.deltaValue).toFixed(0)}</span></div>
      </div>)}</div>
    </div>
    <div style={{marginTop:19,display:"flex",justifyContent:"space-between",alignItems:"center",minHeight:34}}>
      <div style={{font:"11px monospace",color:MUTED,lineHeight:1.7}}>FEE-FREE ILLUSTRATION · NOT A RECORDED TRADE<br/>ETH is synthetic devnet tETH. Execution needs valid prices and liquidity.</div>
      <div style={{fontSize:15,fontWeight:700,opacity:settle,transform:`translateX(${(1-settle)*30}px)`}}>✓ 40 / 20 / 40 <span style={{marginLeft:6,color:MUTED,fontWeight:400}}>restored</span></div>
    </div>
  </div>;
}
