import { readFileSync, statSync } from "node:fs";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { decodeAuctionPolicy, decodeGovernance, decodeIntent, decodeVault } from "./codec.js";
import type { ChainSnapshot, KeeperAction, KeeperConfig } from "./types.js";
import type { ConfirmationResult, KeeperRuntime, SimulationResult } from "./keeper.js";

export const PROGRAM_ID = new PublicKey("FN7uGX34qyijmVX69gqEkMugWjE5Sjso8Pe7gWU6B2N6");
export const SOL_USD_FEED = new PublicKey("7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE");
export const USDC_USD_FEED = new PublicKey("Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX");
export const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const PYTH_RECEIVER_PROGRAM = new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
const ASSOCIATED_TOKEN_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const DISCRIMINATOR = {
  start: Uint8Array.of(61, 251, 146, 164, 48, 29, 208, 170),
  fill: Uint8Array.of(51, 225, 89, 197, 65, 5, 178, 250),
  finish: Uint8Array.of(87, 244, 172, 88, 190, 34, 32, 33),
};

export type SolanaKeeperOptions = KeeperConfig & { rpcUrl: string; signer?: Keypair };

type Prepared = { transaction: Transaction; blockhash: string; lastValidBlockHeight: number };

export class SolanaKeeperRuntime implements KeeperRuntime {
  private readonly connection: Connection;
  private readonly vaultKey: PublicKey;
  private readonly pda: { vault: PublicKey; governance: PublicKey; policy: PublicKey; intent: PublicKey };
  private readonly caller: PublicKey;
  private readonly prepared = new Map<string, Prepared>();
  private readonly submitted = new Map<string, Prepared>();
  private genesisVerified = false;

  constructor(private readonly options: SolanaKeeperOptions) {
    if (options.cluster !== "localnet" && options.cluster !== "devnet") throw new Error("Keeper runtime only accepts Localnet or Devnet");
    if (options.expectedGenesisHash === MAINNET_GENESIS) throw new Error("Mainnet genesis is forbidden");
    if (options.cluster === "localnet" && options.expectedGenesisHash === DEVNET_GENESIS) throw new Error("A Devnet genesis hash cannot be labeled Localnet");
    if (options.cluster === "devnet" && options.expectedGenesisHash !== DEVNET_GENESIS) throw new Error("Devnet must use the pinned Solana Devnet genesis hash");
    if (!options.expectedGenesisHash || options.expectedGenesisHash === MAINNET_GENESIS) throw new Error("Expected non-Mainnet genesis hash is required");
    this.connection = new Connection(options.rpcUrl, { commitment: "confirmed", confirmTransactionInitialTimeout: 30_000 });
    if (!options.signer && !options.callerPublicKey) throw new Error("Dry-run requires COLOYOND_KEEPER_PUBLIC_KEY; signing material is not loaded");
    if (!(options.dryRun ?? true) && !options.signer) throw new Error("Submitting requires a runtime signer");
    this.caller = options.signer?.publicKey ?? new PublicKey(options.callerPublicKey!);
    if (options.callerPublicKey && new PublicKey(options.callerPublicKey).toBase58() !== this.caller.toBase58()) throw new Error("Configured caller does not match the runtime signer");
    this.vaultKey = new PublicKey(options.vaultAddress);
    const vaultPda = PublicKey.findProgramAddressSync([Buffer.from("vault")], PROGRAM_ID)[0];
    if (!vaultPda.equals(this.vaultKey)) throw new Error("Configured vault address is not the pinned S2D Vault PDA");
    this.pda = {
      vault: vaultPda,
      governance: PublicKey.findProgramAddressSync([Buffer.from("governance"), vaultPda.toBuffer()], PROGRAM_ID)[0],
      policy: PublicKey.findProgramAddressSync([Buffer.from("auction_policy"), vaultPda.toBuffer()], PROGRAM_ID)[0],
      intent: PublicKey.findProgramAddressSync([Buffer.from("rebalance_intent"), vaultPda.toBuffer()], PROGRAM_ID)[0],
    };
  }

  async verifyNetwork(): Promise<void> {
    const actual = await this.connection.getGenesisHash();
    if (actual === MAINNET_GENESIS || actual !== this.options.expectedGenesisHash) throw new Error("RPC genesis hash does not match the explicitly configured Localnet/Devnet cluster");
    this.genesisVerified = true;
  }

  async readState(): Promise<ChainSnapshot> {
    await this.ensureNetwork();
    const initial = await this.connection.getAccountInfoAndContext(this.pda.vault, "confirmed");
    if (!initial.value) throw new Error("Vault PDA is absent");
    assertOwner(initial.value.owner, PROGRAM_ID, "Vault");
    const initialVault = decodeVault(initial.value.data);
    const custodyKeys = initialVault.assets.map((asset) => new PublicKey(asset.custody)) as [PublicKey, PublicKey];
    const result = await this.connection.getMultipleAccountsInfoAndContext(
      [this.pda.vault, this.pda.governance, this.pda.policy, this.pda.intent, SOL_USD_FEED, USDC_USD_FEED, ...custodyKeys],
      { commitment: "confirmed", minContextSlot: initial.context.slot },
    );
    const [vaultInfo, governanceInfo, policyInfo, intentInfo, solFeedInfo, usdcFeedInfo, custodyAInfo, custodyBInfo] = result.value;
    if (!vaultInfo) throw new Error("Vault PDA disappeared during reconciliation");
    assertOwner(vaultInfo.owner, PROGRAM_ID, "Vault");
    const vault = decodeVault(vaultInfo.data);
    if (vault.authority !== this.pda.vault.toBase58()) throw new Error("Vault authority does not match the canonical Vault PDA");
    for (let index = 0; index < 2; index++) {
      const asset = vault.assets[index]!;
      if (asset.mint !== initialVault.assets[index]!.mint || asset.custody !== initialVault.assets[index]!.custody) throw new Error("Vault asset addresses changed during a reconciliation read");
      if (asset.tokenProgram !== TOKEN_PROGRAM.toBase58()) throw new Error("Vault uses a token program outside the pinned classic SPL Token contract");
      const expectedCustody = PublicKey.findProgramAddressSync([this.pda.vault.toBuffer(), TOKEN_PROGRAM.toBuffer(), new PublicKey(asset.mint).toBuffer()], ASSOCIATED_TOKEN_PROGRAM)[0];
      if (asset.custody !== expectedCustody.toBase58()) throw new Error("Vault custody address is not the canonical associated token account");
    }
    const governance = governanceInfo ? (assertOwner(governanceInfo.owner, PROGRAM_ID, "GovernanceAccount"), decodeGovernance(governanceInfo.data)) : null;
    const policy = policyInfo ? (assertOwner(policyInfo.owner, PROGRAM_ID, "AuctionPolicy"), decodeAuctionPolicy(policyInfo.data)) : null;
    const intent = intentInfo ? (assertOwner(intentInfo.owner, PROGRAM_ID, "RebalanceIntent"), decodeIntent(intentInfo.data)) : null;
    const oracleAccountsReady = !!solFeedInfo && !!usdcFeedInfo
      && solFeedInfo.owner.equals(PYTH_RECEIVER_PROGRAM) && usdcFeedInfo.owner.equals(PYTH_RECEIVER_PROGRAM)
      && solFeedInfo.data.byteLength > 8 && usdcFeedInfo.data.byteLength > 8;
    const custodyA = custodyAInfo ? decodeTokenAccount(custodyAInfo, vault.assets[0].mint, this.pda.vault.toBase58()) : null;
    const custodyB = custodyBInfo ? decodeTokenAccount(custodyBInfo, vault.assets[1].mint, this.pda.vault.toBase58()) : null;
    const custodyAccountsReady = custodyA !== null && custodyB !== null;
    return {
      slot: BigInt(result.context.slot), vaultAddress: this.vaultKey.toBase58(), oracleAccountsReady, custodyAccountsReady,
      custodyAmounts: [custodyA?.amount ?? 0n, custodyB?.amount ?? 0n], vault, governance, policy, intent,
    };
  }

  async subscribe(onChange: () => void): Promise<() => void> {
    await this.ensureNetwork();
    const snapshot = await this.readState();
    const keys = [this.pda.vault, this.pda.governance, this.pda.policy, this.pda.intent, SOL_USD_FEED, USDC_USD_FEED, ...snapshot.vault.assets.map((asset) => new PublicKey(asset.custody))];
    const ids = await Promise.all(keys.map((key) => this.connection.onAccountChange(key, () => onChange(), "confirmed")));
    return () => { for (const id of ids) void this.connection.removeAccountChangeListener(id); };
  }

  async simulate(action: KeeperAction, snapshot: ChainSnapshot): Promise<SimulationResult> {
    await this.ensureNetwork();
    const prepared = await this.createTransaction(action, snapshot);
    const key = actionCacheKey(action, snapshot.vaultAddress);
    this.prepared.set(key, prepared);
    const message = prepared.transaction.compileMessage();
    const feeResponse = await this.connection.getFeeForMessage(message, "confirmed");
    const fee = feeResponse.value;
    try {
      const result = await this.connection.simulateTransaction(prepared.transaction);
      if (result.value.err) return { ok: false, feeLamports: fee === null ? null : BigInt(fee), reason: `S2D simulation failed: ${JSON.stringify(result.value.err)}` };
      return { ok: true, feeLamports: fee === null ? null : BigInt(fee) };
    } catch (error) {
      return { ok: false, feeLamports: fee === null ? null : BigInt(fee), reason: `Simulation RPC failed: ${safeError(error)}` };
    }
  }

  async submit(action: KeeperAction, snapshot: ChainSnapshot): Promise<string> {
    await this.ensureNetwork();
    if (this.options.dryRun ?? true) throw new Error("Dry-run mode cannot submit transactions");
    if (!this.options.signer) throw new Error("Submission requires a runtime signer");
    const key = actionCacheKey(action, snapshot.vaultAddress);
    const prepared = this.prepared.get(key) ?? await this.createTransaction(action, snapshot);
    this.prepared.delete(key);
    prepared.transaction.partialSign(this.options.signer);
    const raw = prepared.transaction.serialize();
    const signature = await this.connection.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 0, preflightCommitment: "confirmed" });
    this.submitted.set(signature, prepared);
    return signature;
  }

  async confirm(signature: string): Promise<ConfirmationResult> {
    const prepared = this.submitted.get(signature);
    if (!prepared) return { status: "unknown", reason: "No local confirmation window for this signature; reconcile chain state" };
    const deadline = Date.now() + 30_000;
    try {
      while (Date.now() < deadline) {
        const status = (await this.connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
        if (status?.err) { this.submitted.delete(signature); return { status: "failed", reason: JSON.stringify(status.err) }; }
        if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized" || status?.confirmations === null) {
          this.submitted.delete(signature);
          return { status: "confirmed" };
        }
        const height = await this.connection.getBlockHeight("confirmed");
        if (height > prepared.lastValidBlockHeight) {
          this.submitted.delete(signature);
          return { status: "failed", reason: "Recent blockhash expired before confirmation" };
        }
        await sleep(1_000);
      }
      return { status: "unknown", reason: "Confirmation was not observed before the bounded wait ended" };
    } catch (error) {
      return { status: "unknown", reason: `Confirmation RPC unavailable: ${safeError(error)}` };
    }
  }

  private async createTransaction(action: KeeperAction, snapshot: ChainSnapshot): Promise<Prepared> {
    if (!this.genesisVerified) await this.ensureNetwork();
    const instruction = buildS2DInstruction(action, snapshot, this.caller);
    const latest = await this.connection.getLatestBlockhash("confirmed");
    const transaction = new Transaction({ feePayer: this.caller, recentBlockhash: latest.blockhash }).add(instruction);
    return { transaction, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight };
  }

  private async ensureNetwork(): Promise<void> { if (!this.genesisVerified) await this.verifyNetwork(); }
}

export function loadRuntimeSignerFromEnvironment(): Keypair {
  const keyPath = process.env.COLOYOND_KEEPER_KEYPAIR;
  if (!keyPath) throw new Error("COLOYOND_KEEPER_KEYPAIR must point to a private local keypair file for explicitly enabled submission");
  if (process.platform !== "win32" && (statSync(keyPath).mode & 0o077) !== 0) throw new Error("Keeper keypair file permissions must exclude group and other access");
  const raw = readFileSync(keyPath);
  let secret: unknown;
  try {
    secret = JSON.parse(raw.toString("utf8")) as unknown;
    if (!Array.isArray(secret) || secret.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) throw new Error("Keeper keypair file must contain a JSON byte array");
    const bytes = Uint8Array.from(secret as number[]);
    try { return Keypair.fromSecretKey(bytes); }
    finally { bytes.fill(0); (secret as number[]).fill(0); }
  } finally { raw.fill(0); }
}

export function buildS2DInstruction(action: KeeperAction, snapshot: ChainSnapshot, signer: PublicKey): TransactionInstruction {
  const vault = snapshot.vaultAddress;
  const vaultKey = new PublicKey(vault);
  const governance = PublicKey.findProgramAddressSync([Buffer.from("governance"), vaultKey.toBuffer()], PROGRAM_ID)[0];
  const policy = PublicKey.findProgramAddressSync([Buffer.from("auction_policy"), vaultKey.toBuffer()], PROGRAM_ID)[0];
  const intent = PublicKey.findProgramAddressSync([Buffer.from("rebalance_intent"), vaultKey.toBuffer()], PROGRAM_ID)[0];
  const assetA = snapshot.vault.assets[0];
  const assetB = snapshot.vault.assets[1];
  const common = [
    meta(vaultKey, true), meta(governance), meta(policy),
  ];
  if (action.kind === "start") {
    if (action.sellAsset !== 0 && action.sellAsset !== 1) throw new Error("S2D sell asset index must be 0 or 1");
    return new TransactionInstruction({ programId: PROGRAM_ID, keys: [
      ...common, meta(intent, true), meta(assetA.custody, true), meta(assetB.custody, true), meta(assetA.mint), meta(assetB.mint), meta(SOL_USD_FEED), meta(USDC_USD_FEED), meta(signer, true, true), meta(SystemProgram.programId),
    ], data: Buffer.concat([Buffer.from(DISCRIMINATOR.start), Buffer.from([action.sellAsset]), u64le(action.initialSellAmount)]) });
  }
  if (!snapshot.intent) throw new Error("S2D intent disappeared before instruction assembly");
  if (action.kind === "fill") {
    const claim = PublicKey.findProgramAddressSync([Buffer.from("bounty_claim"), vaultKey.toBuffer(), u64le(action.expectedIntentSequence)], PROGRAM_ID)[0];
    return new TransactionInstruction({ programId: PROGRAM_ID, keys: [
      ...common, meta(intent, true), meta(claim, true), meta(assetA.custody, true), meta(assetB.custody, true), meta(assetA.mint), meta(assetB.mint), meta(SOL_USD_FEED), meta(USDC_USD_FEED), meta(action.takerIn, true), meta(action.takerOut, true), meta(signer, false, true), meta(signer, true, true), meta(TOKEN_PROGRAM), meta(SystemProgram.programId),
    ], data: Buffer.concat([Buffer.from(DISCRIMINATOR.fill), u64le(action.expectedIntentSequence), u64le(action.sellAmount), u64le(action.grossBuyAmount), u64le(action.bountyAmount)]) });
  }
  return new TransactionInstruction({ programId: PROGRAM_ID, keys: [
    meta(vaultKey, true), meta(governance), meta(policy, true), meta(intent, true), meta(assetA.custody, true), meta(assetB.custody, true), meta(assetA.mint), meta(assetB.mint), meta(SOL_USD_FEED), meta(USDC_USD_FEED), meta(signer, true, true),
  ], data: Buffer.concat([Buffer.from(DISCRIMINATOR.finish), u64le(action.expectedIntentSequence)]) });
}

function meta(key: string | PublicKey, isWritable = false, isSigner = false) { return { pubkey: typeof key === "string" ? new PublicKey(key) : key, isWritable, isSigner }; }
function u64le(value: bigint): Buffer {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) throw new Error("S2D u64 argument is out of range");
  const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(value); return bytes;
}
function actionCacheKey(action: KeeperAction, vaultAddress: string): string {
  return action.kind === "start" ? `${vaultAddress}:start:${action.expectedVaultSequence}` : action.kind === "fill" ? `${vaultAddress}:fill:${action.expectedVaultSequence}:${action.expectedIntentSequence}` : `${vaultAddress}:finish:${action.expectedVaultSequence}:${action.expectedIntentSequence}`;
}
function decodeTokenAccount(info: NonNullable<Awaited<ReturnType<Connection["getAccountInfo"]>>>, expectedMint: string, expectedOwner: string): { amount: bigint } | null {
  if (!info.owner.equals(TOKEN_PROGRAM) || info.data.byteLength !== 165) return null;
  const mint = new PublicKey(info.data.subarray(0, 32)).toBase58();
  const owner = new PublicKey(info.data.subarray(32, 64)).toBase58();
  const state = info.data[108];
  if (mint !== expectedMint || owner !== expectedOwner || (state !== 1 && state !== 2)) return null;
  return { amount: info.data.readBigUInt64LE(64) };
}
function assertOwner(owner: PublicKey, expected: PublicKey, label: string): void { if (!owner.equals(expected)) throw new Error(`${label} account owner does not match the pinned program`); }
function safeError(error: unknown): string { return error instanceof Error ? error.message : "Unknown RPC error"; }
function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
