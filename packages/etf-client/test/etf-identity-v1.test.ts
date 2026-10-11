import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const fixturePath = new URL(
  "../../../docs/rebalancing/contracts/etf-config-v1-identity-fixture.json",
  import.meta.url,
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as FixtureDocument;

type AssetInput = {
  mintBytesHex: string;
  tokenProgramBytesHex: string;
  decimals: number;
  oracleMode: "push_feed" | "receiver_full";
  oracleProgramBytesHex: string;
  oracleAccountBytesHex: string;
  feedIdBytesHex: string;
  targetWeightBps: number;
};

type ConfigInput = {
  protocolVersion: number;
  assets: AssetInput[];
  mathVersion: number;
  feePolicyIdBytesHex: string;
  feePolicyParamsHex: string;
  riskPolicyIdBytesHex: string;
  riskPolicyParamsHex: string;
  initialGovernanceAuthorityBytesHex: string;
  initialEmergencyGuardianBytesHex: string;
  governanceDelaySeconds: number;
};

type FixtureDocument = {
  schema: string;
  fixtureOnly: boolean;
  inputs: ConfigInput;
  expected: {
    configBytesHex: string;
    configHashHex: string;
    strategyId: string;
    poolPdaSeedsHex: string[];
    programId: string | null;
    poolPda: string | null;
  };
};

const DOMAIN = Buffer.from("coloyond:etf:config:v1", "utf8");
const ORACLE_MODE_TAG: Record<AssetInput["oracleMode"], number> = {
  push_feed: 0,
  receiver_full: 1,
};

function uint(value: number, bits: 8 | 16 | 32, label: string): Buffer {
  assert.ok(Number.isInteger(value) && value >= 0 && value < 2 ** bits, `${label}: outside u${bits} range`);
  const output = Buffer.alloc(bits / 8);
  if (bits === 8) output.writeUInt8(value);
  else if (bits === 16) output.writeUInt16LE(value);
  else output.writeUInt32LE(value);
  return output;
}

function uint64(value: bigint): Buffer {
  assert.equal(typeof value, "bigint", "u64 must be encoded from BigInt, never Number");
  assert.ok(value >= 0n && value <= 0xffff_ffff_ffff_ffffn, "u64 outside range");
  const output = Buffer.alloc(8);
  output.writeBigUInt64LE(value);
  return output;
}

function fixtureU64(value: number): bigint {
  assert.ok(Number.isSafeInteger(value) && value >= 0, "JSON u64 fixture number must be exactly representable");
  return BigInt(value);
}

function fixedHex(value: string, byteLength: number, label: string): Buffer {
  assert.match(value, /^(?:[0-9a-fA-F]{2})*$/, `${label}: expected even-length hexadecimal bytes`);
  const bytes = Buffer.from(value, "hex");
  assert.equal(bytes.length, byteLength, `${label}: expected exactly ${byteLength} bytes`);
  return bytes;
}

function vectorHex(value: string, label: string): Buffer {
  assert.match(value, /^(?:[0-9a-fA-F]{2})*$/, `${label}: expected even-length hexadecimal bytes`);
  return Buffer.from(value, "hex");
}

function encodeAsset(asset: AssetInput): Buffer {
  assert.ok(Object.hasOwn(ORACLE_MODE_TAG, asset.oracleMode), "unsupported oracle enum tag");
  return Buffer.concat([
    fixedHex(asset.mintBytesHex, 32, "mint"),
    fixedHex(asset.tokenProgramBytesHex, 32, "token program"),
    uint(asset.decimals, 8, "decimals"),
    uint(ORACLE_MODE_TAG[asset.oracleMode], 8, "oracle mode"),
    fixedHex(asset.oracleProgramBytesHex, 32, "oracle program"),
    fixedHex(asset.oracleAccountBytesHex, 32, "oracle account"),
    fixedHex(asset.feedIdBytesHex, 32, "feed ID"),
    uint(asset.targetWeightBps, 16, "target weight bps"),
  ]);
}

function encodeConfig(input: ConfigInput): Buffer {
  assert.equal(input.protocolVersion, 1, "unsupported protocol version");
  assert.ok(input.assets.length >= 2 && input.assets.length <= 3, "expected two or three ordered assets");
  const feeParams = vectorHex(input.feePolicyParamsHex, "fee policy params");
  const riskParams = vectorHex(input.riskPolicyParamsHex, "risk policy params");
  return Buffer.concat([
    uint(input.protocolVersion, 8, "protocol version"),
    uint(input.assets.length, 32, "asset count"),
    ...input.assets.map(encodeAsset),
    uint(input.mathVersion, 16, "math version"),
    fixedHex(input.feePolicyIdBytesHex, 32, "fee policy ID"),
    uint(feeParams.length, 32, "fee policy params length"),
    feeParams,
    fixedHex(input.riskPolicyIdBytesHex, 32, "risk policy ID"),
    uint(riskParams.length, 32, "risk policy params length"),
    riskParams,
    fixedHex(input.initialGovernanceAuthorityBytesHex, 32, "initial governance authority"),
    fixedHex(input.initialEmergencyGuardianBytesHex, 32, "initial emergency guardian"),
    uint64(fixtureU64(input.governanceDelaySeconds)),
  ]);
}

test("independent TypeScript encoder matches the shared synthetic ETF identity vector", () => {
  assert.equal(fixture.schema, "etf-pool-config-v1");
  assert.equal(fixture.fixtureOnly, true);
  assert.equal(fixture.expected.programId, null);
  assert.equal(fixture.expected.poolPda, null);

  const encoded = encodeConfig(fixture.inputs);
  assert.equal(encoded.toString("hex"), fixture.expected.configBytesHex);

  const digest = createHash("sha256").update(DOMAIN).update(encoded).digest("hex");
  assert.equal(digest, fixture.expected.configHashHex);
  assert.equal(`etf1:${digest}`, fixture.expected.strategyId);
  assert.deepEqual(
    [Buffer.from("etf_pool_v1", "utf8").toString("hex"), digest],
    fixture.expected.poolPdaSeedsHex,
  );
});

test("fixed identity inputs reject malformed hex and wrong byte lengths", () => {
  assert.throws(() => fixedHex("0", 1, "odd hex"), /even-length hexadecimal/);
  assert.throws(() => fixedHex("gg", 1, "invalid hex"), /even-length hexadecimal/);
  assert.throws(() => fixedHex("00", 32, "short pubkey"), /exactly 32 bytes/);
  assert.throws(() => fixedHex("00".repeat(33), 32, "long feed ID"), /exactly 32 bytes/);
});

test("u64 serialization preserves BigInt precision and rejects Number input", () => {
  const value = 9_007_199_254_740_993n;
  assert.equal(uint64(value).toString("hex"), "0100000000002000");
  assert.throws(() => uint64(86_400 as unknown as bigint), /u64 must be encoded from BigInt/);
  assert.throws(() => fixtureU64(Number.MAX_SAFE_INTEGER + 1), /exactly representable/);
});
