import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { Buffer } from 'buffer';
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import {
  DELEGATION_PROGRAM_ID,
  MAGIC_PROGRAM_ID,
  delegateSpl,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationMetadataPdaFromDelegatedAccount,
  delegationRecordPdaFromDelegatedAccount,
} from '@magicblock-labs/ephemeral-rollups-sdk';
import { mintOf, type AssetId } from './assets';
import { DEMO_RESERVE_PUBLIC_KEY, EXECUTION_PROGRAM_ID } from './config';
import { connection, ephemeralConnection } from './connection';
import { signSendConfirm, type TxResult } from './tx';

export const EXECUTION_PROGRAM = new PublicKey(EXECUTION_PROGRAM_ID);
export const RESERVE_OWNER = new PublicKey(DEMO_RESERVE_PUBLIC_KEY);
const PORTFOLIO_SEED = Buffer.from('portfolio');
const VAULT_DELEGATE_SEED = Buffer.from('vault-delegate');
const RESERVE_DELEGATE_SEED = Buffer.from('reserve-delegate');
const ORACLE_FEEDS: Partial<Record<AssetId, PublicKey>> = {
  wsol: new PublicKey('ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu'),
  tbtc: new PublicKey('71wtTRDY8Gxgw56bXFt2oc6qeAbTxzStdNiC425Z51sr'),
  teth: new PublicKey('5vaYr1hpv8yrSpu8w3K95x22byYxUJCCNCSYJtqVWPvG'),
};

const DISCRIMINATOR = {
  initialize: [0x7a, 0xb1, 0xce, 0xa9, 0x81, 0x55, 0x1a, 0xc0],
  authorizeVault: [0xd3, 0xb5, 0x9c, 0x1f, 0xf3, 0xdc, 0x80, 0x7f],
  schedule: [0x84, 0x79, 0x4a, 0x97, 0x25, 0xb7, 0x28, 0x55],
  setActive: [0x1d, 0x10, 0xe1, 0x84, 0x26, 0xd8, 0xce, 0x21],
  updateTargets: [0xaa, 0x7b, 0xef, 0x60, 0x3f, 0x4d, 0x67, 0xb9],
  delegate: [0x5a, 0x93, 0x4b, 0xb2, 0x55, 0x58, 0x04, 0x89],
} as const;

export function portfolioAddress(vault: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([PORTFOLIO_SEED, vault.toBuffer()], EXECUTION_PROGRAM)[0];
}

export function vaultDelegateAddress(vault: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([VAULT_DELEGATE_SEED, vault.toBuffer()], EXECUTION_PROGRAM)[0];
}

export function reserveDelegateAddress(): PublicKey {
  return PublicKey.findProgramAddressSync([RESERVE_DELEGATE_SEED, RESERVE_OWNER.toBuffer()], EXECUTION_PROGRAM)[0];
}

function ix(discriminator: readonly number[], keys: TransactionInstruction['keys'], args = Buffer.alloc(0)) {
  return new TransactionInstruction({
    programId: EXECUTION_PROGRAM,
    keys,
    data: Buffer.concat([Buffer.from([...discriminator]), args]),
  });
}

function vec<T>(items: T[], encode: (item: T) => Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32LE(items.length, 0);
  return Buffer.concat([length, ...items.map(encode)]);
}

function u16(value: number): Buffer {
  const out = Buffer.alloc(2);
  out.writeUInt16LE(value, 0);
  return out;
}

function i64(value: number): Buffer {
  const out = Buffer.alloc(8);
  new DataView(out.buffer, out.byteOffset, out.byteLength).setBigInt64(0, BigInt(value), true);
  return out;
}

function assetTag(id: AssetId): number {
  return ({ wsol: 0, tusd: 1, tbtc: 2, teth: 3 })[id];
}

async function sendEphemeral(tx: Transaction, signers: Keypair[]): Promise<TxResult> {
  const { blockhash, lastValidBlockHeight } = await ephemeralConnection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  const sig = await ephemeralConnection.sendTransaction(tx, signers, { skipPreflight: false });
  const confirmed = await ephemeralConnection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    'confirmed',
  );
  if (confirmed.value.err) throw new Error(`Ephemeral Rollup transaction failed: ${JSON.stringify(confirmed.value.err)}`);
  return { sig, slot: confirmed.context.slot };
}

async function waitForErAccount(address: PublicKey, label: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await ephemeralConnection.getAccountInfo(address, 'confirmed')) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${label} was not available on the MagicBlock rollup after 30 seconds`);
}

export async function initializeAndSchedulePortfolio(params: {
  owner: Keypair;
  vault: Keypair;
  assets: AssetId[];
  targets: Record<string, number>;
  thresholdPct: number;
  taskId: number;
}): Promise<{ initialize: TxResult; delegate: TxResult; schedule: TxResult }> {
  const { owner, vault, assets, targets, thresholdPct, taskId } = params;
  const portfolio = portfolioAddress(vault.publicKey);
  const targetBps = assets.map((id) => Math.round((targets[id] ?? 0) * 100));
  if (targetBps.reduce((sum, value) => sum + value, 0) !== 10_000) {
    throw new Error('Portfolio target weights must total 100% before scheduling.');
  }

  const args = Buffer.concat([
    RESERVE_OWNER.toBuffer(),
    vec(assets, (id) => Buffer.from([assetTag(id)])),
    vec(assets.map(mintOf), (mint) => mint.toBuffer()),
    vec(targetBps, u16),
    u16(Math.round(thresholdPct * 100)),
    i64(taskId),
  ]);
  const initialize = new Transaction().add(
    ix(DISCRIMINATOR.initialize, [
      { pubkey: portfolio, isSigner: false, isWritable: true },
      { pubkey: vault.publicKey, isSigner: false, isWritable: false },
      { pubkey: owner.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ], args),
  );
  initialize.feePayer = owner.publicKey;
  const initialized = await signSendConfirm(initialize, [owner]);

  const delegationBuffer = delegateBufferPdaFromDelegatedAccountAndOwnerProgram(portfolio, EXECUTION_PROGRAM);
  const delegationRecord = delegationRecordPdaFromDelegatedAccount(portfolio);
  const delegationMetadata = delegationMetadataPdaFromDelegatedAccount(portfolio);
  const delegateTx = new Transaction().add(
    ix(DISCRIMINATOR.delegate, [
      { pubkey: owner.publicKey, isSigner: true, isWritable: false },
      { pubkey: vault.publicKey, isSigner: false, isWritable: false },
      { pubkey: delegationBuffer, isSigner: false, isWritable: true },
      { pubkey: delegationRecord, isSigner: false, isWritable: true },
      { pubkey: delegationMetadata, isSigner: false, isWritable: true },
      { pubkey: portfolio, isSigner: false, isWritable: true },
      { pubkey: EXECUTION_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: DELEGATION_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ]),
  );
  delegateTx.feePayer = owner.publicKey;
  const delegated = await signSendConfirm(delegateTx, [owner]);
  await waitForErAccount(portfolio, 'Portfolio state');

  // Move each canonical SPL balance into the ER and approve the program PDA there.
  for (const id of assets) {
    const mint = mintOf(id);
    const ata = getAssociatedTokenAddressSync(mint, vault.publicKey);
    const balance = await connection.getTokenAccountBalance(ata, 'confirmed');
    const amount = BigInt(balance.value.amount);
    const instructions = await delegateSpl(vault.publicKey, mint, amount, {
      idempotent: false,
      payer: owner.publicKey,
    });
    const tokenDelegateTx = new Transaction().add(...instructions);
    tokenDelegateTx.feePayer = owner.publicKey;
    await signSendConfirm(tokenDelegateTx, [owner, vault]);
    await waitForErAccount(ata, `${id} vault token account`);
    const approveVault = new Transaction().add(
      ix(DISCRIMINATOR.authorizeVault, [
        { pubkey: portfolio, isSigner: false, isWritable: false },
        { pubkey: vault.publicKey, isSigner: true, isWritable: false },
        { pubkey: vaultDelegateAddress(vault.publicKey), isSigner: false, isWritable: false },
        { pubkey: ata, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ]),
    );
    approveVault.feePayer = owner.publicKey;
    await sendEphemeral(approveVault, [owner, vault]);
  }

  const tokenAccounts = assets.map((id) => getAssociatedTokenAddressSync(mintOf(id), vault.publicKey));
  const reserveAccounts = assets.map((id) => getAssociatedTokenAddressSync(mintOf(id), RESERVE_OWNER));
  const oracleAccounts = assets.flatMap((id) => ORACLE_FEEDS[id] ? [ORACLE_FEEDS[id]!] : []);
  const tokenRemaining = [...tokenAccounts, ...reserveAccounts].map((pubkey) => ({
    pubkey,
    isSigner: false,
    isWritable: true,
  }));
  const oracleRemaining = oracleAccounts.map((pubkey) => ({ pubkey, isSigner: false, isWritable: false }));

  const schedule = new Transaction().add(
    ix(DISCRIMINATOR.schedule, [
      { pubkey: MAGIC_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: owner.publicKey, isSigner: true, isWritable: true },
      { pubkey: portfolio, isSigner: false, isWritable: true },
      { pubkey: owner.publicKey, isSigner: true, isWritable: false },
      { pubkey: vaultDelegateAddress(vault.publicKey), isSigner: false, isWritable: false },
      { pubkey: reserveDelegateAddress(), isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: EXECUTION_PROGRAM, isSigner: false, isWritable: false },
      ...tokenRemaining,
      ...oracleRemaining,
    ]),
  );
  schedule.feePayer = owner.publicKey;
  const scheduled = await sendEphemeral(schedule, [owner]);
  return { initialize: initialized, delegate: delegated, schedule: scheduled };
}

export async function setPortfolioActive(owner: Keypair, vault: PublicKey, active: boolean): Promise<TxResult> {
  const data = Buffer.from([active ? 1 : 0]);
  const tx = new Transaction().add(ix(DISCRIMINATOR.setActive, [
    { pubkey: portfolioAddress(vault), isSigner: false, isWritable: true },
    { pubkey: owner.publicKey, isSigner: true, isWritable: false },
  ], data));
  tx.feePayer = owner.publicKey;
  return sendEphemeral(tx, [owner]);
}

export async function updatePortfolioTargets(
  owner: Keypair,
  vault: PublicKey,
  assets: AssetId[],
  targets: Record<string, number>,
): Promise<TxResult> {
  const values = assets.map((id) => Math.round((targets[id] ?? 0) * 100));
  if (values.reduce((sum, value) => sum + value, 0) !== 10_000) throw new Error('Target weights must total 100%.');
  const encoded = vec(values, u16);
  const tx = new Transaction().add(ix(DISCRIMINATOR.updateTargets, [
    { pubkey: portfolioAddress(vault), isSigner: false, isWritable: true },
    { pubkey: owner.publicKey, isSigner: true, isWritable: false },
  ], encoded));
  tx.feePayer = owner.publicKey;
  return sendEphemeral(tx, [owner]);
}
