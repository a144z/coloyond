import { sha256 } from "@noble/hashes/sha256";
import { PublicKey, type AccountInfo, type Commitment, type Connection } from "@solana/web3.js";
import { decodeClassicSplMint, ETF_DEVNET_GENESIS_HASH, ETF_DEVNET_RECEIVER_PROGRAM, ETF_DEVNET_TOKEN_PROGRAM } from "./devnet-read.js";
import { derivePythFixedFeedAccount, manifestContextBelongsTo, type EtfAssetConfig, type VerifiedEtfManifest } from "./manifest.js";

const POOL_DISCRIMINATOR = Buffer.from("5129cb13d2cb328d", "hex");
const STATE_DISCRIMINATOR = Buffer.from("210c5772838a970a", "hex");
const ASSET_STATE_DISCRIMINATOR = Buffer.from("7c57605413067b6d", "hex");
const PRICE_UPDATE_V2_DISCRIMINATOR = Buffer.from([0x22, 0xf1, 0x23, 0x63, 0x9d, 0x7e, 0xf4, 0xcd]);

export type EtfLifecycle = "unseeded" | "active" | "closed";
export type EtfPoolState = Readonly<{
  version: number;
  bump: number;
  pool: string;
  currentGovernance: string;
  currentGuardian: string;
  lifecycle: EtfLifecycle;
  riskPaused: boolean;
  sequence: string;
  schedulerEnabled: boolean;
  schedulerGeneration: string;
  lastObservation: null | Readonly<{ observedAt: string; slot: string; deviationBps: number; eligible: boolean; publishTimes: readonly [string, string, string] }>;
  pendingResume: null | Readonly<{ proposer: string; nonce: string; executeAfter: string }>;
  pendingHandoff: null | Readonly<{ proposer: string; nonce: string; executeAfter: string; role: "governance" | "emergency_guardian"; newAuthority: string }>;
}>;

export type EtfOracleRead = Readonly<{
  address: string;
  mode: "push_feed" | "receiver_full";
  owner: string | null;
  dataLength: number | null;
  feedId: string | null;
  verification: "full" | "partial" | "unknown";
  rawPrice: string | null;
  confidence: string | null;
  confidenceBpsCeil: string | null;
  exponent: number | null;
  publishTime: string | null;
  ageSeconds: string | null;
  freshness: "within_approved_limits" | "stale" | "confidence_over_limit" | "future_publish_time" | "unavailable" | "invalid";
  reason: string | null;
}>;

export type EtfAssetRead = Readonly<{
  index: number;
  mint: string;
  mintOwner: string;
  mintDataLength: number;
  mintSupply: string;
  mintAuthority: string | null;
  mintFreezeAuthority: string | null;
  tokenProgram: string;
  decimals: number;
  targetWeightBps: number;
  label: string;
  backing: "native_wrapped" | "synthetic_unbacked";
  custody: string;
  custodyAmount: string;
  custodyFrozen: boolean;
  assetState: string;
  cumulativeFeeBaseUnits: string;
  oracle: EtfOracleRead;
}>;

export type EtfWalletRead = Readonly<{
  address: string;
  tokenAccounts: readonly Readonly<{ address: string; mint: string; amount: string; frozen: boolean; contextSlot: string }>[];
  shareAccounts: readonly Readonly<{ address: string; amount: string; frozen: boolean; contextSlot: string }>[];
}>;

export type EtfPoolSnapshot = Readonly<{
  network: Readonly<{ cluster: "devnet"; genesisHash: string; rpcEndpoint: string; commitment: "confirmed" | "finalized"; contextSlot: string; blockTime: string | null }>;
  deployment: Readonly<{ programId: string; programExecutable: true; programLoader: string; programData: string; programBinarySha256: string; upgradeAuthority: string | null }>;
  identity: Readonly<{ pool: string; poolState: string; configHash: string; strategyId: string; shareMint: string; initializer: string; currentGovernance: string; currentGuardian: string }>;
  state: EtfPoolState;
  shares: Readonly<{ decimals: 6; supply: string; mintAuthority: string; freezeAuthority: string | null }>;
  assets: readonly EtfAssetRead[];
  wallet: EtfWalletRead | null;
}>;

const VERIFIED_SNAPSHOTS = new WeakMap<object, VerifiedEtfManifest>();
export type VerifiedEtfSnapshot = EtfPoolSnapshot;

function view(data: Buffer): DataView { return new DataView(data.buffer, data.byteOffset, data.byteLength); }
function expectDiscriminator(data: Buffer, expected: Buffer, label: string): void {
  if (data.length < 8 || !data.subarray(0, 8).equals(expected)) throw new Error(`${label}_discriminator_mismatch`);
}
function allZero(data: Buffer): boolean { return data.every((byte) => byte === 0); }
function keyAt(data: Buffer, offset: number): string { return new PublicKey(data.subarray(offset, offset + 32)).toBase58(); }
function take(data: Buffer, offset: number, length: number): Buffer {
  const end = offset + length;
  if (!Number.isSafeInteger(end) || offset < 0 || end > data.length) throw new Error("account_data_truncated");
  return data.subarray(offset, end);
}
function u64At(data: Buffer, offset: number): bigint { return view(data).getBigUint64(offset, true); }
function i64At(data: Buffer, offset: number): bigint { return view(data).getBigInt64(offset, true); }
function parseOption(data: Buffer, offset: number, size: number, label: string): { tag: number; payloadOffset: number } {
  const tag = take(data, offset, 1)[0]!;
  if (tag !== 0 && tag !== 1) throw new Error(`${label}_option_tag_invalid`);
  return { tag, payloadOffset: offset + 1 };
}

export function decodeEtfPoolAccount(account: AccountInfo<Buffer>, expectedProgram: PublicKey, expectedPool: PublicKey, configHashHex: string): Readonly<{ version: number; bump: number; configHash: string; configBytes: Buffer; shareMint: string; initializer: string }> {
  if (!account.owner.equals(expectedProgram) || account.executable) throw new Error("pool_account_owner_or_executable_invalid");
  const data = account.data;
  if (data.length !== 1_265) throw new Error("pool_account_size_invalid");
  expectDiscriminator(data, POOL_DISCRIMINATOR, "pool");
  const version = data[8]!;
  const bump = data[9]!;
  if (version !== 1) throw new Error("pool_version_unsupported");
  const configHash = data.subarray(10, 42).toString("hex");
  if (configHash !== configHashHex) throw new Error("pool_config_hash_mismatch");
  const length = view(data).getUint32(42, true);
  if (length < 1 || length > 1_155) throw new Error("pool_config_length_invalid");
  const configBytes = Buffer.from(take(data, 46, length));
  const end = 46 + length;
  if (!allZero(data.subarray(end, 46 + 1_155))) throw new Error("pool_config_unused_tail_not_zero");
  const shareMint = keyAt(data, 46 + 1_155);
  const initializer = keyAt(data, 46 + 1_155 + 32);
  const [canonicalPool, canonicalPoolBump] = PublicKey.findProgramAddressSync([Buffer.from("etf_pool_v1"), Buffer.from(configHash, "hex")], expectedProgram);
  if (!expectedPool.equals(canonicalPool) || bump !== canonicalPoolBump) {
    throw new Error("pool_identity_mismatch");
  }
  return { version, bump, configHash, configBytes, shareMint, initializer };
}

// Kept separate so the read path cannot accidentally substitute a caller-supplied pool address.
export function decodeEtfPoolStateAccount(account: AccountInfo<Buffer>, expectedProgram: PublicKey, expectedPool: PublicKey): EtfPoolState {
  if (!account.owner.equals(expectedProgram) || account.executable) throw new Error("pool_state_owner_or_executable_invalid");
  const data = account.data;
  if (data.length !== 300) throw new Error("pool_state_size_invalid");
  expectDiscriminator(data, STATE_DISCRIMINATOR, "pool_state");
  const version = data[8]!;
  const bump = data[9]!;
  if (version !== 1) throw new Error("pool_state_version_unsupported");
  const [, canonicalStateBump] = PublicKey.findProgramAddressSync([Buffer.from("etf_pool_state_v1"), expectedPool.toBuffer()], expectedProgram);
  if (bump !== canonicalStateBump || keyAt(data, 10) !== expectedPool.toBase58()) throw new Error("pool_state_pda_mismatch");
  const pool = keyAt(data, 10);
  const currentGovernance = keyAt(data, 42);
  const currentGuardian = keyAt(data, 74);
  const lifecycleTag = data[106]!;
  const lifecycle: EtfLifecycle | undefined = ["unseeded", "active", "closed"][lifecycleTag] as EtfLifecycle | undefined;
  if (!lifecycle) throw new Error("pool_lifecycle_invalid");
  const pausedTag = data[107]!;
  if (pausedTag > 1) throw new Error("pool_pause_flag_invalid");
  const sequence = u64At(data, 108).toString();
  let offset = 116;
  let lastObservation: EtfPoolState["lastObservation"] = null;
  const observation = parseOption(data, offset, 43, "last_observation");
  offset = observation.payloadOffset;
  if (observation.tag === 1) {
    const observedAt = i64At(data, offset); const slot = u64At(data, offset + 8); const deviationBps = view(data).getUint16(offset + 16, true);
    const eligibleTag = data[offset + 18]!;
    if (eligibleTag > 1) throw new Error("observation_eligible_invalid");
    const publishTimes = [i64At(data, offset + 19), i64At(data, offset + 27), i64At(data, offset + 35)] as const;
    lastObservation = { observedAt: observedAt.toString(), slot: slot.toString(), deviationBps, eligible: eligibleTag === 1, publishTimes: publishTimes.map(String) as unknown as readonly [string, string, string] };
    offset += 43;
  }
  let pendingResume: EtfPoolState["pendingResume"] = null;
  const resume = parseOption(data, offset, 48, "pending_resume");
  offset = resume.payloadOffset;
  if (resume.tag === 1) {
    pendingResume = { proposer: keyAt(data, offset), nonce: u64At(data, offset + 32).toString(), executeAfter: i64At(data, offset + 40).toString() };
    offset += 48;
  }
  let pendingHandoff: EtfPoolState["pendingHandoff"] = null;
  const handoff = parseOption(data, offset, 81, "pending_handoff");
  offset = handoff.payloadOffset;
  if (handoff.tag === 1) {
    const roleTag = data[offset + 48]!;
    if (roleTag > 1) throw new Error("pending_handoff_role_invalid");
    pendingHandoff = { proposer: keyAt(data, offset), nonce: u64At(data, offset + 32).toString(), executeAfter: i64At(data, offset + 40).toString(), role: roleTag === 0 ? "governance" : "emergency_guardian", newAuthority: keyAt(data, offset + 49) };
    offset += 81;
  }
  const schedulerTag = data[offset]!;
  if (schedulerTag > 1) throw new Error("scheduler_enabled_invalid");
  const schedulerGeneration = u64At(data, offset + 1).toString();
  offset += 9;
  if (!allZero(data.subarray(offset))) throw new Error("pool_state_unused_tail_not_zero");
  if (pool !== expectedPool.toBase58()) throw new Error("pool_state_pool_mismatch");
  return { version, bump, pool, currentGovernance, currentGuardian, lifecycle, riskPaused: pausedTag === 1, sequence, schedulerEnabled: schedulerTag === 1, schedulerGeneration, lastObservation, pendingResume, pendingHandoff };
}

export function decodeEtfAssetStateAccount(account: AccountInfo<Buffer>, expectedProgram: PublicKey, expectedPool: PublicKey, expectedIndex: number): string {
  if (!account.owner.equals(expectedProgram) || account.executable) throw new Error("asset_state_owner_or_executable_invalid");
  const data = account.data;
  if (data.length !== 59) throw new Error("asset_state_size_invalid");
  expectDiscriminator(data, ASSET_STATE_DISCRIMINATOR, "asset_state");
  const [, canonicalAssetBump] = PublicKey.findProgramAddressSync([Buffer.from("etf_asset_v1"), expectedPool.toBuffer(), Buffer.from([expectedIndex])], expectedProgram);
  if (data[8] !== 1 || data[9] !== canonicalAssetBump || keyAt(data, 10) !== expectedPool.toBase58() || data[42] !== expectedIndex) throw new Error("asset_state_identity_mismatch");
  return decodeU128(data, 43);
}

function decodeU128(data: Buffer, offset: number): string {
  const low = u64At(data, offset);
  const high = u64At(data, offset + 8);
  return ((high << 64n) | low).toString();
}

function decodeClassicMint(account: AccountInfo<Buffer>, expectedAuthority: PublicKey): { supply: string; decimals: 6; mintAuthority: string; freezeAuthority: null } {
  if (!account.owner.equals(new PublicKey(ETF_DEVNET_TOKEN_PROGRAM)) || account.executable || account.data.length !== 82) throw new Error("share_mint_account_invalid");
  const data = account.data;
  if (data.readUInt32LE(0) !== 1 || !new PublicKey(data.subarray(4, 36)).equals(expectedAuthority)) throw new Error("share_mint_authority_invalid");
  const freezeTag = data.readUInt32LE(46);
  if (freezeTag !== 0 || data[45] !== 1 || data[44] !== 6) throw new Error("share_mint_decimals_or_freeze_authority_invalid");
  return { supply: u64At(data, 36).toString(), decimals: 6, mintAuthority: expectedAuthority.toBase58(), freezeAuthority: null };
}

function decodeTokenAccount(account: AccountInfo<Buffer>, mint: PublicKey, authority: PublicKey): { amount: bigint; frozen: boolean } {
  if (!account.owner.equals(new PublicKey(ETF_DEVNET_TOKEN_PROGRAM)) || account.executable || account.data.length !== 165) throw new Error("classic_token_account_invalid");
  const data = account.data;
  if (!new PublicKey(data.subarray(0, 32)).equals(mint) || !new PublicKey(data.subarray(32, 64)).equals(authority)) throw new Error("token_account_identity_mismatch");
  const delegateTag = data.readUInt32LE(72);
  const nativeTag = data.readUInt32LE(109);
  const closeAuthorityTag = data.readUInt32LE(129);
  if (delegateTag !== 0 || (nativeTag !== 0 && nativeTag !== 1) || closeAuthorityTag !== 0) throw new Error("custody_token_authority_or_option_invalid");
  if (data[108] !== 1 && data[108] !== 2) throw new Error("token_account_not_initialized");
  return { amount: u64At(data, 64), frozen: data[108] === 2 };
}

function decodeOracle(account: AccountInfo<Buffer> | null, asset: EtfAssetConfig, pushOracleProgramId: PublicKey, observedTime: number | null, limits: VerifiedEtfManifest["manifest"]["oraclePolicy"]): EtfOracleRead {
  const base: EtfOracleRead = { address: asset.oracleAccount.toBase58(), mode: asset.oracleMode, owner: account?.owner.toBase58() ?? null, dataLength: account?.data.length ?? null, feedId: null, verification: "unknown", rawPrice: null, confidence: null, confidenceBpsCeil: null, exponent: null, publishTime: null, ageSeconds: null, freshness: "unavailable", reason: account === null ? "feed_account_missing" : null };
  if (account === null) return base;
  const invalid = (reason: string, patch: Partial<EtfOracleRead> = {}): EtfOracleRead => ({ ...base, freshness: "invalid", reason, ...patch });
  if (asset.oracleMode === "push_feed" && !derivePythFixedFeedAccount(pushOracleProgramId, Buffer.from(asset.feedId), 0).equals(asset.oracleAccount)) return invalid("fixed_feed_pda_mismatch");
  if (asset.oracleProgram.toBase58() !== ETF_DEVNET_RECEIVER_PROGRAM || !account.owner.equals(asset.oracleProgram)) return invalid("wrong_receiver_owner");
  const data = account.data;
  if (account.executable || (data.length !== 133 && data.length !== 134)) return invalid("price_update_v2_layout_invalid");
  if (!data.subarray(0, 8).equals(PRICE_UPDATE_V2_DISCRIMINATOR)) return invalid("price_update_v2_discriminator_invalid");
  const verifyTag = data[40]!;
  if (verifyTag !== 1) return invalid(verifyTag === 0 ? "partial_verification" : "unknown_verification_level", { verification: verifyTag === 0 ? "partial" : "unknown" });
  const feedId = `0x${data.subarray(41, 73).toString("hex")}`;
  const expectedFeedId = `0x${Buffer.from(asset.feedId).toString("hex")}`;
  if (feedId !== expectedFeedId) return invalid("embedded_feed_id_mismatch", { feedId, verification: "full" });
  const rawPriceBig = view(data).getBigInt64(73, true);
  const confidenceBig = view(data).getBigUint64(81, true);
  const exponent = view(data).getInt32(89, true);
  const publishTimeBig = view(data).getBigInt64(93, true);
  const partial = { feedId, verification: "full" as const, rawPrice: rawPriceBig.toString(), confidence: confidenceBig.toString(), exponent, publishTime: publishTimeBig.toString() };
  if (rawPriceBig <= 0n) return invalid("nonpositive_price", partial);
  if (exponent < limits.minimumExponent || exponent > limits.maximumExponent) return invalid("exponent_outside_approved_limit", partial);
  if (observedTime === null || !Number.isSafeInteger(observedTime)) return invalid("chain_time_unavailable", partial);
  const age = BigInt(observedTime) - publishTimeBig;
  if (age < 0n) return { ...invalid("future_publish_time", { ...partial, ageSeconds: age.toString() }), freshness: "future_publish_time" };
  const confidenceBps = ((confidenceBig * 10_000n) + rawPriceBig - 1n) / rawPriceBig;
  const computed = { ...partial, confidenceBpsCeil: confidenceBps.toString(), ageSeconds: age.toString() };
  if (age > BigInt(limits.maximumAgeSeconds)) return { ...base, ...computed, freshness: "stale", reason: "feed_exceeds_approved_age" };
  if (confidenceBps > BigInt(limits.maximumConfidenceBps)) return { ...base, ...computed, freshness: "confidence_over_limit", reason: "confidence_exceeds_approved_limit" };
  return { ...base, ...computed, freshness: "within_approved_limits", reason: null };
}

function parseProgramLoader(program: AccountInfo<Buffer> | null, loader: PublicKey, expectedUpgradeAuthority: string | null, expectedBinaryHash: string): { programData: PublicKey; binarySha256: string; upgradeAuthority: string | null } {
  if (program === null || !program.executable || !program.owner.equals(loader) || program.data.length !== 36 || program.data.readUInt32LE(0) !== 2) throw new Error("deployed_program_loader_state_invalid");
  const programData = new PublicKey(program.data.subarray(4, 36));
  return { programData, binarySha256: expectedBinaryHash, upgradeAuthority: expectedUpgradeAuthority };
}

function parseProgramData(account: AccountInfo<Buffer> | null, loader: PublicKey, expectedUpgradeAuthority: string | null, expectedHash: string): string {
  if (account === null || account.executable || !account.owner.equals(loader) || account.data.length < 45 || account.data.readUInt32LE(0) !== 3) throw new Error("program_data_account_invalid");
  const tag = account.data[12]!;
  if (tag !== 0 && tag !== 1) throw new Error("program_upgrade_authority_tag_invalid");
  const upgradeAuthority = tag === 1 ? new PublicKey(account.data.subarray(13, 45)).toBase58() : null;
  if (upgradeAuthority !== expectedUpgradeAuthority) throw new Error("program_upgrade_authority_mismatch");
  const binaryHash = Buffer.from(sha256(account.data.subarray(45))).toString("hex");
  if (binaryHash !== expectedHash) throw new Error("deployed_program_binary_hash_mismatch");
  return binaryHash;
}

function decodeWalletTokenAccount(account: AccountInfo<Buffer>, address: PublicKey, wallet: PublicKey): { address: string; mint: string; amount: string; frozen: boolean } {
  if (!account.owner.equals(new PublicKey(ETF_DEVNET_TOKEN_PROGRAM)) || account.executable || account.data.length !== 165) throw new Error("wallet_token_account_layout_invalid");
  const mint = new PublicKey(account.data.subarray(0, 32));
  const owner = new PublicKey(account.data.subarray(32, 64));
  if (!owner.equals(wallet)) throw new Error("wallet_token_account_owner_mismatch");
  const state = account.data[108]!;
  if (state !== 1 && state !== 2) throw new Error("wallet_token_account_not_initialized");
  return { address: address.toBase58(), mint: mint.toBase58(), amount: u64At(account.data, 64).toString(), frozen: state === 2 };
}

/** Reads one coherent pool/account batch and refuses any manifest, account, loader, or oracle identity mismatch. */
export async function readEtfSnapshot(connection: Connection, context: VerifiedEtfManifest, options: { walletAddress?: string; commitment?: "confirmed" | "finalized" } = {}): Promise<VerifiedEtfSnapshot> {
  const commitment = options.commitment ?? "confirmed";
  const actualGenesis = await connection.getGenesisHash();
  if (actualGenesis !== ETF_DEVNET_GENESIS_HASH || actualGenesis !== context.manifest.genesisHash) throw new Error("deployment_genesis_mismatch");
  const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
  const programInfo = await connection.getAccountInfo(context.programId, commitment as Commitment);
  const loaderView = parseProgramLoader(programInfo, loader, context.manifest.expectedUpgradeAuthority, context.manifest.programBinarySha256);
  const programDataInfo = await connection.getAccountInfo(loaderView.programData, commitment as Commitment);
  const programBinarySha256 = parseProgramData(programDataInfo, loader, context.manifest.expectedUpgradeAuthority, context.manifest.programBinarySha256);
  const assetAddresses = context.addresses.assets.slice(0, context.config.assets.length);
  const feedKeys = context.config.assets.map((asset) => asset.oracleAccount);
  const keys = [context.addresses.pool, context.addresses.poolState, context.addresses.shareMint,
    ...assetAddresses.flatMap(({ custody, assetState }, index) => [context.config.assets[index]!.mint, custody, assetState]), ...feedKeys];
  const response = await connection.getMultipleAccountsInfoAndContext(keys, commitment as Commitment);
  const blockTimeValue = await connection.getBlockTime(response.context.slot).catch(() => null);
  const infos = response.value;
  let cursor = 0;
  const poolInfo = infos[cursor++] ?? null;
  const stateInfo = infos[cursor++] ?? null;
  const shareInfo = infos[cursor++] ?? null;
  if (!poolInfo || !stateInfo || !shareInfo) throw new Error("required_pool_account_missing");
  const pool = decodeEtfPoolAccount(poolInfo, context.programId, context.addresses.pool, context.configHash.toString("hex"));
  if (pool.configBytes.compare(context.configBytes) !== 0) throw new Error("pool_config_bytes_mismatch");
  if (pool.shareMint !== context.addresses.shareMint.toBase58()) throw new Error("pool_share_mint_pda_mismatch");
  const state = decodeEtfPoolStateAccount(stateInfo, context.programId, context.addresses.pool);
  const shareMint = decodeClassicMint(shareInfo, context.addresses.authority);
  const feeRows: string[] = [];
  const assetRows: Array<{ mintInfo: AccountInfo<Buffer>; custodyInfo: AccountInfo<Buffer>; assetStateInfo: AccountInfo<Buffer> }> = [];
  for (let index = 0; index < context.config.assets.length; index += 1) {
    const mintInfo = infos[cursor++] ?? null;
    const custodyInfo = infos[cursor++] ?? null;
    const assetStateInfo = infos[cursor++] ?? null;
    const asset = context.config.assets[index]!;
    if (!mintInfo) throw new Error(`asset_${index}_mint_missing`);
    if (!custodyInfo || !assetStateInfo) throw new Error(`asset_${index}_custody_or_state_missing`);
    const mint = decodeClassicSplMint(asset.mint.toBase58(), mintInfo);
    if (mint.status !== "available" || !mint.isInitialized || mint.owner === null || mint.dataLength === null || mint.supplyBaseUnits === null || mint.decimals === null) throw new Error(`asset_${index}_mint_metadata_incomplete`);
    if (mint.decimals !== asset.decimals) throw new Error(`asset_${index}_mint_decimals_mismatch`);
    const reserve = decodeTokenAccount(custodyInfo, asset.mint, context.addresses.authority);
    feeRows.push(decodeEtfAssetStateAccount(assetStateInfo, context.programId, context.addresses.pool, index));
    assetRows.push({ mintInfo, custodyInfo, assetStateInfo });
  }
  const oracleInfos = infos.slice(cursor);
  const observedTime = blockTimeValue === null ? null : blockTimeValue;
  const assets: EtfAssetRead[] = context.config.assets.map((asset, index) => {
    const row = assetRows[index]!;
    const reserve = decodeTokenAccount(row.custodyInfo, asset.mint, context.addresses.authority);
    const mint = decodeClassicSplMint(asset.mint.toBase58(), row.mintInfo);
    const feedAccount = oracleInfos[index] ?? null;
    const oracle = decodeOracle(feedAccount, asset, new PublicKey(context.manifest.oraclePolicy.pushOracleProgramId), observedTime, context.manifest.oraclePolicy);
    return { index, mint: asset.mint.toBase58(), mintOwner: mint.owner!, mintDataLength: mint.dataLength!, mintSupply: mint.supplyBaseUnits!, mintAuthority: mint.mintAuthority, mintFreezeAuthority: mint.freezeAuthority, tokenProgram: asset.tokenProgram.toBase58(), decimals: asset.decimals, targetWeightBps: asset.targetWeightBps, label: context.manifest.assetLabels[index]!.label, backing: context.manifest.assetLabels[index]!.backing, custody: context.addresses.assets[index]!.custody.toBase58(), custodyAmount: reserve.amount.toString(), custodyFrozen: reserve.frozen, assetState: context.addresses.assets[index]!.assetState.toBase58(), cumulativeFeeBaseUnits: feeRows[index]!, oracle };
  });
  const blockTime = blockTimeValue === null ? null : BigInt(blockTimeValue).toString();
  let wallet: EtfWalletRead | null = null;
  if (options.walletAddress !== undefined) {
    const walletKey = new PublicKey(options.walletAddress);
    const tokenRows: EtfWalletRead["tokenAccounts"][number][] = [];
    const shareRows: EtfWalletRead["shareAccounts"][number][] = [];
    for (const asset of context.config.assets) {
      const query = await connection.getTokenAccountsByOwner(walletKey, { mint: asset.mint }, commitment as Commitment);
      for (const item of query.value) {
        const row = decodeWalletTokenAccount(item.account, item.pubkey, walletKey);
        tokenRows.push({ ...row, contextSlot: query.context.slot.toString() });
      }
    }
    const shareQuery = await connection.getTokenAccountsByOwner(walletKey, { mint: context.addresses.shareMint }, commitment as Commitment);
    for (const item of shareQuery.value) {
      const row = decodeWalletTokenAccount(item.account, item.pubkey, walletKey);
      if (row.mint !== context.addresses.shareMint.toBase58()) throw new Error("wallet_share_mint_mismatch");
      shareRows.push({ address: row.address, amount: row.amount, frozen: row.frozen, contextSlot: shareQuery.context.slot.toString() });
    }
    wallet = { address: walletKey.toBase58(), tokenAccounts: tokenRows, shareAccounts: shareRows };
  }
  const snapshot = freezeSnapshot({
    network: { cluster: "devnet", genesisHash: actualGenesis, rpcEndpoint: new URL(connection.rpcEndpoint).origin, commitment, contextSlot: response.context.slot.toString(), blockTime },
    deployment: { programId: context.programId.toBase58(), programExecutable: true, programLoader: loader.toBase58(), programData: loaderView.programData.toBase58(), programBinarySha256, upgradeAuthority: loaderView.upgradeAuthority },
    identity: { pool: context.addresses.pool.toBase58(), poolState: context.addresses.poolState.toBase58(), configHash: pool.configHash, strategyId: `etf1:${pool.configHash}`, shareMint: pool.shareMint, initializer: pool.initializer, currentGovernance: state.currentGovernance, currentGuardian: state.currentGuardian },
    state,
    shares: shareMint,
    assets,
    wallet,
  }) as VerifiedEtfSnapshot;
  VERIFIED_SNAPSHOTS.set(snapshot, context);
  return snapshot;
}

function freezeSnapshot<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) value.forEach(freezeSnapshot);
  else if (Object.getPrototypeOf(value) === Object.prototype) Object.values(value as Record<string, unknown>).forEach(freezeSnapshot);
  else return value;
  return Object.freeze(value);
}

export function assertVerifiedEtfSnapshot(snapshot: VerifiedEtfSnapshot, context: VerifiedEtfManifest): void {
  if (VERIFIED_SNAPSHOTS.get(snapshot) !== context || !manifestContextBelongsTo(context, new PublicKey(snapshot.deployment.programId), new PublicKey(snapshot.identity.pool))) throw new Error("rpc_snapshot_context_mismatch");
}

export function assertRiskOracleReady(snapshot: VerifiedEtfSnapshot): void {
  if (snapshot.assets.some(({ oracle }) => oracle.freshness !== "within_approved_limits" || oracle.verification !== "full")) throw new Error("oracle_not_within_approved_limits");
}
