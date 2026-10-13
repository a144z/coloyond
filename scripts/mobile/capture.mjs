import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { join } from 'node:path';

const probe = createServer();
const port = await new Promise((resolve, reject) => {
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const address = probe.address();
    if (!address || typeof address === 'string') return reject(new Error('Could not reserve a local test port.'));
    probe.close((error) => error ? reject(error) : resolve(address.port));
  });
});
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
process.on('exit', () => server.kill());
for (let i=0; i<100; i++) { try { await fetch(origin); break; } catch { await new Promise(r=>setTimeout(r,100)); } }
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] });
const out = process.env.MOBILE_CAPTURE_OUT ?? new URL('../../remotion/public/screens/', import.meta.url).pathname;
await mkdir(out, { recursive: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
const page = await context.newPage();
const errors=[]; page.on('pageerror', e=>errors.push(e.message));
await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
await page.goto(`${origin}/app`);
await page.getByRole('heading', { name: 'A mix of your own.' }).waitFor();
await page.screenshot({ path: join(out, '01-portfolios.png') });
await page.getByRole('button', { name: '+ Create portfolio', exact: true }).click();
await page.getByRole('heading', { name: 'Set the balance.' }).waitFor();
await page.screenshot({ path: join(out, '02-create.png') });
const slider=page.getByRole('slider', { name: 'Target slider for WSOL' });
await slider.fill('70');
const locked=page.getByRole('button', { name: /Lock WSOL weight/ }); await locked.click();
if (!await slider.isDisabled()) throw Error('Weight lock does not disable slider');
const before=await page.getByRole('textbox',{name:'Exact target percentage for WSOL'}).inputValue();
await page.getByRole('slider',{name:'Target slider for tBTC'}).fill('10');
if (before!==await page.getByRole('textbox',{name:'Exact target percentage for WSOL'}).inputValue()) throw Error('Locked weight changed');
await page.screenshot({ path: join(out, '03-mix.png') });
await page.getByRole('button', {name:/Unlock WSOL weight/}).click();
await page.getByRole('button',{name:'Add an executable asset'}).click();
await page.getByRole('dialog').waitFor();
await page.screenshot({path:join(out, '04-assets.png')});
await page.getByRole('button',{name:'Close',exact:true}).click();
await page.getByRole('button',{name:'Back',exact:true}).click();
await page.getByRole('button',{name:'Wallet',exact:true}).click();
await page.getByRole('button',{name:'Import a seed phrase'}).click();
await page.getByRole('dialog').waitFor();
await page.evaluate(() => window.dispatchEvent(new Event('coloyond:back')));
if(await page.getByRole('dialog').count()) throw Error('Import sheet did not close');
await page.getByRole('button',{name:'System',exact:true}).click();
await page.getByRole('heading',{name:'The working parts.'}).waitFor();
await page.screenshot({path:join(out, '05-system.png')});
// Presentation-only data stays in this browser context. Never signs or sends transactions.
await page.evaluate(async()=>{
 const {useStore}=await import('/src/ui/app/lib/store.ts');
 const {stopScheduler}=await import('/src/ui/app/lib/automation.ts'); stopScheduler();
 const now=Date.now(), address='11111111111111111111111111111111';
 const vault={id:'showcase',name:'Everyday mix',createdAt:now,publicKey:address,shareMint:address,assets:['wsol','dusd','tbtc','teth'],targets:{wsol:50,dusd:30,tbtc:15,teth:5},thresholdPct:2,cadenceSec:60,status:'active',blockedReason:null,lastCheckAt:now,nextCheckAt:now+60000,lastTradeAt:now-120000,lastTradeSig:null,lastTradeSlot:12345,lastWeightEditAt:null,deposited:{},tradeCount:8};
 const tokens={wsol:5000000000,dusd:450000000,tbtc:250000,teth:15000000};
 useStore.setState({wallet:{mnemonic:'',publicKey:address,createdAt:now},vaults:[vault],walletBalances:{solLamports:42850000000,tokens},vaultBalances:{showcase:{solLamports:0,tokens,shareBalanceRaw:'10000000000',shareSupplyRaw:'10000000000'}},price:{observedAt:now,entries:{wsol:{usd:150,source:'coinbase'},dusd:{usd:1,source:'fixed'},tbtc:{usd:90000,source:'coinbase'},teth:{usd:5000,source:'coinbase'}}},rpc:{slot:123456789,pingMs:42,at:now},refreshVaultBalances:async()=>{},refreshBalances:async()=>{},refreshPrice:async()=>{},refreshRpc:async()=>{},refreshReserve:async()=>{}});
 useStore.getState().setTab('portfolios');
});
await page.getByRole('button',{name:'Open portfolio →'}).waitFor();
await page.screenshot({path:join(out, '06-active.png')});
await page.getByRole('button',{name:'Open portfolio →'}).click();
await page.getByRole('heading',{name:'Everyday mix',exact:true}).waitFor();
await page.screenshot({path:join(out, '07-detail.png')});
await page.getByRole('button',{name:'Edit target weights'}).click();
await page.getByRole('dialog').waitFor();
await page.screenshot({path:join(out, '08-edit.png')});
await page.keyboard.press('Escape');
await page.getByRole('button',{name:'Deposit assets'}).click(); await page.getByRole('dialog').waitFor(); await page.keyboard.press('Escape');
await page.getByRole('button',{name:'Redeem shares'}).click(); await page.getByRole('dialog').waitFor(); await page.keyboard.press('Escape');
await page.getByRole('button',{name:'Back',exact:true}).click();
await page.getByRole('button',{name:'Wallet',exact:true}).click();
await page.getByRole('heading',{name:'The owner key.'}).waitFor();
await page.screenshot({path:join(out, '09-wallet.png')});
await page.getByRole('button',{name:'Wrap SOL → WSOL'}).click(); await page.getByRole('dialog').waitFor(); await page.keyboard.press('Escape');
for(const width of [320,360,430,768,1440]) {
 await page.setViewportSize({width,height:900});
 await page.getByRole('button',{name:'Portfolios',exact:true}).click();
 await page.getByRole('button',{name:'+ Create portfolio',exact:true}).click();
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
 if(overflow) throw Error(`Horizontal page overflow at ${width}px`);
 await page.getByRole('button',{name:'Back',exact:true}).click();
}
if(errors.length) throw Error(errors.join('\n'));
console.log('PASS: navigation, weight locks, asset picker, import, deposit, redeem, edit, wrap sheets; 320–1440px layout; no page errors.');
await browser.close();

server.kill();
