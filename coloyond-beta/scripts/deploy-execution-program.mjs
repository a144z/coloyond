#!/usr/bin/env node
/** Deploy the compiled Anchor program to devnet using local-only signers. */
import { access, chmod, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Keypair } from '@solana/web3.js';

const upgradePath = join(homedir(), '.config/solana/devnet-id.json');
const programPath = 'target/deploy/coloyond_execution-keypair.json';
const binaryPath = 'target/deploy/coloyond_execution.so';
const bufferPath = 'target/deploy/coloyond_execution-buffer-keypair.json';
const baseRpc = process.env.SOLANA_RPC_URL ?? 'devnet';

await access(binaryPath);
await access(programPath);
await access(upgradePath);
try {
  await access(bufferPath);
} catch {
  await writeFile(bufferPath, JSON.stringify([...Keypair.generate().secretKey]), { mode: 0o600, flag: 'wx' });
  await chmod(bufferPath, 0o600);
}

const bundledCli = join(homedir(), '.local/share/solana/install/active_release/bin/solana');
let cli = process.env.SOLANA_CLI;
if (!cli) {
  try {
    await access(bundledCli);
    cli = bundledCli;
  } catch {
    cli = 'solana';
  }
}
const result = spawnSync(cli, [
  'program', 'deploy', binaryPath,
  '--program-id', programPath,
  '--buffer', bufferPath,
  '--keypair', upgradePath,
  '--upgrade-authority', upgradePath,
  '--url', baseRpc,
  '--use-rpc',
], { stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Execution program deployed at ${Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(programPath, 'utf8')))).publicKey.toBase58()}`);
