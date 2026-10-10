import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PublicKey, TransactionInstruction } = require("@solana/web3.js");
const idl = JSON.parse(readFileSync(new URL("../../../../idl/coloyond_vault.json", import.meta.url), "utf8"));

/** Localnet-only values copied from the Rust policy fixture; these are not recommendations. */
export const LOCALNET_POLICY_CONFIG = Object.freeze({
  maximum_age_seconds: 45n,
  maximum_confidence_bps: 100,
  maximum_usdc_deviation_bps: 100,
  minimum_drift_bps: 250,
  maximum_trade_value_q9: 50_000_000_000n,
  cooldown_slots: 10n,
  curve_start_rate_bps: 10_100,
  curve_end_rate_bps: 10_000,
  duration_slots: 200n,
  fee_bps: 20,
  maximum_fee_bps: 50,
  fee_reserve_share_bps: 5_000,
  reserve_floor: [2n, 1n],
  epoch_bounty_budget: [10n, 5n],
  maximum_bounty_per_fill: 5n,
  maximum_cumulative_nav_loss_bps: 100,
  maximum_nav_loss_bps: 25,
  asset_feed_indices: [0, 1],
});

function findInstruction(name) {
  const instruction = idl.instructions.find((candidate) => candidate.name === name);
  assert(instruction, `IDL is missing instruction ${name}`);
  return instruction;
}

function findDefinedType(name) {
  const defined = idl.types.find((candidate) => candidate.name === name);
  assert(defined, `IDL is missing type ${name}`);
  return defined.type;
}

function encodeUnsigned(value, bytes, field) {
  const integer = BigInt(value);
  const limit = 1n << BigInt(bytes * 8);
  assert(integer >= 0n && integer < limit, `${field} does not fit u${bytes * 8}`);
  const result = Buffer.alloc(bytes);
  if (bytes === 1) result.writeUInt8(Number(integer));
  else if (bytes === 2) result.writeUInt16LE(Number(integer));
  else if (bytes === 4) result.writeUInt32LE(Number(integer));
  else if (bytes === 8) result.writeBigUInt64LE(integer);
  else throw new Error(`Unsupported unsigned integer width ${bytes}`);
  return result;
}

function encodeType(type, value, field) {
  if (typeof type === "string") {
    const widths = { u8: 1, u16: 2, u32: 4, u64: 8 };
    if (widths[type]) return encodeUnsigned(value, widths[type], field);
    if (type === "pubkey") {
      const key = value instanceof PublicKey ? value : new PublicKey(value);
      return key.toBuffer();
    }
    throw new Error(`Unsupported IDL type ${type} for ${field}`);
  }
  if (type.array) {
    const [elementType, length] = type.array;
    assert(Array.isArray(value) && value.length === length, `${field} must contain exactly ${length} values`);
    return Buffer.concat(value.map((entry, index) => encodeType(elementType, entry, `${field}[${index}]`)));
  }
  if (type.defined) {
    const name = typeof type.defined === "string" ? type.defined : type.defined.name;
    const definition = findDefinedType(name);
    assert.equal(definition.kind, "struct", `${field} must be an IDL struct`);
    return Buffer.concat(definition.fields.map((property) => {
      assert(Object.hasOwn(value, property.name), `${field}.${property.name} is missing`);
      return encodeType(property.type, value[property.name], `${field}.${property.name}`);
    }));
  }
  throw new Error(`Unsupported IDL type for ${field}`);
}

function instruction(programId, name, accountValues, args = {}) {
  const spec = findInstruction(name);
  const keys = spec.accounts.map((account) => {
    const supplied = accountValues[account.name];
    const address = supplied ?? account.address;
    assert(address, `${name} is missing account ${account.name}`);
    return {
      pubkey: address instanceof PublicKey ? address : new PublicKey(address),
      isSigner: account.signer === true,
      isWritable: account.writable === true,
    };
  });
  const encodedArgs = spec.args.map((arg) => {
    assert(Object.hasOwn(args, arg.name), `${name} is missing argument ${arg.name}`);
    return encodeType(arg.type, args[arg.name], arg.name);
  });
  return new TransactionInstruction({
    programId,
    keys,
    data: Buffer.concat([Buffer.from(spec.discriminator), ...encodedArgs]),
  });
}

export function deriveGovernedPolicyPdas(programId, vault) {
  const program = programId instanceof PublicKey ? programId : new PublicKey(programId);
  const vaultKey = vault instanceof PublicKey ? vault : new PublicKey(vault);
  const propose = findInstruction("propose_auction_policy");
  const derive = (name) => {
    const account = propose.accounts.find((candidate) => candidate.name === name);
    assert(account?.pda?.seeds?.length, `${name} is missing PDA seed metadata in the IDL`);
    const seeds = account.pda.seeds.map((seed) => {
      if (seed.kind === "const" && Array.isArray(seed.value)) return Buffer.from(seed.value);
      if (seed.kind === "account" && seed.path === "vault") return vaultKey.toBuffer();
      throw new Error(`${name} has unsupported PDA seed metadata`);
    });
    return PublicKey.findProgramAddressSync(seeds, program)[0];
  };
  const auctionPolicy = derive("auction_policy");
  const pendingPolicy = derive("pending_policy");
  return { auctionPolicy, pendingPolicy };
}

export function proposeAuctionPolicyInstruction(programId, accounts, config = LOCALNET_POLICY_CONFIG) {
  return instruction(programId, "propose_auction_policy", accounts, { config });
}

export function executeAuctionPolicyInstruction(programId, accounts) {
  return instruction(programId, "execute_auction_policy", accounts);
}

export function resumeRiskInstruction(programId, accounts) {
  return instruction(programId, "resume_risk", accounts);
}

class BorshReader {
  constructor(bytes) {
    this.bytes = bytes;
    this.offset = 0;
  }

  take(size) {
    assert(this.offset + size <= this.bytes.length, "Account data ended before the IDL fields were decoded");
    const value = this.bytes.subarray(this.offset, this.offset + size);
    this.offset += size;
    return value;
  }

  decode(type, field) {
    if (typeof type === "string") {
      const widths = { u8: 1, u16: 2, u32: 4, u64: 8 };
      if (widths[type]) {
        const bytes = this.take(widths[type]);
        if (type === "u8") return bytes.readUInt8(0);
        if (type === "u16") return bytes.readUInt16LE(0);
        if (type === "u32") return bytes.readUInt32LE(0);
        return bytes.readBigUInt64LE(0);
      }
      if (type === "bool") {
        const value = this.take(1).readUInt8(0);
        assert(value === 0 || value === 1, `${field} has an invalid Borsh bool`);
        return value === 1;
      }
      if (type === "pubkey") return new PublicKey(this.take(32)).toBase58();
      throw new Error(`Unsupported IDL type ${type} for ${field}`);
    }
    if (type.array) {
      const [elementType, length] = type.array;
      return Array.from({ length }, (_, index) => this.decode(elementType, `${field}[${index}]`));
    }
    if (type.option) {
      const tag = this.take(1).readUInt8(0);
      assert(tag === 0 || tag === 1, `${field} has an invalid Borsh option tag`);
      return tag === 0 ? null : this.decode(type.option, field);
    }
    if (type.defined) {
      const name = typeof type.defined === "string" ? type.defined : type.defined.name;
      const definition = findDefinedType(name);
      assert.equal(definition.kind, "struct", `${field} must be an IDL struct`);
      return Object.fromEntries(definition.fields.map((property) => [
        property.name,
        this.decode(property.type, `${field}.${property.name}`),
      ]));
    }
    throw new Error(`Unsupported IDL type for ${field}`);
  }
}

/** Decode an Anchor account from the checked-in canonical IDL, rejecting mismatched tags and nonzero tail bytes. */
export function decodeAnchorAccount(name, bytes) {
  const spec = idl.accounts.find((candidate) => candidate.name === name);
  assert(spec, `IDL is missing account ${name}`);
  const data = Buffer.from(bytes);
  assert(data.length >= 8, `${name} account is shorter than its discriminator`);
  assert(data.subarray(0, 8).equals(Buffer.from(spec.discriminator)), `${name} discriminator mismatch`);
  const definition = findDefinedType(name);
  assert.equal(definition.kind, "struct", `${name} must be an IDL struct`);
  const reader = new BorshReader(data.subarray(8));
  const value = Object.fromEntries(definition.fields.map((field) => [
    field.name,
    reader.decode(field.type, `${name}.${field.name}`),
  ]));
  assert(
    reader.bytes.subarray(reader.offset).every((byte) => byte === 0),
    `${name} has nonzero bytes beyond the IDL account layout`,
  );
  return value;
}

export function governedPolicyIdl() {
  return idl;
}

