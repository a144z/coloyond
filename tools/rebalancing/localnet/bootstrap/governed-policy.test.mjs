import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import {
  decodeAnchorAccount,
  governedPolicyIdl,
  LOCALNET_POLICY_CONFIG,
  proposeAuctionPolicyInstruction,
  deriveGovernedPolicyPdas,
} from "./governed-policy.mjs";

const require = createRequire(import.meta.url);
const { PublicKey } = require("@solana/web3.js");
const idl = governedPolicyIdl();
const programId = new PublicKey("FN7uGX34qyijmVX69gqEkMugWjE5Sjso8Pe7gWU6B2N6");
const vault = new PublicKey(Uint8Array.from({ length: 32 }, (_, i) => i + 1));

function u64(value) {
  const result = Buffer.alloc(8);
  result.writeBigUInt64LE(BigInt(value));
  return result;
}

function u16(value) {
  const result = Buffer.alloc(2);
  result.writeUInt16LE(value);
  return result;
}

function keys() {
  const { auctionPolicy, pendingPolicy } = deriveGovernedPolicyPdas(programId, vault);
  return {
    vault,
    governance: new PublicKey(new Uint8Array(32).fill(11)),
    pending_policy: pendingPolicy,
    auction_policy: auctionPolicy,
    governance_authority: new PublicKey(new Uint8Array(32).fill(12)),
    custody_a: new PublicKey(new Uint8Array(32).fill(13)),
    custody_b: new PublicKey(new Uint8Array(32).fill(14)),
    mint_a: new PublicKey(new Uint8Array(32).fill(15)),
    mint_b: new PublicKey(new Uint8Array(32).fill(16)),
  };
}

test("policy proposal encoding and account flags follow the checked-in IDL", () => {
  const actual = proposeAuctionPolicyInstruction(programId, keys());
  const spec = idl.instructions.find((entry) => entry.name === "propose_auction_policy");
  assert(spec);
  assert.deepEqual([...actual.data.subarray(0, 8)], spec.discriminator);
  assert.equal(actual.data.length, 8 + 94);
  assert.deepEqual(
    actual.keys.map(({ pubkey, isWritable, isSigner }) => ({
      pubkey: pubkey.toBase58(), isWritable, isSigner,
    })),
    spec.accounts.map((account) => ({
      pubkey: (keys()[account.name] ?? new PublicKey(account.address)).toBase58(),
      isWritable: account.writable === true,
      isSigner: account.signer === true,
    })),
  );
});

test("PendingAuctionPolicy decoding follows IDL fields and preserves u64 precision", () => {
  const account = idl.accounts.find((entry) => entry.name === "PendingAuctionPolicy");
  const proposal = proposeAuctionPolicyInstruction(programId, keys());
  const configBytes = proposal.data.subarray(8);
  const firstKey = new PublicKey(new Uint8Array(32).fill(21));
  const bytes = Buffer.concat([
    Buffer.from(account.discriminator),
    Buffer.from([1, 2]),
    vault.toBuffer(),
    firstKey.toBuffer(),
    u64(7), u64(12), u64(100), u64(132), configBytes,
  ]);
  const decoded = decodeAnchorAccount("PendingAuctionPolicy", bytes);
  assert.equal(decoded.version, 1);
  assert.equal(decoded.vault, vault.toBase58());
  assert.equal(decoded.governance_authority, firstKey.toBase58());
  assert.equal(decoded.configuration_revision, 7n);
  assert.equal(decoded.vault_sequence, 12n);
  assert.equal(decoded.proposed_at_slot, 100n);
  assert.equal(decoded.activate_after_slot, 132n);
  assert.equal(decoded.config.maximum_trade_value_q9, LOCALNET_POLICY_CONFIG.maximum_trade_value_q9);
  assert.deepEqual(decoded.config.reserve_floor, LOCALNET_POLICY_CONFIG.reserve_floor);
});

test("account decoder rejects a wrong discriminator and nonzero trailing data", () => {
  const account = idl.accounts.find((entry) => entry.name === "PendingAuctionPolicy");
  const proposal = proposeAuctionPolicyInstruction(programId, keys());
  const valid = Buffer.concat([
    Buffer.from(account.discriminator), Buffer.from([1, 2]), vault.toBuffer(),
    new Uint8Array(32).fill(12), u64(7), u64(12), u64(100), u64(132), proposal.data.subarray(8),
  ]);
  const wrongTag = Buffer.from(valid);
  wrongTag[0] ^= 1;
  assert.throws(() => decodeAnchorAccount("PendingAuctionPolicy", wrongTag), /discriminator mismatch/);
  assert.throws(() => decodeAnchorAccount("PendingAuctionPolicy", Buffer.concat([valid, Buffer.from([1])])), /nonzero bytes/);
});

