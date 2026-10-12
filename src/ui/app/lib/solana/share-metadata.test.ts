import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Buffer } from 'buffer';
import { sha256 } from '@noble/hashes/sha2.js';
import { Keypair, PublicKey, SYSVAR_RENT_PUBKEY, SystemProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
  buildCreateShareMetadataInstruction,
  buildShareMetadataDocument,
  buildUpdateShareMetadataInstruction,
  decodeShareSymbolRegistry,
  deriveShareSymbolAssignmentAddress,
  deriveShareSymbolRegistryAddress,
  metadataHttpsUrl,
  shareMetadataDocumentMatches,
  shareSymbolForSequence,
  validateShareMetadataForm,
  verifyShareMetadataUri,
} from './execution.js';
import { metadataAddressForMint } from './explore.js';
import { EXECUTION_PROGRAM_ID } from './config.js';

const program = new PublicKey(EXECUTION_PROGRAM_ID);
const owner = Keypair.fromSeed(Buffer.alloc(32, 18)).publicKey;
const state = Keypair.fromSeed(Buffer.alloc(32, 19)).publicKey;
const [mint] = PublicKey.findProgramAddressSync([Buffer.from('share-mint'), state.toBuffer()], program);
const metadata = metadataAddressForMint(mint);
const authority = PublicKey.findProgramAddressSync([Buffer.from('vault-authority'), state.toBuffer()], program)[0];
const form = { name: 'Balanced', description: 'A balanced demo portfolio.', image: 'ipfs://bafybeigdyrzt/image.png', uri: 'ar://abc123/meta.json' };

test('serializes create_share_metadata discriminator, expected sequence and Borsh strings', () => {
  const ix = buildCreateShareMetadataInstruction(state, owner, 42n, form.name, form.uri);
  assert.ok(ix.programId.equals(program));
  assert.deepEqual([...ix.data.subarray(0, 8)], [...sha256(new TextEncoder().encode('global:create_share_metadata')).slice(0, 8)]);
  assert.equal(ix.data.readBigUInt64LE(8), 42n);
  let offset = 16;
  const readString = () => {
    const size = ix.data.readUInt32LE(offset); offset += 4;
    const result = ix.data.toString('utf8', offset, offset + size); offset += size;
    return result;
  };
  assert.equal(readString(), form.name);
  assert.equal(readString(), form.uri);
  assert.equal(offset, ix.data.length);
  assert.deepEqual(ix.keys.map((key) => key.pubkey.toBase58()), [
    state.toBase58(), authority.toBase58(), mint.toBase58(), metadata.toBase58(),
    deriveShareSymbolRegistryAddress().toBase58(), deriveShareSymbolAssignmentAddress(state).toBase58(),
    owner.toBase58(), new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s').toBase58(),
    SystemProgram.programId.toBase58(), SYSVAR_RENT_PUBKEY.toBase58(),
  ]);
  assert.deepEqual(ix.keys.map(({ isSigner, isWritable }) => [isSigner, isWritable]), [
    [false, false], [false, false], [false, false], [false, true], [false, true], [false, true],
    [true, true], [false, false], [false, false], [false, false],
  ]);
  assert.ok(metadata.equals(PublicKey.findProgramAddressSync([
    Buffer.from('metadata'), new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s').toBuffer(), mint.toBuffer(),
  ], new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'))[0]));
  assert.equal(TOKEN_PROGRAM_ID.toBase58(), 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
});

test('serializes update_share_metadata without a caller-provided symbol', () => {
  const ix = buildUpdateShareMetadataInstruction(state, owner, form.name, form.uri);
  assert.deepEqual([...ix.data.subarray(0, 8)], [...sha256(new TextEncoder().encode('global:update_share_metadata')).slice(0, 8)]);
  let offset = 8;
  const readString = () => {
    const size = ix.data.readUInt32LE(offset); offset += 4;
    const result = ix.data.toString('utf8', offset, offset + size); offset += size;
    return result;
  };
  assert.equal(readString(), form.name);
  assert.equal(readString(), form.uri);
  assert.equal(offset, ix.data.length);
  assert.deepEqual(ix.keys.map((key) => key.pubkey.toBase58()), [
    state.toBase58(), authority.toBase58(), metadata.toBase58(), deriveShareSymbolAssignmentAddress(state).toBase58(),
    owner.toBase58(), new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s').toBase58(),
  ]);
  assert.deepEqual(ix.keys.map(({ isSigner, isWritable }) => [isSigner, isWritable]), [
    [false, false], [false, false], [false, true], [false, false], [true, false], [false, false],
  ]);
});

test('uses fixed-width unique symbols and validates exact Metaplex JSON fields', () => {
  assert.equal(shareSymbolForSequence(1n), 'CB00000001');
  assert.equal(shareSymbolForSequence(99_999_999n), 'CB99999999');
  assert.throws(() => shareSymbolForSequence(0n), /sequence/);
  const symbol = shareSymbolForSequence(42n);
  const document = buildShareMetadataDocument(form, symbol);
  assert.deepEqual(document, { name: form.name, symbol, description: form.description, image: form.image });
  assert.equal(shareMetadataDocumentMatches(document, document), true);
  assert.equal(shareMetadataDocumentMatches({ ...document, image: 'https://wrong.example/image.png' }, document), false);
});

test('decodes the program-owned versioned symbol registry layout', () => {
  const data = Buffer.alloc(17);
  data.set(sha256(new TextEncoder().encode('account:ShareSymbolRegistry')).slice(0, 8));
  data[8] = 1;
  data.writeBigUInt64LE(73n, 9);
  assert.equal(decodeShareSymbolRegistry(data, program), 73n);
  assert.throws(() => decodeShareSymbolRegistry(data, TOKEN_PROGRAM_ID), /owned/);
  const badDiscriminator = Buffer.from(data); badDiscriminator[0] ^= 0x1;
  assert.throws(() => decodeShareSymbolRegistry(badDiscriminator, program), /layout/);
  const badVersion = Buffer.from(data); badVersion[8] = 2;
  assert.throws(() => decodeShareSymbolRegistry(badVersion, program), /version/);
});

test('validates UTF-8 byte limits and only secure HTTPS/IPFS/Arweave URLs', async () => {
  const symbol = 'CB00000001';
  assert.deepEqual(validateShareMetadataForm(form, symbol), []);
  assert.equal(metadataHttpsUrl(form.uri), 'https://arweave.net/abc123/meta.json');
  assert.equal(metadataHttpsUrl(form.image), 'https://ipfs.io/ipfs/bafybeigdyrzt/image.png');
  assert.equal(metadataHttpsUrl('https://cdn.example.org/image.png'), 'https://cdn.example.org/image.png');
  assert.match(validateShareMetadataForm({ ...form, image: 'http://bad.example/image.png' }, symbol).join(' '), /HTTPS/);
  assert.match(validateShareMetadataForm({ ...form, uri: `https://cdn.example/${'a'.repeat(190)}` }, symbol).join(' '), /200 UTF-8 bytes/);
  assert.match(validateShareMetadataForm({ ...form, name: '😀'.repeat(9) }, symbol).join(' '), /32 UTF-8 bytes/);
  await assert.rejects(verifyShareMetadataUri({ ...form, uri: 'http://bad.example/metadata.json' }, symbol), /HTTPS/);
});

test('verification fetches the URI and blocks a JSON mismatch before transaction submission', async () => {
  const originalFetch = globalThis.fetch;
  const symbol = 'CB00000001';
  const expected = { name: form.name, symbol, description: form.description, image: form.image };
  try {
    globalThis.fetch = async () => new Response(JSON.stringify(expected), { status: 200, headers: { 'Content-Type': 'application/json' } });
    await verifyShareMetadataUri(form, symbol);
    globalThis.fetch = async () => new Response(JSON.stringify({ ...expected, symbol: 'CB00000002' }), { status: 200 });
    await assert.rejects(verifyShareMetadataUri(form, symbol), /does not exactly match/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
