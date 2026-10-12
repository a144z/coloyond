import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { Buffer } from 'buffer';
import { sha256 } from '@noble/hashes/sha2.js';
import { base58 } from '@scure/base';
import { Keypair, PublicKey, Transaction, type Connection, type AccountInfo } from '@solana/web3.js';
import {
  EXPLORE_ASSETS,
  buildExploreDepositTransaction,
  decodeShareMetadata,
  decodeVaultState,
  discoverExploreVaults,
  deriveExploreVaultAddresses,
  formatRawAmount,
  investInExploreVault,
  metadataAddressForMint,
  parseTokenAmount,
  resolveMetadataUri,
} from './explore.js';
import { EXECUTION_PROGRAM_ID } from './config.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { connection } from './connection.js';

const programId = new PublicKey(EXECUTION_PROGRAM_ID);
const creator = Keypair.fromSeed(Buffer.alloc(32, 17)).publicKey;
const assets = [EXPLORE_ASSETS[0]!, EXPLORE_ASSETS[1]!];

function makeVault(active = true, targetBps = [6_000, 4_000]) {
  return makeVaultConfigured({ active, targetBps });
}

function makeVaultConfigured(options: {
  id?: bigint;
  owner?: PublicKey;
  active?: boolean;
  selectedAssets?: (typeof EXPLORE_ASSETS)[number][];
  targetBps?: number[];
} = {}) {
  const { id = 7n, owner = creator, active = true, selectedAssets = assets } = options;
  let targetBps = options.targetBps;
  if (!targetBps) {
    targetBps = selectedAssets.map((_, index) => index === 0 ? (selectedAssets.length === 1 ? 10_000 : 6_000) : Math.floor(4_000 / (selectedAssets.length - 1)));
    targetBps[targetBps.length - 1] += 10_000 - targetBps.reduce((sum, target) => sum + target, 0);
  }
  const [address] = PublicKey.findProgramAddressSync([Buffer.from('vault'), owner.toBuffer(), u64(id)], programId);
  const [authority, authorityBump] = PublicKey.findProgramAddressSync([Buffer.from('vault-authority'), address.toBuffer()], programId);
  const [shareMint] = PublicKey.findProgramAddressSync([Buffer.from('share-mint'), address.toBuffer()], programId);
  const data = Buffer.alloc(494);
  data.set(sha256(new TextEncoder().encode('account:VaultState')).slice(0, 8), 0);
  let offset = 8;
  data.writeBigUInt64LE(id, offset); offset += 8;
  data.set(owner.toBuffer(), offset); offset += 32;
  data.set(shareMint.toBuffer(), offset); offset += 32;
  data.writeUInt8(active ? 1 : 0, offset++);
  data.writeUInt16LE(200, offset); offset += 2;
  data.writeUInt16LE(100, offset); offset += 2;
  data.writeUInt8(authorityBump, offset++);
  data.writeBigUInt64LE(3n, offset); offset += 8;
  data.writeUInt32LE(selectedAssets.length, offset); offset += 4;
  for (let i = 0; i < selectedAssets.length; i += 1) {
    const asset = selectedAssets[i]!;
    data.set(new PublicKey(asset.mint).toBuffer(), offset); offset += 32;
    data.writeUInt8(asset.decimals, offset++);
    data.writeUInt16LE(targetBps[i]!, offset); offset += 2;
    data.set(new PublicKey(asset.feedAccount).toBuffer(), offset); offset += 32;
    data.set(hexBytes(asset.feedId), offset); offset += 32;
  }
  const state = decodeVaultState(data, programId);
  return { address, owner, authority, shareMint: state.shareMint, data, state };
}

function encodeMetadata(mint: PublicKey, updateAuthority: PublicKey, name: string, symbol: string, uri: string): Buffer {
  return Buffer.concat([
    Buffer.from([4]), updateAuthority.toBuffer(), mint.toBuffer(), string(name), string(symbol), string(uri),
    Buffer.from([0, 0, 0, 0, 1]), // no seller fee, no creators, no primary sale, mutable
  ]);
}

function encodeMetadataWithCreators(mint: PublicKey, updateAuthority: PublicKey, count: number, verified = 1, share = 100): Buffer {
  const entries = count === 1 ? [Keypair.generate().publicKey.toBuffer(), Buffer.from([verified, share])] : [];
  const countBuffer = Buffer.alloc(4); countBuffer.writeUInt32LE(count);
  return Buffer.concat([
    Buffer.from([4]), updateAuthority.toBuffer(), mint.toBuffer(), string('Name'), string('SYM'), string('ipfs://cid'),
    Buffer.from([0, 0, 1]), countBuffer, ...entries, Buffer.from([0, 1]),
  ]);
}

function tokenMintAccount(authority: PublicKey | null, decimals: number, supply = 0n, freezeAuthority: PublicKey | null = null, initialized = true): AccountInfo<Buffer> {
  const data = Buffer.alloc(82);
  if (authority) { data.writeUInt32LE(1, 0); data.set(authority.toBuffer(), 4); }
  data.writeBigUInt64LE(supply, 36);
  data[44] = decimals;
  data[45] = initialized ? 1 : 0;
  if (freezeAuthority) { data.writeUInt32LE(1, 46); data.set(freezeAuthority.toBuffer(), 50); }
  return accountInfo(TOKEN_PROGRAM_ID, data);
}

function tokenAccount(mint: PublicKey, authority: PublicKey, amount = 0n, options: { delegate?: PublicKey; frozen?: boolean } = {}): AccountInfo<Buffer> {
  const data = Buffer.alloc(165);
  data.set(mint.toBuffer(), 0);
  data.set(authority.toBuffer(), 32);
  data.writeBigUInt64LE(amount, 64);
  if (options.delegate) { data.writeUInt32LE(1, 72); data.set(options.delegate.toBuffer(), 76); }
  data[108] = options.frozen ? 2 : 1;
  return accountInfo(TOKEN_PROGRAM_ID, data);
}

function accountInfo(owner: PublicKey, data: Buffer): AccountInfo<Buffer> {
  return { data, executable: false, lamports: 1, owner, rentEpoch: 0 };
}

function discoveryAccounts(vaults: ReturnType<typeof makeVaultConfigured>[], amounts: bigint[] = []): Map<string, AccountInfo<Buffer>> {
  const result = new Map<string, AccountInfo<Buffer>>();
  for (const [vaultIndex, vault] of vaults.entries()) {
    result.set(vault.shareMint.toBase58(), tokenMintAccount(vault.authority, 9, 100_000n));
    for (const [assetIndex, asset] of vault.state.assets.entries()) {
      const assetMint = asset.mint;
      const spec = EXPLORE_ASSETS.find((candidate) => candidate.mint === assetMint.toBase58())!;
      result.set(assetMint.toBase58(), tokenMintAccount(null, spec.decimals));
      const custody = getAta(assetMint.toBase58(), vault.authority);
      result.set(custody, tokenAccount(assetMint, vault.authority, amounts[vaultIndex * vault.state.assets.length + assetIndex] ?? 0n));
    }
  }
  return result;
}

function fakeRpc(
  vaults: { address: PublicKey; data: Buffer; owner?: PublicKey }[],
  accounts = new Map<string, AccountInfo<Buffer>>(),
  onProgramRequest?: (program: PublicKey, config: unknown) => void,
): Connection {
  return {
    getProgramAccounts: async (program: PublicKey, config: unknown) => {
      onProgramRequest?.(program, config);
      return vaults.map(({ address, data, owner = programId }) => ({ pubkey: address, account: accountInfo(owner, data) }));
    },
    getMultipleAccountsInfo: async (addresses: PublicKey[]) => addresses.map((address) => accounts.get(address.toBase58()) ?? null),
    getAccountInfo: async (address: PublicKey) => {
      const vault = vaults.find((candidate) => candidate.address.equals(address));
      return vault ? accountInfo(vault.owner ?? programId, vault.data) : null;
    },
    getSlot: async () => 123,
  } as unknown as Connection;
}

function jsonResponse(value: unknown, url = 'https://ipfs.io/ipfs/example/metadata.json', status = 200): Response {
  const response = new Response(typeof value === 'string' ? value : JSON.stringify(value), { status });
  Object.defineProperty(response, 'url', { value: url });
  return response;
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
  const badRisk = Buffer.from(data); badRisk.writeUInt16LE(1_001, 81);
  assert.throws(() => decodeVaultState(badRisk, programId), /risk bounds/);
  const badSlippage = Buffer.from(data); badSlippage.writeUInt16LE(501, 83);
  assert.throws(() => decodeVaultState(badSlippage, programId), /risk bounds/);
  const badAssetCount = Buffer.from(data); badAssetCount.writeUInt32LE(5, 94);
  assert.throws(() => decodeVaultState(badAssetCount, programId), /asset vector/);
  const badZeroAssets = Buffer.from(data); badZeroAssets.writeUInt32LE(0, 94);
  assert.throws(() => decodeVaultState(badZeroAssets, programId), /asset vector/);
  const badCreator = Buffer.from(data); badCreator.fill(0, 16, 48);
  assert.throws(() => decodeVaultState(badCreator, programId), /creator is invalid/);
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
  assert.equal(makeVaultConfigured({ selectedAssets: [EXPLORE_ASSETS[0]!] }).state.assets[0]!.targetBps, 10_000);
  assert.equal(makeVaultConfigured({ selectedAssets: EXPLORE_ASSETS.slice(0, 4) }).state.assets.length, 4);
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
  assert.throws(() => decodeShareMetadata(encodeMetadata(mint, updateAuthority, 'x'.repeat(33), 'PONE', 'ipfs://cid'), new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'), address, mint), /too long/);
  assert.throws(() => decodeShareMetadata(encodeMetadata(mint, updateAuthority, 'Name', 'SYMBOLISLONG', 'ipfs://cid'), new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'), address, mint), /too long/);
  assert.throws(() => decodeShareMetadata(encodeMetadata(mint, updateAuthority, 'Name', 'SYM', `https://example.com/${'x'.repeat(190)}`), new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'), address, mint), /too long/);
  assert.throws(() => decodeShareMetadata(encodeMetadata(mint, updateAuthority, 'Name', 'SYM', 'ipfs://cid'), TOKEN_PROGRAM_ID, address, mint), /owner/);
  assert.throws(() => decodeShareMetadata(encodeMetadata(mint, updateAuthority, 'Name', 'SYM', 'ipfs://cid'), new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'), Keypair.generate().publicKey, mint), /canonical/);
  const badMutable = encodeMetadata(mint, updateAuthority, 'Name', 'SYM', 'ipfs://cid'); badMutable[badMutable.length - 1] = 2;
  assert.throws(() => decodeShareMetadata(badMutable, new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'), address, mint), /mutability/);
  const badCreatorOption = encodeMetadata(mint, updateAuthority, 'Name', 'SYM', 'ipfs://cid'); badCreatorOption[badCreatorOption.length - 3] = 2;
  assert.throws(() => decodeShareMetadata(badCreatorOption, new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'), address, mint), /option tag/);
  const badPrimarySale = encodeMetadata(mint, updateAuthority, 'Name', 'SYM', 'ipfs://cid'); badPrimarySale[badPrimarySale.length - 2] = 2;
  assert.throws(() => decodeShareMetadata(badPrimarySale, new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'), address, mint), /sale flag/);
  const badFee = encodeMetadata(mint, updateAuthority, 'Name', 'SYM', 'ipfs://cid'); badFee.writeUInt16LE(10_001, badFee.length - 5);
  assert.throws(() => decodeShareMetadata(badFee, new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'), address, mint), /seller fee/);
  const badUtf8 = encodeMetadata(mint, updateAuthority, 'Name', 'SYM', 'ipfs://cid'); badUtf8[69] = 0xff;
  assert.throws(() => decodeShareMetadata(badUtf8, new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'), address, mint), /valid UTF-8/);
  const creatorMetadata = decodeShareMetadata(encodeMetadataWithCreators(mint, updateAuthority, 1), new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'), address, mint);
  assert.equal(creatorMetadata.symbol, 'SYM');
  assert.throws(() => decodeShareMetadata(encodeMetadataWithCreators(mint, updateAuthority, 101), new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'), address, mint), /creator list is too large/);
  assert.throws(() => decodeShareMetadata(encodeMetadataWithCreators(mint, updateAuthority, 1, 2, 100), new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'), address, mint), /creator flags/);
  assert.throws(() => decodeShareMetadata(encodeMetadata(mint, updateAuthority, 'Name', 'SYM', 'ipfs://cid').subarray(0, 30), new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'), address, mint), /truncated/);
});

test('resolves IPFS and Arweave URIs and rejects insecure HTTP metadata', () => {
  assert.equal(resolveMetadataUri('ipfs://bafybeigdyrzt/meta.json'), 'https://ipfs.io/ipfs/bafybeigdyrzt/meta.json');
  assert.equal(resolveMetadataUri('ar://abc123/meta.json'), 'https://arweave.net/abc123/meta.json');
  assert.equal(resolveMetadataUri('https://example.com/meta.json'), 'https://example.com/meta.json');
  assert.throws(() => resolveMetadataUri('http://example.com/meta.json'), /HTTPS/);
  assert.throws(() => resolveMetadataUri('ar://\\\\evil.example/meta.json'), /invalid/);
  assert.throws(() => resolveMetadataUri('ipfs://'), /invalid/);
  assert.throws(() => resolveMetadataUri('ipfs:///cid/meta.json'), /invalid/);
  assert.throws(() => resolveMetadataUri('https://user:secret@example.com/meta.json'), /HTTPS/);
  assert.throws(() => resolveMetadataUri('javascript:alert(1)'), /HTTPS/);
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
  assert.equal(parseTokenAmount('0.000000001', 9), 1n);
  assert.equal(parseTokenAmount('1.', 0), 1n);
  assert.equal(parseTokenAmount('1.1', 0), null);
  assert.equal(parseTokenAmount('1', -1), null);
  assert.equal(parseTokenAmount('1', 256), null);
  assert.throws(() => formatRawAmount('-1', 6), /negative/);
  assert.throws(() => formatRawAmount('1', -1), /decimals/);
  assert.throws(() => formatRawAmount('1', 6, -1), /fraction/);
});

test('discovers active canonical vaults from program state and reports missing metadata without hiding holdings', async () => {
  const valid = makeVaultConfigured({ id: 70n });
  const inactive = makeVaultConfigured({ id: 71n, active: false });
  const malformed = makeVaultConfigured({ id: 72n });
  malformed.data[0] ^= 0x01;
  const wrongOwner = makeVaultConfigured({ id: 79n });
  const liveAccounts = discoveryAccounts([valid]);
  let programFilter: unknown;
  const result = await discoverExploreVaults(fakeRpc([
    { address: valid.address, data: valid.data },
    { address: inactive.address, data: inactive.data },
    { address: malformed.address, data: malformed.data },
    { address: wrongOwner.address, data: wrongOwner.data, owner: TOKEN_PROGRAM_ID },
  ], liveAccounts, (requestedProgram, config) => {
    assert.ok(requestedProgram.equals(programId));
    programFilter = config;
  }));

  const filters = (programFilter as { filters: { memcmp: { offset: number; bytes: string } }[] }).filters;
  assert.deepEqual(filters.map((filter) => filter.memcmp.offset), [0, 80]);
  assert.equal(filters[0]!.memcmp.bytes, base58.encode(sha256(new TextEncoder().encode('account:VaultState')).slice(0, 8)));
  assert.equal(filters[1]!.memcmp.bytes, '2');
  assert.equal(result.slot, 123);
  assert.equal(result.rejectedAccounts, 2);
  assert.equal(result.vaults.length, 1);
  assert.equal(result.vaults[0]!.address, valid.address.toBase58());
  assert.equal(result.vaults[0]!.creator, valid.owner.toBase58());
  assert.equal(result.vaults[0]!.shareMint, valid.shareMint.toBase58());
  assert.equal(result.vaults[0]!.shareSupplyRaw, '100000');
  assert.deepEqual(result.vaults[0]!.assets.map((asset) => [asset.amountRaw, asset.targetBps]), [['0', 6_000], ['0', 4_000]]);
  assert.equal(result.vaults[0]!.metadata, null);
  assert.match(result.vaults[0]!.metadataIssue ?? '', /No Metaplex metadata/);
  await assert.rejects(discoverExploreVaults({ getProgramAccounts: async () => { throw new Error('devnet RPC unavailable'); } } as unknown as Connection), /devnet RPC unavailable/);
});

test('discovery displays on-chain metadata when off-chain JSON disagrees and marks the mismatch', async () => {
  const vault = makeVaultConfigured({ id: 73n });
  const liveAccounts = discoveryAccounts([vault]);
  const metadataAddress = metadataAddressForMint(vault.shareMint);
  liveAccounts.set(metadataAddress.toBase58(), accountInfo(
    new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'),
    encodeMetadata(vault.shareMint, vault.authority, 'Chain Name', 'CB00000073', 'ipfs://cid/metadata.json'),
  ));
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => jsonResponse({
      name: 'Different Name', symbol: 'CB00000073', description: 'Verified description', image: 'ar://image-id/image.png',
    });
    const result = await discoverExploreVaults(fakeRpc([{ address: vault.address, data: vault.data }], liveAccounts));
    assert.equal(result.vaults.length, 1);
    assert.equal(result.vaults[0]!.metadata?.name, 'Chain Name');
    assert.equal(result.vaults[0]!.metadata?.description, 'Verified description');
    assert.equal(result.vaults[0]!.metadata?.image, 'https://arweave.net/image-id/image.png');
    assert.match(result.vaults[0]!.metadataIssue ?? '', /name does not match on-chain metadata/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('invalid Metaplex accounts never replace or hide the verified Vault State', async () => {
  const vault = makeVaultConfigured({ id: 80n });
  const baseAccounts = discoveryAccounts([vault]);
  const metadataAddress = metadataAddressForMint(vault.shareMint);
  const validData = encodeMetadata(vault.shareMint, vault.authority, 'Chain Name', 'CB00000080', 'ipfs://cid/meta.json');
  const cases = [
    accountInfo(TOKEN_PROGRAM_ID, validData),
    accountInfo(new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'), encodeMetadata(new PublicKey(EXPLORE_ASSETS[1]!.mint), vault.authority, 'Wrong Mint', 'BAD', 'https://example.com/meta.json')),
    accountInfo(new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'), Buffer.from([0, 1, 2])),
  ];
  for (const invalid of cases) {
    const accounts = new Map(baseAccounts);
    accounts.set(metadataAddress.toBase58(), invalid);
    const result = await discoverExploreVaults(fakeRpc([{ address: vault.address, data: vault.data }], accounts));
    assert.equal(result.vaults.length, 1);
    assert.equal(result.vaults[0]!.metadata, null);
    assert.ok(result.vaults[0]!.metadataIssue);
    assert.equal(result.rejectedAccounts, 0); // Metadata errors do not invalidate the vault.
  }
});

test('discovery isolates broken metadata JSON and rejects invalid share mint or custody accounts', async () => {
  const vault = makeVaultConfigured({ id: 74n });
  const liveAccounts = discoveryAccounts([vault]);
  const metadataAddress = metadataAddressForMint(vault.shareMint);
  liveAccounts.set(metadataAddress.toBase58(), accountInfo(
    new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'),
    encodeMetadata(vault.shareMint, vault.authority, 'Chain Name', 'CB00000074', 'https://metadata.example/meta.json'),
  ));
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => jsonResponse('not-json');
    const valid = await discoverExploreVaults(fakeRpc([{ address: vault.address, data: vault.data }], liveAccounts));
    assert.equal(valid.vaults.length, 1);
    assert.equal(valid.vaults[0]!.metadata?.name, 'Chain Name');
    assert.match(valid.vaults[0]!.metadataIssue ?? '', /JSON is invalid/);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const cases: { body: unknown; url?: string; issue: RegExp }[] = [
    { body: { description: 'Only description.' }, issue: /is missing name, symbol, image/ },
    { body: { name: 'Chain Name', symbol: 'CB00000074', description: 'Description', image: 'https://image.example/a.png' }, url: 'http://insecure.example/metadata.json', issue: /redirect did not use HTTPS/ },
    { body: 'x'.repeat(512 * 1024 + 1), issue: /too large/ },
  ];
  for (const sample of cases) {
    const original = globalThis.fetch;
    try {
      globalThis.fetch = async () => jsonResponse(sample.body, sample.url);
      const result = await discoverExploreVaults(fakeRpc([{ address: vault.address, data: vault.data }], liveAccounts));
      assert.equal(result.vaults.length, 1);
      assert.equal(result.vaults[0]!.metadata?.name, 'Chain Name');
      assert.match(result.vaults[0]!.metadataIssue ?? '', sample.issue);
    } finally {
      globalThis.fetch = original;
    }
  }

  const invalidLiveAccounts = [
    (accounts: Map<string, AccountInfo<Buffer>>) => accounts.set(vault.shareMint.toBase58(), tokenMintAccount(Keypair.generate().publicKey, 9)),
    (accounts: Map<string, AccountInfo<Buffer>>) => accounts.set(vault.shareMint.toBase58(), tokenMintAccount(vault.authority, 8)),
    (accounts: Map<string, AccountInfo<Buffer>>) => accounts.set(vault.shareMint.toBase58(), tokenMintAccount(vault.authority, 9, 0n, Keypair.generate().publicKey)),
    (accounts: Map<string, AccountInfo<Buffer>>) => accounts.set(vault.shareMint.toBase58(), tokenMintAccount(vault.authority, 9, 0n, null, false)),
    (accounts: Map<string, AccountInfo<Buffer>>) => accounts.delete(getAta(assets[0]!.mint, vault.authority)),
    (accounts: Map<string, AccountInfo<Buffer>>) => accounts.set(getAta(assets[0]!.mint, vault.authority), tokenAccount(new PublicKey(assets[0]!.mint), vault.authority, 0n, { frozen: true })),
    (accounts: Map<string, AccountInfo<Buffer>>) => accounts.set(getAta(assets[0]!.mint, vault.authority), tokenAccount(new PublicKey(assets[0]!.mint), vault.authority, 0n, { delegate: Keypair.generate().publicKey })),
    (accounts: Map<string, AccountInfo<Buffer>>) => accounts.set(getAta(assets[0]!.mint, vault.authority), tokenAccount(new PublicKey(assets[1]!.mint), vault.authority)),
    (accounts: Map<string, AccountInfo<Buffer>>) => accounts.set(getAta(assets[0]!.mint, vault.authority), tokenAccount(new PublicKey(assets[0]!.mint), Keypair.generate().publicKey)),
    (accounts: Map<string, AccountInfo<Buffer>>) => accounts.set(assets[0]!.mint, tokenMintAccount(null, 2)),
    (accounts: Map<string, AccountInfo<Buffer>>) => accounts.set(assets[0]!.mint, tokenMintAccount(null, 6, 0n, null, false)),
  ];
  for (const corrupt of invalidLiveAccounts) {
    const accounts = discoveryAccounts([vault]);
    corrupt(accounts);
    const result = await discoverExploreVaults(fakeRpc([{ address: vault.address, data: vault.data }], accounts));
    assert.equal(result.vaults.length, 0);
    assert.equal(result.rejectedAccounts, 1);
  }
});

test('batches account verification below Solana getMultipleAccountsInfo limits', async () => {
  const vaults = Array.from({ length: 51 }, (_, index) => makeVaultConfigured({ id: BigInt(100 + index) }));
  const liveAccounts = discoveryAccounts(vaults);
  const batchSizes: number[] = [];
  const rpc = fakeRpc(vaults.map(({ address, data }) => ({ address, data })), liveAccounts);
  const originalGetMultiple = rpc.getMultipleAccountsInfo;
  Object.defineProperty(rpc, 'getMultipleAccountsInfo', {
    value: async (addresses: PublicKey[], ...args: unknown[]) => {
      batchSizes.push(addresses.length);
      return originalGetMultiple.call(rpc, addresses, ...args as [never]);
    },
  });
  const result = await discoverExploreVaults(rpc);
  assert.equal(result.vaults.length, vaults.length);
  assert.ok(batchSizes.length > 1);
  assert.ok(batchSizes.every((size) => size <= 100));
});

test('revalidates active state, configured mints, nonnegative u64 amounts, and minimum shares before investing', async () => {
  const vault = makeVaultConfigured({ id: 75n });
  const rpc = fakeRpc([{ address: vault.address, data: vault.data }]);
  const owner = Keypair.generate();
  await assert.rejects(investInExploreVault(owner, vault.address, {}, 0n, rpc), /positive u64/);
  await assert.rejects(investInExploreVault(owner, vault.address, {}, (1n << 64n), rpc), /positive u64/);
  await assert.rejects(investInExploreVault(owner, Keypair.generate().publicKey, {}, 1n, rpc), /no longer available/);
  await assert.rejects(investInExploreVault(owner, vault.address, { '11111111111111111111111111111111': 1n }, 1n, rpc), /not configured/);
  await assert.rejects(investInExploreVault(owner, vault.address, { [assets[0]!.mint]: -1n }, 1n, rpc), /u64 range/);
  await assert.rejects(investInExploreVault(owner, vault.address, { [assets[0]!.mint]: 1n << 64n }, 1n, rpc), /u64 range/);
  await assert.rejects(investInExploreVault(owner, vault.address, {}, 1n, rpc), /positive amount/);
  const badShareMint = discoveryAccounts([vault]);
  badShareMint.set(vault.shareMint.toBase58(), tokenMintAccount(vault.authority, 8));
  await assert.rejects(investInExploreVault(owner, vault.address, { [assets[0]!.mint]: 1n }, 1n, fakeRpc([{ address: vault.address, data: vault.data }], badShareMint)), /Share mint authority, decimals/);
  const inactive = makeVaultConfigured({ id: 76n, active: false });
  await assert.rejects(investInExploreVault(owner, inactive.address, {}, 1n, fakeRpc([{ address: inactive.address, data: inactive.data }])), /no longer active/);
});

test('revalidates live mint/custody accounts and signs exactly one NAV deposit transaction', async () => {
  const vault = makeVaultConfigured({ id: 78n });
  const owner = Keypair.fromSeed(Buffer.alloc(32, 45));
  const liveAccounts = discoveryAccounts([vault]);
  const rpc = fakeRpc([{ address: vault.address, data: vault.data }], liveAccounts);
  let sent: Buffer | null = null;
  mock.method(connection, 'getLatestBlockhash', async () => ({ blockhash: owner.publicKey.toBase58(), lastValidBlockHeight: 500 }));
  mock.method(connection, 'sendRawTransaction', async (raw: Uint8Array) => { sent = Buffer.from(raw); return 'deposit-signature'; });
  mock.method(connection, 'confirmTransaction', async () => ({ context: { slot: 789 }, value: { err: null } }));
  try {
    const result = await investInExploreVault(owner, vault.address, { [assets[0]!.mint]: 1_250_000_000n }, 123n, rpc);
    assert.deepEqual(result, { sig: 'deposit-signature', slot: 789 });
    const transaction = Transaction.from(sent!);
    const deposit = transaction.instructions.at(-1)!;
    assert.ok(deposit.programId.equals(programId));
    assert.equal(deposit.data.readBigUInt64LE(12), 1_250_000_000n);
    assert.equal(deposit.data.readBigUInt64LE(20), 0n);
    assert.equal(deposit.data.readBigUInt64LE(28), 123n);
    assert.equal(deposit.keys[4]!.pubkey.toBase58(), owner.publicKey.toBase58());
  } finally {
    mock.restoreAll();
  }
});

test('builds a four-asset deposit with WSOL wrapping once and only configured oracle feeds', () => {
  const fourAssets = EXPLORE_ASSETS.slice(0, 4);
  const vault = makeVaultConfigured({ id: 77n, selectedAssets: fourAssets });
  const owner = Keypair.fromSeed(Buffer.alloc(32, 44)).publicKey;
  const amounts = [2_000_000_000n, 0n, 10_000n, 0n];
  const tx = buildExploreDepositTransaction(owner, vault.state, vault.authority, amounts, 123n);
  const deposit = tx.instructions.at(-1)!;
  assert.equal(tx.instructions.length, 8); // WSOL ATA + transfer + sync, 3 other ATAs, share ATA, deposit.
  assert.equal(deposit.keys.length, 6 + 2 * fourAssets.length + 2); // 2 Pyth feeds; fixed-price feeds omitted.
  assert.equal(deposit.data.readUInt32LE(8), fourAssets.length);
  assert.deepEqual(Array.from({ length: 4 }, (_, i) => deposit.data.readBigUInt64LE(12 + i * 8)), amounts);
  assert.equal(deposit.data.readBigUInt64LE(12 + 4 * 8), 123n);
  assert.throws(() => buildExploreDepositTransaction(owner, vault.state, vault.authority, [-1n, 0n, 0n, 0n], 1n), /u64 range/);
  assert.throws(() => buildExploreDepositTransaction(owner, vault.state, vault.authority, [1n << 64n, 0n, 0n, 0n], 1n), /u64 range/);
  assert.throws(() => buildExploreDepositTransaction(owner, vault.state, vault.authority, [BigInt(Number.MAX_SAFE_INTEGER) + 1n, 0n, 0n, 0n], 1n), /safe wrapping/);
  assert.throws(() => buildExploreDepositTransaction(owner, vault.state, vault.authority, [0n, 0n, 0n, 0n], 1n), /amounts do not match/);
  assert.throws(() => buildExploreDepositTransaction(owner, vault.state, vault.authority, [1n, 0n], 1n), /amounts do not match/);
  assert.throws(() => buildExploreDepositTransaction(owner, vault.state, vault.authority, [1n, 0n, 0n, 0n], 1n << 64n), /positive u64/);
  const withoutWsol = buildExploreDepositTransaction(owner, vault.state, vault.authority, [0n, 1n, 0n, 2n], 1n);
  assert.equal(withoutWsol.instructions.length, 6); // Four source ATAs, share ATA, and deposit; zero WSOL is not wrapped.
});

function string(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  const length = Buffer.alloc(4); length.writeUInt32LE(bytes.length);
  return Buffer.concat([length, bytes]);
}
function u64(value: bigint): Buffer { const out = Buffer.alloc(8); out.writeBigUInt64LE(value); return out; }
function hexBytes(value: string): Uint8Array { return Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16)); }
function getAta(mint: string, owner: PublicKey): string { return PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), new PublicKey(mint).toBuffer()], new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'))[0].toBase58(); }
