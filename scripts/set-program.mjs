import fs from 'node:fs';
import {PublicKey} from '@solana/web3.js';
const address=new PublicKey(process.argv[2]).toBase58();
for(const [file,pattern,replacement] of [
  ['programs/coloyond-vault/src/lib.rs',/declare_id!\("[^"]+"\)/,`declare_id!("${address}")`],
  ['Anchor.toml',/coloyond_vault = "[^"]+"/g,`coloyond_vault = "${address}"`],
  ['src/shared/config.ts',/DEFAULT_PROGRAM = '[^']+'/,`DEFAULT_PROGRAM = '${address}'`],
  ['.env.local.example',/VITE_PROGRAM_ID=[^\n]+/,`VITE_PROGRAM_ID=${address}`],
]){const source=fs.readFileSync(file,'utf8');if(!pattern.test(source))throw new Error(`Missing identity in ${file}`);pattern.lastIndex=0;fs.writeFileSync(file,source.replace(pattern,replacement));}
console.log(`Program identity synchronized: ${address}. Rebuild SBF and redeploy to a fresh address.`);
