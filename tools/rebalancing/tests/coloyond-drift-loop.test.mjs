import assert from "node:assert/strict";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";
import {
  DEVNET_GENESIS_HASH,
  DEVNET_USDC_MINT,
  PYTH_DISCRIMINATOR,
  PYTH_RECEIVER_ID,
  TOKEN_PROGRAM_ID,
  UPGRADEABLE_LOADER_ID,
  VAULT_DISCRIMINATOR,
  VAULT_ACCOUNT_SIZE,
  WSOL_MINT,
  calculateObservedDrift,
  decodePythFullPrice,
  deriveCanonicalVault,
  deriveProgramDataAddress,
  feedForMint,
  feedsForAssets,
  parseVault,
  requireAccount,
  validateCustodyAccount,
  validateGenesis,
  validateRuntimeConfig,
  verifyUpgradeableProgram,
} from "../coloyond-drift-loop.mjs";

const key = (value) => new PublicKey(value).toBuffer();
const feedNow = 1_800_000_000n;

function putKey(data, offset, address) { data.set(key(address), offset); }

function makeVault({ reverse = false } = {}) {
  const data = new Uint8Array(VAULT_ACCOUNT_SIZE);
  data.set(VAULT_DISCRIMINATOR, 0);
  const view = new DataView(data.buffer);
  let offset = 8;
  view.setUint8(offset++, 1); // version
  view.setUint8(offset++, 255); // bump
  view.setUint8(offset++, 2); // paused
  putKey(data, offset, deriveCanonicalVault()); offset += 32;
  view.setBigUint64(offset, 9_007_199_254_740_993n, true); offset += 8;
  const assets = reverse
    ? [
        { mint: DEVNET_USDC_MINT, decimals: 6, targetBps: 6_000, custody: "Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX" },
        { mint: WSOL_MINT, decimals: 9, targetBps: 4_000, custody: "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE" },
      ]
    : [
        { mint: WSOL_MINT, decimals: 9, targetBps: 6_000, custody: "Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX" },
        { mint: DEVNET_USDC_MINT, decimals: 6, targetBps: 4_000, custody: "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE" },
      ];
  for (const asset of assets) {
    putKey(data, offset, asset.mint); offset += 32;
    putKey(data, offset, TOKEN_PROGRAM_ID); offset += 32;
    putKey(data, offset, asset.custody); offset += 32;
    view.setUint8(offset++, asset.decimals);
    view.setUint16(offset, asset.targetBps, true); offset += 2;
  }
  putKey(data, offset, "11111111111111111111111111111111"); offset += 32;
  view.setBigUint64(offset, 9_007_199_254_740_993n, true); offset += 8;
  view.setBigUint64(offset, 1n, true); offset += 8;
  view.setBigUint64(offset, 1_000_000n, true); offset += 8;
  view.setBigUint64(offset, 2_000_000n, true); offset += 8;
  view.setBigUint64(offset, 1n, true); offset += 8;
  view.setBigUint64(offset, 2n, true); offset += 8;
  view.setBigUint64(offset, 0n, true); offset += 8;
  view.setBigUint64(offset, 0n, true); offset += 8;
  view.setBigUint64(offset, 17n, true); offset += 8;
  assert.equal(offset, VAULT_ACCOUNT_SIZE);
  return data;
}

function makePyth(feed, { price = 100_000_000n, confidence = 10_000n, exponent = -8, publishTime = feedNow - 10n, verification = 1, feedId = feed.id } = {}) {
  // Pyth SDK 1.2.0: Full is a one-byte enum tag at 40, message starts at 41,
  // and the fixed PriceUpdateV2::LEN account allocation is 134 bytes.
  const data = new Uint8Array(134);
  data.set(PYTH_DISCRIMINATOR, 0);
  data.set(Buffer.from(feedId.slice(2), "hex"), 41);
  data[40] = verification;
  const view = new DataView(data.buffer);
  view.setBigInt64(73, price, true);
  view.setBigUint64(81, confidence, true);
  view.setInt32(89, exponent, true);
  view.setBigInt64(93, publishTime, true);
  return data;
}

function parseFeed(feed, options = {}) {
  return decodePythFullPrice({
    data: makePyth(feed, options),
    accountOwner: PYTH_RECEIVER_ID,
    accountAddress: feed.address,
    expectedFeed: feed,
    nowUnix: feedNow,
    maxAgeSeconds: 60n,
    maxConfidenceBps: 25n,
    maxUsdcDeviationBps: 100n,
  });
}

test("Vault decoder reads the exact 353-byte account layout and preserves u64 values", () => {
  const vault = parseVault(makeVault());
  assert.equal(vault.status, "paused");
  assert.equal(vault.configurationRevision, 9_007_199_254_740_993n);
  assert.equal(vault.assets[0].mint, WSOL_MINT);
  assert.equal(vault.assets[1].mint, DEVNET_USDC_MINT);
  assert.deepEqual(vault.accountedAmounts, [1_000_000n, 2_000_000n]);
  assert.equal(vault.sequence, 17n);
  assert.throws(() => parseVault(makeVault().subarray(0, 352)), /exactly 353 bytes/);
});

test("upgradeable program verification checks the expected executable and canonical ProgramData", () => {
  const programId = "FN7uGX34qyijmVX69gqEkMugWjE5Sjso8Pe7gWU6B2N6";
  const programDataAddress = PublicKey.findProgramAddressSync(
    [key(programId)], new PublicKey(UPGRADEABLE_LOADER_ID),
  )[0].toBase58();
  assert.equal(deriveProgramDataAddress(programId), "GwaYMa1ep89ZAz4StTkkby2MbduH3udkFUBsN9UrTfnq");
  const programBytes = new Uint8Array(36);
  new DataView(programBytes.buffer).setUint32(0, 2, true);
  putKey(programBytes, 4, programDataAddress);
  const programDataBytes = new Uint8Array(13);
  new DataView(programDataBytes.buffer).setUint32(0, 3, true);
  const input = {
    programId,
    program: { owner: UPGRADEABLE_LOADER_ID, executable: true, data: programBytes },
    programData: { owner: UPGRADEABLE_LOADER_ID, executable: false, data: programDataBytes },
    programDataAddress,
  };
  assert.deepEqual(verifyUpgradeableProgram(input), { programId, programDataAddress, upgradeAuthority: null });
  assert.throws(() => verifyUpgradeableProgram({ ...input, expectedProgramId: "11111111111111111111111111111111" }), /expected program ID/);
  assert.throws(() => verifyUpgradeableProgram({ ...input, program: { ...input.program, owner: "11111111111111111111111111111111" } }), /owner or is not executable/);
  assert.throws(() => verifyUpgradeableProgram({ ...input, programData: { ...input.programData, owner: "11111111111111111111111111111111" } }), /ProgramData account has the wrong owner/);
});

test("runtime config requires one RPC and exact pinned Devnet genesis plus explicit bounds", () => {
  const env = {
    RPC_URL: "https://rpc.example.invalid",
    EXPECTED_GENESIS_HASH: DEVNET_GENESIS_HASH,
    MAX_FEED_AGE_SECONDS: "60",
    MAX_CONFIDENCE_BPS: "25",
    MAX_USDC_DEVIATION_BPS: "100",
  };
  assert.equal(validateRuntimeConfig(env).rpcUrl, env.RPC_URL);
  assert.throws(() => validateRuntimeConfig({ ...env, EXPECTED_GENESIS_HASH: "wrong" }), /pinned Devnet genesis/);
  assert.throws(() => validateRuntimeConfig({ ...env, RPC_URL: undefined }), /RPC_URL is required/);
  assert.throws(() => validateRuntimeConfig({ ...env, MAX_FEED_AGE_SECONDS: undefined }), /MAX_FEED_AGE_SECONDS is required/);
  assert.throws(() => validateRuntimeConfig({ ...env, MAX_FEED_AGE_SECONDS: "Infinity" }), /non-negative integer/);
  assert.throws(() => validateRuntimeConfig({ ...env, MAX_FEED_AGE_SECONDS: ((1n << 63n).toString()) }), /exceeds/);
  assert.throws(() => validateRuntimeConfig({ ...env, MAX_CONFIDENCE_BPS: "10001" }), /exceeds/);
  assert.throws(() => validateRuntimeConfig({ ...env, MAX_USDC_DEVIATION_BPS: "-1" }), /non-negative integer/);
  assert.throws(() => validateGenesis("different-genesis"), /genesis mismatch/);
  assert.throws(() => validateGenesis(DEVNET_GENESIS_HASH, "other-genesis"), /not the pinned Devnet genesis/);
});

test("feed decoding matches pinned Full feed, owner, age, confidence and USDC depeg", () => {
  assert.equal(Buffer.from(PYTH_DISCRIMINATOR).toString("hex"), "22f123639d7ef4cd");
  const sol = parseFeed(feedForMint(WSOL_MINT), { price: 2_000_000_000n, confidence: 1_000_000n });
  assert.equal(sol.feedId, feedForMint(WSOL_MINT).id);
  assert.equal(sol.price, 2_000_000_000n);
  assert.equal(sol.exponent, -8);
  assert.equal(sol.ageSeconds, 10n);
  assert.throws(() => decodePythFullPrice({
    data: makePyth(feedForMint(WSOL_MINT)), accountOwner: "11111111111111111111111111111111",
    accountAddress: feedForMint(WSOL_MINT).address, expectedFeed: feedForMint(WSOL_MINT), nowUnix: feedNow,
    maxAgeSeconds: 60n, maxConfidenceBps: 25n, maxUsdcDeviationBps: 100n,
  }), /owner is not the pinned Pyth Receiver/);
  assert.throws(() => parseFeed(feedForMint(WSOL_MINT), { publishTime: feedNow - 61n }), /is stale/);
  assert.throws(() => parseFeed(feedForMint(WSOL_MINT), { verification: 0 }), /verification is not Full/);
  assert.throws(() => parseFeed(feedForMint(WSOL_MINT), { feedId: feedForMint(DEVNET_USDC_MINT).id }), /feed ID does not match/);
  assert.throws(() => parseFeed(feedForMint(WSOL_MINT), { confidence: 6_000_000n, price: 2_000_000_000n }), /confidence interval/);
  assert.throws(() => parseFeed(feedForMint(DEVNET_USDC_MINT), { price: 101_100_000n }), /depeg bound/);
  assert.throws(() => parseFeed(feedForMint(WSOL_MINT), { publishTime: feedNow + 1n }), /future/);
  assert.throws(() => decodePythFullPrice({
    data: makePyth(feedForMint(WSOL_MINT)), accountOwner: PYTH_RECEIVER_ID,
    accountAddress: feedForMint(DEVNET_USDC_MINT).address, expectedFeed: feedForMint(WSOL_MINT), nowUnix: feedNow,
    maxAgeSeconds: 60n, maxConfidenceBps: 25n, maxUsdcDeviationBps: 100n,
  }), /address does not match/);
});

test("missing account is unknown and no caller can turn absence into an estimate", () => {
  assert.throws(() => requireAccount(null, "SOL/USD feed"), /SOL\/USD feed account is missing/);
});

test("custody validation binds address, classic token owner, mint, Vault authority and exact amount", () => {
  const vaultAddress = deriveCanonicalVault();
  const custodyAddress = "Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX";
  const data = new Uint8Array(165);
  putKey(data, 0, WSOL_MINT);
  putKey(data, 32, vaultAddress);
  new DataView(data.buffer).setBigUint64(64, 9_007_199_254_740_993n, true);
  data[108] = 1;
  const input = { data, accountOwner: TOKEN_PROGRAM_ID, accountAddress: custodyAddress, expectedCustodyAddress: custodyAddress, mint: WSOL_MINT, expectedAuthority: vaultAddress, expectedAmount: 9_007_199_254_740_993n };
  assert.equal(validateCustodyAccount(input).amount, 9_007_199_254_740_993n);
  assert.throws(() => validateCustodyAccount({ ...input, accountOwner: "11111111111111111111111111111111" }), /classic SPL Token Program/);
  assert.throws(() => validateCustodyAccount({ ...input, accountAddress: "11111111111111111111111111111111" }), /differs from Vault configuration/);
  assert.throws(() => validateCustodyAccount({ ...input, mint: DEVNET_USDC_MINT }), /mint does not match/);
  assert.throws(() => validateCustodyAccount({ ...input, expectedAuthority: "11111111111111111111111111111111" }), /authority does not match/);
  assert.throws(() => validateCustodyAccount({ ...input, expectedAmount: 1n }), /differs from the Vault accounted amount/);
  assert.throws(() => validateCustodyAccount({ ...input, data: null }), /byteLength/);
});

test("reversed allowed asset order maps USDC then WSOL to the matching feeds", () => {
  const vault = parseVault(makeVault({ reverse: true }));
  const feeds = feedsForAssets(vault.assets);
  assert.deepEqual(feeds.map((feed) => feed.label), ["USDC/USD", "SOL/USD"]);
  assert.throws(() => feedsForAssets([{ ...vault.assets[0], mint: "11111111111111111111111111111111" }, vault.assets[1]]), /Unsupported Devnet asset mint/);
});

test("drift uses exact BigInt fixed-point arithmetic beyond Number precision", () => {
  const assets = [
    { mint: WSOL_MINT, decimals: 9, targetBps: 6_000 },
    { mint: DEVNET_USDC_MINT, decimals: 6, targetBps: 4_000 },
  ];
  const balances = [9_007_199_254_740_993n, 18_014_398_509_481_986n];
  const prices = [
    { price: 200_000_000_000n, exponent: -8 },
    { price: 100_000_000n, exponent: -8 },
  ];
  const drift = calculateObservedDrift(assets, balances, prices);
  assert.equal(drift.valuesQ27[0], balances[0] * prices[0].price * 10n ** 10n);
  assert.equal(drift.valuesQ27[0], drift.valuesQ27[1]);
  assert.deepEqual(drift.driftsHundredthsBps, [100_000n, 100_000n]);
});
