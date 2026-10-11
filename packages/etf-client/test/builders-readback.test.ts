import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, type AccountInfo, type Connection } from "@solana/web3.js";
import {
  buildEligibilityPokeInstruction,
  buildCancelResumeProposalInstruction,
  buildCreateEtfTokenAccountInstruction,
  buildInKindRedeemInstruction,
  buildInitializePoolInstruction,
  buildPauseRiskInstruction,
  buildProposeResumeInstruction,
  buildProportionalDepositInstruction,
  buildResumeRiskAfterDelayInstruction,
  buildSeedPoolInstruction,
  buildTraderFundedSwapInstruction,
  decodeEtfAssetStateAccount,
  deriveEtfAddresses,
  derivePythFixedFeedAccount,
  deriveWalletAtaPreparationPlan,
  ETF_CONFIG_DOMAIN,
  ETF_DEVNET_CANDIDATE_FEEDS,
  ETF_DEVNET_GENESIS,
  ETF_DEVNET_RECEIVER_PROGRAM,
  ETF_DEVNET_TOKEN_PROGRAM,
  readEtfSnapshot,
  quoteProportionalDeposit,
  quoteProportionalRedeem,
  verifyEtfManifest,
  submitWalletTransaction,
  WalletSubmissionError,
  type EtfDeploymentManifestV1,
} from "../src/index.js";

const receiver = new PublicKey(ETF_DEVNET_RECEIVER_PROGRAM);
const token = new PublicKey(ETF_DEVNET_TOKEN_PROGRAM);
const pushOracle = new PublicKey("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");
const SOL_FEED = Buffer.from("ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d", "hex");
const USD_FEED = Buffer.from("eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a", "hex");
const poolDiscriminator = Buffer.from("5129cb13d2cb328d", "hex");
const stateDiscriminator = Buffer.from("210c5772838a970a", "hex");
const assetStateDiscriminator = Buffer.from("7c57605413067b6d", "hex");
const priceDiscriminator = Buffer.from([0x22, 0xf1, 0x23, 0x63, 0x9d, 0x7e, 0xf4, 0xcd]);
const idlFixture = JSON.parse(readFileSync(new URL("../../../idl/coloyond_etf.json", import.meta.url), "utf8")) as Record<string, unknown>;
const u32 = (value: number): Buffer => { const b = Buffer.alloc(4); b.writeUInt32LE(value); return b; };
const u64 = (value: bigint): Buffer => { const b = Buffer.alloc(8); b.writeBigUInt64LE(value); return b; };
const fromHex = (s: string): Buffer => Buffer.from(s.replace(/^0x/, ""), "hex");
function vec(bytes: Buffer): Buffer { return Buffer.concat([u32(bytes.length), bytes]); }
function assertIdlBaseAccounts(instruction: { keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] }, idl: Record<string, unknown>, name: string): void {
  const entries = (idl as { instructions: { name: string; accounts: { name: string; writable?: boolean; signer?: boolean; address?: string }[] }[] }).instructions;
  const expected = entries.find((entry) => entry.name === name);
  assert.ok(expected, `IDL instruction ${name} exists`);
  assert.ok(instruction.keys.length >= expected.accounts.length, `${name} has its IDL account prefix`);
  expected.accounts.forEach((meta, index) => {
    const actual = instruction.keys[index]!;
    assert.equal(actual.isSigner, meta.signer ?? false, `${name}.${meta.name} signer`);
    assert.equal(actual.isWritable, meta.writable ?? false, `${name}.${meta.name} writable`);
    if (meta.address !== undefined) assert.equal(actual.pubkey.toBase58(), meta.address, `${name}.${meta.name} address`);
  });
}
function account(owner: PublicKey, data: Buffer, executable = false): AccountInfo<Buffer> {
  return { owner, data, executable, lamports: 1, rentEpoch: 0 };
}
function tokenAccount(mint: PublicKey, authority: PublicKey, amount: bigint, frozen = false): Buffer {
  const b = Buffer.alloc(165); mint.toBuffer().copy(b, 0); authority.toBuffer().copy(b, 32); u64(amount).copy(b, 64); b[108] = frozen ? 2 : 1; return b;
}
function mintAccount(decimals: number, supply: bigint): Buffer {
  const b = Buffer.alloc(82); b.writeUInt32LE(0, 0); u64(supply).copy(b, 36); b[44] = decimals; b[45] = 1; b.writeUInt32LE(0, 46); return b;
}
function priceAccount(feed: Buffer, publishTime: bigint, owner = receiver, verifyTag = 1, confidence = 10n): AccountInfo<Buffer> {
  const b = Buffer.alloc(134); priceDiscriminator.copy(b); b[40] = verifyTag; feed.copy(b, 41); b.writeBigInt64LE(100_000_000n, 73); b.writeBigUInt64LE(confidence, 81); b.writeInt32LE(-8, 89); b.writeBigInt64LE(publishTime, 93); return account(owner, b);
}

type TestDeployment = { manifest: EtfDeploymentManifestV1; idl: Record<string, unknown>; context: ReturnType<typeof verifyEtfManifest>; rpc: Connection; wallet: PublicKey; walletAssetAccounts: { mint: string; tokenAccount: string }[]; shareAccount: PublicKey; programId: PublicKey; pool: PublicKey; addressByKey: Map<string, AccountInfo<Buffer> | null> };

function buildTestDeployment(overrides: { genesisHash?: string; feedOwner?: PublicKey; verifyTag?: number; missingPool?: boolean; missingPoolState?: boolean; missingFeed?: boolean; missingMint?: boolean; badMintDecimals?: boolean; badProgramBinary?: boolean; lifecycle?: "unseeded" | "active" | "closed"; riskPaused?: boolean; oraclePublishTime?: bigint; oracleConfidence?: bigint; sequence?: bigint; schedulerEnabled?: boolean; schedulerGeneration?: bigint; lastObservation?: Readonly<{ observedAt: bigint; slot: bigint; deviationBps: number; eligible: boolean; publishTimes: readonly [bigint, bigint, bigint] }> | null; pendingResume?: Readonly<{ proposer: PublicKey; nonce: bigint; executeAfter: bigint }> | null; blockTime?: number | null; governance?: PublicKey; currentGovernance?: PublicKey; currentGuardian?: PublicKey } = {}): TestDeployment {
  const programId = Keypair.generate().publicKey;
  const governance = overrides.governance ?? Keypair.generate().publicKey;
  const guardian = Keypair.generate().publicKey;
  const wallet = Keypair.generate().publicKey;
  const initializer = Keypair.generate().publicKey;
  const mintA = new PublicKey(ETF_DEVNET_CANDIDATE_FEEDS[0]!.associatedMint!);
  const mintB = new PublicKey(ETF_DEVNET_CANDIDATE_FEEDS[2]!.associatedMint!);
  const feedA = new PublicKey(ETF_DEVNET_CANDIDATE_FEEDS[0]!.address);
  const feedB = new PublicKey(ETF_DEVNET_CANDIDATE_FEEDS[2]!.address);
  const configBytes = Buffer.concat([
    Buffer.from([1]), u32(2),
    mintA.toBuffer(), token.toBuffer(), Buffer.from([9, 0]), receiver.toBuffer(), feedA.toBuffer(), SOL_FEED, Buffer.from([0x88, 0x13]),
    mintB.toBuffer(), token.toBuffer(), Buffer.from([6, 1]), receiver.toBuffer(), feedB.toBuffer(), USD_FEED, Buffer.from([0x88, 0x13]),
    Buffer.from([7, 0]), Buffer.alloc(32, 0x11), vec(Buffer.from([0x31])), Buffer.alloc(32, 0x22), vec(Buffer.from([0x42])),
    governance.toBuffer(), guardian.toBuffer(), u64(86_400n),
  ]);
  const configHash = createHash("sha256").update(ETF_CONFIG_DOMAIN).update(configBytes).digest();
  const addresses = deriveEtfAddresses(programId, configHash);
  const pool = addresses.pool;
  const poolBump = PublicKey.findProgramAddressSync([Buffer.from("etf_pool_v1"), configHash], programId)[1];
  const poolStateBump = PublicKey.findProgramAddressSync([Buffer.from("etf_pool_state_v1"), pool.toBuffer()], programId)[1];
  const labels = [
    { label: "WSOL", backing: "native_wrapped" as const },
    { label: "Test USD · synthetic / unbacked · not redeemable USDC", backing: "synthetic_unbacked" as const },
  ];
  const idl = { ...idlFixture, address: programId.toBase58() };
  const manifest = {
    schema: "coloyond-etf-deployment-v1", status: "accepted", cluster: "devnet", genesisHash: ETF_DEVNET_GENESIS, programId: programId.toBase58(),
    programSourceSha256: "aa".repeat(32), programBinarySha256: createHash("sha256").update(Buffer.from([0xaa, 0xbb])).digest("hex"), idlSha256: createHash("sha256").update(JSON.stringify(idl)).digest("hex"), expectedUpgradeAuthority: null,
    configBytesHex: configBytes.toString("hex"), configHashHex: configHash.toString("hex"),
    addresses: { pool: pool.toBase58(), poolState: addresses.poolState.toBase58(), authority: addresses.authority.toBase58(), shareMint: addresses.shareMint.toBase58() },
    approvals: { s0b: "synthetic test fixture only", s5a: "synthetic test fixture only", s5d2: "synthetic test fixture only" },
    mathPolicy: { status: "accepted", version: 7, valueScaleUsdDecimals: 12, minimumWeightBps: 100 },
    oraclePolicy: { status: "accepted", idHex: "22".repeat(32), paramsHex: "42", pushOracleProgramId: pushOracle.toBase58(), maximumAgeSeconds: 60, maximumConfidenceBps: 100, minimumExponent: -17, maximumExponent: 0 },
    feePolicy: { status: "accepted", idHex: "11".repeat(32), paramsHex: "31", swapFeeBps: 30, maximumInputBps: 3_000, quoteParityBandBps: 200, seedCompositionToleranceBps: 200 },
    assetLabels: labels,
  } as unknown as EtfDeploymentManifestV1;
  const context = verifyEtfManifest(manifest, idl, ETF_DEVNET_GENESIS);
  const map = new Map<string, AccountInfo<Buffer> | null>();
  const programData = Keypair.generate().publicKey;
  const programBytes = Buffer.from([0xaa, 0xbb]);
  const programDataBytes = Buffer.alloc(45 + programBytes.length); programDataBytes.writeUInt32LE(3, 0); programDataBytes[12] = 0; (overrides.badProgramBinary ? Buffer.from([0xaa, 0xbc]) : programBytes).copy(programDataBytes, 45);
  const programBytesData = Buffer.alloc(36); programBytesData.writeUInt32LE(2, 0); programData.toBuffer().copy(programBytesData, 4);
  map.set(programId.toBase58(), account(new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"), programBytesData, true));
  map.set(programData.toBase58(), account(new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"), programDataBytes));

  const poolBytes = Buffer.alloc(1_265); poolDiscriminator.copy(poolBytes); poolBytes[8] = 1; poolBytes[9] = poolBump; configHash.copy(poolBytes, 10); u32(configBytes.length).copy(poolBytes, 42); configBytes.copy(poolBytes, 46); addresses.shareMint.toBuffer().copy(poolBytes, 1_201); initializer.toBuffer().copy(poolBytes, 1_233);
  const stateBytes = Buffer.alloc(300); stateDiscriminator.copy(stateBytes); stateBytes[8] = 1; stateBytes[9] = poolStateBump; pool.toBuffer().copy(stateBytes, 10); (overrides.currentGovernance ?? governance).toBuffer().copy(stateBytes, 42); (overrides.currentGuardian ?? guardian).toBuffer().copy(stateBytes, 74); stateBytes[106] = overrides.lifecycle === "unseeded" ? 0 : overrides.lifecycle === "closed" ? 2 : 1; stateBytes[107] = overrides.riskPaused ? 1 : 0; u64(overrides.sequence ?? 8n).copy(stateBytes, 108);
  let stateOffset = 116;
  if (overrides.lastObservation) {
    stateBytes[stateOffset++] = 1;
    stateBytes.writeBigInt64LE(overrides.lastObservation.observedAt, stateOffset); stateOffset += 8;
    u64(overrides.lastObservation.slot).copy(stateBytes, stateOffset); stateOffset += 8;
    stateBytes.writeUInt16LE(overrides.lastObservation.deviationBps, stateOffset); stateOffset += 2;
    stateBytes[stateOffset++] = overrides.lastObservation.eligible ? 1 : 0;
    for (const publishTime of overrides.lastObservation.publishTimes) { stateBytes.writeBigInt64LE(publishTime, stateOffset); stateOffset += 8; }
  } else stateOffset += 1;
  if (overrides.pendingResume) {
    stateBytes[stateOffset++] = 1;
    overrides.pendingResume.proposer.toBuffer().copy(stateBytes, stateOffset); stateOffset += 32;
    u64(overrides.pendingResume.nonce).copy(stateBytes, stateOffset); stateOffset += 8;
    stateBytes.writeBigInt64LE(overrides.pendingResume.executeAfter, stateOffset); stateOffset += 8;
  } else stateOffset += 1;
  stateOffset += 1; // no pending authority handoff
  stateBytes[stateOffset++] = overrides.schedulerEnabled ? 1 : 0;
  u64(overrides.schedulerGeneration ?? 0n).copy(stateBytes, stateOffset);
  const shareMintBytes = Buffer.alloc(82); shareMintBytes.writeUInt32LE(1, 0); addresses.authority.toBuffer().copy(shareMintBytes, 4); u64(overrides.lifecycle === "unseeded" ? 0n : 1_000_000n).copy(shareMintBytes, 36); shareMintBytes[44] = 6; shareMintBytes[45] = 1; shareMintBytes.writeUInt32LE(0, 46);
  map.set(pool.toBase58(), overrides.missingPool ? null : account(programId, poolBytes));
  map.set(addresses.poolState.toBase58(), overrides.missingPoolState ? null : account(programId, stateBytes));
  map.set(addresses.shareMint.toBase58(), account(token, shareMintBytes));
  const assetMints = [mintA, mintB];
  const feedIds = [SOL_FEED, USD_FEED];
  const feedAccounts = [feedA, feedB];
  const walletAssetAccounts = assetMints.map((mint) => ({ mint: mint.toBase58(), tokenAccount: Keypair.generate().publicKey.toBase58() }));
  const shareAccount = Keypair.generate().publicKey;
  assetMints.forEach((mint, index) => {
    const { custody, assetState } = addresses.assets[index]!;
    map.set(mint.toBase58(), overrides.missingMint && index === 0 ? null : account(token, mintAccount(index === 0 ? 9 : overrides.badMintDecimals && index === 1 ? 9 : 6, index === 0 ? 1_000_000_000n : 9_000_000_000_000n)));
    map.set(custody.toBase58(), account(token, tokenAccount(mint, addresses.authority, 1_000_000n)));
    const assetBump = PublicKey.findProgramAddressSync([Buffer.from("etf_asset_v1"), pool.toBuffer(), Buffer.from([index])], programId)[1];
    const state = Buffer.alloc(59); assetStateDiscriminator.copy(state); state[8] = 1; state[9] = assetBump; pool.toBuffer().copy(state, 10); state[42] = index; u64(BigInt(index + 2)).copy(state, 43);
    map.set(assetState.toBase58(), account(programId, state));
    map.set(feedAccounts[index]!.toBase58(), overrides.missingFeed && index === 0 ? null : priceAccount(feedIds[index]!, overrides.oraclePublishTime ?? 999_950n, overrides.feedOwner ?? receiver, overrides.verifyTag ?? 1, overrides.oracleConfidence ?? 10n));
  });
  for (let index = 0; index < assetMints.length; index += 1) {
    const tokenKey = new PublicKey(walletAssetAccounts[index]!.tokenAccount);
    map.set(tokenKey.toBase58(), account(token, tokenAccount(assetMints[index]!, wallet, 10_000_000n)));
  }
  map.set(shareAccount.toBase58(), account(token, tokenAccount(addresses.shareMint, wallet, overrides.lifecycle === "unseeded" ? 0n : 500_000n)));

  const mocked = {
    rpcEndpoint: "https://api.devnet.solana.com",
    getGenesisHash: async () => overrides.genesisHash ?? ETF_DEVNET_GENESIS,
    getAccountInfo: async (key: PublicKey) => map.get(key.toBase58()) ?? null,
    getMultipleAccountsInfoAndContext: async (keys: PublicKey[]) => ({ context: { slot: 12345 }, value: keys.map((key) => map.get(key.toBase58()) ?? null) }),
    getBlockTime: async () => overrides.blockTime === undefined ? 1_000_000 : overrides.blockTime,
    getTokenAccountsByOwner: async (owner: PublicKey, filter: { mint: PublicKey }) => {
      const keys = owner.equals(wallet)
        ? (filter.mint.equals(addresses.shareMint) ? [shareAccount] : walletAssetAccounts.filter((item) => item.mint === filter.mint.toBase58()).map((item) => new PublicKey(item.tokenAccount)))
        : [];
      return { context: { slot: 12345 }, value: keys.map((pubkey) => ({ pubkey, account: map.get(pubkey.toBase58())! })) };
    },
  } as unknown as Connection;
  return { manifest, idl, context, rpc: mocked, wallet, walletAssetAccounts, shareAccount, programId, pool, addressByKey: map };
}

test("rejects unconfigured, wrong-genesis, draft-IDL, and mismatched-IDL contexts", () => {
  const testDeployment = buildTestDeployment();
  assert.throws(() => verifyEtfManifest({ ...testDeployment.manifest, status: "draft" }, testDeployment.idl, ETF_DEVNET_GENESIS), /not_accepted/);
  assert.throws(() => verifyEtfManifest(testDeployment.manifest, testDeployment.idl, "wrong-genesis"), /genesis_mismatch/);
  assert.throws(() => verifyEtfManifest(testDeployment.manifest, idlFixture, ETF_DEVNET_GENESIS), /draft_localnet_idl_rejected/);
  const wrongIdl = { ...testDeployment.idl, address: Keypair.generate().publicKey.toBase58() };
  assert.throws(() => verifyEtfManifest(testDeployment.manifest, wrongIdl, ETF_DEVNET_GENESIS), /idl_program_id_mismatch/);
  const wrongDiscriminator = structuredClone(testDeployment.idl) as { instructions: { name: string; discriminator: number[] }[] };
  wrongDiscriminator.instructions.find((item) => item.name === "swap_exact_in")!.discriminator[0]! ^= 1;
  assert.throws(() => verifyEtfManifest(testDeployment.manifest, wrongDiscriminator, ETF_DEVNET_GENESIS), /idl_discriminator_mismatch_swap_exact_in/);
  assert.throws(() => verifyEtfManifest({ ...testDeployment.manifest, idlSha256: "ff".repeat(32) }, testDeployment.idl, ETF_DEVNET_GENESIS), /manifest_idl_hash_mismatch/);
});

test("matches Pyth's shard/feed derivation and rejects config feed-mode/address mismatches", () => {
  assert.equal(derivePythFixedFeedAccount(pushOracle, SOL_FEED, 0).toBase58(), "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE");
  const testDeployment = buildTestDeployment();
  const badBytes = Buffer.from(testDeployment.context.configBytes);
  const feedAddressOffset = 1 + 4 + 32 + 32 + 1 + 1 + 32;
  badBytes[feedAddressOffset] ^= 0x01;
  const badHash = createHash("sha256").update(ETF_CONFIG_DOMAIN).update(badBytes).digest();
  const badAddresses = deriveEtfAddresses(testDeployment.programId, badHash);
  const badManifest = { ...testDeployment.manifest, configBytesHex: badBytes.toString("hex"), configHashHex: badHash.toString("hex"), addresses: { pool: badAddresses.pool.toBase58(), poolState: badAddresses.poolState.toBase58(), authority: badAddresses.authority.toBase58(), shareMint: badAddresses.shareMint.toBase58() } };
  assert.throws(() => verifyEtfManifest(badManifest, testDeployment.idl, ETF_DEVNET_GENESIS), /pyth_fixed_feed_pda_mismatch/);
  const wrongMode = Buffer.from(testDeployment.context.configBytes);
  const secondModeOffset = 1 + 4 + 164 + 32 + 32 + 1;
  wrongMode[secondModeOffset] = 0;
  Keypair.generate().publicKey.toBuffer().copy(wrongMode, secondModeOffset + 33);
  const wrongModeHash = createHash("sha256").update(ETF_CONFIG_DOMAIN).update(wrongMode).digest();
  const wrongModeAddresses = deriveEtfAddresses(testDeployment.programId, wrongModeHash);
  const wrongModeManifest = { ...testDeployment.manifest, configBytesHex: wrongMode.toString("hex"), configHashHex: wrongModeHash.toString("hex"), addresses: { pool: wrongModeAddresses.pool.toBase58(), poolState: wrongModeAddresses.poolState.toBase58(), authority: wrongModeAddresses.authority.toBase58(), shareMint: wrongModeAddresses.shareMint.toBase58() } };
  assert.throws(() => verifyEtfManifest(wrongModeManifest, testDeployment.idl, ETF_DEVNET_GENESIS), /asset_1_pyth_fixed_feed_pda_mismatch/);
});

test("reads the exact deployment, pool, shares, custody, fees, and Full oracle state from one Devnet RPC context", async () => {
  const d = buildTestDeployment();
  const snapshot = await readEtfSnapshot(d.rpc, d.context, { walletAddress: d.wallet.toBase58() });
  assert.equal(snapshot.network.genesisHash, ETF_DEVNET_GENESIS);
  assert.equal(snapshot.network.contextSlot, "12345");
  assert.equal(snapshot.deployment.programExecutable, true);
  assert.equal(snapshot.deployment.programBinarySha256, d.manifest.programBinarySha256);
  assert.equal(snapshot.identity.pool, d.pool.toBase58());
  assert.equal(snapshot.shares.supply, "1000000");
  assert.equal(snapshot.assets[0]!.custodyAmount, "1000000");
  assert.equal(snapshot.assets[0]!.mintOwner, token.toBase58());
  assert.equal(snapshot.assets[0]!.mintDataLength, 82);
  assert.equal(snapshot.assets[1]!.mintSupply, "9000000000000");
  assert.equal(snapshot.assets[1]!.cumulativeFeeBaseUnits, "3");
  assert.equal(snapshot.assets[0]!.oracle.verification, "full");
  assert.equal(snapshot.assets[0]!.oracle.freshness, "within_approved_limits");
  assert.equal(snapshot.state.schedulerEnabled, false);
  assert.equal(snapshot.state.schedulerGeneration, "0");
  assert.equal(snapshot.state.lastObservation, null);
  assert.match(snapshot.assets[1]!.label, /synthetic \/ unbacked/);
  const wrongOwner = buildTestDeployment({ feedOwner: SystemProgram.programId });
  const wrong = await readEtfSnapshot(wrongOwner.rpc, wrongOwner.context, { walletAddress: wrongOwner.wallet.toBase58() });
  assert.equal(wrong.assets[0]!.oracle.reason, "wrong_receiver_owner");
  assert.throws(() => buildEligibilityPokeInstruction(wrongOwner.context, wrong, wrongOwner.wallet), /oracle_not_within_approved_limits/);
  const partial = buildTestDeployment({ verifyTag: 0 });
  const partialRead = await readEtfSnapshot(partial.rpc, partial.context, { walletAddress: partial.wallet.toBase58() });
  assert.equal(partialRead.assets[0]!.oracle.verification, "partial");
  const stale = buildTestDeployment({ oraclePublishTime: 999_939n });
  const staleRead = await readEtfSnapshot(stale.rpc, stale.context, { walletAddress: stale.wallet.toBase58() });
  assert.equal(staleRead.assets[0]!.oracle.freshness, "stale");
  const lowConfidence = buildTestDeployment({ oracleConfidence: 1_010_000n });
  const lowConfidenceRead = await readEtfSnapshot(lowConfidence.rpc, lowConfidence.context, { walletAddress: lowConfidence.wallet.toBase58() });
  assert.equal(lowConfidenceRead.assets[0]!.oracle.freshness, "confidence_over_limit");
  const badFeedIdentity = buildTestDeployment();
  const badFeedAccount = badFeedIdentity.addressByKey.get(badFeedIdentity.context.config.assets[0]!.oracleAccount.toBase58())!;
  badFeedAccount!.data[41] ^= 0x01;
  const badFeedRead = await readEtfSnapshot(badFeedIdentity.rpc, badFeedIdentity.context, { walletAddress: badFeedIdentity.wallet.toBase58() });
  assert.equal(badFeedRead.assets[0]!.oracle.reason, "embedded_feed_id_mismatch");
  const absent = buildTestDeployment({ missingPool: true });
  await assert.rejects(() => readEtfSnapshot(absent.rpc, absent.context), /required_pool_account_missing/);
  const missingState = buildTestDeployment({ missingPoolState: true });
  await assert.rejects(() => readEtfSnapshot(missingState.rpc, missingState.context), /required_pool_account_missing/);
  const missingMint = buildTestDeployment({ missingMint: true });
  await assert.rejects(() => readEtfSnapshot(missingMint.rpc, missingMint.context), /asset_0_mint_missing/);
  const badMintDecimals = buildTestDeployment({ badMintDecimals: true });
  await assert.rejects(() => readEtfSnapshot(badMintDecimals.rpc, badMintDecimals.context), /asset_1_mint_decimals_mismatch/);
  const missingFeed = buildTestDeployment({ missingFeed: true });
  const missingFeedSnapshot = await readEtfSnapshot(missingFeed.rpc, missingFeed.context, { walletAddress: missingFeed.wallet.toBase58() });
  assert.equal(missingFeedSnapshot.assets[0]!.oracle.freshness, "unavailable");
  assert.throws(() => buildEligibilityPokeInstruction(missingFeed.context, missingFeedSnapshot, missingFeed.wallet), /oracle_not_within_approved_limits/);
  const badProgramBinary = buildTestDeployment({ badProgramBinary: true });
  await assert.rejects(() => readEtfSnapshot(badProgramBinary.rpc, badProgramBinary.context), /deployed_program_binary_hash_mismatch/);
  const wrongGenesis = buildTestDeployment({ genesisHash: "not-devnet" });
  await assert.rejects(() => readEtfSnapshot(wrongGenesis.rpc, wrongGenesis.context), /genesis_mismatch/);
});

test("reads scheduler generation and eligibility only from verified pool state", async () => {
  const observation = {
    observedAt: 999_900n,
    slot: 12_345n,
    deviationBps: 725,
    eligible: true,
    publishTimes: [999_895n, 999_896n, 0n] as const,
  };
  const enabled = buildTestDeployment({ schedulerEnabled: true, schedulerGeneration: 4n, lastObservation: observation });
  const snapshot = await readEtfSnapshot(enabled.rpc, enabled.context);
  assert.equal(snapshot.state.schedulerEnabled, true);
  assert.equal(snapshot.state.schedulerGeneration, "4");
  assert.deepEqual(snapshot.state.lastObservation, {
    observedAt: "999900",
    slot: "12345",
    deviationBps: 725,
    eligible: true,
    publishTimes: ["999895", "999896", "0"],
  });

  const malformed = buildTestDeployment();
  const stateAddress = malformed.context.addresses.poolState.toBase58();
  malformed.addressByKey.get(stateAddress)!.data[119] = 2;
  await assert.rejects(() => readEtfSnapshot(malformed.rpc, malformed.context), /scheduler_enabled_invalid/);
});

test("encodes all S5E instruction discriminators, argument vectors, and account groups from the generated IDL", async () => {
  const d = buildTestDeployment();
  const active = await readEtfSnapshot(d.rpc, d.context, { walletAddress: d.wallet.toBase58() });
  const initialize = buildInitializePoolInstruction(d.context, d.wallet);
  assert.equal(initialize.instruction.data.subarray(0, 8).toString("hex"), "5fb40aac54aee828");
  assert.deepEqual(initialize.instruction.data.subarray(8, 40), d.context.configHash);
  assert.deepEqual(initialize.instruction.data.subarray(40), Buffer.concat([u32(d.context.configBytes.length), d.context.configBytes]));
  assert.deepEqual(initialize.instruction.keys.slice(0, 7).map((key) => key.pubkey.toBase58()), [d.wallet, d.context.addresses.pool, d.context.addresses.poolState, d.context.addresses.shareMint, d.context.addresses.authority, token, SystemProgram.programId].map((key) => key.toBase58()));
  assert.equal(initialize.instruction.keys.length, 13);
  const shareAta = buildCreateEtfTokenAccountInstruction(d.context, d.wallet, d.wallet, d.context.addresses.shareMint);
  assert.equal(shareAta.data.toString("hex"), "01");
  assert.equal(shareAta.keys.length, 6);
  assert.equal(shareAta.programId.toBase58(), "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
  assert.throws(() => buildCreateEtfTokenAccountInstruction(d.context, d.wallet, d.wallet, Keypair.generate().publicKey), /mint_not_in_manifest/);
  const ataPayer = Keypair.generate();
  const ataPlan = deriveWalletAtaPreparationPlan(d.context, ataPayer.publicKey, [d.context.config.assets[0]!.mint, d.context.addresses.shareMint]);
  assert.equal(ataPlan.length, 2);
  assert.equal(ataPlan[0]!.decimals, d.context.config.assets[0]!.decimals);
  assert.equal(ataPlan[1]!.decimals, 6);
  assert.throws(() => deriveWalletAtaPreparationPlan(d.context, ataPayer.publicKey, [Keypair.generate().publicKey]), /wallet_submit_no_token_action_invalid/);
  const assetAta = buildCreateEtfTokenAccountInstruction(d.context, ataPayer.publicKey, ataPayer.publicKey, d.context.config.assets[0]!.mint);
  const shareAtaForPayer = buildCreateEtfTokenAccountInstruction(d.context, ataPayer.publicKey, ataPayer.publicKey, d.context.addresses.shareMint);
  const invalidAta = new TransactionInstruction({ programId: assetAta.programId, keys: assetAta.keys, data: Buffer.from([0]) });
  const invalidAtaTransaction = new Transaction({ feePayer: ataPayer.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58() }).add(invalidAta, shareAtaForPayer);
  let ataSignCalls = 0;
  await assert.rejects(() => submitWalletTransaction({
    connection: {} as Connection,
    signer: { publicKey: ataPayer.publicKey, async signTransaction(transaction) { ataSignCalls += 1; return transaction; } },
    transaction: invalidAtaTransaction,
    journal: { async read() { return null; }, async appendIfLatest() { return true; }, async replaceLatest() { return true; } },
    operationId: "ata-reject-invalid-create-mode",
    trackedTokenAccounts: [],
    noTokenBalanceAction: "prepare_accounts",
    noTokenProgramId: new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
    ataPreparationPlan: ataPlan,
  }), (error: unknown) => error instanceof WalletSubmissionError && error.code === "wallet_submit_no_token_action_invalid");
  assert.equal(ataSignCalls, 0, "invalid ATA instruction is rejected before requesting a wallet signature");

  const seedDeployment = buildTestDeployment({ lifecycle: "unseeded", riskPaused: false });
  const seedSnapshot = await readEtfSnapshot(seedDeployment.rpc, seedDeployment.context, { walletAddress: seedDeployment.wallet.toBase58() });
  const seed = buildSeedPoolInstruction(seedDeployment.context, seedSnapshot, seedDeployment.wallet, [100n, 200n], 1n, seedDeployment.shareAccount, seedDeployment.walletAssetAccounts);
  assert.equal(seed.instruction.data.subarray(0, 8).toString("hex"), "6fd6942e6c02d912");
  assert.deepEqual(seed.instruction.data.subarray(8), Buffer.concat([u32(2), u64(100n), u64(200n), u64(1n)]));
  assert.equal(seed.instruction.keys[8]!.pubkey.toBase58(), seedDeployment.context.programId.toBase58(), "None optional feed uses IDL program-ID sentinel");
  assert.equal(seed.instruction.keys.length, 18);

  const deposit = buildProportionalDepositInstruction(d.context, active, d.wallet, [30n, 60n], 5n, d.shareAccount, d.walletAssetAccounts);
  assert.equal(deposit.instruction.data.subarray(0, 8).toString("hex"), "3f39802ea4ee8f85");
  assert.deepEqual(deposit.instruction.data.subarray(8), Buffer.concat([u32(2), u64(30n), u64(60n), u64(5n)]));
  assert.equal(deposit.instruction.keys.length, 15);

  const pausedDeployment = buildTestDeployment({ riskPaused: true });
  const paused = await readEtfSnapshot(pausedDeployment.rpc, pausedDeployment.context, { walletAddress: pausedDeployment.wallet.toBase58() });
  const redeem = buildInKindRedeemInstruction(pausedDeployment.context, paused, pausedDeployment.wallet, 100n, [40n, 50n], pausedDeployment.shareAccount, pausedDeployment.walletAssetAccounts);
  assert.equal(redeem.instruction.data.subarray(0, 8).toString("hex"), "663abdfcc0db8c59");
  assert.deepEqual(redeem.instruction.data.subarray(8), Buffer.concat([u64(100n), u32(2), u64(40n), u64(50n)]));

  const swap = buildTraderFundedSwapInstruction(d.context, active, d.wallet, 0, 1, 100n, 90n, d.walletAssetAccounts);
  assert.equal(swap.instruction.data.subarray(0, 8).toString("hex"), "68688356a1bdb4d8");
  assert.deepEqual(swap.instruction.data.subarray(8), Buffer.concat([Buffer.from([0, 1]), u64(100n), u64(90n)]));
  assert.equal(swap.instruction.keys[0]!.pubkey.toBase58(), d.wallet.toBase58(), "separate trader is the signer and swap input provider");

  const guardianSnapshot = await readEtfSnapshot(d.rpc, d.context, { walletAddress: d.context.config.initialEmergencyGuardian.toBase58() });
  const pause = buildPauseRiskInstruction(d.context, guardianSnapshot, d.context.config.initialEmergencyGuardian);
  assert.equal(pause.instruction.data.subarray(0, 8).toString("hex"), "dd022264d9b22a0f");
  const poke = buildEligibilityPokeInstruction(d.context, active, d.wallet);
  assert.equal(poke.instruction.data.subarray(0, 8).toString("hex"), "2e18106bd4091105");
  assert.equal(poke.instruction.keys.length, 6);
  assert.equal(poke.instruction.keys.some((key) => key.pubkey.equals(token)), false, "poke receives no token program/counterparty/custody account");
  const forgedSnapshot = { ...active, state: { ...active.state, riskPaused: false } } as typeof active;
  assert.throws(() => buildEligibilityPokeInstruction(d.context, forgedSnapshot, d.wallet), /rpc_snapshot_context_mismatch/);
  const forgedContext = { ...d.context } as typeof d.context;
  assert.throws(() => buildInitializePoolInstruction(forgedContext, d.wallet), /unverified_manifest_context/);

  const idl = d.idl as { instructions: { name: string; discriminator: number[] }[] };
  for (const built of [initialize, seed, deposit, redeem, swap, pause, poke]) {
    const idlName = built.action === "initialize" ? "initialize_pool" : built.action === "seed" ? "seed_pool" : built.action === "deposit" ? "deposit_proportional" : built.action === "redeem" ? "redeem_in_kind" : built.action === "swap" ? "swap_exact_in" : built.action === "pause" ? "pause_risk" : "poke";
    const expected = idl.instructions.find((entry) => entry.name === idlName);
    assert.ok(expected);
    assert.deepEqual([...built.instruction.data.subarray(0, 8)], expected.discriminator);
    assertIdlBaseAccounts(built.instruction, d.idl, idlName);
  }
});

test("builds the delayed governance resume lifecycle with exact IDL encoding and fail-closed RPC preconditions", async () => {
  const d = buildTestDeployment({ lifecycle: "unseeded", riskPaused: true });
  const governance = d.context.config.initialGovernanceAuthority;
  const proposalSnapshot = await readEtfSnapshot(d.rpc, d.context);
  const expectedProposalSequence = BigInt(proposalSnapshot.state.sequence);
  const propose = buildProposeResumeInstruction(d.context, proposalSnapshot, governance, expectedProposalSequence);

  const proposalNonce = 12n;
  const executeAfter = 1_000_100n;
  const pending = buildTestDeployment({
    lifecycle: "unseeded", riskPaused: true, sequence: 15n, governance,
    pendingResume: { proposer: governance, nonce: proposalNonce, executeAfter },
    blockTime: Number(executeAfter),
  });
  const pendingSnapshot = await readEtfSnapshot(pending.rpc, pending.context);
  const expectedPendingSequence = BigInt(pendingSnapshot.state.sequence);
  const unrelatedExecutor = Keypair.generate().publicKey;
  const execute = buildResumeRiskAfterDelayInstruction(pending.context, pendingSnapshot, unrelatedExecutor, proposalNonce, expectedPendingSequence);
  const cancelDeployment = buildTestDeployment({
    lifecycle: "unseeded", riskPaused: true, sequence: 15n, governance,
    pendingResume: { proposer: governance, nonce: proposalNonce, executeAfter },
    blockTime: Number(executeAfter - 1n),
  });
  const cancelSnapshot = await readEtfSnapshot(cancelDeployment.rpc, cancelDeployment.context);
  const cancel = buildCancelResumeProposalInstruction(cancelDeployment.context, cancelSnapshot, cancelDeployment.context.config.initialGovernanceAuthority, proposalNonce, BigInt(cancelSnapshot.state.sequence));

  function assertExactEncoding(built: ReturnType<typeof buildProposeResumeInstruction>, idlName: string, expectedKeys: PublicKey[], encodedArgs: Buffer): void {
    const idl = d.idl as { instructions: { name: string; discriminator: number[]; accounts: { signer?: boolean; writable?: boolean }[] }[] };
    const definition = idl.instructions.find((item) => item.name === idlName);
    assert.ok(definition);
    assert.equal(built.instruction.keys.length, definition.accounts.length, `${idlName} has no unmodeled accounts`);
    assert.deepEqual(built.instruction.keys.map((item) => item.pubkey.toBase58()), expectedKeys.map((key) => key.toBase58()));
    definition.accounts.forEach((item, index) => {
      assert.equal(built.instruction.keys[index]!.isSigner, item.signer ?? false, `${idlName} signer ${index}`);
      assert.equal(built.instruction.keys[index]!.isWritable, item.writable ?? false, `${idlName} writable ${index}`);
    });
    assert.deepEqual(built.instruction.data, Buffer.concat([Buffer.from(definition.discriminator), encodedArgs]));
  }

  assert.equal(propose.action, "resume_propose");
  assert.equal(propose.riskIncreasing, false);
  assertExactEncoding(propose, "propose_resume", [governance, d.context.addresses.pool, d.context.addresses.poolState], Buffer.alloc(0));
  assert.equal(execute.action, "resume_execute");
  assert.equal(execute.riskIncreasing, true);
  assertExactEncoding(execute, "resume_risk_after_delay", [unrelatedExecutor, pending.context.addresses.pool, pending.context.addresses.poolState], u64(proposalNonce));
  assert.equal(cancel.action, "resume_cancel");
  assert.equal(cancel.riskIncreasing, false);
  assertExactEncoding(cancel, "cancel_resume_proposal", [cancelDeployment.context.config.initialGovernanceAuthority, cancelDeployment.context.addresses.pool, cancelDeployment.context.addresses.poolState], u64(proposalNonce));

  assert.throws(() => buildProposeResumeInstruction(d.context, proposalSnapshot, d.context.config.initialEmergencyGuardian, expectedProposalSequence), /not_authorized/);
  assert.throws(() => buildCancelResumeProposalInstruction(cancelDeployment.context, cancelSnapshot, cancelDeployment.context.config.initialEmergencyGuardian, proposalNonce, expectedPendingSequence), /not_authorized/);
  assert.throws(() => buildProposeResumeInstruction(d.context, proposalSnapshot, governance, expectedProposalSequence + 1n), /sequence_stale/);
  assert.throws(() => buildResumeRiskAfterDelayInstruction(pending.context, pendingSnapshot, unrelatedExecutor, proposalNonce, expectedPendingSequence + 1n), /sequence_stale/);
  assert.throws(() => buildCancelResumeProposalInstruction(cancelDeployment.context, cancelSnapshot, governance, proposalNonce, expectedPendingSequence + 1n), /sequence_stale/);
  assert.throws(() => buildResumeRiskAfterDelayInstruction(pending.context, pendingSnapshot, unrelatedExecutor, proposalNonce + 1n, expectedPendingSequence), /nonce_stale/);
  assert.throws(() => buildCancelResumeProposalInstruction(cancelDeployment.context, cancelSnapshot, governance, proposalNonce + 1n, expectedPendingSequence), /nonce_stale/);

  const successorGovernance = Keypair.generate().publicKey;
  const successorGuardian = Keypair.generate().publicKey;
  const handedOff = buildTestDeployment({ lifecycle: "unseeded", riskPaused: true, currentGovernance: successorGovernance, currentGuardian: successorGuardian });
  const handedOffSnapshot = await readEtfSnapshot(handedOff.rpc, handedOff.context, { walletAddress: successorGuardian.toBase58() });
  assert.equal(handedOffSnapshot.identity.currentGovernance, successorGovernance.toBase58());
  assert.equal(handedOffSnapshot.identity.currentGuardian, successorGuardian.toBase58());
  assert.equal(buildProposeResumeInstruction(handedOff.context, handedOffSnapshot, successorGovernance, BigInt(handedOffSnapshot.state.sequence)).action, "resume_propose");
  assert.throws(() => buildProposeResumeInstruction(handedOff.context, handedOffSnapshot, governance, BigInt(handedOffSnapshot.state.sequence)), /not_authorized/);
  assert.equal(buildPauseRiskInstruction(handedOff.context, handedOffSnapshot, successorGuardian).action, "pause");

  const priorAuthorityPending = buildTestDeployment({
    lifecycle: "unseeded", riskPaused: true, sequence: 15n, currentGovernance: successorGovernance,
    pendingResume: { proposer: governance, nonce: proposalNonce, executeAfter }, blockTime: Number(executeAfter),
  });
  const priorAuthoritySnapshot = await readEtfSnapshot(priorAuthorityPending.rpc, priorAuthorityPending.context);
  assert.equal(buildCancelResumeProposalInstruction(priorAuthorityPending.context, priorAuthoritySnapshot, successorGovernance, proposalNonce, 15n).action, "resume_cancel");
  assert.throws(() => buildResumeRiskAfterDelayInstruction(priorAuthorityPending.context, priorAuthoritySnapshot, unrelatedExecutor, proposalNonce, 15n), /governance_mismatch/);

  const early = buildTestDeployment({ lifecycle: "unseeded", riskPaused: true, sequence: 15n, governance, pendingResume: { proposer: governance, nonce: proposalNonce, executeAfter }, blockTime: Number(executeAfter - 1n) });
  const earlySnapshot = await readEtfSnapshot(early.rpc, early.context);
  assert.throws(() => buildResumeRiskAfterDelayInstruction(early.context, earlySnapshot, unrelatedExecutor, proposalNonce, 15n), /delay_not_elapsed/);
  const noBlockTime = buildTestDeployment({ lifecycle: "unseeded", riskPaused: true, sequence: 15n, governance, pendingResume: { proposer: governance, nonce: proposalNonce, executeAfter }, blockTime: null });
  const noBlockTimeSnapshot = await readEtfSnapshot(noBlockTime.rpc, noBlockTime.context);
  assert.throws(() => buildResumeRiskAfterDelayInstruction(noBlockTime.context, noBlockTimeSnapshot, unrelatedExecutor, proposalNonce, 15n), /block_time_unavailable/);

  const replay = buildTestDeployment({ lifecycle: "active", riskPaused: false, sequence: 16n });
  const replaySnapshot = await readEtfSnapshot(replay.rpc, replay.context);
  assert.throws(() => buildResumeRiskAfterDelayInstruction(replay.context, replaySnapshot, unrelatedExecutor, proposalNonce, 16n), /proposal_not_pending/);
  assert.throws(() => buildCancelResumeProposalInstruction(replay.context, replaySnapshot, replay.context.config.initialGovernanceAuthority, proposalNonce, 16n), /proposal_not_pending/);
  assert.throws(() => buildProposeResumeInstruction(replay.context, replaySnapshot, replay.context.config.initialGovernanceAuthority, 16n), /pool_not_paused/);
  assert.throws(() => buildProposeResumeInstruction(d.context, replaySnapshot, governance, BigInt(replaySnapshot.state.sequence)), /rpc_snapshot_context_mismatch/);

  const wrongFlags = structuredClone(d.idl) as { instructions: { name: string; accounts: { signer?: boolean }[] }[] };
  wrongFlags.instructions.find((item) => item.name === "propose_resume")!.accounts[0]!.signer = false;
  assert.throws(() => verifyEtfManifest(d.manifest, wrongFlags, ETF_DEVNET_GENESIS), /idl_account_flags_mismatch_propose_resume/);
  const wrongArgType = structuredClone(d.idl) as { instructions: { name: string; args: { type: unknown }[] }[] };
  wrongArgType.instructions.find((item) => item.name === "resume_risk_after_delay")!.args[0]!.type = "u8";
  assert.throws(() => verifyEtfManifest(d.manifest, wrongArgType, ETF_DEVNET_GENESIS), /idl_argument_type_mismatch_resume_risk_after_delay/);
  const wrongDiscriminator = structuredClone(d.idl) as { instructions: { name: string; discriminator: number[] }[] };
  wrongDiscriminator.instructions.find((item) => item.name === "cancel_resume_proposal")!.discriminator[0]! ^= 1;
  assert.throws(() => verifyEtfManifest(d.manifest, wrongDiscriminator, ETF_DEVNET_GENESIS), /idl_discriminator_mismatch_cancel_resume_proposal/);
});

test("rejects wrong account vectors, paused risk actions, bad account identities, and input above the accepted cap", async () => {
  const d = buildTestDeployment();
  const active = await readEtfSnapshot(d.rpc, d.context, { walletAddress: d.wallet.toBase58() });
  assert.throws(() => buildProportionalDepositInstruction(d.context, active, d.wallet, [1n], 1n, d.shareAccount, d.walletAssetAccounts), /UnsupportedAssetCount/);
  const seedDeployment = buildTestDeployment({ lifecycle: "unseeded", riskPaused: false });
  const seedSnapshot = await readEtfSnapshot(seedDeployment.rpc, seedDeployment.context, { walletAddress: seedDeployment.wallet.toBase58() });
  assert.throws(() => buildSeedPoolInstruction(seedDeployment.context, seedSnapshot, seedDeployment.wallet, [1n, 1n], 1n, seedDeployment.shareAccount, seedDeployment.walletAssetAccounts.map((x) => ({ ...x, mint: seedDeployment.context.config.assets[1]!.mint.toBase58() }))), /mint_order_mismatch/);
  const pausedDeployment = buildTestDeployment({ riskPaused: true });
  const paused = await readEtfSnapshot(pausedDeployment.rpc, pausedDeployment.context, { walletAddress: pausedDeployment.wallet.toBase58() });
  assert.throws(() => buildTraderFundedSwapInstruction(pausedDeployment.context, paused, pausedDeployment.wallet, 0, 1, 100n, 1n, pausedDeployment.walletAssetAccounts), /pool_not_swap_ready/);
  assert.throws(() => buildTraderFundedSwapInstruction(d.context, active, d.wallet, 0, 1, 500_000n, 1n, d.walletAssetAccounts), /size_cap/);
  assert.throws(() => buildInKindRedeemInstruction(d.context, active, d.wallet, 500_001n, [0n, 0n], d.shareAccount, d.walletAssetAccounts), /share_balance/);
  const frozenAccount = d.addressByKey.get(d.walletAssetAccounts[0]!.tokenAccount)!;
  assert.ok(frozenAccount);
  d.addressByKey.set(d.walletAssetAccounts[0]!.tokenAccount, account(token, tokenAccount(d.context.config.assets[0]!.mint, d.wallet, 10n, true)));
  const frozen = await readEtfSnapshot(d.rpc, d.context, { walletAddress: d.wallet.toBase58() });
  assert.throws(() => buildProportionalDepositInstruction(d.context, frozen, d.wallet, [1n, 1n], 1n, d.shareAccount, d.walletAssetAccounts), /verified_readback/);
  assert.throws(() => decodeEtfAssetStateAccount(frozenAccount, d.programId, d.pool, 0), /asset_state/);
});

test("matches the checked-in S5B full-width proportional share corpus exactly", () => {
  const csv = readFileSync(new URL("../../../crates/etf-math/tests/shares_full_width_vectors.csv", import.meta.url), "utf8");
  const rows = csv.trim().split(/\r?\n/).slice(1);
  let transitions = 0;
  let errors = 0;
  for (const line of rows) {
    const fields = line.split(",");
    assert.equal(fields.length, 22, `malformed vector ${fields[0]}`);
    const count = Number(fields[1]);
    const supply = BigInt(fields[3]!);
    const reserves = [BigInt(fields[4]!), BigInt(fields[5]!), BigInt(fields[6]!)].slice(0, count);
    const inputs = [BigInt(fields[7]!), BigInt(fields[8]!), BigInt(fields[9]!)].slice(0, count);
    if (fields[10] === "error") {
      assert.throws(() => quoteProportionalDeposit(inputs, reserves, supply), new RegExp(fields[21]!));
      errors += 1;
      continue;
    }
    const deposit = quoteProportionalDeposit(inputs, reserves, supply);
    assert.equal(deposit.sharesOut, BigInt(fields[11]!), fields[0]);
    for (let index = 0; index < count; index += 1) {
      assert.equal(deposit.consumed[index], BigInt(fields[12 + index]!), `${fields[0]} consumed ${index}`);
      assert.equal(deposit.refund[index], BigInt(fields[15 + index]!), `${fields[0]} refund ${index}`);
    }
    const postReserves = reserves.map((reserve, index) => reserve + deposit.consumed[index]!);
    const redeem = quoteProportionalRedeem(deposit.sharesOut, supply + deposit.sharesOut, postReserves);
    for (let index = 0; index < count; index += 1) assert.equal(redeem.amountsOut[index], BigInt(fields[18 + index]!), `${fields[0]} redeem ${index}`);
    transitions += 1;
  }
  assert.equal(transitions, 130);
  assert.equal(errors, 6);
});
