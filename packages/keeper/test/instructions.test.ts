import assert from "node:assert/strict";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";
import { buildS2DInstruction, PROGRAM_ID } from "../src/solana.js";
import { snapshot, VAULT } from "./helpers.js";

const signer = new PublicKey(Buffer.alloc(32, 9));
const pda = (seed: string, extra?: Buffer): PublicKey => PublicKey.findProgramAddressSync(extra ? [Buffer.from(seed), extra] : [Buffer.from(seed)], PROGRAM_ID)[0];

test("encodes the generated S2D start and finish instruction discriminators and account ordering", () => {
  const state = snapshot();
  const start = buildS2DInstruction({ kind: "start", expectedVaultSequence: 3n, sellAsset: 1, initialSellAmount: 513n }, state, signer);
  assert.deepEqual(Array.from(start.data.subarray(0, 8)), [61, 251, 146, 164, 48, 29, 208, 170]);
  assert.equal(start.data[8], 1);
  assert.equal(start.data.readBigUInt64LE(9), 513n);
  assert.equal(start.keys.length, 12);
  assert.equal(start.keys[0]!.pubkey.toBase58(), VAULT);
  assert.equal(start.keys[3]!.pubkey.toBase58(), pda("rebalance_intent", new PublicKey(VAULT).toBuffer()).toBase58());
  assert.equal(start.keys[10]!.pubkey.toBase58(), signer.toBase58());

  const finish = buildS2DInstruction({ kind: "finish", expectedVaultSequence: 3n, expectedIntentSequence: 5n }, { ...state, intent: { version: 1, vault: VAULT, sequence: 5n, targetRevision: 4n, policyRevision: 4n, sellAsset: 0, initialSellAmount: 1n, remainingSellAmount: 0n, endSlot: 200n } }, signer);
  assert.deepEqual(Array.from(finish.data.subarray(0, 8)), [87, 244, 172, 88, 190, 34, 32, 33]);
  assert.equal(finish.data.readBigUInt64LE(8), 5n);
  assert.equal(finish.keys.length, 11);
});

test("encodes fill compare-and-swap arguments and bounty claim PDA", () => {
  const state = snapshot({ intent: { version: 1, vault: VAULT, sequence: 5n, targetRevision: 4n, policyRevision: 4n, sellAsset: 0, initialSellAmount: 10n, remainingSellAmount: 8n, endSlot: 300n } });
  const takerIn = new PublicKey(Buffer.alloc(32, 10));
  const takerOut = new PublicKey(Buffer.alloc(32, 11));
  const fill = buildS2DInstruction({ kind: "fill", expectedVaultSequence: 5n, expectedIntentSequence: 5n, sellAmount: 2n, grossBuyAmount: 20n, bountyAmount: 1n, takerIn: takerIn.toBase58(), takerOut: takerOut.toBase58() }, state, signer);
  assert.deepEqual(Array.from(fill.data.subarray(0, 8)), [51, 225, 89, 197, 65, 5, 178, 250]);
  assert.deepEqual([fill.data.readBigUInt64LE(8), fill.data.readBigUInt64LE(16), fill.data.readBigUInt64LE(24), fill.data.readBigUInt64LE(32)], [5n, 2n, 20n, 1n]);
  const claim = PublicKey.findProgramAddressSync([Buffer.from("bounty_claim"), new PublicKey(VAULT).toBuffer(), Buffer.from([5, 0, 0, 0, 0, 0, 0, 0])], PROGRAM_ID)[0];
  assert.equal(fill.keys[4]!.pubkey.toBase58(), claim.toBase58());
  assert.equal(fill.keys[13]!.pubkey.toBase58(), signer.toBase58());
  assert.equal(fill.keys[14]!.pubkey.toBase58(), signer.toBase58());
});
