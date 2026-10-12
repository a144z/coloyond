#!/usr/bin/env node
/** Create a two-asset standard-SPL vault, wrap a small SOL deposit, and mint its share tokens. */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';

const PROGRAM_ID = new PublicKey('HT7c9346N1o1TRzttWEHTg6mf7gyB1qNeV6K9VBKdN2d');
const DEVNET_USD_MINT = new PublicKey('DQZn9b9uNUZdE3AJoGoZ9hmC2NzaWxTZRo4gnNLzyuSv');
const SOL_FEED = new PublicKey('7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE');
const BASE_RPC = process.env.COLONYOND_BASE_RPC ?? 'https://rpc.magicblock.app/devnet';
const signerPath = process.env.COLONYOND_CANARY_SIGNER ?? `${homedir()}/.config/solana/devnet-id.json`;
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(signerPath, 'utf8'))));
const connection = new Connection(BASE_RPC, 'confirmed');
const id = BigInt(process.env.COLONYOND_VAULT_ID ?? Date.now());
const idBytes = Buffer.alloc(8);
idBytes.writeBigUInt64LE(id);
const vaultAssets = [NATIVE_MINT, DEVNET_USD_MINT];
const amounts = [100_000_000n, 0n]; // 0.1 wrapped SOL, supplied by the CLI Devnet wallet.
const [vaultState] = PublicKey.findProgramAddressSync(
  [Buffer.from('vault'), payer.publicKey.toBuffer(), idBytes],
  PROGRAM_ID,
);
const [vaultAuthority] = PublicKey.findProgramAddressSync(
  [Buffer.from('vault-authority'), vaultState.toBuffer()],
  PROGRAM_ID,
);
const [shareMint] = PublicKey.findProgramAddressSync(
  [Buffer.from('share-mint'), vaultState.toBuffer()],
  PROGRAM_ID,
);
const [executor] = PublicKey.findProgramAddressSync(
  [Buffer.from('executor'), vaultState.toBuffer()],
  PROGRAM_ID,
);
const vaultTokens = vaultAssets.map((mint) => getAssociatedTokenAddressSync(mint, vaultAuthority, true));
const sourceTokens = vaultAssets.map((mint) => getAssociatedTokenAddressSync(mint, payer.publicKey));
const shareToken = getAssociatedTokenAddressSync(shareMint, payer.publicKey);
const discriminator = (name) => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const u16 = (value) => { const b = Buffer.alloc(2); b.writeUInt16LE(value); return b; };
const u64 = (value) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(value)); return b; };
const vecLength = (value) => { const b = Buffer.alloc(4); b.writeUInt32LE(value); return b; };

if (await connection.getAccountInfo(vaultState, 'confirmed')) {
  throw new Error(`Vault already exists for id ${id}; set COLONYOND_VAULT_ID to a new integer.`);
}

const initializeData = Buffer.concat([
  discriminator('initialize_vault'),
  idBytes,
  vecLength(2),
  vaultAssets[0].toBuffer(), u16(5_000),
  vaultAssets[1].toBuffer(), u16(5_000),
  u16(100),
  u16(100),
]);
const initialize = new TransactionInstruction({
  programId: PROGRAM_ID,
  keys: [
    { pubkey: vaultState, isSigner: false, isWritable: true },
    { pubkey: vaultAuthority, isSigner: false, isWritable: false },
    { pubkey: shareMint, isSigner: false, isWritable: true },
    { pubkey: executor, isSigner: false, isWritable: true },
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
  ],
  data: initializeData,
});
const initializeSignature = await sendAndConfirmTransaction(connection, new Transaction().add(initialize), [payer]);

const createVaultAtas = vaultAssets.map((mint, index) => new TransactionInstruction({
  programId: PROGRAM_ID,
  keys: [
    { pubkey: vaultState, isSigner: false, isWritable: false },
    { pubkey: vaultAuthority, isSigner: false, isWritable: false },
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: vaultTokens[index], isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  data: discriminator('create_vault_asset_account'),
}));
const userAtas = [
  ...sourceTokens.map((ata, index) => createAssociatedTokenAccountIdempotentInstruction(
    payer.publicKey, ata, payer.publicKey, vaultAssets[index],
  )),
  createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, shareToken, payer.publicKey, shareMint),
];
const assetSetupSignature = await sendAndConfirmTransaction(
  connection,
  new Transaction().add(...createVaultAtas, ...userAtas),
  [payer],
);

const wrapSol = new Transaction().add(
  SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: sourceTokens[0], lamports: Number(amounts[0]) }),
  createSyncNativeInstruction(sourceTokens[0]),
);
const wrapSignature = await sendAndConfirmTransaction(connection, wrapSol, [payer]);

const deposit = new TransactionInstruction({
  programId: PROGRAM_ID,
  keys: [
    { pubkey: vaultState, isSigner: false, isWritable: false },
    { pubkey: vaultAuthority, isSigner: false, isWritable: false },
    { pubkey: shareMint, isSigner: false, isWritable: true },
    { pubkey: shareToken, isSigner: false, isWritable: true },
    { pubkey: payer.publicKey, isSigner: true, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ...sourceTokens.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true })),
    ...vaultTokens.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true })),
    { pubkey: SOL_FEED, isSigner: false, isWritable: false },
  ],
  data: Buffer.concat([
    discriminator('deposit'),
    vecLength(amounts.length),
    ...amounts.map(u64),
    u64(0),
  ]),
});
const depositSignature = await sendAndConfirmTransaction(connection, new Transaction().add(deposit), [payer]);
const [solBalance, usdBalance, shareBalance] = await Promise.all([
  connection.getTokenAccountBalance(vaultTokens[0], 'confirmed'),
  connection.getTokenAccountBalance(vaultTokens[1], 'confirmed'),
  connection.getTokenAccountBalance(shareToken, 'confirmed'),
]);

console.log(JSON.stringify({
  vaultState: vaultState.toBase58(),
  vaultAuthority: vaultAuthority.toBase58(),
  shareMint: shareMint.toBase58(),
  executor: executor.toBase58(),
  assets: vaultAssets.map((mint, index) => ({
    mint: mint.toBase58(),
    targetBps: 5_000,
    vaultTokenAccount: vaultTokens[index].toBase58(),
    amount: index === 0 ? solBalance.value.uiAmountString : usdBalance.value.uiAmountString,
  })),
  userShareTokenAccount: shareToken.toBase58(),
  userShares: shareBalance.value.uiAmountString,
  initializeSignature,
  assetSetupSignature,
  wrapSignature,
  depositSignature,
}, null, 2));
