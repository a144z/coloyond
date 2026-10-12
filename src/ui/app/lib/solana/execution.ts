import { Buffer } from 'buffer';
import {
  AccountInfo,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import {
  ConnectionMagicRouter,
  DELEGATION_PROGRAM_ID,
  EPHEMERAL_VAULT_ID,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationMetadataPdaFromDelegatedAccount,
  delegationRecordPdaFromDelegatedAccount,
  createDelegateInstruction,
  magicFeeVaultPdaFromValidator,
} from '@magicblock-labs/ephemeral-rollups-sdk';
import { mintOf, mintToAssetMap, type AssetId } from './assets.js';
import { EXECUTION_PROGRAM_ID, ROUTER_RPC_URL } from './config.js';
import { connection } from './connection.js';
import { wrapSolInstructions } from './wallet.js';
import { signSendConfirm, type OwnerSigner, type TxResult } from './tx.js';

export const EXECUTION_PROGRAM = new PublicKey(EXECUTION_PROGRAM_ID);
export const HYDRA_EPHEMERAL_PROGRAM = new PublicKey('eHyd5BU8QffvHi4GnXwxrK4WpS7pM2x9UGKHBWii7mf');
export const MARKET_AUTHORITY_SEED = Buffer.from('market-authority');
export const REBALANCE_INTERVAL_SLOTS = 5_700;
export const TARGET_REBALANCE_SECONDS = 60;
const VAULT_SEED = Buffer.from('vault');
const VAULT_AUTHORITY_SEED = Buffer.from('vault-authority');
const SHARE_MINT_SEED = Buffer.from('share-mint');
const EXECUTOR_SEED = Buffer.from('executor');
const SCHEDULER_CONFIG_SEED = Buffer.from('scheduler-config');
const CRANK_POLICY_SEED = Buffer.from('crank-policy');
const CRANK_SEED = Buffer.from('crank');
const TASK_SPONSOR_INITIAL_LAMPORTS = 5_000_000;
const INSTRUCTIONS_SYSVAR_ID = new PublicKey('Sysvar1nstructions1111111111111111111111111');
const router = new ConnectionMagicRouter(ROUTER_RPC_URL, 'confirmed');

const DISCRIMINATOR: Record<string, number[]> = {
  initializeVault: [0x30, 0xbf, 0xa3, 0x2c, 0x47, 0x81, 0x3f, 0xa4],
  createVaultAssetAccount: [0xf7, 0x1e, 0x7b, 0xb2, 0x8f, 0x14, 0x42, 0x20],
  createMarketAssetAccount: [0x9a, 0xa9, 0x37, 0x83, 0x1c, 0x4e, 0x0f, 0x5c],
  deposit: [0xf2, 0x23, 0xc6, 0x89, 0x52, 0xe1, 0xf2, 0xb6],
  redeem: [0xb8, 0x0c, 0x56, 0x95, 0x46, 0xc4, 0x61, 0xe1],
  setActive: [0x1d, 0x10, 0xe1, 0x84, 0x26, 0xd8, 0xce, 0x21],
  updateTargets: [0xaa, 0x7b, 0xef, 0x60, 0x3f, 0x4d, 0x67, 0xb9],
  delegateExecutor: [0x99, 0x0f, 0x08, 0xdb, 0x23, 0xb6, 0xbc, 0x38],
  setSchedulerSponsor: [0x98, 0xce, 0x0d, 0x35, 0xeb, 0xcb, 0xe7, 0x6f],
  setCrankPolicy: [0xe2, 0xfa, 0xab, 0x25, 0x6f, 0x70, 0xb0, 0xeb],
  cancel: [0xb2, 0x5b, 0x89, 0x92, 0x63, 0x43, 0x97, 0x6e],
};

export interface VaultAddresses {
  state: PublicKey;
  authority: PublicKey;
  shareMint: PublicKey;
  executor: PublicKey;
  schedulerConfig: PublicKey;
  crankPolicy: PublicKey;
  marketAuthority: PublicKey;
}

export interface OnChainVaultAsset {
  id: AssetId;
  mint: PublicKey;
  targetBps: number;
  decimals: number;
  feedAccount: PublicKey;
}

export interface OnChainVaultState {
  id: bigint;
  owner: PublicKey;
  shareMint: PublicKey;
  active: boolean;
  thresholdBps: number;
  maxSlippageBps: number;
  lastSettledNonce: bigint;
  assets: OnChainVaultAsset[];
}

export interface VaultSettlementActivity {
  signature: string;
  slot: number;
  blockTime: number | null;
  nonce: number;
  legs: number;
}

/** Read confirmed settlement transactions for this vault; UI logs never synthesize trades. */
export async function fetchRecentVaultSettlements(
  stateAddress: PublicKey,
  limit = 5,
): Promise<VaultSettlementActivity[]> {
  const signatures = await connection.getSignaturesForAddress(stateAddress, { limit: 30 }, 'confirmed');
  const settlements: VaultSettlementActivity[] = [];
  for (const item of signatures) {
    if (item.err) continue;
    const transaction = await connection.getTransaction(item.signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });
    const message = transaction?.meta?.logMessages?.find((line) =>
      line.includes('Base-layer SPL rebalance settled atomically: nonce '),
    );
    const matched = message?.match(/nonce (\d+), (\d+) legs/);
    if (!transaction || !matched) continue;
    settlements.push({
      signature: item.signature,
      slot: transaction.slot,
      blockTime: transaction.blockTime ?? null,
      nonce: Number(matched[1]),
      legs: Number(matched[2]),
    });
    if (settlements.length >= limit) break;
  }
  return settlements;
}

export function deriveVaultAddresses(owner: PublicKey, id: bigint): VaultAddresses {
  const [state] = PublicKey.findProgramAddressSync([VAULT_SEED, owner.toBuffer(), u64(id)], EXECUTION_PROGRAM);
  const [authority] = PublicKey.findProgramAddressSync([VAULT_AUTHORITY_SEED, state.toBuffer()], EXECUTION_PROGRAM);
  const [shareMint] = PublicKey.findProgramAddressSync([SHARE_MINT_SEED, state.toBuffer()], EXECUTION_PROGRAM);
  const [executor] = PublicKey.findProgramAddressSync([EXECUTOR_SEED, state.toBuffer()], EXECUTION_PROGRAM);
  const [schedulerConfig] = PublicKey.findProgramAddressSync([SCHEDULER_CONFIG_SEED, state.toBuffer()], EXECUTION_PROGRAM);
  const [crankPolicy] = PublicKey.findProgramAddressSync([CRANK_POLICY_SEED, state.toBuffer()], EXECUTION_PROGRAM);
  const [marketAuthority] = PublicKey.findProgramAddressSync([MARKET_AUTHORITY_SEED], EXECUTION_PROGRAM);
  return { state, authority, shareMint, executor, schedulerConfig, crankPolicy, marketAuthority };
}

export function vaultAddressesForState(state: PublicKey): VaultAddresses {
  const [authority] = PublicKey.findProgramAddressSync([VAULT_AUTHORITY_SEED, state.toBuffer()], EXECUTION_PROGRAM);
  const [shareMint] = PublicKey.findProgramAddressSync([SHARE_MINT_SEED, state.toBuffer()], EXECUTION_PROGRAM);
  const [executor] = PublicKey.findProgramAddressSync([EXECUTOR_SEED, state.toBuffer()], EXECUTION_PROGRAM);
  const [schedulerConfig] = PublicKey.findProgramAddressSync([SCHEDULER_CONFIG_SEED, state.toBuffer()], EXECUTION_PROGRAM);
  const [crankPolicy] = PublicKey.findProgramAddressSync([CRANK_POLICY_SEED, state.toBuffer()], EXECUTION_PROGRAM);
  const [marketAuthority] = PublicKey.findProgramAddressSync([MARKET_AUTHORITY_SEED], EXECUTION_PROGRAM);
  return { state, authority, shareMint, executor, schedulerConfig, crankPolicy, marketAuthority };
}

export function vaultAssetAccounts(state: OnChainVaultState, authority: PublicKey): PublicKey[] {
  return state.assets.map(({ mint }) => getAssociatedTokenAddressSync(mint, authority, true));
}

export function marketAssetAccounts(state: OnChainVaultState, authority: PublicKey): PublicKey[] {
  return state.assets.map(({ mint }) => getAssociatedTokenAddressSync(mint, authority, true));
}

export async function readVaultState(address: PublicKey): Promise<OnChainVaultState> {
  const info = await connection.getAccountInfo(address, 'confirmed');
  if (!info || !info.owner.equals(EXECUTION_PROGRAM)) throw new Error('Vault State was not found on Solana devnet.');
  const data = Buffer.from(info.data);
  if (data.length < 98) throw new Error('Vault State data is incomplete.');
  let offset = 8;
  const id = BigInt(data.readBigUInt64LE(offset).toString()); offset += 8;
  const owner = new PublicKey(data.subarray(offset, offset + 32)); offset += 32;
  const shareMint = new PublicKey(data.subarray(offset, offset + 32)); offset += 32;
  const active = data[offset] === 1; offset += 1;
  const thresholdBps = data.readUInt16LE(offset); offset += 2;
  const maxSlippageBps = data.readUInt16LE(offset); offset += 2;
  offset += 1; // authority bump
  const lastSettledNonce = BigInt(data.readBigUInt64LE(offset).toString()); offset += 8;
  const count = data.readUInt32LE(offset); offset += 4;
  if (count < 1 || count > 4 || data.length < offset + count * 99) throw new Error('Vault State has an invalid asset list.');
  const byMint = mintToAssetMap();
  const assets: OnChainVaultAsset[] = [];
  for (let index = 0; index < count; index += 1) {
    const mint = new PublicKey(data.subarray(offset, offset + 32)); offset += 32;
    const id = byMint.get(mint.toBase58());
    if (!id) throw new Error(`Vault State contains an unsupported mint: ${mint.toBase58()}`);
    const decimals = data[offset]; offset += 1;
    const targetBps = data.readUInt16LE(offset); offset += 2;
    const feedAccount = new PublicKey(data.subarray(offset, offset + 32)); offset += 32;
    offset += 32; // Pyth feed id
    assets.push({ id, mint, decimals, targetBps, feedAccount });
  }
  return { id, owner, shareMint, active, thresholdBps, maxSlippageBps, lastSettledNonce, assets };
}

export async function initializeVault(
  owner: OwnerSigner,
  id: bigint,
  assets: AssetId[],
  targets: Record<string, number>,
  thresholdPct: number,
): Promise<{ addresses: VaultAddresses; result: TxResult }> {
  const addresses = deriveVaultAddresses(owner.publicKey, id);
  const weights = targetBasisPoints(assets, targets);
  const assetArgs = Buffer.concat(assets.flatMap((asset, index) => [mintOf(asset).toBuffer(), u16(weights[index])]));
  const data = Buffer.concat([
    Buffer.from(DISCRIMINATOR.initializeVault),
    u64(id),
    u32(assets.length),
    assetArgs,
    u16(Math.round(thresholdPct * 100)),
    u16(100), // 1% maximum settlement slippage
  ]);
  const tx = new Transaction().add(new TransactionInstruction({
    programId: EXECUTION_PROGRAM,
    keys: [
      { pubkey: addresses.state, isSigner: false, isWritable: true },
      { pubkey: addresses.authority, isSigner: false, isWritable: false },
      { pubkey: addresses.shareMint, isSigner: false, isWritable: true },
      { pubkey: addresses.executor, isSigner: false, isWritable: true },
      { pubkey: owner.publicKey, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  }));
  tx.feePayer = owner.publicKey;
  return { addresses, result: await signSendConfirm(tx, owner) };
}

export async function createVaultTokenAccounts(
  owner: OwnerSigner,
  stateAddress: PublicKey,
  assets: AssetId[],
): Promise<TxResult> {
  const addresses = vaultAddressesForState(stateAddress);
  const tx = new Transaction();
  for (const id of assets) {
    const mint = mintOf(id);
    const vaultToken = getAssociatedTokenAddressSync(mint, addresses.authority, true);
    tx.add(new TransactionInstruction({
      programId: EXECUTION_PROGRAM,
      keys: [
        { pubkey: stateAddress, isSigner: false, isWritable: false },
        { pubkey: addresses.authority, isSigner: false, isWritable: false },
        { pubkey: owner.publicKey, isSigner: true, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: vaultToken, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.from(DISCRIMINATOR.createVaultAssetAccount),
    }));
    tx.add(createAssociatedTokenAccountIdempotentInstruction(
      owner.publicKey,
      getAssociatedTokenAddressSync(mint, owner.publicKey),
      owner.publicKey,
      mint,
    ));
  }
  tx.add(createAssociatedTokenAccountIdempotentInstruction(
    owner.publicKey,
    getAssociatedTokenAddressSync(addresses.shareMint, owner.publicKey),
    owner.publicKey,
    addresses.shareMint,
  ));
  tx.feePayer = owner.publicKey;
  return signSendConfirm(tx, owner);
}

export async function depositToVault(
  owner: OwnerSigner,
  stateAddress: PublicKey,
  amounts: Record<string, number>,
  minimumSharesOut = 1n,
): Promise<TxResult> {
  const state = await readVaultState(stateAddress);
  const addresses = vaultAddressesForState(stateAddress);
  const values = state.assets.map((asset) => BigInt(amounts[asset.id] ?? 0));
  const tx = new Transaction();
  const wsolIndex = state.assets.findIndex((asset) => asset.id === 'wsol');
  if (wsolIndex >= 0 && values[wsolIndex] > 0n) {
    tx.add(...wrapSolInstructions(owner.publicKey, Number(values[wsolIndex])));
  }
  const sources = state.assets.map((asset) => getAssociatedTokenAddressSync(asset.mint, owner.publicKey));
  const vaultTokens = vaultAssetAccounts(state, addresses.authority);
  for (let index = 0; index < state.assets.length; index += 1) {
    tx.add(createAssociatedTokenAccountIdempotentInstruction(
      owner.publicKey,
      sources[index],
      owner.publicKey,
      state.assets[index].mint,
    ));
  }
  const shareAccount = getAssociatedTokenAddressSync(state.shareMint, owner.publicKey);
  tx.add(createAssociatedTokenAccountIdempotentInstruction(owner.publicKey, shareAccount, owner.publicKey, state.shareMint));
  const feeds = state.assets.filter((asset) => !asset.feedAccount.equals(PublicKey.default)).map((asset) => asset.feedAccount);
  tx.add(new TransactionInstruction({
    programId: EXECUTION_PROGRAM,
    keys: [
      { pubkey: stateAddress, isSigner: false, isWritable: false },
      { pubkey: addresses.authority, isSigner: false, isWritable: false },
      { pubkey: state.shareMint, isSigner: false, isWritable: true },
      { pubkey: shareAccount, isSigner: false, isWritable: true },
      { pubkey: owner.publicKey, isSigner: true, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ...sources.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true })),
      ...vaultTokens.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true })),
      ...feeds.map((pubkey) => ({ pubkey, isSigner: false, isWritable: false })),
    ],
    data: Buffer.concat([
      Buffer.from(DISCRIMINATOR.deposit),
      u32(values.length),
      ...values.map(u64),
      u64(minimumSharesOut),
    ]),
  }));
  tx.feePayer = owner.publicKey;
  return signSendConfirm(tx, owner);
}

export async function redeemFromVault(
  owner: OwnerSigner,
  stateAddress: PublicKey,
  shares: bigint,
  minimumAmountsOut: bigint[],
): Promise<TxResult> {
  const state = await readVaultState(stateAddress);
  const addresses = vaultAddressesForState(stateAddress);
  const shareAccount = getAssociatedTokenAddressSync(state.shareMint, owner.publicKey);
  const vaultTokens = vaultAssetAccounts(state, addresses.authority);
  const destinations = state.assets.map((asset) => getAssociatedTokenAddressSync(asset.mint, owner.publicKey));
  const tx = new Transaction();
  for (let index = 0; index < state.assets.length; index += 1) {
    tx.add(createAssociatedTokenAccountIdempotentInstruction(
      owner.publicKey,
      destinations[index],
      owner.publicKey,
      state.assets[index].mint,
    ));
  }
  tx.add(new TransactionInstruction({
    programId: EXECUTION_PROGRAM,
    keys: [
      { pubkey: stateAddress, isSigner: false, isWritable: false },
      { pubkey: addresses.authority, isSigner: false, isWritable: false },
      { pubkey: state.shareMint, isSigner: false, isWritable: true },
      { pubkey: shareAccount, isSigner: false, isWritable: true },
      { pubkey: owner.publicKey, isSigner: true, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ...vaultTokens.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true })),
      ...destinations.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true })),
    ],
    data: Buffer.concat([
      Buffer.from(DISCRIMINATOR.redeem),
      u64(shares),
      u32(minimumAmountsOut.length),
      ...minimumAmountsOut.map(u64),
    ]),
  }));
  tx.feePayer = owner.publicKey;
  return signSendConfirm(tx, owner);
}

export async function updateVaultTargets(
  owner: OwnerSigner,
  stateAddress: PublicKey,
  targets: Record<string, number>,
): Promise<TxResult> {
  const state = await readVaultState(stateAddress);
  const weights = targetBasisPoints(state.assets.map((asset) => asset.id), targets);
  const tx = new Transaction().add(new TransactionInstruction({
    programId: EXECUTION_PROGRAM,
    keys: [
      { pubkey: stateAddress, isSigner: false, isWritable: true },
      { pubkey: owner.publicKey, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from(DISCRIMINATOR.updateTargets), u32(weights.length), ...weights.map(u16)]),
  }));
  tx.feePayer = owner.publicKey;
  return signSendConfirm(tx, owner);
}

export async function setVaultActive(owner: OwnerSigner, stateAddress: PublicKey, active: boolean): Promise<TxResult> {
  const tx = new Transaction().add(new TransactionInstruction({
    programId: EXECUTION_PROGRAM,
    keys: [
      { pubkey: stateAddress, isSigner: false, isWritable: true },
      { pubkey: owner.publicKey, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from(DISCRIMINATOR.setActive), Buffer.from([active ? 1 : 0])]),
  }));
  tx.feePayer = owner.publicKey;
  return signSendConfirm(tx, owner);
}

export function slotsForCadence(seconds: number): number {
  if (!Number.isInteger(seconds) || seconds < 60 || seconds > 86_400) {
    throw new Error('Rebalance interval must be between 60 seconds and 24 hours.');
  }
  return Math.ceil(seconds * REBALANCE_INTERVAL_SLOTS / TARGET_REBALANCE_SECONDS);
}

function setCrankPolicyInstruction(owner: OwnerSigner, stateAddress: PublicKey, minIntervalSeconds: number): TransactionInstruction {
  const addresses = vaultAddressesForState(stateAddress);
  return new TransactionInstruction({
    programId: EXECUTION_PROGRAM,
    keys: [
      { pubkey: stateAddress, isSigner: false, isWritable: false },
      { pubkey: addresses.crankPolicy, isSigner: false, isWritable: true },
      { pubkey: owner.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from(DISCRIMINATOR.setCrankPolicy), u64(BigInt(minIntervalSeconds))]),
  });
}

export async function scheduleVault(
  owner: OwnerSigner,
  stateAddress: PublicKey,
  minIntervalSeconds = TARGET_REBALANCE_SECONDS,
): Promise<TxResult> {
  const state = await readVaultState(stateAddress);
  if (!state.active) throw new Error('Resume the portfolio on Solana before scheduling it.');
  const intervalSlots = slotsForCadence(minIntervalSeconds);
  const addresses = vaultAddressesForState(stateAddress);
  const vaultTokens = vaultAssetAccounts(state, addresses.authority);
  const marketTokens = marketAssetAccounts(state, addresses.marketAuthority);
  const feeds = state.assets.filter((asset) => !asset.feedAccount.equals(PublicKey.default)).map((asset) => asset.feedAccount);

  // Persist the policy and create any missing market ATAs with one wallet
  // approval. Both operations are idempotent, so this is safe to retry.
  const setup = new Transaction().add(setCrankPolicyInstruction(owner, stateAddress, minIntervalSeconds));
  for (let index = 0; index < state.assets.length; index += 1) {
    setup.add(new TransactionInstruction({
      programId: EXECUTION_PROGRAM,
      keys: [
        { pubkey: addresses.marketAuthority, isSigner: false, isWritable: false },
        { pubkey: owner.publicKey, isSigner: true, isWritable: true },
        { pubkey: state.assets[index].mint, isSigner: false, isWritable: false },
        { pubkey: marketTokens[index], isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.from(DISCRIMINATOR.createMarketAssetAccount),
    }));
  }
  setup.feePayer = owner.publicKey;
  await signSendConfirm(setup, owner);

  const executorStatus = await ensureExecutorDelegated(owner, stateAddress, addresses.executor);
  const host = new ConnectionMagicRouter(executorStatus.fqdn, 'confirmed');
  const configuredSponsor = await readSchedulerSponsor(stateAddress, addresses.schedulerConfig);
  if (configuredSponsor) {
    const existingCrank = await host.getAccountInfo(crankAddress(configuredSponsor, stateAddress), 'confirmed');
    if (existingCrank) {
      if (hydraTaskMatches(existingCrank, stateAddress, addresses, intervalSlots)) {
        return { sig: '', slot: await connection.getSlot('confirmed') };
      }
      await cancelVaultSchedule(owner, stateAddress);
    }
  }

  // Hydra's Create path requires a writable sponsor delegated to this ER. Use a
  // fresh, one-use signer and atomically fund, assign, delegate, and authorize it.
  // Combining these instructions prevents failed delegation attempts from
  // leaving funded sponsor accounts behind and reduces wallet approvals.
  const sponsor = Keypair.generate();
  const validator = await readValidatorIdentity(executorStatus.fqdn);
  const delegateSponsor = createDelegateInstruction({
    payer: owner.publicKey,
    delegatedAccount: sponsor.publicKey,
    ownerProgram: SystemProgram.programId,
    validator,
  }, {
    commitFrequencyMs: 0xffff_ffff,
  });
  const setSponsor = new TransactionInstruction({
    programId: EXECUTION_PROGRAM,
    keys: [
      { pubkey: stateAddress, isSigner: false, isWritable: false },
      { pubkey: addresses.schedulerConfig, isSigner: false, isWritable: true },
      { pubkey: owner.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from(DISCRIMINATOR.setSchedulerSponsor), sponsor.publicKey.toBuffer()]),
  });
  const delegationTx = new Transaction()
    .add(SystemProgram.transfer({
      fromPubkey: owner.publicKey,
      toPubkey: sponsor.publicKey,
      lamports: TASK_SPONSOR_INITIAL_LAMPORTS,
    }))
    // DLP's delegate instruction requires the target account to already be
    // owned by DLP. The signer can authorize this System Program assignment.
    .add(SystemProgram.assign({
      accountPubkey: sponsor.publicKey,
      programId: DELEGATION_PROGRAM_ID,
    }))
    .add(delegateSponsor)
    .add(setSponsor);
  delegationTx.feePayer = owner.publicKey;
  await signSendConfirm(delegationTx, owner, [sponsor]);
  let sponsorStatus: { isDelegated: boolean; fqdn?: string } | null = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    sponsorStatus = await router.getDelegationStatus(sponsor.publicKey) as { isDelegated: boolean; fqdn?: string };
    if (sponsorStatus.isDelegated && sponsorStatus.fqdn) break;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  if (!sponsorStatus?.isDelegated || !sponsorStatus.fqdn || sponsorStatus.fqdn !== executorStatus.fqdn) {
    throw new Error("MagicBlock did not delegate the one-use Hydra sponsor to the vault Executor's ER.");
  }

  const crank = crankAddress(sponsor.publicKey, stateAddress);
  const scheduledMetas = [
    { pubkey: INSTRUCTIONS_SYSVAR_ID, isWritable: false },
    { pubkey: stateAddress, isWritable: false },
    { pubkey: addresses.executor, isWritable: true },
    { pubkey: addresses.schedulerConfig, isWritable: false },
    { pubkey: addresses.crankPolicy, isWritable: false },
    { pubkey: addresses.authority, isWritable: false },
    { pubkey: addresses.marketAuthority, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isWritable: false },
    { pubkey: MAGIC_CONTEXT_ID, isWritable: true },
    { pubkey: magicFeeVaultPdaFromValidator(validator), isWritable: true },
    { pubkey: MAGIC_PROGRAM_ID, isWritable: false },
    ...vaultTokens.map((pubkey) => ({ pubkey, isWritable: false })),
    ...marketTokens.map((pubkey) => ({ pubkey, isWritable: false })),
    ...feeds.map((pubkey) => ({ pubkey, isWritable: false })),
  ];
  const callbackData = Buffer.from([0xeb, 0xf6, 0x7d, 0x55, 0x89, 0x61, 0xde, 0xdf]);
  const createData = encodeHydraCreate(stateAddress, addresses.executor, scheduledMetas, callbackData, await host.getSlot('confirmed'), intervalSlots);
  const createInstruction = new TransactionInstruction({
    programId: HYDRA_EPHEMERAL_PROGRAM,
    keys: [
      { pubkey: sponsor.publicKey, isSigner: true, isWritable: true },
      { pubkey: crank, isSigner: false, isWritable: true },
      { pubkey: EPHEMERAL_VAULT_ID, isSigner: false, isWritable: true },
      { pubkey: MAGIC_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: createData,
  });
  const createTx = new Transaction().add(createInstruction);
  createTx.feePayer = sponsor.publicKey;
  const signature = await router.sendAndConfirmTransaction(createTx, [sponsor]);
  const crankInfo = await host.getAccountInfo(crank, 'confirmed');
  if (!crankInfo || !crankInfo.owner.equals(HYDRA_EPHEMERAL_PROGRAM)) {
    throw new Error('Hydra Create confirmed, but the expected crank account was not found on the ER.');
  }
  const interval = Number(crankInfo.data.readBigUInt64LE(72));
  if (interval !== intervalSlots) throw new Error(`The registered interval was ${interval} slots, expected ${intervalSlots}.`);
  return { sig: signature, slot: await connection.getSlot('confirmed') };
}

async function readSchedulerSponsor(stateAddress: PublicKey, schedulerConfig: PublicKey): Promise<PublicKey | null> {
  const info = await connection.getAccountInfo(schedulerConfig, 'confirmed');
  if (!info) return null;
  if (!info.owner.equals(EXECUTION_PROGRAM) || info.data.length < 104) throw new Error('Scheduler Config is malformed.');
  if (!new PublicKey(info.data.subarray(8, 40)).equals(stateAddress)) throw new Error('Scheduler Config belongs to a different vault.');
  return new PublicKey(info.data.subarray(72, 104));
}

function encodeHydraCreate(
  state: PublicKey,
  authority: PublicKey,
  metas: Array<{ pubkey: PublicKey; isWritable: boolean }>,
  callbackData: Buffer,
  currentSlot: number,
  intervalSlots: number,
): Buffer {
  const bodyLength = 35 + 33 * metas.length + callbackData.length;
  // Hydra wire data includes a one-byte instruction discriminator before the
  // 100-byte fixed Create prefix.
  const data = Buffer.alloc(101 + bodyLength);
  let offset = 0;
  data[offset++] = 0;
  state.toBuffer().copy(data, offset); offset += 32;
  authority.toBuffer().copy(data, offset); offset += 32;
  u64(BigInt(currentSlot + intervalSlots)).copy(data, offset); offset += 8;
  u64(BigInt(intervalSlots)).copy(data, offset); offset += 8;
  u64(0n).copy(data, offset); offset += 8;
  u64(0n).copy(data, offset); offset += 8;
  data.writeUInt32LE(800_000, offset); offset += 4;
  data.writeUInt8(metas.length, offset++);
  data.writeUInt16LE(callbackData.length, offset); offset += 2;
  EXECUTION_PROGRAM.toBuffer().copy(data, offset); offset += 32;
  for (const meta of metas) {
    data.writeUInt8(meta.isWritable ? 0b10 : 0, offset++);
    meta.pubkey.toBuffer().copy(data, offset); offset += 32;
  }
  callbackData.copy(data, offset);
  return data;
}

function hydraTaskMatches(
  info: AccountInfo<Buffer>,
  state: PublicKey,
  addresses: VaultAddresses,
  intervalSlots: number,
): boolean {
  const data = Buffer.from(info.data);
  if (!info.owner.equals(HYDRA_EPHEMERAL_PROGRAM) || data.length < 120 || Number(data.readBigUInt64LE(72)) !== intervalSlots) return false;
  const regionLength = data.readUInt16LE(112);
  if (!regionLength || data.length < 120 + regionLength) return false;
  const region = Buffer.from(data.subarray(120, 120 + regionLength));
  if (region.length < 2) return false;
  const count = region.readUInt16LE(0);
  let offset = 2;
  if (region.length < offset + count * 33 + 34) return false;
  const keys: PublicKey[] = [];
  for (let index = 0; index < count; index += 1) {
    offset += 1;
    keys.push(new PublicKey(region.subarray(offset, offset + 32)));
    offset += 32;
  }
  const programId = new PublicKey(region.subarray(offset, offset + 32)); offset += 32;
  const dataLength = region.readUInt16LE(offset); offset += 2;
  const instructionData = region.subarray(offset);
  return instructionData.length === dataLength
    && programId.equals(EXECUTION_PROGRAM)
    && Buffer.from(instructionData).equals(Buffer.from([0xeb, 0xf6, 0x7d, 0x55, 0x89, 0x61, 0xde, 0xdf]))
    && keys[1]?.equals(state)
    && keys[2]?.equals(addresses.executor)
    && keys[3]?.equals(addresses.schedulerConfig)
    && keys[4]?.equals(addresses.crankPolicy);
}

export async function cancelVaultSchedule(owner: OwnerSigner, stateAddress: PublicKey): Promise<TxResult> {
  const addresses = vaultAddressesForState(stateAddress);
  if (!(await router.getDelegationStatus(addresses.executor)).isDelegated) {
    return { sig: '', slot: await connection.getSlot('confirmed') };
  }
  const sponsor = await readSchedulerSponsor(stateAddress, addresses.schedulerConfig);
  if (!sponsor) return { sig: '', slot: await connection.getSlot('confirmed') };
  const hostStatus = await waitForExecutorHost(addresses.executor);
  const crank = crankAddress(sponsor, stateAddress);
  const host = new ConnectionMagicRouter(hostStatus.fqdn, 'confirmed');
  if (!(await host.getAccountInfo(crank, 'confirmed'))) return { sig: '', slot: await connection.getSlot('confirmed') };
  const instruction = new TransactionInstruction({
    programId: EXECUTION_PROGRAM,
    keys: [
      { pubkey: stateAddress, isSigner: false, isWritable: false },
      { pubkey: owner.publicKey, isSigner: true, isWritable: false },
      { pubkey: addresses.executor, isSigner: false, isWritable: true },
      { pubkey: addresses.schedulerConfig, isSigner: false, isWritable: false },
      { pubkey: crank, isSigner: false, isWritable: true },
      { pubkey: EPHEMERAL_VAULT_ID, isSigner: false, isWritable: true },
      { pubkey: MAGIC_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: HYDRA_EPHEMERAL_PROGRAM, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(DISCRIMINATOR.cancel),
  });
  const routed = new Transaction().add(instruction);
  routed.feePayer = owner.publicKey;
  const blockhash = await router.getLatestBlockhashForTransaction(routed);
  routed.recentBlockhash = blockhash.blockhash;
  routed.lastValidBlockHeight = blockhash.lastValidBlockHeight;
  const signed = owner instanceof Keypair
    ? (routed.partialSign(owner), routed)
    : await owner.signTransaction(routed);
  const sig = await router.sendRawTransaction(signed.serialize(), { skipPreflight: false });
  const confirmed = await router.confirmTransaction(
    { signature: sig, blockhash: blockhash.blockhash, lastValidBlockHeight: blockhash.lastValidBlockHeight },
    'confirmed',
  );
  if (confirmed.value.err) throw new Error(`MagicBlock transaction failed: ${JSON.stringify(confirmed.value.err)}`);
  return { sig, slot: await connection.getSlot('confirmed') };
}

export function crankAddress(sponsor: PublicKey, state: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([CRANK_SEED, sponsor.toBuffer(), state.toBuffer()], HYDRA_EPHEMERAL_PROGRAM)[0];
}

async function waitForExecutorHost(executor: PublicKey): Promise<{ fqdn: string }> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const status = await router.getDelegationStatus(executor) as { isDelegated: boolean; fqdn?: string };
    if (status.isDelegated && status.fqdn) return { fqdn: status.fqdn };
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error('MagicBlock has not made the Executor delegation available yet. Retry scheduling in a moment.');
}

async function ensureExecutorDelegated(
  owner: OwnerSigner,
  stateAddress: PublicKey,
  executor: PublicKey,
): Promise<{ fqdn: string }> {
  const status = await router.getDelegationStatus(executor) as { isDelegated: boolean; fqdn?: string };
  if (!status.isDelegated) {
    const delegate = new TransactionInstruction({
      programId: EXECUTION_PROGRAM,
      keys: [
        { pubkey: owner.publicKey, isSigner: true, isWritable: true },
        { pubkey: stateAddress, isSigner: false, isWritable: false },
        { pubkey: delegateBufferPdaFromDelegatedAccountAndOwnerProgram(executor, EXECUTION_PROGRAM), isSigner: false, isWritable: true },
        { pubkey: delegationRecordPdaFromDelegatedAccount(executor), isSigner: false, isWritable: true },
        { pubkey: delegationMetadataPdaFromDelegatedAccount(executor), isSigner: false, isWritable: true },
        { pubkey: executor, isSigner: false, isWritable: true },
        { pubkey: EXECUTION_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: DELEGATION_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.from(DISCRIMINATOR.delegateExecutor),
    });
    const tx = new Transaction().add(delegate);
    tx.feePayer = owner.publicKey;
    await signSendConfirm(tx, owner);
  }
  return waitForExecutorHost(executor);
}

async function readValidatorIdentity(fqdn: string): Promise<PublicKey> {
  const response = await fetch(fqdn, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getIdentity', params: [] }),
  });
  const body = await response.json() as { error?: unknown; result?: { identity?: string } };
  if (!response.ok || body.error || !body.result?.identity) throw new Error('Could not identify the validator hosting this portfolio schedule.');
  return new PublicKey(body.result.identity);
}

export function buildRedeemMinimums(state: OnChainVaultState, balances: Record<string, number>, shareAmount: bigint, shareSupply: bigint): bigint[] {
  if (shareSupply <= 0n) return state.assets.map(() => 0n);
  return state.assets.map((asset) => {
    const amount = BigInt(Math.max(0, Math.floor(balances[asset.id] ?? 0)));
    return (amount * shareAmount / shareSupply) * 9_900n / 10_000n;
  });
}

function targetBasisPoints(assets: AssetId[], targets: Record<string, number>): number[] {
  const weights = assets.map((asset) => Math.round((targets[asset] ?? 0) * 100));
  const remainder = 10_000 - weights.reduce((sum, weight) => sum + weight, 0);
  if (Math.abs(remainder) > weights.length || weights.length === 0) throw new Error('Target weights must total 100%.');
  const largest = weights.indexOf(Math.max(...weights));
  weights[largest] += remainder;
  if (weights.some((weight) => weight < 0 || weight > 10_000)) throw new Error('Target weights must total 100%.');
  return weights;
}

function u16(value: number): Buffer {
  const out = Buffer.alloc(2); out.writeUInt16LE(value, 0); return out;
}

function u32(value: number): Buffer {
  const out = Buffer.alloc(4); out.writeUInt32LE(value, 0); return out;
}

function u64(value: bigint): Buffer {
  const out = Buffer.alloc(8);
  let remaining = value;
  for (let index = 0; index < 8; index += 1) {
    out[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return out;
}
