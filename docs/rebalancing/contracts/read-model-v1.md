# ReadModelV1

**Status:** frozen read-only projection shape for fixtures and UI planning. Values are observations, not signed financial instructions. A browser or client must never fill absent state with fabricated live-looking data.

```ts
type ReadModelV1 = {
  schema: "coloyond/ReadModel/v1";
  network: { cluster: "mainnet-beta" | "devnet" | "localnet"; genesisHash: string | null };
  source: { kind: "rpc" | "fixture"; providerLabel: string | null; observedAt: string | null; slot: number | null };
  program: { programId: string | null; binaryHash: string | null; verified: boolean };
  vault: {
    address: string | null; shareMint: string | null; configRevision: number | null;
    phase: "unavailable" | "active" | "paused" | "auction" | "unknown";
    target: Array<{ mint: string; symbol: string; weightBps: number }>;
    actual: Array<{ mint: string; symbol: string; weightBps: number }> | null;
    totalSupply: string | null; estimatedNavUsd: string | null;
    exit: { available: boolean | null; mode: "in_kind" | "unknown" };
  };
  oracle: Array<{
    feedId: string; publishTime: string | null; ageSeconds: number | null;
    verification: "full" | "partial" | "unknown"; confidenceBps: number | null;
    state: "fresh" | "stale" | "depegged" | "unavailable" | "unknown";
  }>;
  auction: { sequence: number | null; remaining: string | null; expiresAt: string | null; feeBps: number | null } | null;
  reserve: { amountByMint: Record<string, string>; bountyLiabilityByMint: Record<string, string> } | null;
  lastConfirmedTransition: { signature: string; kind: string; slot: number } | null;
};
```

Rules: integer base units and weights only; unknown is `null`/`unknown`, never zero by implication. `fixture` is visibly labeled as sample data. Target configuration and actual balance-derived weights stay separate. NAV is an estimate with source and observation slot, not a redeemable quote. Oracle values include publish time and age; stale or unknown blocks all new-risk claims. A submitted signature is not a confirmed transition. No wallet address or private order data belongs in this public model.
