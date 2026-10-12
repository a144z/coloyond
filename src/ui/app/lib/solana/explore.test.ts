import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Buffer } from 'buffer';
import { sha256 } from '@noble/hashes/sha2.js';
import { Keypair, PublicKey } from '@solana/web3.js';
import {
  EXPLORE_ASSETS,
  buildExploreDepositTransaction,
  decodeShareMetadata,
  decodeVaultState,
  deriveExploreVaultAddresses,
  formatRawAmount,
  metadataAddressForMint,
  parseTokenAmount,
  resolveMetadataUri,
} from './explore.js';
import { EXECUTION_PROGRAM_ID } from './config.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

const programId = new PublicKey(EXECUTION_PROGRAM_ID);
const creator = Keypair.fromSeed(Buffer.alloc(32, 17)).publicKey;
const assets = [EXPLORE_ASSETS[0]!, EXPLORE_ASSETS[1]!];

function makeVault(active = true, targetBps = [6_000, 4_000]) {
  const id = 7n;
  const [address] = PublicKey.findProgramAddressSync([Buffer.from('vault'), creator.toBuffer(), u64(id)], programId);
  const [authority, authorityBump] = PublicKey.findProgramAddressSync([Buffer.from('vault-authority'), address.toBuffer()], programId);
  const [shareMint] = PublicKey.findProgramAddressSync([Buffer.from('share-mint'), address.toBuffer()], programId);
  const data = Buffer.alloc(494);
  data.set(sha256(new TextEncoder().encode('account:VaultState')).slice(0, 8), 0);
  let offset = 8;
  data.writeBigUInt64LE(id, offset); offset += 8;
  data.set(creator.toBuffer(), offset); offset += 32;
  data.set(shareMint.toBuffer(), offset); offset += 32;
  data.writeUInt8(active ? 1 : 0, offset++);
  data.writeUInt16LE(200, offset); offset += 2;
  data.writeUInt16LE(100, offset); offset += 2;
  data.writeUInt8(authorityBump, offset++);
  data.writeBigUInt64LE(3n, offset); offset += 8;
  data.writeUInt32LE(assets.length, offset); offset += 4;
  for (let i = 0; i < assets.length; i += 1) {
    const asset = assets[i]!;
    data.set(new PublicKey(asset.mint).toBuffer(), offset); offset += 32;
    data.writeUInt8(asset.decimals, offset++);
    data.writeUInt16LE(targetBps[i]!, offset); offset += 2;
    data.set(new PublicKey(asset.feedAccount).toBuffer(), offset); offset += 32;
    data.set(hexBytes(asset.feedId), offset); offset += 32;
  }
  const state = decodeVaultState(data, programId);
  return { address, authority, shareMint: state.shareMint, data, state };
}

function encodeMetadata(mint: PublicKey, updateAuthority: PublicKey, name: string, symbol: string, uri: string): Buffer {
  return Buffer.concat([
    Buffer.from([4]), updateAuthority.toBuffer(), mint.toBuffer(), string(name), string(symbol), string(uri),
    Buffer.from([0, 0, 0, 0, 1]), // no seller fee, no creators, no primary sale, mutable
  ]);
}

test('decodes a canonical active Vault State with all supported config facts', () => {
  const { address, state } = makeVault();
  assert.equal(state.id, 7n);
  assert.equal(state.creator.toBase58(), creator.toBase58());
  assert.equal(state.active, true);
  assert.deepEqual(state.assets.map((asset) => asset.targetBps), [6_000, 4_000]);
  assert.ok(deriveExploreVaultAddresses(address, state).shareMint.equals(state.shareMint));
});

test('fails closed for wrong owner, discriminator, truncated or malformed boolean/layout', () => {
  const { data } = makeVault();
  assert.throws(() => decodeVaultState(data, TOKEN_PROGRAM_ID), /owner/);
  const wrongDiscriminator = Buffer.from(data); wrongDiscriminator[0] ^= 1;
  assert.throws(() => decodeVaultState(wrongDiscriminator, programId), /discriminator/);
  assert.throws(() => decodeVaultState(data.subarray(0, data.length - 1), programId), /exactly/);
  const badBool = Buffer.from(data); badBool[80] = 2;
  assert.throws(() => decodeVaultState(badBool, programId), /active flag/);
  const badTrailing = Buffer.from(data); badTrailing[badTrailing.length - 1] = 1;
  assert.throws(() => decodeVaultState(badTrailing, programId), /trailing/);
});

test('rejects unallowlisted feed identity, duplicate assets and invalid target sums, while allowing a zero target', () => {
  const badFeedData = Buffer.from(makeVault().data);
  badFeedData.fill(0, 98 + 32 + 1 + 2 + 32, 98 + 32 + 1 + 2 + 32 + 32);
  assert.throws(() => decodeVaultState(badFeedData, programId), /asset\/feed/);
  const duplicateData = Buffer.from(makeVault().data);
  const firstAssetOffset = 98;
  const secondAssetOffset = firstAssetOffset + 99;
  duplicateData.set(duplicateData.subarray(firstAssetOffset, firstAssetOffset + 99), secondAssetOffset);
  assert.throws(() => decodeVaultState(duplicateData, programId), /duplicate/);
  assert.throws(() => makeVault(true, [6_000, 3_000]), /sum to 100%/);
  assert.deepEqual(makeVault(true, [10_000, 0]).state.assets.map((asset) => asset.targetBps), [10_000, 0]);
});

test('canonical PDA verification rejects another state address', () => {
  const { state } = makeVault();
  assert.throws(() => deriveExploreVaultAddresses(Keypair.generate().publicKey, state), /not canonical/);
});

test('verifies canonical Metaplex metadata PDA, token mint and update policy', () => {
  const mint = new PublicKey(EXPLORE_ASSETS[0]!.mint);
  const updateAuthority = Keypair.fromSeed(Buffer.alloc(32, 21)).publicKey;
  const address = metadataAddressForMint(mint);
  const decoded = decodeShareMetadata(encodeMetadata(mint, updateAuthority, 'Portfolio One', 'PONE', 'ipfs://bafybeigdyrzt/metadata.json'), new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'), address, mint);
  assert.equal(decoded.name, 'Portfolio One');
  assert.equal(decoded.symbol, 'PONE');
  assert.equal(decoded.updateAuthority, updateAuthority.toBase58());
  assert.equal(decoded.isMutable, true);
  const wrongMint = new PublicKey(EXPLORE_ASSETS[1]!.mint);
  assert.throws(() => decodeShareMetadata(encodeMetadata(wrongMint, updateAuthority, 'Other', 'OTH', 'https://example.com/meta.json'), new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'), address, mint), /mint does not match/);
});

test('resolves IPFS and Arweave URIs and rejects insecure HTTP metadata', () => {
  assert.equal(resolveMetadataUri('ipfs://bafybeigdyrzt/meta.json'), 'https://ipfs.io/ipfs/bafybeigdyrzt/meta.json');
  assert.equal(resolveMetadataUri('ar://abc123/meta.json'), 'https://arweave.net/abc123/meta.json');
  assert.equal(resolveMetadataUri('https://example.com/meta.json'), 'https://example.com/meta.json');
  assert.throws(() => resolveMetadataUri('http://example.com/meta.json'), /HTTPS/);
  assert.throws(() => resolveMetadataUri('ar://\\\\evil.example/meta.json'), /invalid/);
});

test('encodes a deposit against a discovered TUSD vault with a positive reviewed minimum', () => {
  const vault = makeVault();
  const owner = Keypair.fromSeed(Buffer.alloc(32, 12)).publicKey;
  const tx = buildExploreDepositTransaction(owner, vault.state, vault.authority, [0n, 1_250_000n], 3n);
  const instruction = tx.instructions.at(-1)!;
  assert.ok(instruction.programId.equals(programId));
  assert.equal(instruction.keys[0]!.pubkey.toBase58(), vault.address.toBase58());
  assert.equal(instruction.keys[4]!.pubkey.toBase58(), owner.toBase58());
  assert.equal(instruction.keys[7]!.pubkey.toBase58(), getAta(assets[1]!.mint, owner));
  assert.equal(instruction.keys[9]!.pubkey.toBase58(), getAta(assets[1]!.mint, vault.authority));
  assert.equal(instruction.data.readUInt32LE(8), 2);
  assert.equal(instruction.data.readBigUInt64LE(12), 0n);
  assert.equal(instruction.data.readBigUInt64LE(20), 1_250_000n);
  assert.equal(instruction.data.readBigUInt64LE(28), 3n);
  assert.throws(() => buildExploreDepositTransaction(owner, vault.state, vault.authority, [1n, 0n], 0n), /positive/);
  assert.throws(() => buildExploreDepositTransaction(owner, vault.state, Keypair.generate().publicKey, [1n, 0n], 1n), /not canonical/);
  assert.throws(() => buildExploreDepositTransaction(owner, makeVault(false).state, vault.authority, [1n, 0n], 1n), /active/);
});

test('parses and formats exact decimal token amounts without floating-point conversion', () => {
  assert.equal(parseTokenAmount('1.000001', 6), 1_000_001n);
  assert.equal(parseTokenAmount('1.0000001', 6), null);
  assert.equal(parseTokenAmount('-1', 6), null);
  assert.equal(parseTokenAmount('', 6), 0n);
  assert.equal(formatRawAmount('1000001', 6), '1.000001');
  assert.equal(formatRawAmount('1234567890123', 6), '1,234,567.890123');
});

function string(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  const length = Buffer.alloc(4); length.writeUInt32LE(bytes.length);
  return Buffer.concat([length, bytes]);
}
function u64(value: bigint): Buffer { const out = Buffer.alloc(8); out.writeBigUInt64LE(value); return out; }
function hexBytes(value: string): Uint8Array { return Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16)); }
function getAta(mint: string, owner: PublicKey): string { return PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), new PublicKey(mint).toBuffer()], new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'))[0].toBase58(); }
