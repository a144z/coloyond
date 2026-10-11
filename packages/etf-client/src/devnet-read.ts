import { Connection, PublicKey, type AccountInfo, type Commitment } from "@solana/web3.js";

export const ETF_DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const ETF_DEVNET_RECEIVER_PROGRAM = "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ";
export const ETF_DEVNET_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

export type DraftOracleLimits = {
  status: "draft_not_approved";
  maximumAgeSeconds: number;
  maximumConfidenceBps: number;
};

export type CandidateFeed = {
  label: string;
  address: string;
  feedId: string;
  associatedMint: string | null;
};

export const ETF_DEVNET_CANDIDATE_FEEDS: readonly CandidateFeed[] = [
  {
    label: "SOL/USD candidate",
    address: "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE",
    feedId: "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
    associatedMint: "So11111111111111111111111111111111111111112",
  },
  {
    label: "BTC/USD candidate · no Devnet BTC mint admitted",
    address: "4cSM2e6rvbGQUFiJbqytoVMi5GgghSMr8LwVrT9VPSPo",
    feedId: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    associatedMint: null,
  },
  {
    label: "USD/USD candidate · test mint is synthetic / unbacked",
    address: "Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX",
    feedId: "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
    associatedMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  },
];

const CANDIDATE_MINTS = [
  {
    symbol: "WSOL",
    label: "Wrapped SOL · candidate, not admitted",
    mint: "So11111111111111111111111111111111111111112",
    backing: "wrapped SOL",
  },
  {
    symbol: "Test USD",
    label: "Test USD · synthetic / unbacked; not redeemable as USDC",
    mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    backing: "synthetic / unbacked",
  },
] as const;

const RECEIVER_OWNER = new PublicKey(ETF_DEVNET_RECEIVER_PROGRAM);
const TOKEN_OWNER = new PublicKey(ETF_DEVNET_TOKEN_PROGRAM);
const PRICE_UPDATE_V2_DISCRIMINATOR = Uint8Array.from([0x22, 0xf1, 0x23, 0x63, 0x9d, 0x7e, 0xf4, 0xcd]);
const PRICE_UPDATE_FULL_LENGTH = 133;
const PRICE_UPDATE_MAX_ALLOCATED_LENGTH = 134;
const PRICE_UPDATE_VERIFICATION_OFFSET = 40;
const PRICE_UPDATE_FEED_ID_OFFSET = 41;
const PRICE_UPDATE_PRICE_OFFSET = 73;
const PRICE_UPDATE_CONFIDENCE_OFFSET = 81;
const PRICE_UPDATE_EXPONENT_OFFSET = 89;
const PRICE_UPDATE_PUBLISH_TIME_OFFSET = 93;
const U64_MAX = (1n << 64n) - 1n;
const I64_MIN = -(1n << 63n);
const I64_MAX = (1n << 63n) - 1n;

export type MintObservation = {
  address: string;
  symbol: string;
  label: string;
  backing: string;
  admission: "not_admitted";
  status: "available" | "unavailable" | "invalid";
  owner: string | null;
  dataLength: number | null;
  decimals: number | null;
  supplyBaseUnits: string | null;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  isInitialized: boolean | null;
  reason?: string;
};

export type FeedObservation = {
  label: string;
  address: string;
  expectedFeedId: string;
  associatedMint: string | null;
  status: "available" | "unavailable" | "invalid";
  owner: string | null;
  dataLength: number | null;
  feedId: string | null;
  verification: "full" | "partial" | "unknown";
  rawPrice: string | null;
  confidence: string | null;
  confidenceBpsCeil: string | null;
  exponent: number | null;
  publishTime: string | null;
  observedUnixTime: string | null;
  ageSeconds: string | null;
  freshness: "unconfigured" | "within_draft_limits" | "stale_under_draft_limit" | "confidence_over_draft_limit" | "future_publish_time" | "unavailable" | "invalid";
  policy: DraftOracleLimits | null;
  exponentDisplaySupport: "-17..0 candidate bounds; not an approved policy";
  reason?: string;
};

export type WalletTokenBalance = {
  mint: string;
  status: "available" | "unavailable" | "invalid";
  rawAmount: string | null;
  tokenAccountCount: number | null;
  frozenAccountCount: number | null;
  contextSlot: string | null;
  reason?: string;
};

export type DevnetCandidateRead = {
  status: "candidate_data";
  network: {
    cluster: "devnet";
    genesisHash: string;
    rpcHost: string;
    commitment: "confirmed" | "finalized";
    contextSlot: string;
    observedUnixTime: string | null;
  };
  deployment: {
    program: { status: "not_configured"; programId: null };
    pool: { status: "not_configured"; address: null };
  };
  admission: "not_admitted";
  oraclePolicy: DraftOracleLimits | null;
  mints: MintObservation[];
  feeds: FeedObservation[];
  wallet: { address: string; balances: WalletTokenBalance[] } | null;
};

export type DevnetReadFailure = {
  status: "genesis_mismatch" | "unavailable";
  reason: string;
  expectedGenesisHash: typeof ETF_DEVNET_GENESIS_HASH;
  actualGenesisHash: string | null;
  network: { cluster: "devnet"; rpcHost: string; commitment: "confirmed" | "finalized" };
  deployment: DevnetCandidateRead["deployment"];
};

export type DevnetReadResult = DevnetCandidateRead | DevnetReadFailure;

function view(data: Uint8Array): DataView {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function feedIdHex(bytes: Uint8Array): string {
  return `0x${hex(bytes)}`;
}

function cOptionKey(data: Uint8Array, tagOffset: number, keyOffset: number): string | null {
  const tag = view(data).getUint32(tagOffset, true);
  if (tag === 0) return null;
  if (tag !== 1) throw new Error("invalid_coption_tag");
  return new PublicKey(data.slice(keyOffset, keyOffset + 32)).toBase58();
}

export function decodeClassicSplMint(address: string, account: AccountInfo<Buffer>): Omit<MintObservation, "symbol" | "label" | "backing" | "admission"> {
  const owner = account.owner.toBase58();
  if (!account.owner.equals(TOKEN_OWNER)) throw new Error("wrong_token_program_owner");
  if (account.executable) throw new Error("mint_account_is_executable");
  if (account.data.length !== 82) throw new Error("wrong_classic_mint_layout_length");
  const data = account.data;
  const decimals = data[44];
  const initialized = data[45];
  if (initialized !== 1) throw new Error("mint_not_initialized");
  if (decimals === undefined) throw new Error("truncated_classic_mint_layout");
  const supply = view(data).getBigUint64(36, true);
  if (supply > U64_MAX) throw new Error("mint_supply_out_of_range");
  return {
    address,
    status: "available",
    owner,
    dataLength: data.length,
    decimals,
    supplyBaseUnits: supply.toString(),
    mintAuthority: cOptionKey(data, 0, 4),
    freezeAuthority: cOptionKey(data, 46, 50),
    isInitialized: true,
  };
}

function invalidFeed(
  feed: CandidateFeed,
  account: AccountInfo<Buffer> | null,
  reason: string,
  policy: DraftOracleLimits | null,
): FeedObservation {
  return {
    label: feed.label,
    address: feed.address,
    expectedFeedId: feed.feedId,
    associatedMint: feed.associatedMint,
    status: account === null ? "unavailable" : "invalid",
    owner: account?.owner.toBase58() ?? null,
    dataLength: account?.data.length ?? null,
    feedId: null,
    verification: "unknown",
    rawPrice: null,
    confidence: null,
    confidenceBpsCeil: null,
    exponent: null,
    publishTime: null,
    observedUnixTime: null,
    ageSeconds: null,
    freshness: account === null ? "unavailable" : "invalid",
    policy,
    exponentDisplaySupport: "-17..0 candidate bounds; not an approved policy",
    reason,
  };
}

export function decodeCandidatePriceFeed(
  feed: CandidateFeed,
  account: AccountInfo<Buffer> | null,
  observedUnixTime: number | null,
  policy: DraftOracleLimits | null = null,
): FeedObservation {
  const pinned = ETF_DEVNET_CANDIDATE_FEEDS.find((candidate) => candidate.address === feed.address);
  if (pinned === undefined || pinned.feedId.toLowerCase() !== feed.feedId.toLowerCase()) {
    return invalidFeed(feed, account, "feed_not_in_pinned_manifest", policy);
  }
  if (account === null) return invalidFeed(feed, null, "feed_account_missing", policy);
  if (!account.owner.equals(RECEIVER_OWNER)) return invalidFeed(feed, account, "wrong_receiver_owner", policy);
  if (account.executable) return invalidFeed(feed, account, "feed_account_is_executable", policy);
  if (account.data.length !== PRICE_UPDATE_FULL_LENGTH && account.data.length !== PRICE_UPDATE_MAX_ALLOCATED_LENGTH) {
    return invalidFeed(feed, account, "wrong_price_update_v2_length", policy);
  }
  const data = account.data;
  if (!PRICE_UPDATE_V2_DISCRIMINATOR.every((byte, index) => data[index] === byte)) {
    return invalidFeed(feed, account, "wrong_price_update_v2_discriminator", policy);
  }
  const verificationTag = data[PRICE_UPDATE_VERIFICATION_OFFSET];
  if (verificationTag !== 1) {
    const result = invalidFeed(feed, account, verificationTag === 0 ? "partial_verification" : "unknown_verification_level", policy);
    result.verification = verificationTag === 0 ? "partial" : "unknown";
    return result;
  }

  const actualFeedId = feedIdHex(data.slice(PRICE_UPDATE_FEED_ID_OFFSET, PRICE_UPDATE_FEED_ID_OFFSET + 32));
  if (actualFeedId.toLowerCase() !== feed.feedId.toLowerCase()) {
    const result = invalidFeed(feed, account, "wrong_embedded_feed_id", policy);
    result.feedId = actualFeedId;
    result.verification = "full";
    return result;
  }

  const dataView = view(data);
  const rawPrice = dataView.getBigInt64(PRICE_UPDATE_PRICE_OFFSET, true);
  const confidence = dataView.getBigUint64(PRICE_UPDATE_CONFIDENCE_OFFSET, true);
  const exponent = dataView.getInt32(PRICE_UPDATE_EXPONENT_OFFSET, true);
  const publishTime = dataView.getBigInt64(PRICE_UPDATE_PUBLISH_TIME_OFFSET, true);
  const populated = {
    feedId: actualFeedId,
    verification: "full" as const,
    rawPrice: rawPrice.toString(),
    confidence: confidence.toString(),
    exponent,
    publishTime: publishTime.toString(),
  };
  if (rawPrice <= 0n) {
    return { ...invalidFeed(feed, account, "nonpositive_price", policy), ...populated };
  }
  if (exponent < -17 || exponent > 0) {
    return { ...invalidFeed(feed, account, "unsupported_display_exponent", policy), ...populated };
  }
  if (observedUnixTime === null || !Number.isSafeInteger(observedUnixTime)) {
    return { ...invalidFeed(feed, account, "chain_time_unavailable", policy), ...populated };
  }
  const observedTime = BigInt(observedUnixTime);
  if (observedTime < I64_MIN || observedTime > I64_MAX) {
    return { ...invalidFeed(feed, account, "chain_time_out_of_range", policy), ...populated };
  }
  const age = observedTime - publishTime;
  if (age < 0n) {
    return {
      ...invalidFeed(feed, account, "future_publish_time", policy),
      ...populated,
      observedUnixTime: observedTime.toString(),
      ageSeconds: age.toString(),
      freshness: "future_publish_time",
    };
  }

  const confidenceBpsCeil = ((confidence * 10_000n) + rawPrice - 1n) / rawPrice;
  let freshness: FeedObservation["freshness"] = "unconfigured";
  if (policy !== null) {
    if (age > BigInt(policy.maximumAgeSeconds)) freshness = "stale_under_draft_limit";
    else if (confidenceBpsCeil > BigInt(policy.maximumConfidenceBps)) freshness = "confidence_over_draft_limit";
    else freshness = "within_draft_limits";
  }
  return {
    label: feed.label,
    address: feed.address,
    expectedFeedId: feed.feedId,
    associatedMint: feed.associatedMint,
    status: "available",
    owner: account.owner.toBase58(),
    dataLength: data.length,
    ...populated,
    confidenceBpsCeil: confidenceBpsCeil.toString(),
    observedUnixTime: observedTime.toString(),
    ageSeconds: age.toString(),
    freshness,
    policy,
    exponentDisplaySupport: "-17..0 candidate bounds; not an approved policy",
  };
}

function notConfiguredDeployment(): DevnetCandidateRead["deployment"] {
  return {
    program: { status: "not_configured", programId: null },
    pool: { status: "not_configured", address: null },
  };
}

function rpcHost(connection: Connection): string {
  try {
    return new URL(connection.rpcEndpoint).origin;
  } catch {
    return "RPC host unavailable";
  }
}

function mintObservation(
  candidate: (typeof CANDIDATE_MINTS)[number],
  account: AccountInfo<Buffer> | null,
): MintObservation {
  const identity = {
    address: candidate.mint,
    symbol: candidate.symbol,
    label: candidate.label,
    backing: candidate.backing,
    admission: "not_admitted" as const,
  };
  if (account === null) {
    return {
      ...identity,
      status: "unavailable",
      owner: null,
      dataLength: null,
      decimals: null,
      supplyBaseUnits: null,
      mintAuthority: null,
      freezeAuthority: null,
      isInitialized: null,
      reason: "mint_account_missing",
    };
  }
  try {
    return { ...identity, ...decodeClassicSplMint(candidate.mint, account) };
  } catch (error) {
    return {
      ...identity,
      status: "invalid",
      owner: account.owner.toBase58(),
      dataLength: account.data.length,
      decimals: null,
      supplyBaseUnits: null,
      mintAuthority: null,
      freezeAuthority: null,
      isInitialized: null,
      reason: error instanceof Error ? error.message : "invalid_mint_account",
    };
  }
}

function readClassicTokenBalance(
  mint: string,
  wallet: PublicKey,
  account: AccountInfo<Buffer>,
): { amount: bigint; frozen: boolean } {
  if (!account.owner.equals(TOKEN_OWNER)) throw new Error("wrong_token_account_program_owner");
  if (account.executable || account.data.length !== 165) throw new Error("wrong_classic_token_account_layout");
  const data = account.data;
  if (!new PublicKey(data.slice(0, 32)).equals(new PublicKey(mint))) throw new Error("token_account_mint_mismatch");
  if (!new PublicKey(data.slice(32, 64)).equals(wallet)) throw new Error("token_account_owner_mismatch");
  const state = data[108];
  if (state !== 1 && state !== 2) throw new Error("token_account_not_initialized");
  return { amount: view(data).getBigUint64(64, true), frozen: state === 2 };
}

async function readWalletBalances(
  connection: Connection,
  walletAddress: string | undefined,
  commitment: "confirmed" | "finalized",
): Promise<{ address: string; balances: WalletTokenBalance[] } | null> {
  if (walletAddress === undefined) return null;
  let wallet: PublicKey;
  try {
    wallet = new PublicKey(walletAddress);
  } catch {
    return {
      address: walletAddress,
      balances: CANDIDATE_MINTS.map(({ mint }) => ({
        mint,
        status: "invalid",
        rawAmount: null,
        tokenAccountCount: null,
        frozenAccountCount: null,
        contextSlot: null,
        reason: "invalid_wallet_address",
      })),
    };
  }
  const balances: WalletTokenBalance[] = [];
  for (const candidate of CANDIDATE_MINTS) {
    try {
      const response = await connection.getTokenAccountsByOwner(wallet, { mint: new PublicKey(candidate.mint) }, commitment);
      let total = 0n;
      let frozen = 0;
      for (const item of response.value) {
        const decoded = readClassicTokenBalance(candidate.mint, wallet, item.account);
        total += decoded.amount;
        if (decoded.frozen) frozen += 1;
      }
      balances.push({
        mint: candidate.mint,
        status: "available",
        rawAmount: total.toString(),
        tokenAccountCount: response.value.length,
        frozenAccountCount: frozen,
        contextSlot: response.context.slot.toString(),
      });
    } catch (error) {
      balances.push({
        mint: candidate.mint,
        status: "unavailable",
        rawAmount: null,
        tokenAccountCount: null,
        frozenAccountCount: null,
        contextSlot: null,
        reason: error instanceof Error ? error.message : "wallet_balance_read_failed",
      });
    }
  }
  return { address: wallet.toBase58(), balances };
}

function validateDraftLimits(limits: DraftOracleLimits | undefined): DraftOracleLimits | null {
  if (limits === undefined) return null;
  if (
    limits.status !== "draft_not_approved" ||
    !Number.isSafeInteger(limits.maximumAgeSeconds) || limits.maximumAgeSeconds < 0 ||
    !Number.isSafeInteger(limits.maximumConfidenceBps) || limits.maximumConfidenceBps < 0 || limits.maximumConfidenceBps > 65_535
  ) throw new Error("invalid_draft_oracle_limits");
  return { ...limits };
}

export async function readDevnetCandidateState(
  connection: Connection,
  options: {
    commitment?: "confirmed" | "finalized";
    walletAddress?: string;
    draftOracleLimits?: DraftOracleLimits;
  } = {},
): Promise<DevnetReadResult> {
  const commitment = options.commitment ?? "confirmed";
  const policy = validateDraftLimits(options.draftOracleLimits);
  const host = rpcHost(connection);
  const deployment = notConfiguredDeployment();
  let actualGenesisHash: string;
  try {
    actualGenesisHash = await connection.getGenesisHash();
  } catch {
    return {
      status: "unavailable",
      reason: "genesis_read_failed",
      expectedGenesisHash: ETF_DEVNET_GENESIS_HASH,
      actualGenesisHash: null,
      network: { cluster: "devnet", rpcHost: host, commitment },
      deployment,
    };
  }
  if (actualGenesisHash !== ETF_DEVNET_GENESIS_HASH) {
    return {
      status: "genesis_mismatch",
      reason: "rpc_genesis_does_not_match_pinned_devnet",
      expectedGenesisHash: ETF_DEVNET_GENESIS_HASH,
      actualGenesisHash,
      network: { cluster: "devnet", rpcHost: host, commitment },
      deployment,
    };
  }

  const mintKeys = CANDIDATE_MINTS.map(({ mint }) => new PublicKey(mint));
  const feedKeys = ETF_DEVNET_CANDIDATE_FEEDS.map(({ address }) => new PublicKey(address));
  try {
    const response = await connection.getMultipleAccountsInfoAndContext([...mintKeys, ...feedKeys], commitment as Commitment);
    let observedUnixTime: number | null = null;
    try {
      observedUnixTime = await connection.getBlockTime(response.context.slot);
    } catch {
      observedUnixTime = null;
    }
    const mints = CANDIDATE_MINTS.map((candidate, index) => mintObservation(candidate, response.value[index] ?? null));
    const feeds = ETF_DEVNET_CANDIDATE_FEEDS.map((feed, index) => decodeCandidatePriceFeed(feed, response.value[mintKeys.length + index] ?? null, observedUnixTime, policy));
    const wallet = await readWalletBalances(connection, options.walletAddress, commitment);
    return {
      status: "candidate_data",
      network: {
        cluster: "devnet",
        genesisHash: actualGenesisHash,
        rpcHost: host,
        commitment,
        contextSlot: response.context.slot.toString(),
        observedUnixTime: observedUnixTime === null ? null : BigInt(observedUnixTime).toString(),
      },
      deployment,
      admission: "not_admitted",
      oraclePolicy: policy,
      mints,
      feeds,
      wallet,
    };
  } catch {
    return {
      status: "unavailable",
      reason: "candidate_account_read_failed",
      expectedGenesisHash: ETF_DEVNET_GENESIS_HASH,
      actualGenesisHash,
      network: { cluster: "devnet", rpcHost: host, commitment },
      deployment,
    };
  }
}
