import { Buffer } from 'buffer';
import { base58 } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  unpackAccount,
  unpackMint,
} from '@solana/spl-token';
import { PublicKey, Transaction, TransactionInstruction, type AccountInfo, type Connection } from '@solana/web3.js';
import { signSendConfirm, type OwnerSigner, type TxResult } from './tx.js';
import { connection } from './connection.js';
import { EXECUTION_PROGRAM_ID } from './config.js';
import { wrapSolInstructions } from './wallet.js';

const PROGRAM_ID = new PublicKey(EXECUTION_PROGRAM_ID);
const TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
const VAULT_SEED = Buffer.from('vault');
const AUTHORITY_SEED = Buffer.from('vault-authority');
const SHARE_MINT_SEED = Buffer.from('share-mint');
const METADATA_SEED = Buffer.from('metadata');
const ACCOUNT_DISCRIMINATOR = sha256(new TextEncoder().encode('account:VaultState')).slice(0, 8);
const MAX_U64 = (1n << 64n) - 1n;
const MAX_ASSETS = 4;
const VAULT_STATE_SIZE = 8 + 8 + 32 + 32 + 1 + 2 + 2 + 1 + 8 + 4 + MAX_ASSETS * 99;
const METADATA_DISCRIMINATOR = 4; // mpl_token_metadata::state::Key::MetadataV1
const MAX_METADATA_JSON_BYTES = 512 * 1024;
const MAX_METADATA_NAME_BYTES = 32;
const MAX_METADATA_SYMBOL_BYTES = 10;
const MAX_METADATA_URI_BYTES = 200;

export interface AllowedAsset {
  id: 'wsol' | 'tusd' | 'dusd' | 'tbtc' | 'teth';
  mint: string;
  name: string;
  symbol: string;
  decimals: number;
  color: string;
  feedAccount: string;
  feedId: string;
}

export const EXPLORE_ASSETS: readonly AllowedAsset[] = [
  { id: 'wsol', mint: 'So11111111111111111111111111111111111111112', name: 'Wrapped SOL', symbol: 'WSOL', decimals: 9, color: '#ff513b', feedAccount: '7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE', feedId: 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d' },
  { id: 'tusd', mint: '39Byty3S2nCgRHk6kshaDiX6UKi7RjGmLVP4Qpz2ZK1D', name: 'Test USD', symbol: 'TUSD', decimals: 6, color: '#1249ed', feedAccount: PublicKey.default.toBase58(), feedId: '00'.repeat(32) },
  { id: 'dusd', mint: 'DQZn9b9uNUZdE3AJoGoZ9hmC2NzaWxTZRo4gnNLzyuSv', name: 'Synthetic Devnet USD', symbol: 'dUSD', decimals: 6, color: '#2666c9', feedAccount: PublicKey.default.toBase58(), feedId: '00'.repeat(32) },
  { id: 'tbtc', mint: '2VnSReFZw6pXAsANhSNFqwjqiEd22ihSehLY6RVXXy8M', name: 'Test BTC', symbol: 'tBTC', decimals: 8, color: '#ffd523', feedAccount: '4cSM2e6rvbGQUFiJbqytoVMi5GgghSMr8LwVrT9VPSPo', feedId: 'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43' },
  { id: 'teth', mint: '5zPzxpfy9bBvhXDQ4cwQGY2zX97RwrrUkadK186HXZSX', name: 'Test ETH', symbol: 'tETH', decimals: 8, color: '#8d25d9', feedAccount: '42amVS4KgzR9rA28tkVYqVXjq9Qa8dcZQMbH5EYFX6XC', feedId: 'ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace' },
];

const ASSET_BY_MINT = new Map(EXPLORE_ASSETS.map((asset) => [asset.mint, asset]));

export interface DecodedExploreAsset {
  mint: PublicKey;
  decimals: number;
  targetBps: number;
  feedAccount: PublicKey;
  feedId: Uint8Array;
}

export interface DecodedVaultState {
  id: bigint;
  creator: PublicKey;
  shareMint: PublicKey;
  active: boolean;
  thresholdBps: number;
  maxSlippageBps: number;
  authorityBump: number;
  lastSettledNonce: bigint;
  assets: DecodedExploreAsset[];
}

export interface ShareTokenMetadata {
  updateAuthority: string;
  mint: string;
  name: string;
  symbol: string;
  uri: string;
  isMutable: boolean;
  description?: string;
  image?: string;
}

export interface ExploreAsset extends AllowedAsset {
  targetBps: number;
  amountRaw: string;
}

export interface ExploreVault {
  address: string;
  creator: string;
  authority: string;
  shareMint: string;
  active: true;
  thresholdBps: number;
  maxSlippageBps: number;
  lastSettledNonce: string;
  shareSupplyRaw: string;
  assets: ExploreAsset[];
  metadata: ShareTokenMetadata | null;
  metadataIssue: string | null;
}

export interface ExploreResult {
  slot: number;
  vaults: ExploreVault[];
  rejectedAccounts: number;
}

export function decodeVaultState(data: Uint8Array, accountOwner: PublicKey): DecodedVaultState {
  if (!accountOwner.equals(PROGRAM_ID)) throw new Error('Vault State account owner does not match the execution program.');
  if (data.byteLength !== VAULT_STATE_SIZE) throw new Error(`Vault State must contain exactly ${VAULT_STATE_SIZE} bytes.`);
  if (!ACCOUNT_DISCRIMINATOR.every((byte, index) => data[index] === byte)) throw new Error('Vault State discriminator is invalid.');

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 8;
  const id = view.getBigUint64(offset, true); offset += 8;
  const creator = publicKeyAt(data, offset); offset += 32;
  const shareMint = publicKeyAt(data, offset); offset += 32;
  const activeByte = view.getUint8(offset++);
  if (activeByte !== 0 && activeByte !== 1) throw new Error('Vault State active flag is invalid.');
  const thresholdBps = view.getUint16(offset, true); offset += 2;
  const maxSlippageBps = view.getUint16(offset, true); offset += 2;
  if (thresholdBps < 1 || thresholdBps > 1_000 || maxSlippageBps < 1 || maxSlippageBps > 500) throw new Error('Vault State risk bounds are invalid.');
  const authorityBump = view.getUint8(offset++);
  const lastSettledNonce = view.getBigUint64(offset, true); offset += 8;
  const assetCount = view.getUint32(offset, true); offset += 4;
  if (assetCount < 1 || assetCount > MAX_ASSETS || offset + assetCount * 99 > data.byteLength) throw new Error('Vault State asset vector is invalid.');

  const assets: DecodedExploreAsset[] = [];
  const seenMints = new Set<string>();
  let totalTargets = 0;
  for (let index = 0; index < assetCount; index += 1) {
    const mint = publicKeyAt(data, offset); offset += 32;
    const decimals = view.getUint8(offset++);
    const targetBps = view.getUint16(offset, true); offset += 2;
    const feedAccount = publicKeyAt(data, offset); offset += 32;
    const feedId = data.slice(offset, offset + 32); offset += 32;
    const spec = ASSET_BY_MINT.get(mint.toBase58());
    if (!spec || decimals !== spec.decimals || !feedAccount.equals(new PublicKey(spec.feedAccount)) || !equalBytes(feedId, hexBytes(spec.feedId))) {
      throw new Error('Vault State contains an unsupported or mismatched asset/feed configuration.');
    }
    if (seenMints.has(mint.toBase58())) throw new Error('Vault State contains duplicate assets.');
    seenMints.add(mint.toBase58());
    totalTargets += targetBps;
    assets.push({ mint, decimals, targetBps, feedAccount, feedId });
  }
  if (totalTargets !== 10_000) throw new Error('Vault State target weights must sum to 100%.');
  if (offset < data.byteLength && data.subarray(offset).some((byte) => byte !== 0)) throw new Error('Vault State contains nonzero trailing data.');
  if (creator.equals(PublicKey.default)) throw new Error('Vault State creator is invalid.');

  return { id, creator, shareMint, active: activeByte === 1, thresholdBps, maxSlippageBps, authorityBump, lastSettledNonce, assets };
}

export function deriveExploreVaultAddresses(stateAddress: PublicKey, state: Pick<DecodedVaultState, 'id' | 'creator' | 'authorityBump'>) {
  const [expectedState] = PublicKey.findProgramAddressSync([VAULT_SEED, state.creator.toBuffer(), u64(state.id)], PROGRAM_ID);
  if (!expectedState.equals(stateAddress)) throw new Error('Vault State address is not canonical for its creator and id.');
  const [authority, authorityBump] = PublicKey.findProgramAddressSync([AUTHORITY_SEED, stateAddress.toBuffer()], PROGRAM_ID);
  if (authorityBump !== state.authorityBump) throw new Error('Vault Authority bump does not match its canonical PDA.');
  const [shareMint] = PublicKey.findProgramAddressSync([SHARE_MINT_SEED, stateAddress.toBuffer()], PROGRAM_ID);
  return { state: stateAddress, authority, authorityBump, shareMint };
}

export function metadataAddressForMint(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([METADATA_SEED, TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()], TOKEN_METADATA_PROGRAM_ID)[0];
}

export function decodeShareMetadata(
  data: Uint8Array,
  accountOwner: PublicKey,
  address: PublicKey,
  expectedMint: PublicKey,
): Omit<ShareTokenMetadata, 'description' | 'image'> {
  if (!accountOwner.equals(TOKEN_METADATA_PROGRAM_ID)) throw new Error('Metadata account owner is not Metaplex Token Metadata.');
  if (!address.equals(metadataAddressForMint(expectedMint))) throw new Error('Metadata account is not the canonical mint PDA.');
  const reader = new BorshReader(data);
  if (reader.u8() !== METADATA_DISCRIMINATOR) throw new Error('Metaplex metadata account type is invalid.');
  const updateAuthority = reader.pubkey();
  const mint = reader.pubkey();
  if (mint !== expectedMint.toBase58()) throw new Error('Metaplex metadata mint does not match the share mint.');
  const name = reader.string(MAX_METADATA_NAME_BYTES).replace(/\0+$/g, '').trim();
  const symbol = reader.string(MAX_METADATA_SYMBOL_BYTES).replace(/\0+$/g, '').trim();
  const uri = reader.string(MAX_METADATA_URI_BYTES).replace(/\0+$/g, '').trim();
  const sellerFeeBps = reader.u16();
  if (sellerFeeBps > 10_000) throw new Error('Metadata seller fee is outside the basis-point range.');
  reader.option(() => {
    const count = reader.u32();
    if (count > 100) throw new Error('Metadata creator list is too large.');
    for (let i = 0; i < count; i += 1) {
      reader.pubkey();
      const verified = reader.u8();
      const share = reader.u8();
      if (verified > 1 || share > 100) throw new Error('Metadata creator flags or shares are invalid.');
    }
  });
  const primarySale = reader.u8();
  if (primarySale !== 0 && primarySale !== 1) throw new Error('Metadata sale flag is invalid.');
  const mutable = reader.u8();
  if (mutable !== 0 && mutable !== 1) throw new Error('Metadata mutability flag is invalid.');
  if (!name || !symbol || !uri) throw new Error('Metaplex metadata name, symbol, or URI is empty.');
  return { updateAuthority, mint, name, symbol, uri, isMutable: mutable === 1 };
}

export function resolveMetadataUri(uri: string): string {
  const trimmed = uri.trim();
  if (trimmed.startsWith('ipfs://')) {
    const path = trimmed.slice('ipfs://'.length).replace(/^ipfs\//, '');
    if (!path || path.startsWith('/')) throw new Error('IPFS metadata URI is invalid.');
    return new URL(`/ipfs/${path}`, 'https://ipfs.io').href;
  }
  if (trimmed.startsWith('ar://')) {
    const path = trimmed.slice('ar://'.length);
    if (!path || path.startsWith('/') || path.includes('\\')) throw new Error('Arweave metadata URI is invalid.');
    return new URL(path, 'https://arweave.net/').href;
  }
  const url = new URL(trimmed);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Metadata URI must use HTTPS, IPFS, or Arweave.');
  return url.href;
}

export async function discoverExploreVaults(rpc: Connection = connection): Promise<ExploreResult> {
  const accounts = await rpc.getProgramAccounts(PROGRAM_ID, {
    commitment: 'confirmed',
    filters: [
      { memcmp: { offset: 0, bytes: base58.encode(ACCOUNT_DISCRIMINATOR) } },
      { memcmp: { offset: 80, bytes: '2' } }, // base58([1]) — Anchor bool true
    ],
  });

  const candidates: { address: PublicKey; state: DecodedVaultState; derived: ReturnType<typeof deriveExploreVaultAddresses> }[] = [];
  let rejectedAccounts = 0;
  for (const { pubkey, account } of accounts) {
    try {
      const state = decodeVaultState(account.data, account.owner);
      if (!state.active) continue;
      const derived = deriveExploreVaultAddresses(pubkey, state);
      if (!state.shareMint.equals(derived.shareMint)) throw new Error('Vault State share mint is not canonical.');
      candidates.push({ address: pubkey, state, derived });
    } catch {
      rejectedAccounts += 1;
    }
  }

  const keys = new Map<string, PublicKey>();
  for (const candidate of candidates) {
    keys.set(candidate.state.shareMint.toBase58(), candidate.state.shareMint);
    keys.set(metadataAddressForMint(candidate.state.shareMint).toBase58(), metadataAddressForMint(candidate.state.shareMint));
    for (const asset of candidate.state.assets) {
      keys.set(asset.mint.toBase58(), asset.mint);
      const custody = getAssociatedTokenAddressSync(asset.mint, candidate.derived.authority, true);
      keys.set(custody.toBase58(), custody);
    }
  }
  const chainAccounts = await fetchAccounts(rpc, [...keys.values()]);
  const verified: { candidate: typeof candidates[number]; vault: ExploreVault; metadataAddress: PublicKey }[] = [];
  for (const candidate of candidates) {
    try {
      const vault = verifyLiveVault(candidate, chainAccounts);
      const metadataAddress = metadataAddressForMint(candidate.state.shareMint);
      verified.push({ candidate, vault, metadataAddress });
    } catch {
      rejectedAccounts += 1;
    }
  }

  const enriched = await Promise.all(verified.map(async ({ vault, candidate, metadataAddress }) => {
    const info = chainAccounts.get(metadataAddress.toBase58());
    if (!info) return { ...vault, metadata: null, metadataIssue: 'No Metaplex metadata account is attached to this share mint.' };
    try {
      const onchain = decodeShareMetadata(info.data, info.owner, metadataAddress, candidate.state.shareMint);
      try {
        const json = await fetchMetadataJson(onchain.uri);
        const missing = [!json.name && 'name', !json.symbol && 'symbol', !json.description && 'description', !json.image && 'image'].filter(Boolean);
        const mismatched = [
          json.name && json.name !== onchain.name && 'name',
          json.symbol && json.symbol !== onchain.symbol && 'symbol',
        ].filter(Boolean);
        const issues = [
          ...(missing.length ? [`is missing ${missing.join(', ')}`] : []),
          ...(mismatched.length ? [`${mismatched.join(' and ')} does not match on-chain metadata`] : []),
        ];
        return {
          ...vault,
          metadata: { ...onchain, ...(json.description ? { description: json.description } : {}), ...(json.image ? { image: resolveMetadataUri(json.image) } : {}) },
          metadataIssue: issues.length ? `Metadata JSON ${issues.join('; ')}.` : null,
        };
      } catch (error) {
        return { ...vault, metadata: onchain, metadataIssue: `Metadata JSON unavailable: ${errorMessage(error)}` };
      }
    } catch (error) {
      return { ...vault, metadata: null, metadataIssue: errorMessage(error) };
    }
  }));
  return { slot: await rpc.getSlot('confirmed'), vaults: enriched, rejectedAccounts };
}

export async function investInExploreVault(
  owner: OwnerSigner,
  vaultAddress: PublicKey,
  amountByMint: Readonly<Record<string, bigint>>,
  minSharesOut: bigint,
  rpc: Connection = connection,
): Promise<TxResult> {
  if (minSharesOut <= 0n || minSharesOut > MAX_U64) throw new Error('Minimum shares out must be a positive u64 amount.');
  const stateInfo = await rpc.getAccountInfo(vaultAddress, 'confirmed');
  if (!stateInfo) throw new Error('Vault State is no longer available on Solana devnet.');
  const state = decodeVaultState(stateInfo.data, stateInfo.owner);
  if (!state.active) throw new Error('This portfolio is no longer active.');
  const derived = deriveExploreVaultAddresses(vaultAddress, state);
  if (!state.shareMint.equals(derived.shareMint)) throw new Error('Vault share mint does not match its canonical PDA.');

  const allowedMints = new Set(state.assets.map((asset) => asset.mint.toBase58()));
  for (const [mint, amount] of Object.entries(amountByMint)) {
    if (!allowedMints.has(mint)) throw new Error('Deposit includes an asset that is not configured in this vault.');
    if (amount < 0n || amount > MAX_U64) throw new Error('Deposit amount is outside the SPL u64 range.');
  }
  const amounts = state.assets.map((asset) => amountByMint[asset.mint.toBase58()] ?? 0n);
  if (amounts.every((amount) => amount === 0n)) throw new Error('Enter a positive amount for at least one vault asset.');

  const keys = [state.shareMint, ...state.assets.map((asset) => asset.mint), ...state.assets.map((asset) => getAssociatedTokenAddressSync(asset.mint, derived.authority, true))];
  const chainAccounts = await fetchAccounts(rpc, keys);
  verifyMintsAndCustody(state, derived.authority, chainAccounts);
  verifyShareMint(state, derived.authority, chainAccounts);
  const tx = buildExploreDepositTransaction(owner.publicKey, state, derived.authority, amounts, minSharesOut);
  return signSendConfirm(tx, owner);
}

export function buildExploreDepositTransaction(
  owner: PublicKey,
  state: DecodedVaultState,
  authority: PublicKey,
  amounts: readonly bigint[],
  minSharesOut: bigint,
): Transaction {
  if (!state.active) throw new Error('Only active Vault State accounts can accept deposits.');
  if (amounts.length !== state.assets.length || amounts.every((amount) => amount === 0n)) throw new Error('Deposit amounts do not match this vault.');
  if (amounts.some((amount) => amount < 0n || amount > MAX_U64)) throw new Error('Deposit amount is outside the SPL u64 range.');
  if (minSharesOut <= 0n || minSharesOut > MAX_U64) throw new Error('Minimum shares out must be a positive u64 amount.');
  const derived = deriveExploreVaultAddresses(stateAddressFor(state), state);
  if (!state.shareMint.equals(derived.shareMint) || !authority.equals(derived.authority)) throw new Error('Vault authority or share mint is not canonical.');
  const tx = new Transaction();
  const wsolIndex = state.assets.findIndex((asset) => asset.mint.equals(new PublicKey(EXPLORE_ASSETS[0].mint)));
  const wrappedWsol = wsolIndex >= 0 && amounts[wsolIndex] > 0n;
  if (wrappedWsol) {
    if (amounts[wsolIndex] > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('WSOL deposit exceeds the safe wrapping limit.');
    tx.add(...wrapSolInstructions(owner, Number(amounts[wsolIndex])));
  }
  const sources = state.assets.map((asset) => getAssociatedTokenAddressSync(asset.mint, owner));
  const custody = state.assets.map((asset) => getAssociatedTokenAddressSync(asset.mint, authority, true));
  const shareAccount = getAssociatedTokenAddressSync(state.shareMint, owner);
  for (const [index, asset] of state.assets.entries()) {
    if (wrappedWsol && index === wsolIndex) continue; // wrapSolInstructions already creates this ATA.
    const source = getAssociatedTokenAddressSync(asset.mint, owner);
    tx.add(createAssociatedTokenAccountIdempotentInstruction(owner, source, owner, asset.mint));
  }
  tx.add(createAssociatedTokenAccountIdempotentInstruction(owner, shareAccount, owner, state.shareMint));
  const feeds = state.assets.filter((asset) => !asset.feedAccount.equals(PublicKey.default)).map((asset) => asset.feedAccount);
  tx.add(new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: stateAddressFor(state), isSigner: false, isWritable: false },
      { pubkey: authority, isSigner: false, isWritable: false },
      { pubkey: state.shareMint, isSigner: false, isWritable: true },
      { pubkey: shareAccount, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ...sources.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true })),
      ...custody.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true })),
      ...feeds.map((pubkey) => ({ pubkey, isSigner: false, isWritable: false })),
    ],
    data: Buffer.concat([
      Buffer.from(sha256(new TextEncoder().encode('global:deposit')).slice(0, 8)),
      u32(amounts.length),
      ...amounts.map(u64),
      u64(minSharesOut),
    ]),
  }));
  tx.feePayer = owner;
  return tx;
}

export function parseTokenAmount(input: string, decimals: number): bigint | null {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) return null;
  const value = input.trim();
  if (!value || !/^\d+(?:\.\d*)?$/.test(value)) return value === '' ? 0n : null;
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals) return null;
  try {
    return BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals) || '0');
  } catch {
    return null;
  }
}

export function formatRawAmount(raw: string, decimals: number, maxFraction = 6): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error('Token decimals must be an integer from 0 to 255.');
  if (!Number.isInteger(maxFraction) || maxFraction < 0) throw new Error('Maximum fraction digits must be a nonnegative integer.');
  const value = BigInt(raw);
  if (value < 0n) throw new Error('Token amount cannot be negative.');
  const scale = 10n ** BigInt(decimals);
  const whole = (value / scale).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = (value % scale).toString().padStart(decimals, '0').slice(0, Math.min(decimals, maxFraction)).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

function verifyLiveVault(
  candidate: { address: PublicKey; state: DecodedVaultState; derived: ReturnType<typeof deriveExploreVaultAddresses> },
  accounts: Map<string, AccountInfo<Buffer> | null>,
): ExploreVault {
  verifyMintsAndCustody(candidate.state, candidate.derived.authority, accounts);
  const mintInfo = verifyShareMint(candidate.state, candidate.derived.authority, accounts);
  return {
    address: candidate.address.toBase58(),
    creator: candidate.state.creator.toBase58(),
    authority: candidate.derived.authority.toBase58(),
    shareMint: candidate.state.shareMint.toBase58(),
    active: true,
    thresholdBps: candidate.state.thresholdBps,
    maxSlippageBps: candidate.state.maxSlippageBps,
    lastSettledNonce: candidate.state.lastSettledNonce.toString(),
    shareSupplyRaw: mintInfo.supply.toString(),
    assets: candidate.state.assets.map((asset) => {
      const spec = ASSET_BY_MINT.get(asset.mint.toBase58())!;
      const custody = getAssociatedTokenAddressSync(asset.mint, candidate.derived.authority, true);
      const tokenInfo = accounts.get(custody.toBase58());
      if (!tokenInfo) throw new Error('Vault custody token account is missing.');
      const tokenAccount = unpackAccount(custody, tokenInfo, TOKEN_PROGRAM_ID);
      if (!tokenAccount.mint.equals(asset.mint) || !tokenAccount.owner.equals(candidate.derived.authority) || tokenAccount.delegate !== null || tokenAccount.isFrozen) {
        throw new Error('Vault custody token account is invalid.');
      }
      return { ...spec, targetBps: asset.targetBps, amountRaw: tokenAccount.amount.toString() };
    }),
    metadata: null,
    metadataIssue: null,
  };
}

function verifyMintsAndCustody(
  state: DecodedVaultState,
  authority: PublicKey,
  accounts: Map<string, AccountInfo<Buffer> | null>,
): void {
  for (const asset of state.assets) {
    const spec = ASSET_BY_MINT.get(asset.mint.toBase58());
    const info = accounts.get(asset.mint.toBase58());
    if (!spec || !info) throw new Error('Allowed asset mint account is unavailable.');
    const mint = unpackMint(asset.mint, info, TOKEN_PROGRAM_ID);
    if (!mint.isInitialized || mint.decimals !== spec.decimals) throw new Error('Allowed asset mint decimals or initialization do not match the program configuration.');
    const custody = getAssociatedTokenAddressSync(asset.mint, authority, true);
    const custodyInfo = accounts.get(custody.toBase58());
    if (!custodyInfo) throw new Error('Vault custody token account is missing.');
    const tokenAccount = unpackAccount(custody, custodyInfo, TOKEN_PROGRAM_ID);
    if (!tokenAccount.isInitialized || !tokenAccount.mint.equals(asset.mint) || !tokenAccount.owner.equals(authority) || tokenAccount.delegate !== null || tokenAccount.isFrozen) {
      throw new Error('Vault custody token account is invalid.');
    }
  }
}

function verifyShareMint(
  state: DecodedVaultState,
  authority: PublicKey,
  accounts: Map<string, AccountInfo<Buffer> | null>,
) {
  const shareMint = accounts.get(state.shareMint.toBase58());
  if (!shareMint) throw new Error('Share mint account is missing.');
  const mintInfo = unpackMint(state.shareMint, shareMint, TOKEN_PROGRAM_ID);
  if (!mintInfo.isInitialized || !mintInfo.mintAuthority?.equals(authority) || mintInfo.decimals !== 9 || mintInfo.freezeAuthority !== null) {
    throw new Error('Share mint authority, decimals, or freeze policy is invalid.');
  }
  return mintInfo;
}

async function fetchAccounts(rpc: Connection, addresses: PublicKey[]): Promise<Map<string, AccountInfo<Buffer> | null>> {
  const unique = [...new Map(addresses.map((address) => [address.toBase58(), address])).values()];
  const result = new Map<string, AccountInfo<Buffer> | null>();
  for (let i = 0; i < unique.length; i += 100) {
    const batch = unique.slice(i, i + 100);
    const infos = await rpc.getMultipleAccountsInfo(batch, 'confirmed');
    batch.forEach((address, index) => result.set(address.toBase58(), infos[index]));
  }
  return result;
}

async function fetchMetadataJson(uri: string): Promise<{ name?: string; symbol?: string; description?: string; image?: string }> {
  const url = resolveMetadataUri(uri);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6_000);
  try {
    const response = await fetch(url, { signal: controller.signal, credentials: 'omit', redirect: 'follow', cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (new URL(response.url).protocol !== 'https:') throw new Error('Metadata redirect did not use HTTPS.');
    const declaredSize = Number(response.headers.get('content-length') ?? 0);
    if (declaredSize > MAX_METADATA_JSON_BYTES) throw new Error('Metadata JSON is too large.');
    const text = await readLimitedText(response, MAX_METADATA_JSON_BYTES);
    let json: unknown;
    try { json = JSON.parse(text) as unknown; }
    catch { throw new Error('Metadata JSON is invalid.'); }
    if (typeof json !== 'object' || json === null || Array.isArray(json)) throw new Error('Metadata JSON must be an object.');
    const fields = json as { name?: unknown; symbol?: unknown; description?: unknown; image?: unknown };
    const name = typeof fields.name === 'string' ? fields.name.trim() : '';
    const symbol = typeof fields.symbol === 'string' ? fields.symbol.trim() : '';
    const description = typeof fields.description === 'string' ? fields.description.trim().slice(0, 2_000) : '';
    const image = typeof fields.image === 'string' ? fields.image.trim() : '';
    return {
      ...(name ? { name } : {}),
      ...(symbol ? { symbol } : {}),
      ...(description ? { description } : {}),
      ...(image ? { image } : {}),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function readLimitedText(response: Response, limit: number): Promise<string> {
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > limit) throw new Error('Metadata JSON is too large.');
    return text;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new Error('Metadata JSON is too large.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

class BorshReader {
  private offset = 0;
  private readonly view: DataView;
  constructor(private readonly data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }
  u8(): number { this.require(1); return this.view.getUint8(this.offset++); }
  u16(): number { this.require(2); const value = this.view.getUint16(this.offset, true); this.offset += 2; return value; }
  u32(): number { this.require(4); const value = this.view.getUint32(this.offset, true); this.offset += 4; return value; }
  pubkey(): string { this.require(32); const value = new PublicKey(this.data.subarray(this.offset, this.offset + 32)).toBase58(); this.offset += 32; return value; }
  string(max: number): string {
    const length = this.u32();
    if (length > max) throw new Error('Metadata string is too long.');
    this.require(length);
    let value: string;
    try { value = new TextDecoder('utf-8', { fatal: true }).decode(this.data.subarray(this.offset, this.offset + length)); }
    catch { throw new Error('Metadata string is not valid UTF-8.'); }
    this.offset += length;
    return value;
  }
  option(read: () => void): void {
    const flag = this.u8();
    if (flag === 1) read();
    else if (flag !== 0) throw new Error('Metadata option tag is invalid.');
  }
  private require(length: number): void {
    if (length < 0 || this.offset + length > this.data.byteLength) throw new Error('Metaplex metadata account is truncated.');
  }
}

function publicKeyAt(data: Uint8Array, offset: number): PublicKey {
  return new PublicKey(data.subarray(offset, offset + 32));
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function hexBytes(value: string): Uint8Array {
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
}

function u32(value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value);
  return out;
}

function u64(value: bigint): Buffer {
  if (value < 0n || value > MAX_U64) throw new Error('Value is outside the u64 range.');
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value);
  return out;
}

function stateAddressFor(state: DecodedVaultState): PublicKey {
  return PublicKey.findProgramAddressSync([VAULT_SEED, state.creator.toBuffer(), u64(state.id)], PROGRAM_ID)[0];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'metadata verification failed';
}
