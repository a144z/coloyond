import { hmac } from '@noble/hashes/hmac.js';
import { sha512 } from '@noble/hashes/sha2.js';

/**
 * SLIP-0010 hierarchical derivation for ed25519 (the scheme behind
 * Solana's m/44'/501'/0'/0' paths used by Phantom and Solflare).
 * Implemented directly so it runs in the browser with no node polyfills.
 */

const ED25519_CURVE = new TextEncoder().encode('ed25519 seed');
const HARDENED_OFFSET = 0x80000000;

export const SOLANA_DERIVATION_PATH = "m/44'/501'/0'/0'";

export function deriveEd25519Path(seed: Uint8Array, path: string): Uint8Array {
  const segments = path.split('/');
  if (segments[0] !== 'm' || segments.length < 2) {
    throw new Error('invalid derivation path');
  }

  let i = hmac(sha512, ED25519_CURVE, seed);
  let key = i.slice(0, 32);
  let chainCode = i.slice(32);

  for (const segment of segments.slice(1)) {
    if (!segment.endsWith("'")) {
      throw new Error('ed25519 derivation requires hardened segments');
    }
    const index = Number.parseInt(segment.slice(0, -1), 10);
    if (!Number.isInteger(index) || index < 0 || index >= HARDENED_OFFSET) {
      throw new Error(`invalid derivation segment: ${segment}`);
    }

    const data = new Uint8Array(1 + 32 + 4);
    data[0] = 0x00;
    data.set(key, 1);
    new DataView(data.buffer).setUint32(33, HARDENED_OFFSET + index, false);

    i = hmac(sha512, chainCode, data);
    key = i.slice(0, 32);
    chainCode = i.slice(32);
  }

  return key;
}
