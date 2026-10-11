import { KeeperService } from "./keeper.js";
import { loadRuntimeSignerFromEnvironment, SolanaKeeperRuntime } from "./solana.js";
import type { ActionProposalSource, KeeperConfig } from "./types.js";

export function keeperConfigFromEnvironment(env: NodeJS.ProcessEnv = process.env): KeeperConfig & { rpcUrl: string } {
  const cluster = env.COLOYOND_KEEPER_CLUSTER;
  if (cluster !== "localnet" && cluster !== "devnet") throw new Error("COLOYOND_KEEPER_CLUSTER must be localnet or devnet; mainnet is not supported");
  const rpcUrl = required(env, "COLOYOND_KEEPER_RPC_URL");
  const expectedGenesisHash = required(env, "COLOYOND_KEEPER_GENESIS_HASH");
  const vaultAddress = required(env, "COLOYOND_KEEPER_VAULT_ADDRESS");
  const dryRunText = env.COLOYOND_KEEPER_DRY_RUN;
  const dryRun = dryRunText === undefined || dryRunText === "true" || dryRunText === "1";
  if (!dryRun && dryRunText !== "false" && dryRunText !== "0") throw new Error("COLOYOND_KEEPER_DRY_RUN must be true or false");
  const callerPublicKey = env.COLOYOND_KEEPER_PUBLIC_KEY?.trim();
  if (!callerPublicKey) throw new Error("COLOYOND_KEEPER_PUBLIC_KEY is required to assemble and simulate the keeper instruction");
  const maxFeeText = env.COLOYOND_KEEPER_MAX_FEE_LAMPORTS;
  const maxFeeLamports = maxFeeText === undefined ? undefined : parsePositiveBigint(maxFeeText, "COLOYOND_KEEPER_MAX_FEE_LAMPORTS");
  if (!dryRun && maxFeeLamports === undefined) throw new Error("Submission requires COLOYOND_KEEPER_MAX_FEE_LAMPORTS");
  return { cluster, rpcUrl, expectedGenesisHash, vaultAddress, callerPublicKey, dryRun, maxFeeLamports };
}

export function createKeeperFromEnvironment(proposals: ActionProposalSource = {}, observe?: ConstructorParameters<typeof KeeperService>[3]): KeeperService {
  const config = keeperConfigFromEnvironment();
  const signer = config.dryRun ? undefined : loadRuntimeSignerFromEnvironment();
  const runtime = new SolanaKeeperRuntime({ ...config, signer });
  return new KeeperService(config, runtime, proposals, observe);
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parsePositiveBigint(value: string, name: string): bigint {
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`${name} must be a positive base-10 integer`);
  return BigInt(value);
}
