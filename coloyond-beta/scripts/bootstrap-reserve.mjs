#!/usr/bin/env node
/**
 * Bootstraps the devnet demo infrastructure:
 *
 *   1. generates demo keypairs if missing (see generate-demo-keys.mjs)
 *   2. airdrops SOL to the reserve (devnet faucet, rate limited)
 *   3. creates every synthetic mint (tUSD 6d, tBTC 8d, tETH 8d; authority = reserve)
 *   4. wraps SOL into the reserve's WSOL inventory
 *   5-7. mints each synthetic inventory
 *
 * Usage: npm run bootstrap:reserve [-- --wsol 2 --tusd 30000 --tbtc 0.05 --teth 1.5]
 */
import {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import {
  MINT_SIZE,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMintInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
  mintTo,
} from '@solana/spl-token';
import { base58 } from '@scure/base';
import { ensureDemoKeys } from './generate-demo-keys.mjs';

const RPC_URL = 'https://api.devnet.solana.com';
const MAX_AIRDROPS = 6;

/** Keep in sync with src/lib/solana/assets.ts. */
const SYNTHETIC_MINTS = [
  { id: 'tusd', symbol: 'tUSD', decimals: 6 },
  { id: 'tbtc', symbol: 'tBTC', decimals: 8 },
  { id: 'teth', symbol: 'tETH', decimals: 8 },
];

function parseArgs() {
  const args = { wsol: 2, tusd: 30_000, tbtc: 0.05, teth: 1.5 };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) {
    for (const key of Object.keys(args)) {
      if (argv[i] === `--${key}`) args[key] = Number(argv[i + 1]);
    }
  }
  for (const [key, value] of Object.entries(args)) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`--${key} must be a non-negative number`);
  }
  return args;
}

const targets = parseArgs();
const targetWsolLamports = Math.floor(targets.wsol * 1e9);
const syntheticTargetsRaw = SYNTHETIC_MINTS.map((m) => ({
  ...m,
  raw: Math.floor(targets[m.id] * 10 ** m.decimals),
}));

const keys = await ensureDemoKeys();
const reserve = Keypair.fromSecretKey(base58.decode(keys.reserveSecretB58));
const mints = Object.fromEntries(
  syntheticTargetsRaw.map((m) => [
    m.id,
    { spec: m, keypair: Keypair.fromSecretKey(base58.decode(keys.mints[m.id].secretB58)) },
  ]),
);

const connection = new Connection(RPC_URL, 'confirmed');
const wsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, reserve.publicKey);

console.log(`reserve: ${reserve.publicKey.toBase58()}`);
for (const m of SYNTHETIC_MINTS) {
  console.log(`${m.symbol.padStart(5)} mint: ${mints[m.id].keypair.publicKey.toBase58()}`);
}
console.log(
  `targets: ${targets.wsol} WSOL · ${targets.tusd.toLocaleString('en-US')} tUSD · ${targets.tbtc} tBTC · ${targets.teth} tETH\n`,
);

async function signAndConfirm(tx, signers, label) {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.feePayer = signers[0].publicKey;
  const sig = await connection.sendTransaction(tx, signers);
  const conf = await connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    'confirmed',
  );
  if (conf.value.err) throw new Error(`${label} failed: ${JSON.stringify(conf.value.err)}`);
  console.log(`  ${label} confirmed (${sig.slice(0, 12)}…)`);
  return sig;
}

async function airdrop(lamports) {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const sig = await connection.requestAirdrop(reserve.publicKey, lamports);
  const conf = await connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    'confirmed',
  );
  if (conf.value.err) throw new Error(`airdrop failed: ${JSON.stringify(conf.value.err)}`);
}

/* 1. SOL for fees, rent and any missing WSOL top-up */
let wsol = 0;
const wsolRes = await connection.getTokenAccountBalance(wsolAta, 'confirmed').catch(() => null);
if (wsolRes) wsol = Number(wsolRes.value.amount);
const rentBuffer = 30_000_000;
const neededSol = rentBuffer + Math.max(0, targetWsolLamports - wsol);
let sol = await connection.getBalance(reserve.publicKey, 'confirmed');
let airdrops = 0;
console.log(`[1/7] reserve SOL: ${(sol / 1e9).toFixed(3)} (need ${(neededSol / 1e9).toFixed(3)})`);
while (sol < neededSol && airdrops < MAX_AIRDROPS) {
  try {
    process.stdout.write('  requesting 1 SOL from the devnet faucet… ');
    await airdrop(1_000_000_000);
    airdrops += 1;
    sol = await connection.getBalance(reserve.publicKey, 'confirmed');
    console.log(`ok → ${(sol / 1e9).toFixed(3)} SOL`);
  } catch (err) {
    console.log(`\n  faucet declined: ${err.message}`);
    console.log(`  retry later, or top up ${reserve.publicKey.toBase58()} manually`);
    break;
  }
}

/* 2. synthetic mints at their fixed addresses */
console.log('[2/7] synthetic mints');
for (const m of SYNTHETIC_MINTS) {
  const mint = mints[m.id].keypair;
  const info = await connection.getAccountInfo(mint.publicKey, 'confirmed');
  if (info) {
    console.log(`  ${m.symbol}: already exists — keeping it`);
  } else if (mints[m.id].spec.raw > 0) {
    const rent = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
    const tx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: reserve.publicKey,
        newAccountPubkey: mint.publicKey,
        space: MINT_SIZE,
        lamports: rent,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMintInstruction(mint.publicKey, m.decimals, reserve.publicKey, null),
    );
    await signAndConfirm(tx, [reserve, mint], `${m.symbol} mint created`);
  }
}

/* 3. WSOL inventory */
console.log('[3/7] WSOL inventory');
const wrapNeeded = targetWsolLamports - wsol;
if (wrapNeeded <= 0) {
  console.log(`  already funded: ${(wsol / 1e9).toFixed(4)} WSOL`);
} else if (sol > wrapNeeded + 10_000_000) {
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(
      reserve.publicKey,
      wsolAta,
      reserve.publicKey,
      NATIVE_MINT,
    ),
    SystemProgram.transfer({ fromPubkey: reserve.publicKey, toPubkey: wsolAta, lamports: wrapNeeded }),
    createSyncNativeInstruction(wsolAta),
  );
  await signAndConfirm(tx, [reserve], `wrapped ${(wrapNeeded / 1e9).toFixed(4)} SOL`);
  wsol += wrapNeeded;
} else {
  console.log(`  insufficient SOL: short by ${((wrapNeeded - sol) / 1e9).toFixed(3)} SOL`);
}

/* 4-7. synthetic inventories (reserve ATA + mint) */
for (const [i, m] of SYNTHETIC_MINTS.entries()) {
  console.log(`[${4 + i}/7] ${m.symbol} inventory`);
  const mint = mints[m.id].keypair;
  const ata = getAssociatedTokenAddressSync(mint.publicKey, reserve.publicKey);
  let have = 0;
  const balRes = await connection.getTokenAccountBalance(ata, 'confirmed').catch(() => null);
  if (balRes) have = Number(balRes.value.amount);
  const mintNeeded = mints[m.id].spec.raw - have;
  if (mintNeeded <= 0) {
    console.log(`  already funded: ${(have / 10 ** m.decimals).toFixed(m.decimals === 6 ? 0 : 4)} ${m.symbol}`);
    continue;
  }
  const ataInfo = await connection.getAccountInfo(ata, 'confirmed');
  if (!ataInfo) {
    const tx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(
        reserve.publicKey,
        ata,
        reserve.publicKey,
        mint.publicKey,
      ),
    );
    await signAndConfirm(tx, [reserve], `reserve ${m.symbol} account created`);
  }
  await mintTo(connection, reserve, mint.publicKey, ata, reserve, mintNeeded);
  console.log(`  minted ${(mintNeeded / 10 ** m.decimals).toLocaleString('en-US')} ${m.symbol}`);
}

sol = await connection.getBalance(reserve.publicKey, 'confirmed');
console.log('\nreserve state:');
console.log(`  SOL:  ${(sol / 1e9).toFixed(4)}`);
console.log(`  WSOL: ${(wsol / 1e9).toFixed(4)}`);
const finalSynthetic = {};
for (const m of SYNTHETIC_MINTS) {
  const ata = getAssociatedTokenAddressSync(mints[m.id].keypair.publicKey, reserve.publicKey);
  const balRes = await connection.getTokenAccountBalance(ata, 'confirmed').catch(() => null);
  const have = balRes ? Number(balRes.value.amount) : 0;
  finalSynthetic[m.id] = have;
  console.log(`  ${m.symbol}: ${(have / 10 ** m.decimals).toLocaleString('en-US', { maximumFractionDigits: 6 })}`);
}
const shortWsol = wsol < targetWsolLamports;
const shortSynthetic = syntheticTargetsRaw.some((m) => finalSynthetic[m.id] < m.raw);
if (shortWsol || shortSynthetic) {
  console.log('\nNOTE: below target — the devnet faucet is rate limited. Re-run later; the');
  console.log('script is idempotent and tops up whatever is missing.');
  process.exitCode = 1;
} else {
  console.log('\ndone. start the app with: npm run dev');
}
