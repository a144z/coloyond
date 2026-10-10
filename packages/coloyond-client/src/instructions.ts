/**
 * Instruction encoder for the `initialize_vault` entry point, mirroring the IDL
 * account order and the `VaultInit` argument layout byte for byte. Pure byte
 * helpers so it works in Node and the browser without a transaction builder.
 */
export const INITIALIZE_VAULT_DISCRIMINATOR = Uint8Array.of(48, 191, 163, 44, 71, 129, 63, 164);

/** IDL account order for `initialize_vault`, kept for key list assertions. */
export const INITIALIZE_VAULT_ACCOUNT_ORDER = [
  "vault",
  "governance",
  "auction_policy",
  "share_mint",
  "seeder",
  "seeder_shares",
  "seeder_asset_a",
  "seeder_asset_b",
  "custody_a",
  "custody_b",
  "mint_a",
  "mint_b",
  "sol_usd",
  "usdc_usd",
  "token_program",
  "system_program",
] as const;

export type VaultInitArgs = {
  configurationRevision: bigint;
  targetBps: [number, number];
  seedAmounts: [bigint, bigint];
  reserveContributions: [bigint, bigint];
  initialShares: bigint;
  minimumLockedShares: bigint;
  governanceAuthority: string;
  emergencyAuthority: string;
  minDelaySlots: bigint;
  maximumAgeSeconds: bigint;
  maximumConfidenceBps: number;
  maximumUsdcDeviationBps: number;
  minimumDriftBps: number;
  maximumTradeValueQ9: bigint;
  cooldownSlots: bigint;
  curveStartRateBps: number;
  curveEndRateBps: number;
  durationSlots: bigint;
  feeBps: number;
  maximumFeeBps: number;
  maximumBountyPerFill: bigint;
  maximumNavLossBps: number;
  maximumCumulativeNavLossBps: number;
  assetFeedIndices: [number, number];
};

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_INDEX = new Map(Array.from(ALPHABET, (character, index) => [character, index] as const));

export function base58Decode(text: string): Uint8Array {
  let zeros = 0;
  while (zeros < text.length && text[zeros] === "1") zeros++;
  let value = 0n;
  for (const character of text.slice(zeros)) {
    const digit = BASE58_INDEX.get(character);
    if (digit === undefined) throw new Error(`invalid base58 character: ${character}`);
    value = value * 58n + BigInt(digit);
  }
  const magnitude: number[] = [];
  while (value > 0n) {
    magnitude.unshift(Number(value % 256n));
    value /= 256n;
  }
  if (zeros + magnitude.length > 32) throw new Error("base58 value does not fit a pubkey");
  return Uint8Array.from([...new Array<number>(32 - magnitude.length).fill(0), ...magnitude].slice(-32));
}

class Writer {
  readonly bytes = new Uint8Array(1024);
  private offset = 0;
  private readonly view = new DataView(this.bytes.buffer);

  u8(value: number): void {
    this.view.setUint8(this.offset, value);
    this.offset += 1;
  }

  skip(length: number): void {
    this.offset += length;
  }

  u16(value: number): void {
    this.view.setUint16(this.offset, value, true);
    this.offset += 2;
  }

  u64(value: bigint): void {
    this.view.setBigUint64(this.offset, value, true);
    this.offset += 8;
  }

  pubkey(address: string): void {
    this.bytes.set(base58Decode(address), this.offset);
    this.offset += 32;
  }

  get length(): number {
    return this.offset;
  }
}

/** Borsh encodes the discriminator plus the single `VaultInit` argument. */
export function encodeInitializeVault(init: VaultInitArgs): Uint8Array {
  const writer = new Writer();
  writer.bytes.set(INITIALIZE_VAULT_DISCRIMINATOR, 0);
  writer.skip(8);
  writer.u64(init.configurationRevision);
  writer.u16(init.targetBps[0]);
  writer.u16(init.targetBps[1]);
  writer.u64(init.seedAmounts[0]);
  writer.u64(init.seedAmounts[1]);
  writer.u64(init.reserveContributions[0]);
  writer.u64(init.reserveContributions[1]);
  writer.u64(init.initialShares);
  writer.u64(init.minimumLockedShares);
  writer.pubkey(init.governanceAuthority);
  writer.pubkey(init.emergencyAuthority);
  writer.u64(init.minDelaySlots);
  writer.u64(init.maximumAgeSeconds);
  writer.u16(init.maximumConfidenceBps);
  writer.u16(init.maximumUsdcDeviationBps);
  writer.u16(init.minimumDriftBps);
  writer.u64(init.maximumTradeValueQ9);
  writer.u64(init.cooldownSlots);
  writer.u16(init.curveStartRateBps);
  writer.u16(init.curveEndRateBps);
  writer.u64(init.durationSlots);
  writer.u16(init.feeBps);
  writer.u16(init.maximumFeeBps);
  writer.u64(init.maximumBountyPerFill);
  writer.u16(init.maximumNavLossBps);
  writer.u16(init.maximumCumulativeNavLossBps);
  writer.u8(init.assetFeedIndices[0]);
  writer.u8(init.assetFeedIndices[1]);
  return writer.bytes.subarray(0, writer.length);
}
