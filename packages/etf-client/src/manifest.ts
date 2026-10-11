import { sha256 } from "@noble/hashes/sha256";
import { PublicKey } from "@solana/web3.js";
import { ETF_DEVNET_CANDIDATE_FEEDS, ETF_DEVNET_GENESIS_HASH, ETF_DEVNET_RECEIVER_PROGRAM, ETF_DEVNET_TOKEN_PROGRAM } from "./devnet-read.js";

/** The compiled IDL address used by local S5E builds. It is never a Devnet deployment identity. */
export const ETF_DRAFT_LOCALNET_PROGRAM_ID = "H3CkHowYVQcxrKXWkyswMW2rqRNzRQYaQr7N8LKXFUt9";
export const ETF_PROGRAM_DATA_LOADER_ID = "BPFLoaderUpgradeab1e11111111111111111111111";
export const ETF_DEVNET_PUSH_ORACLE_PROGRAM_ID = "pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT";
export const ETF_SHARE_DECIMALS = 6;
export const ETF_CONFIG_DOMAIN = Buffer.from("coloyond:etf:config:v1", "utf8");
const MAX_CONFIG_BYTES = 1_155;
const MAX_POLICY_PARAMS_BYTES = 256;
const U64_MAX = (1n << 64n) - 1n;

export type EtfAssetConfig = Readonly<{
  mint: PublicKey;
  tokenProgram: PublicKey;
  decimals: number;
  oracleMode: "push_feed" | "receiver_full";
  oracleProgram: PublicKey;
  oracleAccount: PublicKey;
  feedId: readonly number[];
  targetWeightBps: number;
}>;

export type EtfPoolConfig = Readonly<{
  protocolVersion: 1;
  assets: readonly EtfAssetConfig[];
  mathVersion: number;
  feePolicyId: Uint8Array;
  feePolicyParams: Uint8Array;
  riskPolicyId: Uint8Array;
  riskPolicyParams: Uint8Array;
  initialGovernanceAuthority: PublicKey;
  initialEmergencyGuardian: PublicKey;
  governanceDelaySeconds: bigint;
}>;

export type EtfDeploymentManifestV1 = Readonly<{
  schema: "coloyond-etf-deployment-v1";
  status: "draft" | "accepted";
  cluster: "devnet";
  genesisHash: string;
  programId: string;
  programSourceSha256: string;
  programBinarySha256: string;
  idlSha256: string;
  expectedUpgradeAuthority: string | null;
  configBytesHex: string;
  configHashHex: string;
  addresses: Readonly<{
    pool: string;
    poolState: string;
    authority: string;
    shareMint: string;
  }>;
  approvals: Readonly<{ s0b: string; s5a: string; s5d2: string }>;
  mathPolicy: Readonly<{
    status: "accepted";
    version: number;
    valueScaleUsdDecimals: number;
    minimumWeightBps: number;
  }>;
  oraclePolicy: Readonly<{
    status: "accepted";
    idHex: string;
    paramsHex: string;
    pushOracleProgramId: string;
    maximumAgeSeconds: number;
    maximumConfidenceBps: number;
    minimumExponent: number;
    maximumExponent: number;
  }>;
  feePolicy: Readonly<{
    status: "accepted";
    idHex: string;
    paramsHex: string;
    swapFeeBps: number;
    maximumInputBps: number;
    quoteParityBandBps: number;
    seedCompositionToleranceBps: number;
  }>;
  assetLabels: readonly Readonly<{
    label: string;
    backing: "native_wrapped" | "synthetic_unbacked";
  }>[];
}>;

export type DerivedEtfAddresses = Readonly<{
  pool: PublicKey;
  poolState: PublicKey;
  authority: PublicKey;
  shareMint: PublicKey;
  assets: readonly Readonly<{ custody: PublicKey; assetState: PublicKey }>[];
}>;

const CONTEXT = Symbol("verified-etf-manifest");
const VERIFIED_CONTEXTS = new WeakSet<object>();
export type VerifiedEtfManifest = Readonly<{
  [CONTEXT]: true;
  manifest: EtfDeploymentManifestV1;
  programId: PublicKey;
  config: EtfPoolConfig;
  configBytes: Buffer;
  configHash: Buffer;
  addresses: DerivedEtfAddresses;
  idl: Readonly<Record<string, unknown>>;
}>;

function fixedBytes(buffer: Buffer, length: number, label: string): Buffer {
  if (buffer.length !== length) throw new Error(`${label}_wrong_length`);
  return buffer;
}

function readHex(value: string, label: string, bytes?: number): Buffer {
  if (!/^(?:[0-9a-f]{2})*$/i.test(value)) throw new Error(`${label}_invalid_hex`);
  const result = Buffer.from(value, "hex");
  if (bytes !== undefined) fixedBytes(result, bytes, label);
  return result;
}

function safeKey(bytes: Buffer, label: string): PublicKey {
  try {
    return new PublicKey(fixedBytes(bytes, 32, label));
  } catch {
    throw new Error(`${label}_invalid_pubkey`);
  }
}

class Cursor {
  private offset = 0;
  constructor(private readonly bytes: Buffer) {}
  take(length: number, label: string): Buffer {
    if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.bytes.length) {
      throw new Error(`config_truncated_${label}`);
    }
    const value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }
  u8(label: string): number { return this.take(1, label).readUInt8(0); }
  u16(label: string): number { return this.take(2, label).readUInt16LE(0); }
  u32(label: string): number { return this.take(4, label).readUInt32LE(0); }
  u64(label: string): bigint { return this.take(8, label).readBigUInt64LE(0); }
  vector(label: string): Buffer {
    const length = this.u32(`${label}_length`);
    if (length > MAX_POLICY_PARAMS_BYTES) throw new Error(`${label}_too_large`);
    return this.take(length, label);
  }
  done(): boolean { return this.offset === this.bytes.length; }
}

export function decodeEtfPoolConfigV1(bytes: Uint8Array): EtfPoolConfig {
  const input = Buffer.from(bytes);
  if (input.length === 0 || input.length > MAX_CONFIG_BYTES) throw new Error("config_size_out_of_range");
  const c = new Cursor(input);
  if (c.u8("protocol_version") !== 1) throw new Error("config_unsupported_protocol_version");
  const assetCount = c.u32("asset_count");
  if (assetCount < 2 || assetCount > 3) throw new Error("config_asset_count_out_of_range");
  const assets: EtfAssetConfig[] = [];
  const mints = new Set<string>();
  let weightSum = 0;
  for (let index = 0; index < assetCount; index += 1) {
    const mint = safeKey(c.take(32, `asset_${index}_mint`), `asset_${index}_mint`);
    const tokenProgram = safeKey(c.take(32, `asset_${index}_token_program`), `asset_${index}_token_program`);
    const decimals = c.u8(`asset_${index}_decimals`);
    const modeTag = c.u8(`asset_${index}_oracle_mode`);
    if (modeTag > 1) throw new Error(`asset_${index}_oracle_mode_invalid`);
    const oracleProgram = safeKey(c.take(32, `asset_${index}_oracle_program`), `asset_${index}_oracle_program`);
    const oracleAccount = safeKey(c.take(32, `asset_${index}_oracle_account`), `asset_${index}_oracle_account`);
    const feedId = c.take(32, `asset_${index}_feed_id`);
    const targetWeightBps = c.u16(`asset_${index}_target_weight`);
    if (tokenProgram.toBase58() !== ETF_DEVNET_TOKEN_PROGRAM) throw new Error(`asset_${index}_token_2022_not_supported`);
    if (decimals > 9) throw new Error(`asset_${index}_decimals_out_of_s5b_range`);
    if (mints.has(mint.toBase58())) throw new Error("config_duplicate_mint");
    mints.add(mint.toBase58());
    weightSum += targetWeightBps;
    assets.push({ mint, tokenProgram, decimals, oracleMode: modeTag === 0 ? "push_feed" : "receiver_full", oracleProgram, oracleAccount, feedId: Object.freeze(Array.from(feedId)), targetWeightBps });
  }
  if (weightSum !== 10_000) throw new Error("config_target_weights_invalid");
  const mathVersion = c.u16("math_version");
  const feePolicyId = c.take(32, "fee_policy_id");
  const feePolicyParams = c.vector("fee_policy_params");
  const riskPolicyId = c.take(32, "risk_policy_id");
  const riskPolicyParams = c.vector("risk_policy_params");
  const initialGovernanceAuthority = safeKey(c.take(32, "governance_authority"), "governance_authority");
  const initialEmergencyGuardian = safeKey(c.take(32, "emergency_guardian"), "emergency_guardian");
  const governanceDelaySeconds = c.u64("governance_delay");
  if (!c.done()) throw new Error("config_trailing_bytes");
  if (initialGovernanceAuthority.equals(PublicKey.default) || initialEmergencyGuardian.equals(PublicKey.default) || initialGovernanceAuthority.equals(initialEmergencyGuardian)) {
    throw new Error("config_authorities_invalid");
  }
  return { protocolVersion: 1, assets, mathVersion, feePolicyId, feePolicyParams, riskPolicyId, riskPolicyParams, initialGovernanceAuthority, initialEmergencyGuardian, governanceDelaySeconds };
}

export function deriveEtfAddresses(programId: PublicKey, configHash: Uint8Array): DerivedEtfAddresses {
  const hash = fixedBytes(Buffer.from(configHash), 32, "config_hash");
  const [pool] = PublicKey.findProgramAddressSync([Buffer.from("etf_pool_v1"), hash], programId);
  const [poolState] = PublicKey.findProgramAddressSync([Buffer.from("etf_pool_state_v1"), pool.toBuffer()], programId);
  const [authority] = PublicKey.findProgramAddressSync([Buffer.from("etf_authority_v1"), pool.toBuffer()], programId);
  const [shareMint] = PublicKey.findProgramAddressSync([Buffer.from("etf_share_v1"), pool.toBuffer()], programId);
  const assets = [0, 1, 2].map((index) => {
    const [custody] = PublicKey.findProgramAddressSync([Buffer.from("etf_custody_v1"), pool.toBuffer(), Buffer.from([index])], programId);
    const [assetState] = PublicKey.findProgramAddressSync([Buffer.from("etf_asset_v1"), pool.toBuffer(), Buffer.from([index])], programId);
    return { custody, assetState };
  });
  return { pool, poolState, authority, shareMint, assets };
}

/** Matches Pyth's SDK derivation: PDA([shard_u16_le, 32-byte feed ID], Push Oracle program). */
export function derivePythFixedFeedAccount(pushOracleProgramId: PublicKey, feedId: Uint8Array, shard = 0): PublicKey {
  if (!Number.isInteger(shard) || shard < 0 || shard > 65_535) throw new Error("pyth_shard_out_of_range");
  const feed = fixedBytes(Buffer.from(feedId), 32, "pyth_feed_id");
  const shardBytes = Buffer.alloc(2);
  shardBytes.writeUInt16LE(shard);
  return PublicKey.findProgramAddressSync([shardBytes, feed], pushOracleProgramId)[0];
}

type IdlInstruction = { name: string; discriminator: number[]; accounts: { name: string; writable?: boolean; signer?: boolean; optional?: boolean; address?: string }[]; args: { name: string; type: unknown }[] };
type ExpectedIdlSurface = Readonly<{
  discriminator: readonly number[];
  accounts: readonly string[];
  args: readonly string[];
  accountFlags?: readonly Readonly<{ signer: boolean; writable: boolean }>[];
  argTypes?: readonly string[];
}>;
const EXPECTED_IDL_SURFACE: Readonly<Record<string, ExpectedIdlSurface>> = {
  initialize_pool: { discriminator: [95, 180, 10, 172, 84, 174, 232, 40], accounts: ["payer", "pool", "pool_state", "share_mint", "authority", "token_program", "system_program"], args: ["config_hash", "config_bytes"] },
  seed_pool: { discriminator: [111, 214, 148, 46, 108, 2, 217, 18], accounts: ["seed", "pool", "pool_state", "share_mint", "authority", "token_program", "oracle_feed_0", "oracle_feed_1", "oracle_feed_2"], args: ["amounts", "min_shares_out"] },
  deposit_proportional: { discriminator: [63, 57, 128, 46, 164, 238, 143, 133], accounts: ["user", "pool", "pool_state", "share_mint", "authority", "token_program"], args: ["max_inputs", "min_shares_out"] },
  redeem_in_kind: { discriminator: [102, 58, 189, 252, 192, 219, 140, 89], accounts: ["user", "pool", "pool_state", "share_mint", "authority", "token_program"], args: ["shares_to_burn", "min_amounts_out"] },
  swap_exact_in: { discriminator: [104, 104, 131, 86, 161, 189, 180, 216], accounts: ["trader", "pool", "pool_state", "authority", "token_program", "oracle_feed_0", "oracle_feed_1", "oracle_feed_2"], args: ["asset_in", "asset_out", "amount_in", "min_amount_out"] },
  pause_risk: { discriminator: [221, 2, 34, 100, 217, 178, 42, 15], accounts: ["guardian", "pool", "pool_state", "share_mint", "authority"], args: [] },
  poke: { discriminator: [46, 24, 16, 107, 212, 9, 17, 5], accounts: ["caller", "pool", "pool_state", "oracle_feed_0", "oracle_feed_1", "oracle_feed_2"], args: [] },
  propose_resume: { discriminator: [101, 206, 195, 58, 159, 84, 16, 59], accounts: ["governance", "pool", "pool_state"], args: [], accountFlags: [{ signer: true, writable: false }, { signer: false, writable: false }, { signer: false, writable: true }] },
  resume_risk_after_delay: { discriminator: [62, 120, 18, 234, 169, 77, 91, 35], accounts: ["executor", "pool", "pool_state"], args: ["proposal_nonce"], accountFlags: [{ signer: true, writable: false }, { signer: false, writable: false }, { signer: false, writable: true }], argTypes: ["u64"] },
  cancel_resume_proposal: { discriminator: [214, 159, 34, 123, 49, 111, 127, 76], accounts: ["governance", "pool", "pool_state"], args: ["proposal_nonce"], accountFlags: [{ signer: true, writable: false }, { signer: false, writable: false }, { signer: false, writable: true }], argTypes: ["u64"] },
};

function requireIdl(value: unknown, expectedProgramId: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("idl_missing_or_invalid");
  const idl = value as Record<string, unknown>;
  if (typeof idl.address !== "string") throw new Error("idl_address_missing");
  const idlAddress = new PublicKey(idl.address).toBase58();
  if (idlAddress === ETF_DRAFT_LOCALNET_PROGRAM_ID) throw new Error("draft_localnet_idl_rejected_for_devnet");
  if (idlAddress !== expectedProgramId) throw new Error("idl_program_id_mismatch");
  if (!Array.isArray(idl.instructions)) throw new Error("idl_instructions_missing");
  const instructions = idl.instructions as IdlInstruction[];
  for (const [name, expected] of Object.entries(EXPECTED_IDL_SURFACE)) {
    const actual = instructions.find((item) => item?.name === name);
    if (!actual) throw new Error(`idl_instruction_missing_${name}`);
    if (!Array.isArray(actual.discriminator) || actual.discriminator.join(",") !== expected.discriminator.join(",")) throw new Error(`idl_discriminator_mismatch_${name}`);
    if (!Array.isArray(actual.accounts) || actual.accounts.map((item) => item?.name).join(",") !== expected.accounts.join(",")) throw new Error(`idl_account_order_mismatch_${name}`);
    if (!Array.isArray(actual.args) || actual.args.map((item) => item?.name).join(",") !== expected.args.join(",")) throw new Error(`idl_argument_order_mismatch_${name}`);
    if (expected.accountFlags?.some((flags, index) => (actual.accounts[index]?.signer ?? false) !== flags.signer || (actual.accounts[index]?.writable ?? false) !== flags.writable)) throw new Error(`idl_account_flags_mismatch_${name}`);
    if (expected.argTypes?.some((type, index) => actual.args[index]?.type !== type)) throw new Error(`idl_argument_type_mismatch_${name}`);
  }
  return deepFreeze(structuredClone(idl));
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return value;
  Object.values(value as Record<string, unknown>).forEach(deepFreeze);
  return Object.freeze(value);
}

function requirePolicy(manifest: EtfDeploymentManifestV1): void {
  if (manifest.status !== "accepted") throw new Error("deployment_manifest_not_accepted");
  if (manifest.mathPolicy?.status !== "accepted" || manifest.oraclePolicy?.status !== "accepted" || manifest.feePolicy?.status !== "accepted") {
    throw new Error("required_policy_not_accepted");
  }
  if (![manifest.approvals?.s0b, manifest.approvals?.s5a, manifest.approvals?.s5d2].every((value) => typeof value === "string" && value.trim().length > 0)) {
    throw new Error("required_evidence_approval_missing");
  }
  for (const [name, digest] of [["source", manifest.programSourceSha256], ["binary", manifest.programBinarySha256], ["idl", manifest.idlSha256]] as const) {
    if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error(`program_${name}_digest_invalid`);
  }
  if (manifest.assetLabels.length !== 2 && manifest.assetLabels.length !== 3) throw new Error("asset_labels_count_mismatch");
  manifest.assetLabels.forEach((item) => {
    if (typeof item.label !== "string" || item.label.trim().length === 0) throw new Error("asset_label_missing");
    if (item.backing !== "native_wrapped" && item.backing !== "synthetic_unbacked") throw new Error("asset_backing_label_invalid");
    if (item.backing === "synthetic_unbacked" && !/synthetic|unbacked|test/i.test(item.label)) throw new Error("synthetic_asset_label_inadequate");
  });
  const limits = [manifest.mathPolicy.valueScaleUsdDecimals, manifest.mathPolicy.minimumWeightBps, manifest.oraclePolicy.maximumAgeSeconds, manifest.oraclePolicy.maximumConfidenceBps, manifest.oraclePolicy.minimumExponent, manifest.oraclePolicy.maximumExponent, manifest.feePolicy.swapFeeBps, manifest.feePolicy.maximumInputBps, manifest.feePolicy.quoteParityBandBps, manifest.feePolicy.seedCompositionToleranceBps];
  if (!limits.every(Number.isSafeInteger)) throw new Error("accepted_policy_limit_invalid");
  if (manifest.mathPolicy.version < 1 || manifest.mathPolicy.version > 65_535 || manifest.mathPolicy.valueScaleUsdDecimals !== 12 || manifest.mathPolicy.minimumWeightBps < 1 || manifest.mathPolicy.minimumWeightBps > 5_000) throw new Error("accepted_math_policy_invalid");
  if (manifest.oraclePolicy.maximumAgeSeconds <= 0 || manifest.oraclePolicy.maximumConfidenceBps < 0 || manifest.oraclePolicy.maximumConfidenceBps > 10_000 || manifest.oraclePolicy.minimumExponent < -2_147_483_648 || manifest.oraclePolicy.maximumExponent > 2_147_483_647 || manifest.oraclePolicy.minimumExponent > manifest.oraclePolicy.maximumExponent) throw new Error("accepted_oracle_policy_invalid");
  if (manifest.feePolicy.swapFeeBps < 0 || manifest.feePolicy.swapFeeBps >= 10_000 || manifest.feePolicy.maximumInputBps <= 0 || manifest.feePolicy.maximumInputBps > 3_000 || manifest.feePolicy.quoteParityBandBps < 0 || manifest.feePolicy.quoteParityBandBps > 10_000 || manifest.feePolicy.seedCompositionToleranceBps < 0 || manifest.feePolicy.seedCompositionToleranceBps > 10_000) throw new Error("accepted_economics_policy_invalid");
  if (new PublicKey(manifest.oraclePolicy.pushOracleProgramId).toBase58() !== ETF_DEVNET_PUSH_ORACLE_PROGRAM_ID) throw new Error("push_oracle_program_not_in_devnet_manifest");
}

/** Synchronously admits only a reviewed manifest and a matching non-placeholder IDL. */
export function verifyEtfManifest(manifestInput: unknown, idlInput: unknown, actualGenesisHash: string): VerifiedEtfManifest {
  if (typeof manifestInput !== "object" || manifestInput === null || Array.isArray(manifestInput)) throw new Error("deployment_manifest_missing");
  const manifest = manifestInput as EtfDeploymentManifestV1;
  if (manifest.schema !== "coloyond-etf-deployment-v1") throw new Error("deployment_manifest_schema_invalid");
  if (manifest.cluster !== "devnet" || manifest.genesisHash !== ETF_DEVNET_GENESIS_HASH || actualGenesisHash !== ETF_DEVNET_GENESIS_HASH || actualGenesisHash !== manifest.genesisHash) {
    throw new Error("deployment_genesis_mismatch");
  }
  requirePolicy(manifest);
  const programId = new PublicKey(manifest.programId);
  if (programId.toBase58() === ETF_DRAFT_LOCALNET_PROGRAM_ID) throw new Error("draft_localnet_program_id_rejected_for_devnet");
  const idl = requireIdl(idlInput, programId.toBase58());
  const idlHash = Buffer.from(sha256(Buffer.from(JSON.stringify(idl), "utf8"))).toString("hex");
  if (idlHash !== manifest.idlSha256) throw new Error("manifest_idl_hash_mismatch");
  const configBytes = readHex(manifest.configBytesHex, "config_bytes");
  const config = decodeEtfPoolConfigV1(configBytes);
  const configHash = Buffer.from(sha256(Buffer.concat([ETF_CONFIG_DOMAIN, configBytes])));
  if (configHash.toString("hex") !== manifest.configHashHex) throw new Error("manifest_config_hash_mismatch");
  if (manifest.mathPolicy.valueScaleUsdDecimals !== 12 || manifest.mathPolicy.minimumWeightBps < 100) throw new Error("accepted_math_policy_mismatch_with_s5b");
  if (config.mathVersion !== manifest.mathPolicy.version) throw new Error("manifest_math_version_mismatch");
  if (!Buffer.from(config.feePolicyId).equals(readHex(manifest.feePolicy.idHex, "fee_policy_id", 32)) || !Buffer.from(config.feePolicyParams).equals(readHex(manifest.feePolicy.paramsHex, "fee_policy_params"))) throw new Error("manifest_fee_policy_mismatch");
  if (!Buffer.from(config.riskPolicyId).equals(readHex(manifest.oraclePolicy.idHex, "risk_policy_id", 32)) || !Buffer.from(config.riskPolicyParams).equals(readHex(manifest.oraclePolicy.paramsHex, "risk_policy_params"))) throw new Error("manifest_risk_policy_mismatch");
  if (config.assets.length !== manifest.assetLabels.length) throw new Error("asset_labels_count_mismatch");
  const pushOracleProgramId = new PublicKey(manifest.oraclePolicy.pushOracleProgramId);
  for (let index = 0; index < config.assets.length; index += 1) {
    const asset = config.assets[index]!;
    if (asset.oracleProgram.toBase58() !== ETF_DEVNET_RECEIVER_PROGRAM) throw new Error(`asset_${index}_receiver_program_mismatch`);
    if (asset.oracleMode === "push_feed") {
      const derivedFeed = derivePythFixedFeedAccount(pushOracleProgramId, Buffer.from(asset.feedId), 0);
      if (!derivedFeed.equals(asset.oracleAccount)) throw new Error(`asset_${index}_pyth_fixed_feed_pda_mismatch`);
    }
    const allowedFeed = ETF_DEVNET_CANDIDATE_FEEDS.find((candidate) => candidate.address === asset.oracleAccount.toBase58() && candidate.feedId.toLowerCase() === `0x${Buffer.from(asset.feedId).toString("hex")}`);
    if (!allowedFeed) throw new Error(`asset_${index}_feed_not_in_devnet_candidate_manifest`);
    if (allowedFeed.associatedMint !== null && allowedFeed.associatedMint !== asset.mint.toBase58()) throw new Error(`asset_${index}_mint_feed_binding_mismatch`);
    const expectedBacking = allowedFeed.associatedMint === null || /synthetic|unbacked|test mint/i.test(allowedFeed.label) ? "synthetic_unbacked" : "native_wrapped";
    if (manifest.assetLabels[index]!.backing !== expectedBacking) throw new Error(`asset_${index}_backing_label_mismatch`);
  }
  const addresses = deriveEtfAddresses(programId, configHash);
  const addressChecks: [string, PublicKey][] = [
    ["pool", addresses.pool], ["poolState", addresses.poolState], ["authority", addresses.authority], ["shareMint", addresses.shareMint],
  ];
  for (const [name, derived] of addressChecks) {
    const provided = new PublicKey(manifest.addresses[name as keyof typeof manifest.addresses]);
    if (!provided.equals(derived)) throw new Error(`manifest_${name}_pda_mismatch`);
  }
  for (let index = 0; index < config.assets.length; index += 1) {
    const asset = config.assets[index]!;
    if (asset.targetWeightBps < manifest.mathPolicy.minimumWeightBps) throw new Error(`asset_${index}_below_accepted_math_floor`);
  }
  const frozenManifest = deepFreeze(structuredClone(manifest));
  const frozenConfig = deepFreeze(config);
  const frozenAddresses = deepFreeze(addresses);
  const context = {
    [CONTEXT]: true as const,
    manifest: frozenManifest,
    programId,
    config: frozenConfig,
    get configBytes() { return Buffer.from(configBytes); },
    get configHash() { return Buffer.from(configHash); },
    addresses: frozenAddresses,
    idl,
  };
  Object.freeze(context);
  VERIFIED_CONTEXTS.add(context);
  return context;
}

export function manifestContextBelongsTo(context: VerifiedEtfManifest, programId: PublicKey, pool: PublicKey): boolean {
  return VERIFIED_CONTEXTS.has(context) && context[CONTEXT] === true && context.programId.equals(programId) && context.addresses.pool.equals(pool);
}

export function assertVerifiedEtfManifest(context: VerifiedEtfManifest): void {
  if (!VERIFIED_CONTEXTS.has(context) || context[CONTEXT] !== true) throw new Error("unverified_manifest_context");
}

export const ETF_DEVNET_GENESIS = ETF_DEVNET_GENESIS_HASH;
export const ETF_CLASSIC_TOKEN_PROGRAM = ETF_DEVNET_TOKEN_PROGRAM;
