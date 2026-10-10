import { Buffer } from "buffer";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type Commitment,
} from "@solana/web3.js";

const PROGRAM_ID = "FN7uGX34qyijmVX69gqEkMugWjE5Sjso8Pe7gWU6B2N6";
const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SOL_FEED = "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE";
const USDC_FEED = "Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX";
const SOL_FEED_ID = "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
const USDC_FEED_ID = "eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a";
const RPC_URL = "http://127.0.0.1:8899";
const LOCALHOSTS = new Set(["127.0.0.1", "localhost"]);
const CONFIRMED: Commitment = "confirmed";
// SDK LEN reserves space for Partial's signature-count byte; Full's Borsh variant serializes one byte shorter.
const PYTH_PRICE_UPDATE_V2_ACCOUNT_LEN = 8 + 32 + 2 + 32 + 8 + 8 + 4 + 8 + 8 + 8 + 8 + 8;
const PYTH_PRICE_UPDATE_V2_FULL_SERIALIZED_LEN = PYTH_PRICE_UPDATE_V2_ACCOUNT_LEN - 1;

const DISCRIMINATORS = {
  start: [61, 251, 146, 164, 48, 29, 208, 170],
  fill: [51, 225, 89, 197, 65, 5, 178, 250],
  finish: [87, 244, 172, 88, 190, 34, 32, 33],
} as const;

export interface LocalnetManifest {
  schemaVersion: 1;
  cluster: "localnet";
  rpcUrl: string;
  wsUrl: string;
  expectedGenesisHash: string;
  programId: string;
  vault: string;
  governance: string;
  auctionPolicy: string;
  intent: string;
  solUsd: string;
  usdcUsd: string;
  wsolMint: string;
  usdcMint: string;
  custodyWsol: string;
  custodyUsdc: string;
  takerWallet: string;
  takerWsol: string;
  takerUsdc: string;
  startSellAsset: number;
  startAmount: string | number;
  fillSequence: string | number;
  fillSellAmount: string | number;
  fillGrossBuyAmount: string | number;
  fillBountyAmount: string | number;
  fixtureKind: string;
  fixtureNotice: string;
  [key: string]: unknown;
}

export interface SolanaWalletProvider {
  isPhantom?: boolean;
  publicKey?: PublicKey | { toString(): string } | null;
  connect(): Promise<{ publicKey?: PublicKey | { toString(): string } }>;
  signTransaction?(transaction: Transaction): Promise<Transaction>;
}

declare global {
  interface Window {
    solana?: SolanaWalletProvider;
    phantom?: { solana?: SolanaWalletProvider };
  }
}

export interface LocalnetClient {
  connection: Connection;
  manifest: LocalnetManifest;
  programId: PublicKey;
  keys: Record<string, PublicKey>;
}

export interface FeedSnapshot {
  price: number;
  publishTime: number;
  verifiedFull: boolean;
}

export interface IntentSnapshot {
  sequence: bigint;
  remainingSellAmount: bigint;
  endSlot: bigint;
  sellAsset: number;
}

export interface ChainSnapshot {
  slot: number;
  vaultSequence: bigint;
  vaultStatus: number;
  riskPaused: boolean;
  targetsBps: [number, number];
  decimals: [number, number];
  balances: {
    custodyWsol: bigint;
    custodyUsdc: bigint;
    takerWsol: bigint;
    takerUsdc: bigint;
  };
  prices: { wsol: FeedSnapshot; usdc: FeedSnapshot };
  intent: IntentSnapshot | null;
  previousFillSequence: bigint | null;
  hasPreviousBountyClaim: boolean;
}

export interface TokenDelta {
  custodyWsol: bigint;
  custodyUsdc: bigint;
  takerWsol: bigint;
  takerUsdc: bigint;
}

export interface TransactionOutcome {
  signature: string;
  slot: number | null;
  accepted: boolean;
  error: string | null;
  logs: string[];
  deltas: TokenDelta;
  monitoredValuesUnchanged: boolean;
  vaultSequenceBefore: bigint;
  vaultSequenceAfter: bigint;
  remainingBefore: bigint | null;
  remainingAfter: bigint | null;
}

export type LocalnetAction =
  | { type: "start" }
  | { type: "duplicate-start" }
  | { type: "wrong-feed" }
  | { type: "fill" }
  | { type: "replay" }
  | { type: "adverse-price" }
  | { type: "oversize" }
  | { type: "finish" }
  | { type: "expire" };

function fail(message: string): never {
  throw new Error(message);
}

function publicKey(value: string, label: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    return fail(`Localnet manifest has an invalid ${label} address.`);
  }
}

function parseInteger(value: string | number, label: string): bigint {
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) {
    return fail(`Localnet manifest ${label} must be a nonnegative integer string or safe integer.`);
  }
  try {
    const parsed = BigInt(value);
    if (parsed < 0n || parsed > 0xffff_ffff_ffff_ffffn) throw new Error();
    return parsed;
  } catch {
    return fail(`Localnet manifest ${label} must fit in an unsigned 64-bit integer.`);
  }
}

function equalKey(actual: PublicKey, expected: PublicKey, label: string): void {
  if (!actual.equals(expected)) fail(`Localnet manifest ${label} does not match the program-derived address.`);
}

function derive(seeds: Uint8Array[], programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

export async function loadLocalnetClient(): Promise<LocalnetClient> {
  if (!LOCALHOSTS.has(window.location.hostname)) {
    fail("Localnet mode only runs from http://127.0.0.1 or http://localhost.");
  }
  const response = await fetch("/localnet-manifest.json", { cache: "no-store" });
  if (!response.ok) fail("Localnet manifest is missing. Start the Localnet fixture script and reload this page.");
  const manifest = (await response.json()) as LocalnetManifest;
  if (manifest.schemaVersion !== 1 || manifest.cluster !== "localnet") {
    fail("Unsupported Localnet manifest. Expected schemaVersion 1 and cluster localnet.");
  }
  if (typeof manifest.fixtureKind !== "string" || !manifest.fixtureKind.trim() || typeof manifest.fixtureNotice !== "string" || !manifest.fixtureNotice.trim()) {
    fail("Localnet manifest must explain the fixture kind and fixture data notice.");
  }
  if (manifest.rpcUrl !== RPC_URL) fail(`Localnet manifest RPC must be exactly ${RPC_URL}.`);
  if (typeof manifest.wsUrl !== "string" || (!manifest.wsUrl.startsWith("ws://127.0.0.1:") && !manifest.wsUrl.startsWith("ws://localhost:"))) {
    fail("Localnet manifest WebSocket must point to localhost.");
  }
  const programId = publicKey(manifest.programId, "program ID");
  equalKey(programId, new PublicKey(PROGRAM_ID), "program ID");
  const keys: Record<string, PublicKey> = {};
  for (const field of [
    "vault", "governance", "auctionPolicy", "intent", "solUsd", "usdcUsd", "wsolMint", "usdcMint",
    "custodyWsol", "custodyUsdc", "takerWallet", "takerWsol", "takerUsdc",
  ] as const) {
    if (typeof manifest[field] !== "string") fail(`Localnet manifest is missing ${field}.`);
    keys[field] = publicKey(manifest[field] as string, field);
  }
  if (manifest.startSellAsset !== 0) fail("This Localnet fixture is configured to sell WSOL (asset index 0); regenerate the fixture with that direction.");
  for (const [field, label] of [
    ["startAmount", "startAmount"], ["fillSequence", "fillSequence"], ["fillSellAmount", "fillSellAmount"],
    ["fillGrossBuyAmount", "fillGrossBuyAmount"], ["fillBountyAmount", "fillBountyAmount"],
  ] as const) parseInteger(manifest[field], label);
  if (parseInteger(manifest.startAmount, "startAmount") === 0n || parseInteger(manifest.fillSellAmount, "fillSellAmount") === 0n || parseInteger(manifest.fillGrossBuyAmount, "fillGrossBuyAmount") === 0n) {
    fail("Localnet start and fill amounts must be positive.");
  }
  equalKey(keys.solUsd, new PublicKey(SOL_FEED), "SOL/USD feed");
  equalKey(keys.usdcUsd, new PublicKey(USDC_FEED), "USDC/USD feed");
  equalKey(keys.vault, derive([Buffer.from("vault")], programId), "vault");
  equalKey(keys.governance, derive([Buffer.from("governance"), keys.vault.toBuffer()], programId), "governance");
  equalKey(keys.auctionPolicy, derive([Buffer.from("auction_policy"), keys.vault.toBuffer()], programId), "auction policy");
  equalKey(keys.intent, derive([Buffer.from("rebalance_intent"), keys.vault.toBuffer()], programId), "intent");

  const connection = new Connection(RPC_URL, { commitment: CONFIRMED, wsEndpoint: manifest.wsUrl });
  const genesisHash = await connection.getGenesisHash();
  if (!manifest.expectedGenesisHash || genesisHash !== manifest.expectedGenesisHash) {
    fail(`RPC genesis hash mismatch. Expected ${manifest.expectedGenesisHash || "a pinned Localnet hash"}, received ${genesisHash}.`);
  }
  const program = await connection.getAccountInfo(programId, CONFIRMED);
  if (!program?.executable) fail("The expected SBF program is not deployed on this Localnet validator.");
  const [vault, governance, policy, solFeed, usdcFeed] = await connection.getMultipleAccountsInfo(
    [keys.vault, keys.governance, keys.auctionPolicy, keys.solUsd, keys.usdcUsd],
    CONFIRMED,
  );
  if (!vault || !governance || !policy) fail("Localnet vault, governance, or auction policy account is missing.");
  for (const [info, label] of [[vault, "vault"], [governance, "governance"], [policy, "auction policy"]] as const) {
    equalKey(info.owner, programId, `${label} owner`);
  }
  if (!solFeed || !usdcFeed) fail("Pinned Pyth feed fixtures are missing from Localnet.");
  return { connection, manifest, programId, keys };
}

function readU64(data: Buffer, offset: number): bigint {
  return data.readBigUInt64LE(offset);
}

function tokenAmount(data: Buffer | Uint8Array, label: string, expectedMint: PublicKey, expectedOwner: PublicKey): bigint {
  if (data.length !== 165) fail(`${label} is not a standard classic SPL Token account.`);
  const bytes = Buffer.from(data);
  equalKey(new PublicKey(bytes.subarray(0, 32)), expectedMint, `${label} mint`);
  equalKey(new PublicKey(bytes.subarray(32, 64)), expectedOwner, `${label} token owner`);
  return bytes.readBigUInt64LE(64);
}

function priceUpdate(data: Buffer | Uint8Array, expectedFeed: string, label: string): FeedSnapshot {
  const bytes = Buffer.from(data);
  if (bytes.length !== PYTH_PRICE_UPDATE_V2_FULL_SERIALIZED_LEN && bytes.length !== PYTH_PRICE_UPDATE_V2_ACCOUNT_LEN) {
    fail(`${label} Pyth account has an unsupported PriceUpdateV2 length.`);
  }
  const feedId = bytes.subarray(41, 73).toString("hex");
  if (feedId !== expectedFeed) fail(`${label} Pyth account contains the wrong feed ID.`);
  const verifiedFull = bytes[40] === 1;
  const mantissa = Number(bytes.readBigInt64LE(73));
  const exponent = bytes.readInt32LE(89);
  const publishTime = Number(bytes.readBigInt64LE(93));
  const price = mantissa * 10 ** exponent;
  if (!verifiedFull || !Number.isSafeInteger(publishTime) || publishTime <= 0 || publishTime > Math.floor(Date.now() / 1000) + 5 || !Number.isFinite(price) || price <= 0) {
    fail(`${label} Pyth fixture has malformed, nonpositive, future, or non-Full price data.`);
  }
  return { price, publishTime, verifiedFull };
}

function decodeIntent(data: Buffer | Uint8Array, vaultKey: PublicKey): IntentSnapshot {
  const bytes = Buffer.from(data);
  if (bytes.length < 98) fail("Rebalance intent account is truncated or has an unsupported layout.");
  if (bytes[8] !== 1) fail("Rebalance intent version is unsupported.");
  equalKey(new PublicKey(bytes.subarray(9, 41)), vaultKey, "intent vault");
  if (bytes[65] > 1) fail("Rebalance intent has an unsupported sell asset index.");
  return {
    sequence: readU64(bytes, 41),
    remainingSellAmount: readU64(bytes, 74),
    endSlot: readU64(bytes, 90),
    sellAsset: bytes[65],
  };
}

function assertAccountOwner(info: { owner: PublicKey }, expected: PublicKey, label: string): void {
  equalKey(info.owner, expected, `${label} owner`);
}

export async function readChainSnapshot(client: LocalnetClient): Promise<ChainSnapshot> {
  const { connection, keys, programId } = client;
  const [vault, intent, custodyWsol, custodyUsdc, takerWsol, takerUsdc, solFeed, usdcFeed, wsolMint, usdcMint, governance] =
    await connection.getMultipleAccountsInfo(
      [keys.vault, keys.intent, keys.custodyWsol, keys.custodyUsdc, keys.takerWsol, keys.takerUsdc, keys.solUsd, keys.usdcUsd, keys.wsolMint, keys.usdcMint, keys.governance],
      CONFIRMED,
    );
  if (!vault || !custodyWsol || !custodyUsdc || !takerWsol || !takerUsdc || !solFeed || !usdcFeed || !wsolMint || !usdcMint || !governance) {
    fail("A vault, governance, mint, token, or oracle account required by the manifest is missing from Localnet.");
  }
  assertAccountOwner(vault, programId, "vault");
  assertAccountOwner(governance, programId, "governance");
  assertAccountOwner(wsolMint, new PublicKey(TOKEN_PROGRAM_ID), "WSOL mint");
  assertAccountOwner(usdcMint, new PublicKey(TOKEN_PROGRAM_ID), "USDC mint");
  for (const [info, label] of [
    [custodyWsol, "WSOL custody"], [custodyUsdc, "USDC custody"], [takerWsol, "taker WSOL"], [takerUsdc, "taker USDC"],
  ] as const) assertAccountOwner(info, new PublicKey(TOKEN_PROGRAM_ID), label);
  assertAccountOwner(solFeed, new PublicKey(manifestOracleOwner(client)), "SOL/USD Pyth fixture");
  assertAccountOwner(usdcFeed, new PublicKey(manifestOracleOwner(client)), "USDC/USD Pyth fixture");
  const vaultBytes = Buffer.from(vault.data);
  if (vaultBytes.length < 353) fail("Vault account has an unsupported serialized layout.");
  if (vaultBytes[8] !== 1) fail("Vault account version is unsupported.");
  equalKey(new PublicKey(vaultBytes.subarray(11, 43)), keys.vault, "vault authority");
  if (wsolMint.data.length !== 82 || usdcMint.data.length !== 82) fail("Localnet asset mints do not use the standard SPL Token mint layout.");
  if (wsolMint.data[44] !== vaultBytes[147] || usdcMint.data[44] !== vaultBytes[246]) fail("Vault asset decimals do not match the SPL mint accounts.");
  equalKey(new PublicKey(vaultBytes.subarray(51, 83)), keys.wsolMint, "vault WSOL mint");
  equalKey(new PublicKey(vaultBytes.subarray(150, 182)), keys.usdcMint, "vault USDC mint");
  equalKey(new PublicKey(vaultBytes.subarray(115, 147)), keys.custodyWsol, "vault WSOL custody");
  equalKey(new PublicKey(vaultBytes.subarray(214, 246)), keys.custodyUsdc, "vault USDC custody");
  const governanceBytes = Buffer.from(governance.data);
  if (governanceBytes.length < 231 || governanceBytes[8] !== 1) fail("Governance account has an unsupported version or layout.");
  equalKey(new PublicKey(governanceBytes.subarray(9, 41)), keys.vault, "governance vault");
  equalKey(new PublicKey(governanceBytes.subarray(73, 105)), keys.wsolMint, "governance WSOL mint");
  equalKey(new PublicKey(governanceBytes.subarray(105, 137)), keys.usdcMint, "governance USDC mint");
  if (governanceBytes.readUInt16LE(217) !== vaultBytes.readUInt16LE(148) || governanceBytes.readUInt16LE(219) !== vaultBytes.readUInt16LE(247)) {
    fail("Governance target weights do not match the vault configuration.");
  }
  const governancePendingTag = governanceBytes[229];
  if (governancePendingTag !== 0 && governancePendingTag !== 1) fail("Governance pending-proposal tag is invalid.");
  const riskPausedOffset = governancePendingTag === 0 ? 230 : 266;
  if (governanceBytes.length <= riskPausedOffset || governanceBytes[riskPausedOffset] > 1) fail("Governance risk-pause field is malformed.");
  const activeIntent = intent;
  if (activeIntent) assertAccountOwner(activeIntent, programId, "rebalance intent");
  const parsedIntent = activeIntent ? decodeIntent(activeIntent.data, keys.vault) : null;
  const previousFillSequence = parsedIntent && parsedIntent.sequence > 0n ? parsedIntent.sequence - 1n : null;
  const activeClaim = previousFillSequence === null ? null : derive(
    [Buffer.from("bounty_claim"), keys.vault.toBuffer(), u64Bytes(previousFillSequence)], programId,
  );
  const claimExists = activeClaim ? await connection.getAccountInfo(activeClaim, CONFIRMED) : null;
  const [solPrice, usdcPrice, slot] = await Promise.all([
    Promise.resolve(priceUpdate(solFeed.data, SOL_FEED_ID, "SOL/USD")),
    Promise.resolve(priceUpdate(usdcFeed.data, USDC_FEED_ID, "USDC/USD")),
    connection.getSlot(CONFIRMED),
  ]);
  return {
    slot,
    vaultSequence: readU64(vaultBytes, 345),
    vaultStatus: vaultBytes[10],
    riskPaused: governanceBytes[riskPausedOffset] === 1,
    targetsBps: [vaultBytes.readUInt16LE(148), vaultBytes.readUInt16LE(247)],
    decimals: [vaultBytes[147], vaultBytes[246]],
    balances: {
      custodyWsol: tokenAmount(custodyWsol.data, "WSOL custody", keys.wsolMint, keys.vault),
      custodyUsdc: tokenAmount(custodyUsdc.data, "USDC custody", keys.usdcMint, keys.vault),
      takerWsol: tokenAmount(takerWsol.data, "taker WSOL", keys.wsolMint, keys.takerWallet),
      takerUsdc: tokenAmount(takerUsdc.data, "taker USDC", keys.usdcMint, keys.takerWallet),
    },
    prices: { wsol: solPrice, usdc: usdcPrice },
    intent: parsedIntent,
    previousFillSequence,
    hasPreviousBountyClaim: !!claimExists,
  };
}

function manifestOracleOwner(_client: LocalnetClient): string {
  // The S2D consumer pins the Pyth Receiver owner; Localnet substitutes account data only.
  return "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ";
}

function u64Bytes(value: bigint): Buffer {
  const result = Buffer.alloc(8);
  result.writeBigUInt64LE(value);
  return result;
}

function instructionData(discriminator: readonly number[], ...args: Buffer[]): Buffer {
  return Buffer.concat([Buffer.from(discriminator), ...args]);
}

function u8(value: number): Buffer {
  if (!Number.isInteger(value) || value < 0 || value > 255) fail("Instruction u8 argument is outside its valid range.");
  return Buffer.from([value]);
}

function startInstruction(client: LocalnetClient, caller: PublicKey): TransactionInstruction {
  const { keys, programId, manifest } = client;
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: keys.vault, isSigner: false, isWritable: true },
      { pubkey: keys.governance, isSigner: false, isWritable: false },
      { pubkey: keys.auctionPolicy, isSigner: false, isWritable: false },
      { pubkey: keys.intent, isSigner: false, isWritable: true },
      { pubkey: keys.custodyWsol, isSigner: false, isWritable: true },
      { pubkey: keys.custodyUsdc, isSigner: false, isWritable: true },
      { pubkey: keys.wsolMint, isSigner: false, isWritable: false },
      { pubkey: keys.usdcMint, isSigner: false, isWritable: false },
      { pubkey: keys.solUsd, isSigner: false, isWritable: false },
      { pubkey: keys.usdcUsd, isSigner: false, isWritable: false },
      { pubkey: caller, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: instructionData(DISCRIMINATORS.start, u8(manifest.startSellAsset), u64Bytes(parseInteger(manifest.startAmount, "startAmount"))),
  });
}

function fillInstruction(
  client: LocalnetClient,
  wallet: PublicKey,
  expectedSequence: bigint,
  sellAmount: bigint,
  grossBuyAmount: bigint,
  bountyAmount: bigint,
  wrongFeed = false,
): TransactionInstruction {
  const { keys, programId } = client;
  const bountyClaim = derive([Buffer.from("bounty_claim"), keys.vault.toBuffer(), u64Bytes(expectedSequence)], programId);
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: keys.vault, isSigner: false, isWritable: true },
      { pubkey: keys.governance, isSigner: false, isWritable: false },
      { pubkey: keys.auctionPolicy, isSigner: false, isWritable: false },
      { pubkey: keys.intent, isSigner: false, isWritable: true },
      { pubkey: bountyClaim, isSigner: false, isWritable: true },
      { pubkey: keys.custodyWsol, isSigner: false, isWritable: true },
      { pubkey: keys.custodyUsdc, isSigner: false, isWritable: true },
      { pubkey: keys.wsolMint, isSigner: false, isWritable: false },
      { pubkey: keys.usdcMint, isSigner: false, isWritable: false },
      { pubkey: wrongFeed ? keys.usdcUsd : keys.solUsd, isSigner: false, isWritable: false },
      { pubkey: keys.usdcUsd, isSigner: false, isWritable: false },
      { pubkey: keys.takerUsdc, isSigner: false, isWritable: true },
      { pubkey: keys.takerWsol, isSigner: false, isWritable: true },
      { pubkey: wallet, isSigner: true, isWritable: false },
      { pubkey: wallet, isSigner: true, isWritable: true },
      { pubkey: new PublicKey(TOKEN_PROGRAM_ID), isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: instructionData(
      DISCRIMINATORS.fill,
      u64Bytes(expectedSequence),
      u64Bytes(sellAmount),
      u64Bytes(grossBuyAmount),
      u64Bytes(bountyAmount),
    ),
  });
}

function finishInstruction(client: LocalnetClient, caller: PublicKey, sequence: bigint): TransactionInstruction {
  const { keys, programId } = client;
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: keys.vault, isSigner: false, isWritable: true },
      { pubkey: keys.governance, isSigner: false, isWritable: false },
      { pubkey: keys.auctionPolicy, isSigner: false, isWritable: true },
      { pubkey: keys.intent, isSigner: false, isWritable: true },
      { pubkey: keys.custodyWsol, isSigner: false, isWritable: true },
      { pubkey: keys.custodyUsdc, isSigner: false, isWritable: true },
      { pubkey: keys.wsolMint, isSigner: false, isWritable: false },
      { pubkey: keys.usdcMint, isSigner: false, isWritable: false },
      { pubkey: keys.solUsd, isSigner: false, isWritable: false },
      { pubkey: keys.usdcUsd, isSigner: false, isWritable: false },
      { pubkey: caller, isSigner: true, isWritable: true },
    ],
    data: instructionData(DISCRIMINATORS.finish, u64Bytes(sequence)),
  });
}

function walletProvider(): SolanaWalletProvider {
  const provider = window.phantom?.solana ?? window.solana;
  if (!provider) fail("No Solana wallet extension is available. Install or enable Phantom, then reload.");
  if (!provider.signTransaction) fail("The connected wallet does not support transaction signing.");
  return provider;
}

export async function connectLocalnetWallet(client: LocalnetClient): Promise<PublicKey> {
  const provider = walletProvider();
  const connected = await provider.connect();
  const key = connected.publicKey ?? provider.publicKey;
  if (!key) fail("Wallet connection returned no public key.");
  const walletKey = new PublicKey(key.toString());
  equalKey(walletKey, client.keys.takerWallet, "designated Localnet taker wallet");
  const balance = await client.connection.getBalance(walletKey, CONFIRMED);
  if (balance === 0) fail("Connected wallet has no Localnet SOL. Run the Localnet setup airdrop, then reconnect.");
  return walletKey;
}

async function sendAndConfirm(
  client: LocalnetClient,
  wallet: PublicKey,
  instruction: TransactionInstruction,
  before: ChainSnapshot,
): Promise<TransactionOutcome> {
  const provider = walletProvider();
  if (provider.publicKey && provider.publicKey.toString() !== wallet.toBase58()) {
    fail("Wallet account changed. Reconnect the designated Localnet taker wallet before signing.");
  }
  const latest = await client.connection.getLatestBlockhash(CONFIRMED);
  const transaction = new Transaction({ feePayer: wallet, recentBlockhash: latest.blockhash }).add(instruction);
  const signed = await provider.signTransaction!(transaction);
  const signature = await client.connection.sendRawTransaction(signed.serialize(), {
    // Expected fail-closed cases must reach the validator to produce a confirmed rejection signature.
    skipPreflight: true,
    maxRetries: 3,
  });
  const confirmation = await client.connection.confirmTransaction({ signature, ...latest }, CONFIRMED);
  const after = await readChainSnapshot(client);
  const transactionInfo = await client.connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  const signatureStatus = transactionInfo ? null : await client.connection.getSignatureStatuses(
    [signature],
    { searchTransactionHistory: true },
  );
  const status = signatureStatus?.value[0] ?? null;
  const error = confirmation.value.err ?? transactionInfo?.meta?.err ?? status?.err ?? null;
  const deltas = {
    custodyWsol: after.balances.custodyWsol - before.balances.custodyWsol,
    custodyUsdc: after.balances.custodyUsdc - before.balances.custodyUsdc,
    takerWsol: after.balances.takerWsol - before.balances.takerWsol,
    takerUsdc: after.balances.takerUsdc - before.balances.takerUsdc,
  };
  const monitoredValuesUnchanged = Object.values(deltas).every((delta) => delta === 0n)
    && before.vaultSequence === after.vaultSequence
    && before.intent?.sequence === after.intent?.sequence
    && before.intent?.remainingSellAmount === after.intent?.remainingSellAmount;
  return {
    signature,
    slot: transactionInfo?.slot ?? status?.slot ?? null,
    accepted: error === null,
    error: error === null ? null : JSON.stringify(error),
    logs: transactionInfo?.meta?.logMessages ?? [],
    deltas,
    monitoredValuesUnchanged,
    vaultSequenceBefore: before.vaultSequence,
    vaultSequenceAfter: after.vaultSequence,
    remainingBefore: before.intent?.remainingSellAmount ?? null,
    remainingAfter: after.intent?.remainingSellAmount ?? null,
  };
}

export async function executeLocalnetAction(
  client: LocalnetClient,
  wallet: PublicKey,
  action: LocalnetAction,
): Promise<TransactionOutcome> {
  const before = await readChainSnapshot(client);
  let instruction: TransactionInstruction;
  if (action.type === "start" || action.type === "duplicate-start") {
    instruction = startInstruction(client, wallet);
  } else if (action.type === "finish" || action.type === "expire") {
    if (!before.intent) fail("There is no on-chain intent to close.");
    if (action.type === "finish" && before.intent.remainingSellAmount !== 0n) {
      fail("The on-chain intent still has sell amount remaining. Finish its fills or wait for expiry.");
    }
    if (action.type === "expire" && BigInt(before.slot) <= before.intent.endSlot) {
      fail(`The intent expires after Localnet slot ${before.intent.endSlot}. Current confirmed slot is ${before.slot}.`);
    }
    instruction = finishInstruction(client, wallet, before.intent.sequence);
  } else {
    if (!before.intent) fail("There is no active on-chain intent to fill.");
    const manifest = client.manifest;
    const fillSell = parseInteger(manifest.fillSellAmount, "fillSellAmount");
    const fillBuy = parseInteger(manifest.fillGrossBuyAmount, "fillGrossBuyAmount");
    const bounty = parseInteger(manifest.fillBountyAmount, "fillBountyAmount");
    const sequence = before.intent.sequence;
    if (action.type === "fill") {
      instruction = fillInstruction(client, wallet, sequence, fillSell, fillBuy, bounty);
    } else if (action.type === "replay") {
      if (before.previousFillSequence === null) fail("Replay requires at least one confirmed fill in the current on-chain intent.");
      instruction = fillInstruction(client, wallet, before.previousFillSequence, fillSell, fillBuy, bounty);
    } else if (action.type === "adverse-price") {
      const adverseBuy = 50n * 10n ** BigInt(before.decimals[1]);
      instruction = fillInstruction(client, wallet, sequence, fillSell, adverseBuy, bounty);
    } else if (action.type === "wrong-feed") {
      instruction = fillInstruction(client, wallet, sequence, fillSell, fillBuy, bounty, true);
    } else {
      instruction = fillInstruction(client, wallet, sequence, before.intent.remainingSellAmount + 1n, fillBuy, bounty);
    }
  }
  return sendAndConfirm(client, wallet, instruction, before);
}

export function amountToNumber(amount: bigint, decimals: number): number {
  return Number(amount) / 10 ** decimals;
}

export function amountToText(amount: bigint, decimals: number, digits = 4): string {
  return amountToNumber(amount, decimals).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}
