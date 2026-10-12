import { Buffer } from "buffer";
import { PublicKey } from "@solana/web3.js";
import { assetSpec, mintToAssetMap, type AssetId } from "./assets.js";
import { EXECUTION_PROGRAM_ID } from "./config.js";
import {
  VAULT_FEEDS,
  VAULT_STATE_DISCRIMINATOR,
} from "./vault-feed-registry.js";
import type { OnChainVaultState, OnChainVaultAsset } from "./execution.js";
export function decodeVaultState(
  address: PublicKey,
  bytes: Uint8Array,
): OnChainVaultState {
  const data = Buffer.from(bytes);
  if (
    data.length < 98 ||
    !data.subarray(0, 8).equals(Buffer.from(VAULT_STATE_DISCRIMINATOR))
  )
    throw Error("Invalid Vault State discriminator or size.");
  let offset = 8;
  const id = data.readBigUInt64LE(offset);
  offset += 8;
  const owner = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  const shareMint = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  const activeByte = data[offset++];
  if (activeByte > 1) throw Error("Invalid active flag.");
  const thresholdBps = data.readUInt16LE(offset);
  offset += 2;
  const maxSlippageBps = data.readUInt16LE(offset);
  offset += 2;
  offset++;
  const lastSettledNonce = data.readBigUInt64LE(offset);
  offset += 8;
  const count = data.readUInt32LE(offset);
  offset += 4;
  if (
    count < 1 ||
    count > 4 ||
    data.length < offset + count * 99 ||
    thresholdBps === 0 || thresholdBps > 1000 ||
    maxSlippageBps === 0 || maxSlippageBps > 500
  )
    throw Error("Invalid Vault State config.");
  const program = new PublicKey(EXECUTION_PROGRAM_ID),
    idBytes = Buffer.alloc(8);
  idBytes.writeBigUInt64LE(id);
  const [state] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), owner.toBuffer(), idBytes],
    program,
  );
  const [expectedShare] = PublicKey.findProgramAddressSync(
    [Buffer.from("share-mint"), address.toBuffer()],
    program,
  );
  if (!state.equals(address) || !shareMint.equals(expectedShare))
    throw Error("Vault State or share mint does not match its PDA.");
  const mints = mintToAssetMap(),
    seen = new Set<string>(),
    assets: OnChainVaultAsset[] = [];
  for (let i = 0; i < count; i++) {
    const mint = new PublicKey(data.subarray(offset, offset + 32));
    offset += 32;
    const assetId = mints.get(mint.toBase58());
    if (!assetId || seen.has(assetId))
      throw Error("Unsupported or duplicate vault asset.");
    seen.add(assetId);
    const decimals = data[offset++],
      targetBps = data.readUInt16LE(offset);
    offset += 2;
    const feedAccount = new PublicKey(data.subarray(offset, offset + 32));
    offset += 32;
    const feedId = data.subarray(offset, offset + 32).toString("hex");
    offset += 32;
    const feed =
      assetId === "dusd"
        ? null
        : VAULT_FEEDS[assetId as keyof typeof VAULT_FEEDS];
    if (
      decimals !== assetSpec(assetId).decimals ||
      targetBps > 10000 ||
      !feedAccount.equals(
        feed ? new PublicKey(feed.account) : PublicKey.default,
      ) ||
      feedId !== (feed?.id ?? "0".repeat(64))
    )
      throw Error("Vault asset decimals, target or oracle identity mismatch.");
    assets.push({
      id: assetId as AssetId,
      mint,
      decimals,
      targetBps,
      feedAccount,
    });
  }
  if (assets.reduce((sum, a) => sum + a.targetBps, 0) !== 10000)
    throw Error("Vault targets must sum to 10000 basis points.");
  return {
    id,
    owner,
    shareMint,
    active: activeByte === 1,
    thresholdBps,
    maxSlippageBps,
    lastSettledNonce,
    assets,
  };
}
