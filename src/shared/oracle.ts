import { Buffer } from 'buffer';
import type { AccountInfo, PublicKey } from '@solana/web3.js';
import { RECEIVER_ID, assetFor } from './config.js';
import { discriminator } from './codec.js';
export interface Price { midpoint: bigint; lower: bigint; upper: bigint; published: bigint; confidenceBps: bigint }
/** Mirrors the official PriceUpdateV2 Borsh format and the Rust policy. */
export function readPrice(mint: PublicKey, key: PublicKey, info: AccountInfo<Buffer>, now: bigint): Price {
  const asset = assetFor(mint); const b = Buffer.from(info.data);
  if (!asset.feed.equals(key) || !info.owner.equals(RECEIVER_ID) || (b.length !== 133 && b.length !== 134) || !b.subarray(0,8).equals(discriminator('account','PriceUpdateV2'))) throw new Error('Wrong oracle account, owner, or layout');
  if (b[40] !== 1) throw new Error('Pyth update is not Fully verified');
  if (b.subarray(41,73).toString('hex') !== asset.feedId) throw new Error('Wrong embedded Pyth feed');
  const price = b.readBigInt64LE(73), conf = b.readBigUInt64LE(81), exponent = b.readInt32LE(89), published = b.readBigInt64LE(93);
  if (price <= 0n || conf >= price || exponent < -8 || exponent > 0) throw new Error('Invalid oracle price');
  if (published > now || now-published > 60n) throw new Error('Pyth feed is future-dated or stale (>60 seconds)');
  const confidenceBps = (conf*10_000n+price-1n)/price;
  if (confidenceBps > 100n) throw new Error('Pyth confidence exceeds 1%');
  const scale = 10n**BigInt(12+exponent);
  return {midpoint:price*scale,lower:(price-conf)*scale,upper:(price+conf)*scale,published,confidenceBps};
}
