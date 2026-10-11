import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { decodeVaultAccount, PROGRAM_ID, VAULT_ACCOUNT_SIZE } from "../src/vaultDecoder.js";

const fixturePath = new URL("../fixtures/vault-account-v1.hex", import.meta.url);
const vectorsPath = new URL("../fixtures/vault-v1-vectors.json", import.meta.url);
const idlPath = new URL("../../../idl/coloyond_vault.json", import.meta.url);
const bytes = Uint8Array.from(Buffer.from((await readFile(fixturePath, "utf8")).trim(), "hex"));
const vectors = JSON.parse(await readFile(vectorsPath, "utf8")) as {
  fixtureOnly: boolean;
  programId: string;
  accountFixture: { length: number; accountedAmounts: string[]; bountyLiabilities: string[]; sequence: string };
  u64LittleEndianVectors: { decimal: string; littleEndianHex: string }[];
};
const idl = JSON.parse(await readFile(idlPath, "utf8")) as {
  address: string;
  accounts: { name: string; discriminator: number[] }[];
  types: { name: string; type: { kind: string; fields?: { name: string; type: unknown }[] } }[];
};

test("decoder discriminator is generated from the published IDL", () => {
  assert.deepEqual([...bytes.subarray(0, 8)], idl.accounts.find((account) => account.name === "Vault")?.discriminator);
  assert.equal(PROGRAM_ID, idl.address);
  assert.equal(vectors.fixtureOnly, true);
  assert.equal(vectors.programId, idl.address);
  assert.equal(bytes.byteLength, vectors.accountFixture.length);
});

test("fixed decoder size matches the generated Anchor Vault type", () => {
  const types = new Map(idl.types.map((type) => [type.name, type.type]));
  const vaultType = types.get("Vault");
  assert.ok(vaultType?.fields);
  const sizeOf = (type: unknown): number => {
    if (typeof type === "string") {
      const sizes: Record<string, number> = { u8: 1, u16: 2, u64: 8, pubkey: 32 };
      assert.ok(sizes[type] !== undefined, `unsupported non-fixed IDL type ${type}`);
      return sizes[type]!;
    }
    assert.ok(type && typeof type === "object");
    const value = type as { array?: [unknown, number]; defined?: { name: string } };
    if (value.array) return sizeOf(value.array[0]) * value.array[1];
    if (value.defined) {
      const defined = types.get(value.defined.name);
      assert.ok(defined?.fields);
      return defined.fields.reduce((sum, field) => sum + sizeOf(field.type), 0);
    }
    throw new Error(`unsupported IDL type ${JSON.stringify(type)}`);
  };
  const bytes = 8 + vaultType.fields.reduce((sum, field) => sum + sizeOf(field.type), 0);
  assert.equal(bytes, VAULT_ACCOUNT_SIZE);
});

test("decodes fixed-width account fields and preserves u64 precision", () => {
  const vault = decodeVaultAccount(bytes, PROGRAM_ID);
  assert.equal(vault.status, "paused");
  assert.equal(vault.configurationRevision, "7");
  assert.deepEqual(vault.assets.map(({ decimals, targetBps }) => ({ decimals, targetBps })), [
    { decimals: 9, targetBps: 5500 },
    { decimals: 6, targetBps: 4500 },
  ]);
  assert.deepEqual(vault.accountedAmounts, vectors.accountFixture.accountedAmounts);
  assert.deepEqual(vault.bountyLiabilities, vectors.accountFixture.bountyLiabilities);
  assert.equal(vault.sequence, vectors.accountFixture.sequence);
  for (const amount of vectors.u64LittleEndianVectors) {
    const value = BigInt(amount.decimal);
    const littleEndianHex = Array.from({ length: 8 }, (_, index) =>
      ((value >> BigInt(index * 8)) & 0xffn).toString(16).padStart(2, "0"),
    ).join("");
    assert.equal(littleEndianHex, amount.littleEndianHex);
  }
  assert.equal(vault.shareMint, "11111111111111111111111111111111");
});

test("rejects truncated bytes, wrong discriminators and unknown status", () => {
  assert.throws(() => decodeVaultAccount(bytes.subarray(0, bytes.length - 1), PROGRAM_ID), /exactly 353 bytes/);
  assert.throws(() => decodeVaultAccount(bytes, "11111111111111111111111111111111"), /owner/);
  const wrongDiscriminator = bytes.slice();
  wrongDiscriminator[0] ^= 0xff;
  assert.throws(() => decodeVaultAccount(wrongDiscriminator, PROGRAM_ID), /discriminator/);
  const wrongVersion = bytes.slice();
  wrongVersion[8] = 2;
  assert.throws(() => decodeVaultAccount(wrongVersion, PROGRAM_ID), /version/);
  const wrongStatus = bytes.slice();
  wrongStatus[10] = 9;
  assert.throws(() => decodeVaultAccount(wrongStatus, PROGRAM_ID), /status/);
});
