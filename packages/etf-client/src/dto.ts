/** Draft ETF v1 read-model wire types. This module performs no RPC or signing. */
export type DecimalInteger = string;
export type Commitment = "processed" | "confirmed" | "finalized";
export type OracleMode = "receiver_full" | "push_feed";
export type ObservationFailure = "stale" | "unavailable" | "invalid" | "not_configured";

export type NetworkIdentity = {
  cluster: string;
  genesisHash: string;
  rpcLabel: string;
  commitment: Commitment;
  contextSlot: DecimalInteger;
};

export type OracleValue = {
  mode: "receiver_full";
  account: string;
  owner: string;
  feedId: string;
  rawPrice: DecimalInteger;
  confidence: DecimalInteger;
  exponent: number;
  publishTime: DecimalInteger;
  ageSeconds: DecimalInteger;
  verification: "full";
} | {
  mode: "push_feed";
  account: string;
  owner: string;
  feedId: string;
  rawPrice: DecimalInteger;
  confidence: DecimalInteger;
  exponent: number;
  publishTime: DecimalInteger;
  ageSeconds: DecimalInteger;
  verification: "full";
};

export type AvailableOracleObservation = OracleValue & { status: "available" };

export type FailedObservation = {
  status: ObservationFailure;
  reason: string;
};

export type BalanceObservation = {
  mint: string;
  decimals: number;
  rawAmount: DecimalInteger;
  contextSlot: DecimalInteger;
};

export type ReadSnapshotFixture = {
  id: string;
  kind: "observation";
  status: "available";
  network: NetworkIdentity;
  protocolRevision: string;
  oracle?: OracleValue;
  balances: BalanceObservation[];
  pool?: unknown;
  value?: unknown;
};

export type UnavailableFixture = {
  id: string;
  kind: "observation" | "oracle-observation";
  status: ObservationFailure;
  reason: string;
  [field: string]: unknown;
};

export type WalletAction =
  | { id: string; kind: "wallet-action"; status: "draft" | "awaiting_signature" }
  | { id: string; kind: "wallet-action"; status: "submitted"; [field: string]: unknown }
  | { id: string; kind: "wallet-action"; status: "rejected"; reason: string; [field: string]: unknown }
  | {
      id: string;
      kind: "wallet-action";
      status: "unknown";
      reason: string;
      automaticResendAllowed: false;
      [field: string]: unknown;
    }
  | {
      id: string;
      kind: "wallet-action";
      status: "confirmed";
      signature: string;
      messageHash: string;
      genesisHash: string;
      confirmationSlot: DecimalInteger;
      tokenDeltas: { mint: string; rawDelta: DecimalInteger }[];
      shareDelta: DecimalInteger;
    };

export type EtfReadModelFixture = ReadSnapshotFixture | UnavailableFixture | WalletAction | (AvailableOracleObservation & { id: string; kind: "oracle-observation" });

export type EtfReadModelFixtureDocument = {
  schema: "etf-read-model-v1";
  fixtureOnly: true;
  fixtures: EtfReadModelFixture[];
};

/** Behavioral port only; implementation waits for the frozen program IDL and manifest. */
export interface EtfClientPort<Snapshot, Preview, UnsignedBuild, Reconciliation> {
  readSnapshot(poolAddress: string, walletAddress?: string): Promise<Snapshot>;
  preview(action: unknown, snapshot: Snapshot): Promise<Preview>;
  buildUnsigned(preview: Preview): Promise<UnsignedBuild>;
  reconcile(actionIdentity: string, walletSignature?: string): Promise<Reconciliation>;
}
