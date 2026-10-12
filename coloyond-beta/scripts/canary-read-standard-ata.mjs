#!/usr/bin/env node
/**
 * Invoke the read-only ER canary against a nondelegated classic SPL account
 * owned by the supplied Vault Authority. Set account + authority, and
 * optionally COLONYOND_CANARY_SIGNER / COLONYOND_EXECUTION_PROGRAM.
 */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, unpackAccount } from '@solana/spl-token';
import { ConnectionMagicRouter } from '@magicblock-labs/ephemeral-rollups-sdk';

const accountAddress = process.env.COLONYOND_CANARY_ACCOUNT;
if (!accountAddress) throw new Error('Set COLONYOND_CANARY_ACCOUNT to a standard SPL token account address.');
const expectedAuthorityAddress = process.env.COLONYOND_CANARY_AUTHORITY;
if (!expectedAuthorityAddress) throw new Error('Set COLONYOND_CANARY_AUTHORITY to the expected Vault Authority PDA.');

const signerPath = process.env.COLONYOND_CANARY_SIGNER ?? `${homedir()}/.config/solana/devnet-id.json`;
const secret = Uint8Array.from(JSON.parse(await readFile(signerPath, 'utf8')));
const payer = Keypair.fromSecretKey(secret);
const programId = new PublicKey(
  process.env.COLONYOND_EXECUTION_PROGRAM ?? 'HT7c9346N1o1TRzttWEHTg6mf7gyB1qNeV6K9VBKdN2d',
);
const tokenAccount = new PublicKey(accountAddress);
const expectedAuthority = new PublicKey(expectedAuthorityAddress);
const baseConnection = new Connection(process.env.COLONYOND_BASE_RPC ?? 'https://api.devnet.solana.com', 'confirmed');
const baseAccountInfo = await baseConnection.getAccountInfo(tokenAccount, 'confirmed');
if (!baseAccountInfo) throw new Error('The selected token account does not exist on Solana Devnet.');
const baseTokenAccount = unpackAccount(tokenAccount, baseAccountInfo, TOKEN_PROGRAM_ID);
if (!baseTokenAccount.owner.equals(expectedAuthority)) throw new Error('The token account authority does not match the supplied Vault Authority PDA.');
if (!getAssociatedTokenAddressSync(baseTokenAccount.mint, expectedAuthority, true).equals(tokenAccount)) {
  throw new Error('The selected address is not the associated token account for this mint and Vault Authority PDA.');
}

const connection = new Connection('https://devnet.magicblock.app/', 'confirmed');
const router = new ConnectionMagicRouter('https://devnet-router.magicblock.app/', 'confirmed');
const delegation = await router.getDelegationStatus(tokenAccount);
if (delegation?.isDelegated !== false) {
  throw new Error('MagicBlock reports this account as delegated; choose a base-layer-only vault ATA.');
}
const discriminator = createHash('sha256').update('global:canary_read_standard_ata').digest().subarray(0, 8);
const ix = new TransactionInstruction({
  programId,
  keys: [
    { pubkey: tokenAccount, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ],
  data: Buffer.concat([discriminator, expectedAuthority.toBuffer()]),
});

const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
const tx = new Transaction({ feePayer: payer.publicKey, blockhash, lastValidBlockHeight }).add(ix);
const signature = await connection.sendTransaction(tx, [payer], { skipPreflight: false });
const confirmation = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
if (confirmation.value.err) throw new Error(`ER canary failed: ${JSON.stringify(confirmation.value.err)}`);

const transaction = await connection.getTransaction(signature, {
  commitment: 'confirmed',
  maxSupportedTransactionVersion: 0,
});
const canaryLog = transaction?.meta?.logMessages?.find((line) => line.includes('STANDARD_SPL_ATA_CANARY'));
if (!canaryLog) throw new Error(`Transaction confirmed without the canary log: ${signature}`);
console.log(canaryLog);
console.log(`signature=${signature}`);
