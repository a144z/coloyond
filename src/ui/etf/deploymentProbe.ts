import { sha256 } from "@noble/hashes/sha256";
import { PublicKey, type Connection } from "@solana/web3.js";
import type { VerifiedEtfManifest } from "../../../packages/etf-client/src/index.js";

const UPGRADEABLE_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

export type DeploymentProbe = Readonly<{
  program: "verified" | "missing" | "invalid";
  pool: "uninitialized" | "initialized" | "partial";
  programData: string | null;
  binarySha256: string | null;
  upgradeAuthority: string | null;
  reason: string | null;
}>;

function bytesHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

/** Verifies the accepted program identity before allowing initialization or a pool read. */
export async function probeEtfDeployment(connection: Connection, context: VerifiedEtfManifest): Promise<DeploymentProbe> {
  const programAccount = await connection.getAccountInfo(context.programId, "confirmed");
  if (!programAccount) return { program: "missing", pool: "uninitialized", programData: null, binarySha256: null, upgradeAuthority: null, reason: "accepted_program_account_not_deployed" };
  if (!programAccount.executable || !programAccount.owner.equals(UPGRADEABLE_LOADER) || programAccount.data.length !== 36 || programAccount.data.readUInt32LE(0) !== 2) {
    return { program: "invalid", pool: "partial", programData: null, binarySha256: null, upgradeAuthority: null, reason: "program_loader_account_invalid" };
  }
  const programData = new PublicKey(programAccount.data.subarray(4, 36));
  const programDataAccount = await connection.getAccountInfo(programData, "confirmed");
  if (!programDataAccount || programDataAccount.executable || !programDataAccount.owner.equals(UPGRADEABLE_LOADER) || programDataAccount.data.length < 45 || programDataAccount.data.readUInt32LE(0) !== 3) {
    return { program: "invalid", pool: "partial", programData: programData.toBase58(), binarySha256: null, upgradeAuthority: null, reason: "program_data_account_invalid" };
  }
  const authorityTag = programDataAccount.data[12]!;
  if (authorityTag !== 0 && authorityTag !== 1) {
    return { program: "invalid", pool: "partial", programData: programData.toBase58(), binarySha256: null, upgradeAuthority: null, reason: "program_upgrade_authority_tag_invalid" };
  }
  const upgradeAuthority = authorityTag === 1 ? new PublicKey(programDataAccount.data.subarray(13, 45)).toBase58() : null;
  const binarySha256 = bytesHex(sha256(programDataAccount.data.subarray(45)));
  if (upgradeAuthority !== context.manifest.expectedUpgradeAuthority || binarySha256 !== context.manifest.programBinarySha256) {
    return { program: "invalid", pool: "partial", programData: programData.toBase58(), binarySha256, upgradeAuthority, reason: upgradeAuthority !== context.manifest.expectedUpgradeAuthority ? "program_upgrade_authority_mismatch" : "deployed_program_binary_hash_mismatch" };
  }

  const poolAddresses = [context.addresses.pool, context.addresses.poolState, context.addresses.shareMint,
    ...context.addresses.assets.slice(0, context.config.assets.length).flatMap(({ custody, assetState }) => [custody, assetState])];
  const poolAccounts = await connection.getMultipleAccountsInfo(poolAddresses, "confirmed");
  const present = poolAccounts.filter((account) => account !== null).length;
  const pool: DeploymentProbe["pool"] = present === 0 ? "uninitialized" : present === poolAccounts.length ? "initialized" : "partial";
  return { program: "verified", pool, programData: programData.toBase58(), binarySha256, upgradeAuthority, reason: null };
}
