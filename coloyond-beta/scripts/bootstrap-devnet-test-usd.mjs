#!/usr/bin/env node
/** Create a capped, valueless classic SPL test USD mint and seed the PDA-controlled market ATA once. */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMintInstruction,
  getAssociatedTokenAddressSync,
  getMint,
} from '@solana/spl-token';

const PROGRAM_ID = new PublicKey('HT7c9346N1o1TRzttWEHTg6mf7gyB1qNeV6K9VBKdN2d');
const EXPECTED_MINT = new PublicKey('DQZn9b9uNUZdE3AJoGoZ9hmC2NzaWxTZRo4gnNLzyuSv');
const CAP_RAW = 100_000_000_000n;
const INITIAL_ISSUANCE_RAW = 500_000_000n;
const BASE_RPC = process.env.COLONYOND_BASE_RPC ?? 'https://rpc.magicblock.app/devnet';
const signerPath = process.env.COLONYOND_CANARY_SIGNER ?? `${homedir()}/.config/solana/devnet-id.json`;
const mintPath = process.env.COLONYOND_TEST_USD_MINT_KEYPAIR ?? 'target/devnet-test-usd-mint.json';
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(signerPath, 'utf8'))));
const mintKeypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(mintPath, 'utf8'))));
if (!mintKeypair.publicKey.equals(EXPECTED_MINT)) throw new Error('Local mint keypair does not match the program-approved Devnet USD mint.');

const connection = new Connection(BASE_RPC, 'confirmed');
const [marketAuthority] = PublicKey.findProgramAddressSync([Buffer.from('market-authority')], PROGRAM_ID);
const [marketConfig] = PublicKey.findProgramAddressSync([Buffer.from('market-config')], PROGRAM_ID);
const marketToken = getAssociatedTokenAddressSync(EXPECTED_MINT, marketAuthority, true);
const discriminator = (name) => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const u64le = (value) => {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(value));
  return bytes;
};

if (!(await connection.getAccountInfo(EXPECTED_MINT, 'confirmed'))) {
  const lamports = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
  const createMint = SystemProgram.createAccount({
    fromPubkey: payer.publicKey,
    newAccountPubkey: EXPECTED_MINT,
    lamports,
    space: MINT_SIZE,
    programId: TOKEN_PROGRAM_ID,
  });
  const initializeMint = createInitializeMintInstruction(EXPECTED_MINT, 6, marketAuthority, null, TOKEN_PROGRAM_ID);
  await sendAndConfirmTransaction(connection, new Transaction().add(createMint, initializeMint), [payer, mintKeypair]);
}

const mint = await getMint(connection, EXPECTED_MINT, 'confirmed', TOKEN_PROGRAM_ID);
if (mint.decimals !== 6 || !mint.mintAuthority?.equals(marketAuthority) || mint.freezeAuthority) {
  throw new Error('Devnet USD mint does not have the expected decimals, PDA mint authority, or no-freeze configuration.');
}

if (!(await connection.getAccountInfo(marketConfig, 'confirmed'))) {
  const initializeConfig = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: marketConfig, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: discriminator('initialize_market_config'),
  });
  await sendAndConfirmTransaction(connection, new Transaction().add(initializeConfig), [payer]);
}

const createMarketAta = createAssociatedTokenAccountIdempotentInstruction(
  payer.publicKey,
  marketToken,
  marketAuthority,
  EXPECTED_MINT,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
);
await sendAndConfirmTransaction(connection, new Transaction().add(createMarketAta), [payer]);

const configInfo = await connection.getAccountInfo(marketConfig, 'confirmed');
if (!configInfo || !configInfo.owner.equals(PROGRAM_ID) || configInfo.data.length < 48) {
  throw new Error('Market cap account is missing or malformed.');
}
const issuedRaw = configInfo.data.readBigUInt64LE(40);
if (issuedRaw === 0n) {
  if (INITIAL_ISSUANCE_RAW > CAP_RAW) throw new Error('Initial issuance exceeds the configured lifetime cap.');
  const issue = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: marketConfig, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: false },
      { pubkey: marketAuthority, isSigner: false, isWritable: false },
      { pubkey: EXPECTED_MINT, isSigner: false, isWritable: true },
      { pubkey: marketToken, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([discriminator('issue_devnet_usd'), u64le(INITIAL_ISSUANCE_RAW)]),
  });
  await sendAndConfirmTransaction(connection, new Transaction().add(issue), [payer]);
} else if (issuedRaw !== BigInt(mint.supply)) {
  throw new Error(`Market cap counter (${issuedRaw}) does not match mint supply (${mint.supply}).`);
}

const [marketInfo, finalMint] = await Promise.all([
  connection.getTokenAccountBalance(marketToken, 'confirmed'),
  getMint(connection, EXPECTED_MINT, 'confirmed', TOKEN_PROGRAM_ID),
]);
console.log(JSON.stringify({
  mint: EXPECTED_MINT.toBase58(),
  decimals: finalMint.decimals,
  mintAuthority: marketAuthority.toBase58(),
  freezeAuthority: null,
  marketConfig: marketConfig.toBase58(),
  lifetimeCapTokens: '100000',
  lifetimeIssuedTokens: (BigInt(finalMint.supply) / 1_000_000n).toString(),
  marketTokenAccount: marketToken.toBase58(),
  marketBalance: marketInfo.value.uiAmountString,
}, null, 2));
