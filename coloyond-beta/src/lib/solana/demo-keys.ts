/**
 * Devnet demo keys, loaded from JSON so the bootstrap script (plain node)
 * can read and write the same source of truth.
 *
 * These keypairs are DEVNET-ONLY demo infrastructure:
 *  - the reserve is the funded counterparty for every asset pair
 *  - each mint keypair controls one synthetic asset (tUSD, tBTC, tETH)
 *
 * They must never hold mainnet value. In a production build the reserve
 * becomes a backend service and the mint authorities move off-device.
 */
import keysJsonRaw from './demo-keys.json';

export interface MintKey {
  secretB58: string;
  address: string;
}

export interface DemoKeys {
  reserveSecretB58: string;
  mints: Record<string, MintKey>;
  note: string;
}

export const keysJson = keysJsonRaw as unknown as DemoKeys;

export function assertDemoKeys(): void {
  const missing = ['tusd', 'tbtc', 'teth'].filter((id) => !keysJson.mints?.[id]?.address);
  if (!keysJson.reserveSecretB58 || missing.length > 0) {
    throw new Error(
      `Demo reserve keys are missing (${missing.join(', ') || 'reserve'}). Run: npm run bootstrap:reserve (generates src/lib/solana/demo-keys.json first)`,
    );
  }
}
