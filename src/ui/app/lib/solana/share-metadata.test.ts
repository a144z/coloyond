import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { Buffer } from 'buffer';
import { sha256 } from '@noble/hashes/sha2.js';
import { Keypair, PublicKey, SYSVAR_RENT_PUBKEY, SystemProgram, Transaction, type AccountInfo } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
  buildCreateShareMetadataInstruction,
  buildShareMetadataDocument,
  buildUpdateShareMetadataInstruction,
  createShareTokenMetadata,
  decodeShareSymbolAssignment,
  decodeShareSymbolRegistry,
  deriveVaultAddresses,
  deriveShareSymbolAssignmentAddress,
  deriveShareSymbolRegistryAddress,
  initializeVault,
  metadataHttpsUrl,
  readNextShareSymbolSequence,
  shareMetadataDocumentMatches,
  shareSymbolForSequence,
  updateShareTokenMetadata,
  validateShareMetadataForm,
  verifyShareMetadataUri,
} from './execution.js';
import { metadataAddressForMint } from './explore.js';
import { EXECUTION_PROGRAM_ID } from './config.js';
import { mintOf } from './assets.js';
import { connection } from './connection.js';

const program = new PublicKey(EXECUTION_PROGRAM_ID);
const owner = Keypair.fromSeed(Buffer.alloc(32, 18)).publicKey;
const state = Keypair.fromSeed(Buffer.alloc(32, 19)).publicKey;
const [mint] = PublicKey.findProgramAddressSync([Buffer.from('share-mint'), state.toBuffer()], program);
const metadata = metadataAddressForMint(mint);
const authority = PublicKey.findProgramAddressSync([Buffer.from('vault-authority'), state.toBuffer()], program)[0];
const form = { name: 'Balanced', description: 'A balanced demo portfolio.', image: 'ipfs://bafybeigdyrzt/image.png', uri: 'ar://abc123/meta.json' };
const metadataProgram = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

function makeVaultState(owner: Keypair, id = 91n) {
  const addresses = deriveVaultAddresses(owner.publicKey, id);
  const assetIds = ['wsol', 'dusd'] as const;
  const data = Buffer.alloc(98 + assetIds.length * 99);
  let offset = 8;
  data.writeBigUInt64LE(id, offset); offset += 8;
  data.set(owner.publicKey.toBuffer(), offset); offset += 32;
  data.set(addresses.shareMint.toBuffer(), offset); offset += 32;
  data[offset++] = 1;
  data.writeUInt16LE(200, offset); offset += 2;
  data.writeUInt16LE(100, offset); offset += 2;
  data[offset++] = PublicKey.findProgramAddressSync([Buffer.from('vault-authority'), addresses.state.toBuffer()], program)[1];
  data.writeBigUInt64LE(0n, offset); offset += 8;
  data.writeUInt32LE(assetIds.length, offset); offset += 4;
  for (const assetId of assetIds) {
    const mint = mintOf(assetId);
    data.set(mint.toBuffer(), offset); offset += 32;
    data[offset++] = assetId === 'wsol' ? 9 : 6;
    data.writeUInt16LE(assetId === 'wsol' ? 6_000 : 4_000, offset); offset += 2;
    data.set(PublicKey.default.toBuffer(), offset); offset += 32;
    offset += 32;
  }
  return { addresses, data };
}

function accountInfo(owner: PublicKey, data: Buffer): AccountInfo<Buffer> {
  return { data, executable: false, lamports: 1, owner, rentEpoch: 0 };
}

function encodeMetadata(mint: PublicKey, updateAuthority: PublicKey, name: string, symbol: string, uri: string, mutable = true): Buffer {
  return Buffer.concat([
    Buffer.from([4]), updateAuthority.toBuffer(), mint.toBuffer(), string(name), string(symbol), string(uri),
    Buffer.from([0, 0, 0, 0, mutable ? 1 : 0]),
  ]);
}

function string(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  const length = Buffer.alloc(4); length.writeUInt32LE(bytes.length);
  return Buffer.concat([length, bytes]);
}

function registryData(sequence: bigint): Buffer {
  const data = Buffer.alloc(17);
  data.set(sha256(new TextEncoder().encode('account:ShareSymbolRegistry')).slice(0, 8));
  data[8] = 1;
  data.writeBigUInt64LE(sequence, 9);
  return data;
}

function assignmentData(stateAddress: PublicKey, sequence: bigint): Buffer {
  const data = Buffer.alloc(49);
  data.set(sha256(new TextEncoder().encode('account:ShareSymbolAssignment')).slice(0, 8));
  data[8] = 1;
  data.set(stateAddress.toBuffer(), 9);
  data.writeBigUInt64LE(sequence, 41);
  return data;
}

function installTransactionRpc(): { sent: () => Buffer | null } {
  let sent: Buffer | null = null;
  mock.method(connection, 'getLatestBlockhash', async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 99 }));
  mock.method(connection, 'sendRawTransaction', async (raw: Uint8Array) => { sent = Buffer.from(raw); return 'mock-signature'; });
  mock.method(connection, 'confirmTransaction', async () => ({ context: { slot: 456 }, value: { err: null } }));
  return { sent: () => sent };
}

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
  assert.throws(() => decodeShareSymbolRegistry(data.subarray(0, 16), program), /layout/);
  assert.throws(() => decodeShareSymbolRegistry(Buffer.concat([data, Buffer.from([0])]), program), /layout/);
  const exhausted = Buffer.from(data); exhausted.writeBigUInt64LE(100_000_000n, 9);
  assert.throws(() => decodeShareSymbolRegistry(exhausted, program), /exhausted/);
});

test('validates share-symbol assignments against their owner, version, vault, and sequence', () => {
  const data = assignmentData(state, 73n);
  assert.equal(decodeShareSymbolAssignment(data, program, state), 73n);
  assert.throws(() => decodeShareSymbolAssignment(data, TOKEN_PROGRAM_ID, state), /owned/);
  assert.throws(() => decodeShareSymbolAssignment(data.subarray(1), program, state), /layout/);
  const badVersion = Buffer.from(data); badVersion[8] = 2;
  assert.throws(() => decodeShareSymbolAssignment(badVersion, program, state), /version/);
  assert.throws(() => decodeShareSymbolAssignment(data, program, Keypair.generate().publicKey), /different vault/);
  const invalidSequence = Buffer.from(data); invalidSequence.writeBigUInt64LE(0n, 41);
  assert.throws(() => decodeShareSymbolAssignment(invalidSequence, program, state), /sequence/);
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
  assert.deepEqual(validateShareMetadataForm({ ...form, name: '😀'.repeat(8) }, symbol), []);
  assert.deepEqual(validateShareMetadataForm({ ...form, uri: `https://x.io/${'a'.repeat(187)}` }, symbol), []);
  assert.match(validateShareMetadataForm({ ...form, uri: ` ${form.uri}` }, symbol).join(' '), /whitespace/);
  assert.match(validateShareMetadataForm({ ...form, image: `${form.image} ` }, symbol).join(' '), /whitespace/);
  assert.match(validateShareMetadataForm(form, 'CB00000000').join(' '), /symbol is invalid/);
  assert.match(validateShareMetadataForm(form, 'OTHER00001').join(' '), /symbol is invalid/);
  assert.match(validateShareMetadataForm({ ...form, description: '  ' }, symbol).join(' '), /Description is required/);
  assert.match(validateShareMetadataForm({ ...form, name: ` ${form.name}` }, symbol).join(' '), /leading or trailing whitespace/);
  assert.match(validateShareMetadataForm({ ...form, description: 'x'.repeat(512 * 1024) }, symbol).join(' '), /JSON must be at most 512 KB/);
  assert.throws(() => metadataHttpsUrl('https://user:secret@example.com/image.png'), /HTTPS/);
  assert.throws(() => metadataHttpsUrl('https://example.com/image.png\n'), /whitespace/);
  assert.throws(() => metadataHttpsUrl('ipfs://\\cid/image.png'), /invalid/);
  assert.throws(() => metadataHttpsUrl('ar://\\host/image.png'), /invalid/);
  await assert.rejects(verifyShareMetadataUri({ ...form, uri: 'http://bad.example/metadata.json' }, symbol), /HTTPS/);
});

test('verification fetches the URI and blocks a JSON mismatch before transaction submission', async () => {
  const originalFetch = globalThis.fetch;
  const symbol = 'CB00000001';
  const expected = { name: form.name, symbol, description: form.description, image: form.image };
  try {
    let request: RequestInit | undefined;
    globalThis.fetch = async (_input, init) => {
      request = init;
      return new Response(JSON.stringify(expected), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    await verifyShareMetadataUri(form, symbol);
    assert.equal(request?.credentials, 'omit');
    assert.equal(request?.redirect, 'follow');
    assert.equal(request?.cache, 'no-store');
    assert.equal(request?.headers && (request.headers as Record<string, string>).Accept, 'application/json');
    for (const field of ['name', 'symbol', 'description', 'image'] as const) {
      globalThis.fetch = async () => new Response(JSON.stringify({ ...expected, [field]: `${expected[field]}-wrong` }), { status: 200 });
      await assert.rejects(verifyShareMetadataUri(form, symbol), /does not exactly match/);
    }
    globalThis.fetch = async () => new Response('not JSON', { status: 200 });
    await assert.rejects(verifyShareMetadataUri(form, symbol), /valid JSON/);
    globalThis.fetch = async () => new Response(JSON.stringify([]), { status: 200 });
    await assert.rejects(verifyShareMetadataUri(form, symbol), /object/);
    globalThis.fetch = async () => new Response(JSON.stringify({ name: 1, symbol, description: form.description, image: form.image }), { status: 200 });
    await assert.rejects(verifyShareMetadataUri(form, symbol), /string name, symbol/);
    globalThis.fetch = async () => new Response('unavailable', { status: 503 });
    await assert.rejects(verifyShareMetadataUri(form, symbol), /HTTP 503/);
    globalThis.fetch = async () => new Response('x'.repeat(512 * 1024 + 1), { status: 200 });
    await assert.rejects(verifyShareMetadataUri(form, symbol), /512 KB/);
    globalThis.fetch = async () => new Response(JSON.stringify(expected), { status: 200, headers: { 'content-length': String(512 * 1024 + 1) } });
    await assert.rejects(verifyShareMetadataUri(form, symbol), /512 KB/);
    globalThis.fetch = async () => new Response(Uint8Array.of(0xff), { status: 200 });
    await assert.rejects(verifyShareMetadataUri(form, symbol), /valid UTF-8/);
    globalThis.fetch = async () => {
      const response = new Response(JSON.stringify(expected), { status: 200 });
      Object.defineProperty(response, 'url', { value: 'http://insecure.example/metadata.json' });
      return response;
    };
    await assert.rejects(verifyShareMetadataUri(form, symbol), /credential-free HTTPS/);
    globalThis.fetch = async () => new Response(JSON.stringify({ ...expected, image: 'http://bad.example/image.png' }), { status: 200 });
    await assert.rejects(verifyShareMetadataUri({ ...form, image: 'http://bad.example/image.png' }, symbol), /HTTPS/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('reads an absent registry as sequence one and rejects malformed registry data', async () => {
  const originalGetAccountInfo = connection.getAccountInfo;
  try {
    connection.getAccountInfo = async () => null as never;
    assert.equal(await readNextShareSymbolSequence(), 1n);
    const invalid = accountInfo(TOKEN_PROGRAM_ID, registryData(1n));
    connection.getAccountInfo = async () => invalid as never;
    await assert.rejects(readNextShareSymbolSequence(), /unexpected program/);
  } finally {
    connection.getAccountInfo = originalGetAccountInfo;
  }
});

test('initializes Vault State and Metaplex metadata in one transaction after fresh URI verification', async () => {
  const payer = Keypair.fromSeed(Buffer.alloc(32, 31));
  const expected = { name: form.name, symbol: 'CB00000001', description: form.description, image: form.image };
  const sent = installTransactionRpc();
  const originalGetAccountInfo = connection.getAccountInfo;
  const originalFetch = globalThis.fetch;
  try {
    connection.getAccountInfo = async () => null as never; // first-use registry is sequence one
    globalThis.fetch = async () => new Response(JSON.stringify(expected), { status: 200 });
    const { addresses, result } = await initializeVault(
      payer,
      9_100n,
      ['wsol', 'dusd'],
      { wsol: 60, dusd: 40 },
      2,
      { ...form, expectedSequence: 1n },
    );
    assert.equal(result.sig, 'mock-signature');
    assert.equal(result.slot, 456);
    assert.equal(addresses.state.toBase58(), deriveVaultAddresses(payer.publicKey, 9_100n).state.toBase58());
    const raw = sent.sent();
    assert.ok(raw);
    const transaction = Transaction.from(raw!);
    assert.equal(transaction.instructions.length, 2);
    assert.equal(transaction.instructions[0]!.keys[0]!.pubkey.toBase58(), addresses.state.toBase58());
    assert.equal(transaction.instructions[1]!.keys[0]!.pubkey.toBase58(), addresses.state.toBase58());
    assert.equal(transaction.instructions[1]!.data.readBigUInt64LE(8), 1n);
  } finally {
    connection.getAccountInfo = originalGetAccountInfo;
    globalThis.fetch = originalFetch;
    mock.restoreAll();
  }
});

test('recovers an already-confirmed atomic initialization without resending or losing backfill state', async () => {
  const payer = Keypair.fromSeed(Buffer.alloc(32, 37));
  const { addresses, data } = makeVaultState(payer, 9_104n);
  const metadataAddress = metadataAddressForMint(addresses.shareMint);
  const assignmentAddress = deriveShareSymbolAssignmentAddress(addresses.state);
  const accounts = new Map<string, AccountInfo<Buffer> | null>([
    [addresses.state.toBase58(), accountInfo(program, data)],
  ]);
  const originalGetAccountInfo = connection.getAccountInfo;
  const originalFetch = globalThis.fetch;
  try {
    connection.getAccountInfo = async (address: PublicKey) => accounts.get(address.toBase58()) ?? null as never;
    globalThis.fetch = async () => { throw new Error('An already-committed transaction must not require an upload refetch.'); };
    const input = {
      assets: ['wsol', 'dusd'] as const,
      targets: { wsol: 60, dusd: 40 },
      thresholdPct: 2,
      metadata: { ...form, expectedSequence: 1n },
    };
    const metadataMissing = await initializeVault(payer, 9_104n, [...input.assets], input.targets, input.thresholdPct, input.metadata);
    assert.equal(metadataMissing.result.sig, '');
    assert.equal(metadataMissing.metadataAttached, false);

    accounts.set(metadataAddress.toBase58(), accountInfo(metadataProgram, encodeMetadata(addresses.shareMint, addresses.authority, form.name, 'CB00000001', form.uri)));
    accounts.set(assignmentAddress.toBase58(), accountInfo(program, assignmentData(addresses.state, 1n)));
    const complete = await initializeVault(payer, 9_104n, [...input.assets], input.targets, input.thresholdPct, input.metadata);
    assert.equal(complete.result.sig, '');
    assert.equal(complete.metadataAttached, true);

    await assert.rejects(initializeVault(payer, 9_104n, [...input.assets], { wsol: 50, dusd: 50 }, input.thresholdPct, input.metadata), /configuration differs/);
  } finally {
    connection.getAccountInfo = originalGetAccountInfo;
    globalThis.fetch = originalFetch;
    mock.restoreAll();
  }
});

test('stale symbol sequences and rejected metadata transactions never report success', async () => {
  const payer = Keypair.fromSeed(Buffer.alloc(32, 32));
  const originalGetAccountInfo = connection.getAccountInfo;
  const originalFetch = globalThis.fetch;
  const registry = accountInfo(program, registryData(2n));
  const stateAddress = deriveVaultAddresses(payer.publicKey, 9_101n).state;
  const registryAddress = deriveShareSymbolRegistryAddress();
  try {
    connection.getAccountInfo = async (address) => address.equals(stateAddress)
      ? null as never
      : address.equals(registryAddress) ? registry as never : null as never;
    globalThis.fetch = async () => { throw new Error('fetch must not happen for stale sequence'); };
    await assert.rejects(initializeVault(payer, 9_101n, ['wsol', 'dusd'], { wsol: 60, dusd: 40 }, 2, {
      ...form, expectedSequence: 1n,
    }), /changed to CB00000002/);
  } finally {
    connection.getAccountInfo = originalGetAccountInfo;
    globalThis.fetch = originalFetch;
    mock.restoreAll();
  }
});

test('maps an on-chain symbol compare-and-swap race to an actionable retry error', async () => {
  const payer = Keypair.fromSeed(Buffer.alloc(32, 35));
  const originalGetAccountInfo = connection.getAccountInfo;
  const originalFetch = globalThis.fetch;
  try {
    connection.getAccountInfo = async () => null as never;
    globalThis.fetch = async () => new Response(JSON.stringify({ ...form, symbol: 'CB00000001' }), { status: 200 });
    mock.method(connection, 'getLatestBlockhash', async () => ({ blockhash: payer.publicKey.toBase58(), lastValidBlockHeight: 99 }));
    mock.method(connection, 'sendRawTransaction', async () => { throw new Error('custom program error: 0x177b'); });
    await assert.rejects(initializeVault(payer, 9_102n, ['wsol', 'dusd'], { wsol: 60, dusd: 40 }, 2, {
      ...form, expectedSequence: 1n,
    }), /regenerate and re-upload the JSON/i);
  } finally {
    connection.getAccountInfo = originalGetAccountInfo;
    globalThis.fetch = originalFetch;
    mock.restoreAll();
  }
});

test('rejects metadata initialization before sending when uploaded JSON differs from the current symbol', async () => {
  const payer = Keypair.fromSeed(Buffer.alloc(32, 36));
  const sent = installTransactionRpc();
  const originalGetAccountInfo = connection.getAccountInfo;
  const originalFetch = globalThis.fetch;
  try {
    connection.getAccountInfo = async () => null as never;
    globalThis.fetch = async () => new Response(JSON.stringify({ ...form, symbol: 'CB00000002' }), { status: 200 });
    await assert.rejects(initializeVault(payer, 9_103n, ['wsol', 'dusd'], { wsol: 60, dusd: 40 }, 2, {
      ...form, expectedSequence: 1n,
    }), /does not exactly match/);
    assert.equal(sent.sent(), null);
  } finally {
    connection.getAccountInfo = originalGetAccountInfo;
    globalThis.fetch = originalFetch;
    mock.restoreAll();
  }
});

test('creates metadata only for the on-chain vault owner and safely resumes an already-created token', async () => {
  const payer = Keypair.fromSeed(Buffer.alloc(32, 33));
  const { addresses, data } = makeVaultState(payer);
  const accounts = new Map<string, AccountInfo<Buffer> | null>([[addresses.state.toBase58(), accountInfo(program, data)]]);
  const originalGetAccountInfo = connection.getAccountInfo;
  const originalFetch = globalThis.fetch;
  const expected = { name: form.name, symbol: 'CB00000001', description: form.description, image: form.image };
  try {
    connection.getAccountInfo = async (address: PublicKey) => accounts.get(address.toBase58()) ?? null as never;
    globalThis.fetch = async () => new Response(JSON.stringify(expected), { status: 200 });
    const sent = installTransactionRpc();
    const txResult = await createShareTokenMetadata(payer, addresses.state, 1n, form);
    assert.equal(txResult?.sig, 'mock-signature');
    const transaction = Transaction.from(sent.sent()!);
    assert.equal(transaction.instructions.length, 1);
    assert.ok(transaction.instructions[0]!.programId.equals(program));

    const mintMetadata = metadataAddressForMint(addresses.shareMint);
    accounts.set(mintMetadata.toBase58(), accountInfo(metadataProgram, encodeMetadata(addresses.shareMint, addresses.authority, form.name, 'CB00000001', form.uri)));
    accounts.set(deriveShareSymbolAssignmentAddress(addresses.state).toBase58(), accountInfo(program, assignmentData(addresses.state, 1n)));
    assert.equal(await createShareTokenMetadata(payer, addresses.state, 1n, form), null);
    accounts.set(mintMetadata.toBase58(), accountInfo(metadataProgram, encodeMetadata(addresses.shareMint, Keypair.generate().publicKey, form.name, 'CB00000001', form.uri)));
    await assert.rejects(createShareTokenMetadata(payer, addresses.state, 1n, form), /not mutable by this vault/);
    accounts.set(mintMetadata.toBase58(), accountInfo(metadataProgram, encodeMetadata(addresses.shareMint, addresses.authority, form.name, 'CB00000001', form.uri, false)));
    await assert.rejects(createShareTokenMetadata(payer, addresses.state, 1n, form), /not mutable by this vault/);
    accounts.set(mintMetadata.toBase58(), accountInfo(metadataProgram, encodeMetadata(addresses.shareMint, addresses.authority, 'Different', 'CB00000001', form.uri)));
    await assert.rejects(createShareTokenMetadata(payer, addresses.state, 1n, form), /Use the update action/);
    accounts.set(mintMetadata.toBase58(), accountInfo(metadataProgram, encodeMetadata(addresses.shareMint, addresses.authority, form.name, 'CB00000001', form.uri)));
    accounts.delete(deriveShareSymbolAssignmentAddress(addresses.state).toBase58());
    await assert.rejects(createShareTokenMetadata(payer, addresses.state, 1n, form), /assignment/);
    accounts.set(deriveShareSymbolAssignmentAddress(addresses.state).toBase58(), accountInfo(program, assignmentData(Keypair.generate().publicKey, 1n)));
    await assert.rejects(createShareTokenMetadata(payer, addresses.state, 1n, form), /different vault/);
    accounts.set(deriveShareSymbolAssignmentAddress(addresses.state).toBase58(), accountInfo(program, assignmentData(addresses.state, 2n)));
    await assert.rejects(createShareTokenMetadata(payer, addresses.state, 1n, form), /different share symbol sequence/);
    await assert.rejects(createShareTokenMetadata(Keypair.generate(), addresses.state, 1n, form), /Only the on-chain vault owner/);
  } finally {
    connection.getAccountInfo = originalGetAccountInfo;
    globalThis.fetch = originalFetch;
    mock.restoreAll();
  }
});

test('updates metadata only when the vault PDA and fixed symbol assignment agree', async () => {
  const payer = Keypair.fromSeed(Buffer.alloc(32, 34));
  const { addresses, data } = makeVaultState(payer);
  const mintMetadata = metadataAddressForMint(addresses.shareMint);
  const assignmentAddress = deriveShareSymbolAssignmentAddress(addresses.state);
  const accounts = new Map<string, AccountInfo<Buffer> | null>([
    [addresses.state.toBase58(), accountInfo(program, data)],
    [mintMetadata.toBase58(), accountInfo(metadataProgram, encodeMetadata(addresses.shareMint, addresses.authority, form.name, 'CB00000001', form.uri))],
    [assignmentAddress.toBase58(), accountInfo(program, assignmentData(addresses.state, 1n))],
  ]);
  const originalGetAccountInfo = connection.getAccountInfo;
  const originalFetch = globalThis.fetch;
  const updated = { ...form, name: 'Balanced Mix', uri: 'ar://abc123/updated.json' };
  try {
    connection.getAccountInfo = async (address: PublicKey) => accounts.get(address.toBase58()) ?? null as never;
    globalThis.fetch = async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/updated.json')) {
        return new Response(JSON.stringify({ ...updated, symbol: 'CB00000001' }), { status: 200 });
      }
      return new Response(JSON.stringify({ ...form, symbol: 'CB00000001' }), { status: 200 });
    };
    const sent = installTransactionRpc();
    const result = await updateShareTokenMetadata(payer, addresses.state, updated);
    assert.equal(result.sig, 'mock-signature');
    const transaction = Transaction.from(sent.sent()!);
    const updateIx = transaction.instructions[0]!;
    assert.equal(updateIx.data.subarray(8).includes(Buffer.from('CB00000001')), false); // symbol is derived from the assignment, never caller supplied.

    accounts.set(assignmentAddress.toBase58(), accountInfo(program, assignmentData(Keypair.generate().publicKey, 1n)));
    await assert.rejects(updateShareTokenMetadata(payer, addresses.state, updated), /different vault/);
    accounts.set(assignmentAddress.toBase58(), accountInfo(program, assignmentData(addresses.state, 1n)));
    accounts.set(mintMetadata.toBase58(), accountInfo(metadataProgram, encodeMetadata(addresses.shareMint, addresses.authority, form.name, 'CB00000001', form.uri, false)));
    await assert.rejects(updateShareTokenMetadata(payer, addresses.state, updated), /not mutable/);
    await assert.rejects(updateShareTokenMetadata(Keypair.generate(), addresses.state, updated), /Only the on-chain vault owner/);
  } finally {
    connection.getAccountInfo = originalGetAccountInfo;
    globalThis.fetch = originalFetch;
    mock.restoreAll();
  }
});
