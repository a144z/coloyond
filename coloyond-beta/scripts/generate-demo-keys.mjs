#!/usr/bin/env node
/**
 * Generates the devnet demo keypairs and writes them to
 * src/lib/solana/demo-keys.json (the app and the bootstrap script share
 * this file as the source of truth).
 *
 *   reserve keypair  – the funded swap counterparty for all assets
 *   mint keypairs    – owners of the fixed-address synthetic mints:
 *                      tUSD (6 decimals, fixed $1)
 *                      tBTC (8 decimals, live BTC-USD mid)
 *                      tETH (8 decimals, live ETH-USD mid)
 *
 * These are DEVNET-ONLY. They ship with the demo on purpose (the product
 * design calls for "a funded test reserve as the counterparty") and must
 * never hold mainnet value.
 *
 * Keep SYNTHETIC_MINT_IDS in sync with src/lib/solana/assets.ts.
 */
import { Keypair } from '@solana/web3.js';
import { base58 } from '@scure/base';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const keysPath = join(here, '..', 'src', 'lib', 'solana', 'demo-keys.json');

const SYNTHETIC_MINT_IDS = ['tusd', 'tbtc', 'teth'];

const NOTE =
  'DEVNET-ONLY demo infrastructure: funded reserve counterparty + synthetic mint authorities (tUSD/tBTC/tETH). Never hold mainnet value here. Replace with a backend service in production.';

/**
 * Idempotent: existing keys are never overwritten. Upgrades the v1 shape
 * (single tUSD mint) to the multi-mint shape while preserving every key that
 * already exists on-chain. Returns the key JSON.
 */
export async function ensureDemoKeys() {
  const existing = JSON.parse(await readFile(keysPath, 'utf8'));

  const next = { reserveSecretB58: '', mints: {}, note: NOTE };

  if (existing.reserveSecretB58 && existing.mints?.tusd?.secretB58) {
    // current multi-mint shape
    next.reserveSecretB58 = existing.reserveSecretB58;
    for (const id of SYNTHETIC_MINT_IDS) {
      if (existing.mints[id]?.secretB58 && existing.mints[id]?.address) {
        next.mints[id] = existing.mints[id];
      }
    }
  } else if (existing.reserveSecretB58 && existing.mintSecretB58 && existing.mintAddress) {
    // v1 shape: migrate, preserving the funded reserve and on-chain tUSD mint
    next.reserveSecretB58 = existing.reserveSecretB58;
    next.mints.tusd = { secretB58: existing.mintSecretB58, address: existing.mintAddress };
  } else if (existing.reserveSecretB58) {
    next.reserveSecretB58 = existing.reserveSecretB58;
  }

  if (!next.reserveSecretB58) {
    const reserve = Keypair.generate();
    next.reserveSecretB58 = base58.encode(reserve.secretKey);
  }
  for (const id of SYNTHETIC_MINT_IDS) {
    if (!next.mints[id]) {
      const mint = Keypair.generate();
      next.mints[id] = { secretB58: base58.encode(mint.secretKey), address: mint.publicKey.toBase58() };
    }
  }

  await writeFile(keysPath, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const keys = await ensureDemoKeys();
  const reservePub = Keypair.fromSecretKey(base58.decode(keys.reserveSecretB58)).publicKey;
  console.log(`demo keys: ${keysPath}`);
  console.log(`  reserve: ${reservePub.toBase58()}`);
  for (const id of SYNTHETIC_MINT_IDS) {
    console.log(`  ${id.padEnd(6)}: ${keys.mints[id].address}`);
  }
  console.log('next: npm run bootstrap:reserve');
}
