#!/usr/bin/env node
/** Create a minimal real Vault State and a classic SPL ATA for the ER read canary. */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { Connection, Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';

const BASE_RPC = process.env.COLONYOND_BASE_RPC ?? 'https://rpc.magicblock.app/devnet';
const PROGRAM_ID = new PublicKey('HT7c9346N1o1TRzttWEHTg6mf7gyB1qNeV6K9VBKdN2d');
const TUSD_MINT = new PublicKey('39Byty3S2nCgRHk6kshaDiX6UKi7RjGmLVP4Qpz2ZK1D');
const signerPath = process.env.COLONYOND_CANARY_SIGNER ?? `${homedir()}/.config/solana/devnet-id.json`;
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(signerPath, 'utf8'))));
const connection = new Connection(BASE_RPC, 'confirmed');

const id = BigInt(process.env.COLONYOND_VAULT_ID ?? Date.now());
const idBytes = Buffer.alloc(8);
idBytes.writeBigUInt64LE(id);
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
const vaultToken = getAssociatedTokenAddressSync(TUSD_MINT, vaultAuthority, true);
const discriminator = (name) => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const u16 = (value) => {
  const data = Buffer.alloc(2);
  data.writeUInt16LE(value);
  return data;
};

if (await connection.getAccountInfo(vaultState, 'confirmed')) {
  throw new Error(`Vault already exists for id ${id}; set COLONYOND_VAULT_ID to a new integer.`);
}

const initializeData = Buffer.concat([
  discriminator('initialize_vault'),
  idBytes,
  Buffer.from([1, 0, 0, 0]),
  TUSD_MINT.toBuffer(),
  u16(10_000),
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

const createAssetData = discriminator('create_vault_asset_account');
const createAssetAccount = new TransactionInstruction({
  programId: PROGRAM_ID,
  keys: [
    { pubkey: vaultState, isSigner: false, isWritable: false },
    { pubkey: vaultAuthority, isSigner: false, isWritable: false },
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: TUSD_MINT, isSigner: false, isWritable: false },
    { pubkey: vaultToken, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ],
  data: createAssetData,
});
const assetSignature = await sendAndConfirmTransaction(connection, new Transaction().add(createAssetAccount), [payer]);

console.log(JSON.stringify({
  vaultState: vaultState.toBase58(),
  vaultAuthority: vaultAuthority.toBase58(),
  shareMint: shareMint.toBase58(),
  executor: executor.toBase58(),
  vaultTokenAccount: vaultToken.toBase58(),
  initializeSignature,
  assetAccountSignature: assetSignature,
}, null, 2));
