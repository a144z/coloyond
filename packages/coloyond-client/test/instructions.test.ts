import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  base58Decode,
  encodeInitializeVault,
  INITIALIZE_VAULT_ACCOUNT_ORDER,
  INITIALIZE_VAULT_DISCRIMINATOR,
  type VaultInitArgs,
} from "../src/instructions.js";

const idlPath = new URL("../../../idl/coloyond_vault.json", import.meta.url);
type JsonValue = JsonValue[] | { [key: string]: JsonValue } | string | number | boolean | null;
type JsonRecord = { [key: string]: JsonValue };
const idl = JSON.parse(await readFile(idlPath, "utf-8")) as JsonRecord;

const instructions = idl.instructions as JsonRecord[];
const initializeInstruction = instructions.find((instruction) => instruction.name === "initialize_vault");
assert.ok(initializeInstruction, "initialize_vault is published in the IDL");
const types = new Map((idl.types as JsonRecord[]).map((entry) => [entry.name as string, entry.type as JsonRecord]));

const sample: VaultInitArgs = {
  configurationRevision: 7n,
  targetBps: [6000, 4000],
  seedAmounts: [1000n, 2000n],
  reserveContributions: [10n, 20n],
  initialShares: 1000000000n,
  minimumLockedShares: 1n,
  governanceAuthority: "FN7uGX34qyijmVX69gqEkMugWjE5Sjso8Pe7gWU6B2N6",
  emergencyAuthority: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  minDelaySlots: 100n,
  maximumAgeSeconds: 600n,
  maximumConfidenceBps: 100,
  maximumUsdcDeviationBps: 250,
  minimumDriftBps: 75,
  maximumTradeValueQ9: 4831813792n,
  cooldownSlots: 32n,
  curveStartRateBps: 400,
  curveEndRateBps: 8000,
  durationSlots: 240n,
  feeBps: 30,
  maximumFeeBps: 500,
  maximumBountyPerFill: 5000n,
  maximumNavLossBps: 150,
  maximumCumulativeNavLossBps: 600,
  assetFeedIndices: [0, 1],
};

test("encoder discriminator and account order match the published IDL", () => {
  assert.deepEqual([...INITIALIZE_VAULT_DISCRIMINATOR], initializeInstruction!.discriminator as number[]);
  assert.deepEqual(
    INITIALIZE_VAULT_ACCOUNT_ORDER,
    (initializeInstruction!.accounts as JsonRecord[]).map((account) => account.name as string),
  );
  assert.deepEqual(initializeInstruction!.args, [{ name: "init", type: { defined: { name: "VaultInit" } } }]);
});

test("encoded length equals the IDL VaultInit field sizes", () => {
  const sizeOf = (type: JsonValue): number => {
    if (typeof type === "string") {
      const sizes: Record<string, number> = { u8: 1, u16: 2, u64: 8, pubkey: 32 };
      assert.ok(sizes[type] !== undefined, `unsupported non-fixed IDL type ${type}`);
      return sizes[type]!;
    }
    assert.ok(type && typeof type === "object" && !Array.isArray(type));
    const record = type as JsonRecord;
    if (record.array) {
      const [inner, length] = record.array as [JsonValue, number];
      return sizeOf(inner) * length;
    }
    assert.ok(record.defined, `unexpected non-fixed IDL type ${JSON.stringify(type)}`);
    const name = (record.defined as JsonRecord).name as string;
    const fields = (types.get(name) as JsonRecord).fields as JsonRecord[];
    return fields.reduce((total, field) => total + sizeOf(field.type as JsonValue), 0);
  };
  assert.ok(types.has("VaultInit"), "VaultInit type is published in the IDL");
  const fields = (types.get("VaultInit") as JsonRecord).fields as JsonRecord[];
  assert.equal(fields.length, 24);
  const expectedLength = 8 + fields.reduce((total, field) => total + sizeOf(field.type as JsonValue), 0);
  assert.equal(encodeInitializeVault(sample).byteLength, expectedLength);
});

test("encodeInitializeVault writes little endian fields in IDL order", () => {
  const bytes = encodeInitializeVault(sample);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.deepEqual([...bytes.subarray(0, 8)], [...INITIALIZE_VAULT_DISCRIMINATOR]);
  assert.equal(view.getBigUint64(8, true), 7n);
  assert.equal(view.getUint16(16, true), 6000);
  assert.equal(view.getUint16(18, true), 4000);
  assert.equal(view.getBigUint64(20, true), 1000n);
  assert.equal(view.getBigUint64(52, true), 1000000000n);
  assert.deepEqual([...bytes.subarray(68, 100)], [...base58Decode(sample.governanceAuthority)]);
  assert.deepEqual([...bytes.subarray(100, 132)], [...base58Decode(sample.emergencyAuthority)]);
  assert.equal(view.getUint16(148, true), 100);
  assert.equal(view.getUint16(150, true), 250);
  assert.equal(view.getBigUint64(154, true), 4831813792n);
  assert.equal(bytes[198], 0);
  assert.equal(bytes[199], 1);
});

test("base58Decode rejects invalid characters and oversized values", () => {
  assert.throws(() => base58Decode("0!"), /base58/);
  assert.equal(base58Decode("1".repeat(32)).length, 32);
  assert.throws(() => base58Decode("1".repeat(45)), /pubkey/);
});
