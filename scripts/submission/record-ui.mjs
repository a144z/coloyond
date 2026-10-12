import {chromium} from '@playwright/test';import {spawn} from 'node:child_process';import {mkdir,writeFile} from 'node:fs/promises';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5174','--strictPort'],{stdio:'ignore'});
await mkdir('docs/submission/evidence',{recursive:true});let browser;
try {
 for(let i=0;i<80;i++){try{await fetch('http://127.0.0.1:5174');break;}catch{await new Promise(r=>setTimeout(r,100));}}
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:430,height:900},recordVideo:{dir:'/tmp/coloyond-proof-recording',size:{width:430,height:900}}});const page=await context.newPage();
 await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:5174')?r.continue():r.abort());
 const started=Date.now(),events=[];
 const mark=async(text)=>{const time=(Date.now()-started)/1000;events.push({time:Math.round(time*100)/100,text});await page.evaluate(text=>{let note=document.getElementById('proof-note');if(!note){note=document.createElement('div');note.id='proof-note';Object.assign(note.style,{position:'fixed',left:'12px',right:'12px',top:'0',zIndex:9999,background:'#141414',color:'#efece6',font:'12px Arial',padding:'9px 12px',borderRadius:'0 0 9px 9px',pointerEvents:'none',lineHeight:'1.5'});document.body.append(note);}note.textContent=text;},text);await page.waitForTimeout(1500);};
 await page.goto('http://127.0.0.1:5174/app');await page.getByRole('heading',{name:'A mix of your own.'}).waitFor();await mark('ACTUAL /app · browser recording · no wallet or transaction');
 await page.getByRole('button',{name:'+ Create portfolio',exact:true}).click();await mark('1 · Create an unsigned portfolio draft');
 await page.getByRole('slider',{name:'Target slider for WSOL'}).fill('40');await page.getByRole('button',{name:/Lock WSOL weight/}).click();
 await page.getByRole('slider',{name:'Target slider for tETH'}).fill('20');for(const [symbol,value] of [['WSOL',40],['tETH',20],['dUSD',40]]){const actual=Number(await page.getByRole('textbox',{name:`Exact target percentage for ${symbol}`}).inputValue());if(Math.abs(actual-value)>.001)throw Error(`Recorded target ${symbol} is ${actual}, expected ${value}`);}
 await mark('2 · SOL 40%, ETH 20%, dUSD 40% · locked SOL preserved');
 await page.getByRole('slider',{name:'Illustrative SOL price change'}).scrollIntoViewIfNeeded();await mark('3 · Production price-shock explorer · fee-free illustration');
 await page.getByRole('slider',{name:'Illustrative SOL price change'}).fill('20');await page.getByRole('slider',{name:'Illustrative ETH price change'}).fill('-20');await mark('4 · SOL up, ETH down · actual model calculates buy/sell amounts');
 await page.getByRole('button',{name:'Illustrate rebalance',exact:true}).click();await mark('5 · Illustrated target restoration · no real trade submitted');
 await page.getByRole('button',{name:'Share portfolio card ↗',exact:true}).click();await page.getByRole('button',{name:'Share PNG ↗',exact:true}).waitFor();await mark('6 · Real local PNG renderer · portfolio-based artwork');
 await page.getByRole('button',{name:'Remix artwork',exact:true}).click();await page.getByRole('button',{name:'Share PNG ↗',exact:true}).waitFor();await mark('7 · Artwork remix changes geometry, not allocation');
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download PNG',exact:true}).click();await (await download).saveAs('docs/submission/evidence/recorded-draft-card.png');await mark('8 · Actual 1200×1500 PNG download');
 await page.keyboard.press('Escape');const link=await page.evaluate(async()=>{const {remixLink}=await import('/src/ui/app/lib/art/remix-link.ts');const {cardInput}=await import('/src/ui/app/components/ui/PortfolioArt.tsx');return remixLink(cardInput('draft','Everyday mix',{wsol:40,teth:20,dusd:40},true),location.origin);});
 await page.goto(link);await page.getByRole('heading',{name:'Set the balance.'}).waitFor();await mark('9 · Recipient link opens the same allocation as an unsigned draft');
 await mark('Wallet approval / Android chooser: not exercised in this browser recording');
 const video=page.video();await context.close();await video.saveAs('docs/submission/evidence/actual-mobile-flow.webm');await writeFile('docs/submission/evidence/actual-mobile-flow-transcript.md','# Actual mobile UI recording\n\nBrowser execution of the production app. Network requests blocked; no wallet connected, no funds or on-chain transaction. The annotation strip is recording-only.\n\n'+events.map(e=>`- **${e.time.toFixed(2)}s** — ${e.text}`).join('\n')+'\n');console.log('Actual UI recording saved',events.length,'steps');
}finally{await browser?.close();server.kill();}
