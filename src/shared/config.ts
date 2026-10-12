import { PublicKey } from '@solana/web3.js';
export const DEFAULT_PROGRAM = 'FN7uGX34qyijmVX69gqEkMugWjE5Sjso8Pe7gWU6B2N6';
export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const RPC_URL = import.meta.env?.VITE_RPC_URL ?? 'https://api.devnet.solana.com';
export const PROGRAM_ID = new PublicKey(import.meta.env?.VITE_PROGRAM_ID ?? DEFAULT_PROGRAM);
export const RECEIVER_ID = new PublicKey('rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ');
export const ASSETS = [
  { symbol: 'WSOL', label: 'Wrapped SOL', mint: new PublicKey('So11111111111111111111111111111111111111112'), decimals: 9,
    feed: new PublicKey('7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE'), feedId: 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d' },
  { symbol: 'Test USDC', label: 'Devnet test token · not redeemable USD', mint: new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'), decimals: 6,
    feed: new PublicKey('Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX'), feedId: 'eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a' },
] as const;
export function assetFor(mint: PublicKey) {
  const asset = ASSETS.find(a => a.mint.equals(mint));
  if (!asset) throw new Error('Unsupported asset');
  return asset;
}
