import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PublicKey, type AccountInfo, type Connection } from "@solana/web3.js";
import {
  decodeCandidatePriceFeed,
  decodeClassicSplMint,
  ETF_DEVNET_CANDIDATE_FEEDS,
  ETF_DEVNET_GENESIS_HASH,
  readDevnetCandidateState,
} from "../src/devnet-read.js";

type RpcAccount = { owner: string; data: string | [string, string]; executable: boolean; space?: number };
type CapturedRpc = {
  genesis_hash: string;
  account_context_slot: number;
  cluster_unix_time: number;
  rpc_calls: {
    getMultipleAccounts: { request: { params: [string[], { commitment: string }] }; response: { result: { value: (RpcAccount | null)[] } } };
  };
};

const root = new URL("../../../tools/", import.meta.url);
const feedCapture = JSON.parse(readFileSync(new URL("rebalancing/etf-oracle-probe/snapshots/devnet-finalized-509788637-20261011T045650.654983Z.json", root), "utf8")) as CapturedRpc;
const mintCapture = JSON.parse(readFileSync(new URL("rebalancing/etf-asset-probe/snapshots/devnet-509738517-20261011T013735.190931Z.json", root), "utf8")) as {
  assets: Array<{ address: string; data_base64: string; owner_program: string; executable: boolean; lamports: number }>;
};
const mintRpc = new Map(mintCapture.assets.map((asset) => [asset.address, {
  owner: asset.owner_program,
  data: asset.data_base64,
  executable: asset.executable,
  lamports: asset.lamports,
}]));
const feedKeys = feedCapture.rpc_calls.getMultipleAccounts.request.params[0];
const feedValues = feedCapture.rpc_calls.getMultipleAccounts.response.result.value;
const feedRpc = new Map(feedKeys.map((key, index) => [key, feedValues[index]]));

function accountFromRpc(value: RpcAccount, lamports = 1): AccountInfo<Buffer> {
  return {
    data: Buffer.from(Array.isArray(value.data) ? value.data[0] : value.data, "base64"),
    executable: value.executable,
    lamports,
    owner: new PublicKey(value.owner),
    rentEpoch: 0,
  };
}

function capturedFeed(index: number): AccountInfo<Buffer> {
  const value = feedRpc.get(ETF_DEVNET_CANDIDATE_FEEDS[index]!.address);
  assert.ok(value);
  return accountFromRpc(value);
}

function copyAccount(account: AccountInfo<Buffer>): AccountInfo<Buffer> {
  return { ...account, data: Buffer.from(account.data) };
}

const draftLimits = {
  status: "draft_not_approved" as const,
  maximumAgeSeconds: 60,
  maximumConfidenceBps: 100,
};

test("reads preserved confirmed Devnet captures as non-admitted observations", async () => {
  const requested: string[] = [];
  let requestedCommitment = "";
  const connection = {
    rpcEndpoint: "https://api.devnet.solana.com",
    getGenesisHash: async () => feedCapture.genesis_hash,
    getMultipleAccountsInfoAndContext: async (keys: PublicKey[], commitment: string) => {
      requested.push(...keys.map((key) => key.toBase58()));
      requestedCommitment = commitment;
      const values = keys.map((key) => {
        const address = key.toBase58();
        const mint = mintRpc.get(address);
        if (mint) return accountFromRpc(mint, mint.lamports);
        const feed = feedRpc.get(address);
        return feed ? accountFromRpc(feed) : null;
      });
      return { context: { slot: feedCapture.account_context_slot }, value: values };
    },
    getBlockTime: async (slot: number) => slot === feedCapture.account_context_slot ? feedCapture.cluster_unix_time : null,
  } as unknown as Connection;

  const result = await readDevnetCandidateState(connection, { commitment: "finalized" });
  assert.equal(result.status, "candidate_data");
  if (result.status !== "candidate_data") return;
  assert.equal(result.network.cluster, "devnet");
  assert.equal(result.network.genesisHash, ETF_DEVNET_GENESIS_HASH);
  assert.equal(result.network.commitment, "finalized");
  assert.equal(result.network.contextSlot, String(feedCapture.account_context_slot));
  assert.equal(requestedCommitment, "finalized");
  assert.equal(requested.length, 5);
  assert.deepEqual(result.deployment, {
    program: { status: "not_configured", programId: null },
    pool: { status: "not_configured", address: null },
  });
  assert.equal(result.admission, "not_admitted");
  assert.equal(result.oraclePolicy, null);
  assert.equal(result.wallet, null);
  assert.equal(result.mints[0]?.status, "available");
  assert.equal(result.mints[0]?.decimals, 9);
  assert.equal(result.mints[0]?.mintAuthority, null);
  assert.equal(result.mints[0]?.freezeAuthority, null);
  assert.equal(result.mints[1]?.symbol, "Test USD");
  assert.match(result.mints[1]?.label ?? "", /synthetic \/ unbacked/);
  assert.equal(result.mints[1]?.admission, "not_admitted");
  assert.ok(result.mints[1]?.mintAuthority);
  assert.ok(result.mints[1]?.freezeAuthority);
  assert.equal(result.feeds.length, 3);
  assert.ok(result.feeds.every((feed) => feed.status === "available" && feed.verification === "full"));
  assert.ok(result.feeds.every((feed) => feed.freshness === "unconfigured"));
  assert.equal(result.feeds[1]?.associatedMint, null);
  assert.match(result.feeds[1]?.label ?? "", /no Devnet BTC mint admitted/);
});

test("fails closed on the wrong genesis before reading candidate accounts", async () => {
  let accountRead = false;
  const connection = {
    rpcEndpoint: "https://api.mainnet-beta.solana.com",
    getGenesisHash: async () => "wrong-genesis",
    getMultipleAccountsInfoAndContext: async () => { accountRead = true; throw new Error("should not read"); },
  } as unknown as Connection;

  const result = await readDevnetCandidateState(connection, { walletAddress: "11111111111111111111111111111111" });
  assert.equal(result.status, "genesis_mismatch");
  assert.equal(accountRead, false);
  assert.equal("mints" in result, false);
  assert.equal("feeds" in result, false);
  assert.equal("wallet" in result, false);
  assert.equal(result.deployment.pool.status, "not_configured");
});

test("decodes classic SPL mint metadata and rejects owner/layout/tag mutations", () => {
  const candidate = mintRpc.get("So11111111111111111111111111111111111111112");
  assert.ok(candidate);
  const mint = accountFromRpc(candidate);
  assert.equal(decodeClassicSplMint("So11111111111111111111111111111111111111112", mint).decimals, 9);

  assert.throws(() => decodeClassicSplMint("mint", { ...mint, owner: new PublicKey("11111111111111111111111111111111") }), /wrong_token_program_owner/);
  assert.throws(() => decodeClassicSplMint("mint", { ...mint, data: mint.data.slice(0, 81) }), /wrong_classic_mint_layout_length/);
  const badTag = copyAccount(mint);
  badTag.data.writeUInt32LE(2, 0);
  assert.throws(() => decodeClassicSplMint("mint", badTag), /invalid_coption_tag/);
});

test("requires receiver ownership, PriceUpdateV2 discriminator, exact feed identity and Full verification", () => {
  const feed = ETF_DEVNET_CANDIDATE_FEEDS[0]!;
  const valid = capturedFeed(0);
  const atPublish = Number(valid.data.readBigInt64LE(93));
  assert.equal(decodeCandidatePriceFeed(feed, valid, atPublish).status, "available");

  assert.equal(decodeCandidatePriceFeed(feed, { ...valid, owner: new PublicKey("11111111111111111111111111111111") }, atPublish).reason, "wrong_receiver_owner");
  const badDiscriminator = copyAccount(valid);
  badDiscriminator.data[0] ^= 0xff;
  assert.equal(decodeCandidatePriceFeed(feed, badDiscriminator, atPublish).reason, "wrong_price_update_v2_discriminator");
  const badFeed = copyAccount(valid);
  badFeed.data[41] ^= 0x01;
  assert.equal(decodeCandidatePriceFeed(feed, badFeed, atPublish).reason, "wrong_embedded_feed_id");
  const partial = copyAccount(valid);
  partial.data[40] = 0;
  const partialRead = decodeCandidatePriceFeed(feed, partial, atPublish);
  assert.equal(partialRead.reason, "partial_verification");
  assert.equal(partialRead.verification, "partial");
});

test("labels staleness only against explicit draft limits and rejects future, nonpositive and unsupported observations", () => {
  const feed = ETF_DEVNET_CANDIDATE_FEEDS[0]!;
  const valid = capturedFeed(0);
  const publishTime = Number(valid.data.readBigInt64LE(93));

  const stale = decodeCandidatePriceFeed(feed, valid, publishTime + 61, draftLimits);
  assert.equal(stale.freshness, "stale_under_draft_limit");
  assert.equal(stale.policy?.status, "draft_not_approved");
  assert.equal(decodeCandidatePriceFeed(feed, valid, publishTime - 1, draftLimits).freshness, "future_publish_time");

  const nonpositive = copyAccount(valid);
  nonpositive.data.writeBigInt64LE(0n, 73);
  assert.equal(decodeCandidatePriceFeed(feed, nonpositive, publishTime, draftLimits).reason, "nonpositive_price");

  const unsupportedExponent = copyAccount(valid);
  unsupportedExponent.data.writeInt32LE(1, 89);
  const unsupported = decodeCandidatePriceFeed(feed, unsupportedExponent, publishTime, draftLimits);
  assert.equal(unsupported.reason, "unsupported_display_exponent");
  assert.match(unsupported.exponentDisplaySupport, /not an approved policy/);
});

test("accepts both SDK account allocations, without treating the trailing byte as policy", () => {
  const feed = ETF_DEVNET_CANDIDATE_FEEDS[0]!;
  const allocated = copyAccount(capturedFeed(0));
  assert.equal(allocated.data.length, 134);
  const publishTime = Number(allocated.data.readBigInt64LE(93));
  allocated.data[133] = 0xff;
  assert.equal(decodeCandidatePriceFeed(feed, allocated, publishTime).status, "available");
  assert.equal(decodeCandidatePriceFeed(feed, { ...allocated, data: allocated.data.slice(0, 133) }, publishTime).status, "available");
});

