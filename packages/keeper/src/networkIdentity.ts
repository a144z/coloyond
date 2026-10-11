export type KeeperCluster = "localnet" | "devnet";

// Confirmed by the Devnet and independent OnFinality RPCs on 2026-10-11.
export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export const TESTNET_GENESIS_HASH = "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY";

const PUBLIC_GENESIS_HASHES = new Set([
  DEVNET_GENESIS_HASH,
  MAINNET_GENESIS_HASH,
  TESTNET_GENESIS_HASH,
]);

export function assertClusterGenesisConfiguration(cluster: KeeperCluster, expectedGenesisHash: string): void {
  if (!expectedGenesisHash) throw new Error("An explicit cluster genesis hash is required");
  if (cluster === "devnet" && expectedGenesisHash !== DEVNET_GENESIS_HASH) {
    throw new Error("Devnet must use the current pinned Solana Devnet genesis hash");
  }
  if (cluster === "localnet" && PUBLIC_GENESIS_HASHES.has(expectedGenesisHash)) {
    throw new Error("A public Solana cluster genesis hash cannot be labeled Localnet");
  }
}

export function assertClusterRpcUrl(cluster: KeeperCluster, rpcUrl: string): void {
  if (cluster !== "localnet") return;
  let endpoint: URL;
  try {
    endpoint = new URL(rpcUrl);
  } catch {
    throw new Error("Localnet RPC URL must be a valid loopback URL");
  }
  if (!(["http:", "https:"].includes(endpoint.protocol)
    && ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname.toLowerCase())
    && !endpoint.username && !endpoint.password)) {
    throw new Error("Localnet RPC URL must use localhost or a loopback address without embedded credentials");
  }
}

export function assertRpcClusterGenesis(
  cluster: KeeperCluster,
  expectedGenesisHash: string,
  actualGenesisHash: string,
): void {
  assertClusterGenesisConfiguration(cluster, expectedGenesisHash);
  if (actualGenesisHash !== expectedGenesisHash) {
    throw new Error("RPC genesis hash does not match the explicitly configured Localnet/Devnet cluster");
  }
  if (cluster === "localnet" && PUBLIC_GENESIS_HASHES.has(actualGenesisHash)) {
    throw new Error("A public Solana cluster RPC cannot be labeled Localnet");
  }
}
