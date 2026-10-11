#!/usr/bin/env node
/** Deploy the compiled Anchor program to devnet using local-only signers. */
import { access, chmod, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { Keypair } from '@solana/web3.js';

const upgradePath = 'target/upgrade-authority.json';
const programPath = 'target/deploy/coloyond_execution-keypair.json';
const binaryPath = 'target/deploy/coloyond_execution.so';

await access(binaryPath);
await access(programPath);
try {
  await access(upgradePath);
} catch {
  const upgrade = Keypair.generate();
  await writeFile(upgradePath, JSON.stringify(Array.from(upgrade.secretKey)), { mode: 0o600 });
  console.log(`New local upgrade authority: ${upgrade.publicKey.toBase58()}`);
}
await chmod(upgradePath, 0o600);

const cli = process.env.SOLANA_CLI || 'solana';
const result = spawnSync(cli, [
  'program', 'deploy', binaryPath,
  '--program-id', programPath,
  '--keypair', upgradePath,
  '--upgrade-authority', upgradePath,
  '--url', 'devnet',
  '--use-rpc',
], { stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Execution program deployed at ${Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(programPath, 'utf8')))).publicKey.toBase58()}`);
