#!/usr/bin/env node
/** Create market ATAs, delegate only a vault Executor PDA, and register its ER Hydra task. */
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
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import {
  DELEGATION_PROGRAM_ID,
  EPHEMERAL_VAULT_ID,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
  ConnectionMagicRouter,
  delegationMetadataPdaFromDelegatedAccount,
  delegationRecordPdaFromDelegatedAccount,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  magicFeeVaultPdaFromValidator,
} from '@magicblock-labs/ephemeral-rollups-sdk';

const PROGRAM_ID = new PublicKey('HT7c9346N1o1TRzttWEHTg6mf7gyB1qNeV6K9VBKdN2d');
const HYDRA_EPHEMERAL_PROGRAM_ID = new PublicKey('eHyd5BU8QffvHi4GnXwxrK4WpS7pM2x9UGKHBWii7mf');
const INSTRUCTIONS_SYSVAR_ID = new PublicKey('Sysvar1nstructions1111111111111111111111111');
const BASE_RPC = process.env.COLONYOND_BASE_RPC ?? 'https://rpc.magicblock.app/devnet';
const ROUTER_RPC = process.env.COLONYOND_ROUTER_RPC ?? 'https://devnet-router.magicblock.app/';
const signerPath = process.env.COLONYOND_CANARY_SIGNER ?? `${homedir()}/.config/solana/devnet-id.json`;
const vaultState = new PublicKey(process.env.COLONYOND_VAULT_STATE ?? '6Eqq3CowkjQzzH4oeDbh7RNCuqyQXbZ3R41qhMxHjw3U');
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(signerPath, 'utf8'))));
const base = new Connection(BASE_RPC, 'confirmed');
const router = new ConnectionMagicRouter(ROUTER_RPC, 'confirmed');

const discriminator = (name) => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const [vaultAuthority] = PublicKey.findProgramAddressSync(
  [Buffer.from('vault-authority'), vaultState.toBuffer()],
  PROGRAM_ID,
);
const [executor] = PublicKey.findProgramAddressSync(
  [Buffer.from('executor'), vaultState.toBuffer()],
  PROGRAM_ID,
);
const [marketAuthority] = PublicKey.findProgramAddressSync([Buffer.from('market-authority')], PROGRAM_ID);

const stateInfo = await base.getAccountInfo(vaultState, 'confirmed');
if (!stateInfo || !stateInfo.owner.equals(PROGRAM_ID) || stateInfo.data.length < 98) {
  throw new Error('Vault State is missing, malformed, or owned by a different program.');
}
if (!stateInfo.data.subarray(16, 48).equals(payer.publicKey.toBuffer())) {
  throw new Error('The configured signer is not the owner of this Vault State.');
}
if (stateInfo.data.readUInt8(80) !== 1) throw new Error('Vault is inactive; activate it before scheduling.');

const assetCount = stateInfo.data.readUInt32LE(94);
if (assetCount === 0 || assetCount > 4 || stateInfo.data.length < 98 + assetCount * 99) {
  throw new Error('Vault State has an invalid asset list.');
}
const assets = Array.from({ length: assetCount }, (_, i) => {
  const offset = 98 + i * 99;
  return {
    mint: new PublicKey(stateInfo.data.subarray(offset, offset + 32)),
    feed: new PublicKey(stateInfo.data.subarray(offset + 35, offset + 67)),
  };
});
const vaultTokens = assets.map(({ mint }) => getAssociatedTokenAddressSync(mint, vaultAuthority, true));
const marketTokens = assets.map(({ mint }) => getAssociatedTokenAddressSync(mint, marketAuthority, true));
const oracleFeeds = assets.map(({ feed }) => feed).filter((feed) => !feed.equals(PublicKey.default));

// Create the program-controlled market ATAs on L1. These remain ordinary SPL accounts.
const marketSetup = new Transaction();
for (let i = 0; i < assets.length; i++) {
  if (await base.getAccountInfo(marketTokens[i], 'confirmed')) continue;
  marketSetup.add(new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: marketAuthority, isSigner: false, isWritable: false },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: assets[i].mint, isSigner: false, isWritable: false },
      { pubkey: marketTokens[i], isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: discriminator('create_market_asset_account'),
  }));
}
if (marketSetup.instructions.length > 0) {
  await sendAndConfirmTransaction(base, marketSetup, [payer]);
}

// Delegate only the non-token Executor PDA; vault SPL ATAs are intentionally untouched.
const executorStatus = await router.getDelegationStatus(executor);
if (!executorStatus.isDelegated) {
  const buffer = delegateBufferPdaFromDelegatedAccountAndOwnerProgram(executor, PROGRAM_ID);
  const record = delegationRecordPdaFromDelegatedAccount(executor);
  const metadata = delegationMetadataPdaFromDelegatedAccount(executor);
  const delegateExecutor = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: vaultState, isSigner: false, isWritable: false },
      { pubkey: buffer, isSigner: false, isWritable: true },
      { pubkey: record, isSigner: false, isWritable: true },
      { pubkey: metadata, isSigner: false, isWritable: true },
      { pubkey: executor, isSigner: false, isWritable: true },
      { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: DELEGATION_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: discriminator('delegate_executor'),
  });
  await sendAndConfirmTransaction(base, new Transaction().add(delegateExecutor), [payer]);
}

let delegated = false;
for (let attempt = 0; attempt < 30; attempt++) {
  if ((await router.getDelegationStatus(executor)).isDelegated) {
    delegated = true;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}
if (!delegated) throw new Error('Executor delegation did not become visible on MagicBlock Devnet.');

const seed = vaultState.toBuffer();
const [crank] = PublicKey.findProgramAddressSync(
  [Buffer.from('crank'), executor.toBuffer(), seed],
  HYDRA_EPHEMERAL_PROGRAM_ID,
);
if (await router.getAccountInfo(crank, 'confirmed')) {
  throw new Error(`A Hydra schedule already exists for this vault: ${crank.toBase58()}`);
}
const liveExecutorStatus = await router.getDelegationStatus(executor);
if (!liveExecutorStatus.isDelegated || !liveExecutorStatus.fqdn) {
  throw new Error('Executor delegation is not available for Hydra schedule registration.');
}
const identityResponse = await fetch(liveExecutorStatus.fqdn, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getIdentity', params: [] }),
});
const identityData = await identityResponse.json();
if (!identityResponse.ok || identityData.error || !identityData.result?.identity) {
  throw new Error('Could not resolve the validator that hosts this Executor delegation.');
}
const validator = new PublicKey(identityData.result.identity);
const magicFeeVault = magicFeeVaultPdaFromValidator(validator);
const schedule = new TransactionInstruction({
  programId: PROGRAM_ID,
  keys: [
    { pubkey: vaultState, isSigner: false, isWritable: false },
    { pubkey: payer.publicKey, isSigner: true, isWritable: false },
    { pubkey: vaultAuthority, isSigner: false, isWritable: false },
    { pubkey: executor, isSigner: false, isWritable: true },
    { pubkey: marketAuthority, isSigner: false, isWritable: false },
    { pubkey: crank, isSigner: false, isWritable: true },
    { pubkey: INSTRUCTIONS_SYSVAR_ID, isSigner: false, isWritable: false },
    { pubkey: MAGIC_CONTEXT_ID, isSigner: false, isWritable: true },
    { pubkey: magicFeeVault, isSigner: false, isWritable: true },
    { pubkey: MAGIC_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: EPHEMERAL_VAULT_ID, isSigner: false, isWritable: true },
    { pubkey: HYDRA_EPHEMERAL_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ...vaultTokens.map((pubkey) => ({ pubkey, isSigner: false, isWritable: false })),
    ...marketTokens.map((pubkey) => ({ pubkey, isSigner: false, isWritable: false })),
    ...oracleFeeds.map((pubkey) => ({ pubkey, isSigner: false, isWritable: false })),
  ],
  data: discriminator('schedule_rebalance'),
});
const tx = new Transaction().add(schedule);
const signature = await router.sendAndConfirmTransaction(tx, [payer]);
const crankInfo = await router.getAccountInfo(crank, 'confirmed');
if (!crankInfo || crankInfo.owner.toBase58() !== HYDRA_EPHEMERAL_PROGRAM_ID.toBase58()) {
  throw new Error('Schedule transaction confirmed, but its Hydra crank account is missing or has the wrong owner.');
}
const registeredIntervalSlots = Number(crankInfo.data.readBigUInt64LE(72));

console.log(JSON.stringify({
  vaultState: vaultState.toBase58(),
  executor: executor.toBase58(),
  executorDelegated: true,
  vaultTokenAccounts: vaultTokens.map((key) => key.toBase58()),
  marketTokenAccounts: marketTokens.map((key) => key.toBase58()),
  hydraCrank: crank.toBase58(),
  requestedIntervalSlots: 5700,
  registeredIntervalSlots,
  intervalMatchesRequested: registeredIntervalSlots === 5700,
  targetIntervalSeconds: 60,
  scheduleSignature: signature,
  note: 'The registered interval is read back from the ER crank account. A Hydra cranker and funded, drifted vault balances are required for a rebalance action.',
}, null, 2));
