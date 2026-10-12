"""Read-only, reproducible evidence for the program used by /app. No keys or writes."""
import base64,hashlib,json,os,time,urllib.request
from pathlib import Path
RPC=os.environ.get('COLOYOND_EVIDENCE_RPC','https://api.devnet.solana.com')
PROGRAM='HT7c9346N1o1TRzttWEHTg6mf7gyB1qNeV6K9VBKdN2d'
EXPECTED_GENESIS='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'
OUT=Path('docs/submission/evidence/deployment-read.json')
def rpc(method,params=[]):
 for attempt in range(4):
  try:
   request=urllib.request.Request(RPC,data=json.dumps({'jsonrpc':'2.0','id':1,'method':method,'params':params}).encode(),headers={'Content-Type':'application/json'})
   with urllib.request.urlopen(request,timeout=30) as response:data=json.load(response)
   if 'error' in data:raise RuntimeError(str(data['error']))
   return data['result']
  except Exception:
   if attempt==3:raise
   time.sleep(1+attempt)
def account(address):return rpc('getAccountInfo',[address,{'encoding':'base64','commitment':'confirmed'}])
def base58(data):
 alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';n=int.from_bytes(data,'big');out=''
 while n:n,r=divmod(n,58);out=alphabet[r]+out
 return '1'*(len(data)-len(data.lstrip(b'\0')))+out
report={'observedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'rpc':RPC,'programId':PROGRAM,'scope':'Read-only RPC observation; not a source/binary audit, MWA/device test, or future uptime guarantee.'}
report['genesis']=rpc('getGenesisHash');assert report['genesis']==EXPECTED_GENESIS
program=account(PROGRAM);v=program['value'];assert v and v['executable'] and v['owner']=='BPFLoaderUpgradeab1e11111111111111111111111';raw=base64.b64decode(v['data'][0]);assert int.from_bytes(raw[:4],'little')==2
pd=base58(raw[4:36]);d=account(pd);blob=base64.b64decode(d['value']['data'][0]);assert int.from_bytes(blob[:4],'little')==3
report['program']={'slot':program['context']['slot'],'owner':v['owner'],'executable':v['executable'],'programData':pd,'deployedSlot':int.from_bytes(blob[4:12],'little'),'upgradeAuthority':base58(blob[13:45]) if blob[12] else None,'programDataAccountSha256':hashlib.sha256(blob).hexdigest(),'programBytesSha256':hashlib.sha256(blob[45:]).hexdigest(),'programBytesLength':len(blob)-45,'sourceBinaryCorrespondence':'not independently established'}
report['recentTransactions']=[]
for candidate in rpc('getSignaturesForAddress',[PROGRAM,{'limit':16,'commitment':'confirmed'}]):
 if candidate['err']:continue
 tx=rpc('getTransaction',[candidate['signature'],{'encoding':'json','commitment':'confirmed','maxSupportedTransactionVersion':0}])
 if not tx:continue
 logs=tx.get('meta',{}).get('logMessages',[])
 events=[line for line in logs if any(tag in line for tag in ['Instruction:','settled atomically','Magic Action submitted','Scheduled rebalance skipped'])]
 report['recentTransactions'].append({'signature':candidate['signature'],'slot':tx['slot'],'blockTime':tx.get('blockTime'),'err':tx.get('meta',{}).get('err'),'events':events,'preTokenBalances':tx.get('meta',{}).get('preTokenBalances',[]),'postTokenBalances':tx.get('meta',{}).get('postTokenBalances',[]),'explorer':f"https://explorer.solana.com/tx/{candidate['signature']}?cluster=devnet"})
 print('observed',candidate['signature'][:12],events[-2:])
OUT.write_text(json.dumps(report,indent=2)+'\n');print('Saved',OUT)
