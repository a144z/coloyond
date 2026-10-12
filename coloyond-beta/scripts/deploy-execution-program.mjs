#!/usr/bin/env node
/** Deploy the compiled Anchor program to devnet using local-only signers. */
import { access, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Keypair } from '@solana/web3.js';

const upgradePath = join(homedir(), '.config/solana/devnet-id.json');
const programPath = 'target/deploy/coloyond_execution-keypair.json';
const binaryPath = 'target/deploy/coloyond_execution.so';
const baseRpc = process.env.SOLANA_RPC_URL ?? 'devnet';

await access(binaryPath);
await access(programPath);
await access(upgradePath);

const cli = process.env.SOLANA_CLI || 'solana';
const result = spawnSync(cli, [
  'program', 'deploy', binaryPath,
  '--program-id', programPath,
  '--keypair', upgradePath,
  '--upgrade-authority', upgradePath,
  '--url', baseRpc,
  '--use-rpc',
], { stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Execution program deployed at ${Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(programPath, 'utf8')))).publicKey.toBase58()}`);
