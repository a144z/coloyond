import type { ReadModelV1Fixture } from "../types.js";

/**
 * Synthetic examples for presentation and local development only.
 * These values are not fetched from a cluster and must never be shown as live.
 */
export const READ_MODEL_FIXTURES = {
  unavailable: {
    schema: "coloyond/ReadModel/v1",
    network: { cluster: "devnet", genesisHash: null },
    source: {
      kind: "fixture",
      providerLabel: "SYNTHETIC FIXTURE — no RPC source",
      observedAt: null,
      slot: null,
    },
    program: { programId: null, binaryHash: null, verified: false },
    vault: {
      address: null,
      shareMint: null,
      configRevision: null,
      phase: "unavailable",
      target: [],
      actual: null,
      totalSupply: null,
      estimatedNavUsd: null,
      exit: { available: null, mode: "unknown" },
    },
    oracle: [
      {
        feedId: "fixture-only:SOL/USD",
        publishTime: null,
        ageSeconds: null,
        verification: "unknown",
        confidenceBps: null,
        state: "unknown",
      },
    ],
    auction: null,
    reserve: null,
    lastConfirmedTransition: null,
  },
  staleOracle: {
    schema: "coloyond/ReadModel/v1",
    network: { cluster: "devnet", genesisHash: null },
    source: {
      kind: "fixture",
      providerLabel: "SYNTHETIC FIXTURE — no RPC source",
      observedAt: "2000-01-01T00:00:00.000Z",
      slot: "1",
    },
    program: { programId: null, binaryHash: null, verified: false },
    vault: {
      address: null,
      shareMint: null,
      configRevision: null,
      phase: "unknown",
      target: [],
      actual: null,
      totalSupply: null,
      estimatedNavUsd: null,
      exit: { available: null, mode: "unknown" },
    },
    oracle: [
      {
        feedId: "fixture-only:SOL/USD",
        publishTime: "2000-01-01T00:00:00.000Z",
        ageSeconds: 1_000_000_000,
        verification: "unknown",
        confidenceBps: null,
        state: "stale",
      },
    ],
    auction: null,
    reserve: null,
    lastConfirmedTransition: null,
  },
} satisfies Record<string, ReadModelV1Fixture>;
