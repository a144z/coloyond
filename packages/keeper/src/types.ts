export type Cluster = "localnet" | "devnet";

export type VaultAsset = {
  mint: string;
  tokenProgram: string;
  custody: string;
  decimals: number;
  targetBps: number;
};

export type VaultState = {
  version: number;
  status: "uninitialized" | "active" | "paused";
  authority: string;
  configurationRevision: bigint;
  assets: [VaultAsset, VaultAsset];
  accountedAmounts: [bigint, bigint];
  sequence: bigint;
};

export type GovernanceState = {
  version: number;
  vault: string;
  configurationRevision: bigint;
  targetBps: [number, number];
  riskPaused: boolean;
};

export type AuctionPolicyState = {
  version: number;
  vault: string;
  configurationRevision: bigint;
  maximumAgeSeconds: bigint;
  minimumDriftBps: number;
  maximumTradeValueQ9: bigint;
  cooldownSlots: bigint;
  lastCompletedSlot: bigint | null;
  durationSlots: bigint;
  maximumBountyPerFill: bigint;
  valid: boolean;
};

export type IntentState = {
  version: number;
  vault: string;
  sequence: bigint;
  targetRevision: bigint;
  policyRevision: bigint;
  sellAsset: 0 | 1;
  initialSellAmount: bigint;
  remainingSellAmount: bigint;
  endSlot: bigint;
};

export type ChainSnapshot = {
  slot: bigint;
  vaultAddress: string;
  oracleAccountsReady: boolean;
  custodyAccountsReady: boolean;
  custodyAmounts: [bigint, bigint];
  vault: VaultState;
  governance: GovernanceState | null;
  policy: AuctionPolicyState | null;
  intent: IntentState | null;
};

export type StartCandidate = {
  kind: "start";
  expectedVaultSequence: bigint;
  sellAsset: 0 | 1;
  initialSellAmount: bigint;
};

export type FillCandidate = {
  kind: "fill";
  expectedVaultSequence: bigint;
  expectedIntentSequence: bigint;
  sellAmount: bigint;
  grossBuyAmount: bigint;
  bountyAmount: bigint;
  takerIn: string;
  takerOut: string;
};

export type FinishCandidate = {
  kind: "finish";
  expectedVaultSequence: bigint;
  expectedIntentSequence: bigint;
};

export type KeeperAction = StartCandidate | FillCandidate | FinishCandidate;

export type ActionProposalSource = {
  start?: (snapshot: ChainSnapshot) => Promise<StartCandidate | null> | StartCandidate | null;
  fill?: (snapshot: ChainSnapshot) => Promise<FillCandidate | null> | FillCandidate | null;
};

export type ActionResult =
  | { status: "idle"; reason: string; slot: bigint }
  | { status: "stale"; reason: string; slot: bigint }
  | { status: "simulated"; action: KeeperAction; feeLamports: bigint | null; slot: bigint }
  | { status: "submitted"; action: KeeperAction; signature: string; slot: bigint }
  | { status: "confirmed"; action: KeeperAction; signature: string; sequence: bigint; slot: bigint }
  | { status: "rejected"; action: KeeperAction; reason: string; slot: bigint }
  | { status: "pending"; action: KeeperAction; signature: string; slot: bigint };

export type KeeperConfig = {
  cluster: Cluster;
  expectedGenesisHash: string;
  vaultAddress: string;
  callerPublicKey?: string;
  dryRun?: boolean;
  maxFeeLamports?: bigint;
  pollIntervalMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
};
