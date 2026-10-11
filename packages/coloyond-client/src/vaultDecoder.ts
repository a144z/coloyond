/** Strict read-only decoder for the S1F Anchor Vault account. */
export const PROGRAM_ID = "FN7uGX34qyijmVX69gqEkMugWjE5Sjso8Pe7gWU6B2N6";
export const VAULT_ACCOUNT_SIZE = 353;
export const VAULT_DISCRIMINATOR = Uint8Array.of(211, 8, 232, 43, 2, 152, 117, 119);

export type DecodedAsset = {
  mint: string;
  tokenProgram: string;
  custody: string;
  decimals: number;
  targetBps: number;
};

export type DecodedVault = {
  version: number;
  bump: number;
  status: "uninitialized" | "active" | "paused";
  authority: string;
  configurationRevision: string;
  assets: [DecodedAsset, DecodedAsset];
  shareMint: string;
  totalShares: string;
  minimumLockedShares: string;
  accountedAmounts: [string, string];
  bootstrapReserve: [string, string];
  bountyLiabilities: [string, string];
  sequence: string;
};

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits = [0];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i]!;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j]! << 8;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  if (zeros === bytes.length) return "1".repeat(zeros);
  return "1".repeat(zeros) + digits.reverse().map((digit) => ALPHABET[digit]).join("");
}

class Reader {
  private offset = 0;
  private readonly view: DataView;

  constructor(private readonly data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  u8(): number { return this.view.getUint8(this.offset++); }
  u16(): number { const value = this.view.getUint16(this.offset, true); this.offset += 2; return value; }
  u64(): string { const value = this.view.getBigUint64(this.offset, true); this.offset += 8; return value.toString(); }
  pubkey(): string { const value = base58(this.data.subarray(this.offset, this.offset + 32)); this.offset += 32; return value; }
  discriminator(): Uint8Array { const value = this.data.subarray(this.offset, this.offset + 8); this.offset += 8; return value; }
}

export function decodeVaultAccount(data: Uint8Array, ownerProgramId: string): DecodedVault {
  if (ownerProgramId !== PROGRAM_ID) throw new Error("Vault account owner does not match the generated Anchor IDL program address");
  if (data.byteLength !== VAULT_ACCOUNT_SIZE) throw new Error(`Vault account must contain exactly ${VAULT_ACCOUNT_SIZE} bytes`);
  const reader = new Reader(data);
  const discriminator = reader.discriminator();
  if (!VAULT_DISCRIMINATOR.every((byte, index) => discriminator[index] === byte)) {
    throw new Error("Vault account discriminator does not match the generated Anchor IDL");
  }
  const version = reader.u8();
  if (version !== 1) throw new Error(`Unsupported Vault account version ${version}`);
  const bump = reader.u8();
  const statusCode = reader.u8();
  const status = statusCode === 0 ? "uninitialized" : statusCode === 1 ? "active" : statusCode === 2 ? "paused" : undefined;
  if (!status) throw new Error(`Unsupported Vault status ${statusCode}`);
  const authority = reader.pubkey();
  const configurationRevision = reader.u64();
  const assets = [0, 1].map(() => ({
    mint: reader.pubkey(),
    tokenProgram: reader.pubkey(),
    custody: reader.pubkey(),
    decimals: reader.u8(),
    targetBps: reader.u16(),
  })) as [DecodedAsset, DecodedAsset];
  const shareMint = reader.pubkey();
  const totalShares = reader.u64();
  const minimumLockedShares = reader.u64();
  const accountedAmounts: [string, string] = [reader.u64(), reader.u64()];
  const bootstrapReserve: [string, string] = [reader.u64(), reader.u64()];
  const bountyLiabilities: [string, string] = [reader.u64(), reader.u64()];
  const sequence = reader.u64();
  return { version, bump, status, authority, configurationRevision, assets, shareMint, totalShares, minimumLockedShares, accountedAmounts, bootstrapReserve, bountyLiabilities, sequence };
}
