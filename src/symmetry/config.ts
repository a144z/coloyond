import { Connection } from "@solana/web3.js";
import { SymmetryCore } from "@symmetry-hq/sdk";

export type SymmetryNetwork = "devnet" | "mainnet";

export const SYMMETRY_PROGRAM_ID = "BASKT7aKd8n7ibpUbwLP3Wiyxyi3yoiXsxBk4Hpumate";

export const NETWORK_RPC: Record<SymmetryNetwork, string> = {
  devnet: "https://api.devnet.solana.com",
  mainnet: "https://api.mainnet-beta.solana.com",
};

export const DEFAULT_NETWORK: SymmetryNetwork = "devnet";

type Bundle = { connection: Connection; sdk: SymmetryCore };

const cache = new Map<string, Bundle>();

export function getSymmetry(network: SymmetryNetwork, rpcUrl?: string): Bundle {
  const endpoint = rpcUrl ?? NETWORK_RPC[network];
  const key = `${network}|${endpoint}`;
  let hit = cache.get(key);
  if (!hit) {
    const connection = new Connection(endpoint, "confirmed");
    hit = { connection, sdk: new SymmetryCore({ connection, network }) };
    cache.set(key, hit);
  }
  return hit;
}
