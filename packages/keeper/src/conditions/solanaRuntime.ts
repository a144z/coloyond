import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { decodeAuctionPolicy, decodeGovernance, decodeIntent, decodeVault } from "../codec.js";
import { loadRuntimeSignerFromEnvironment, PROGRAM_ID, SOL_USD_FEED, USDC_USD_FEED } from "../solana.js";
import { keeperConfigFromEnvironment } from "../env.js";
import { conditionStateAddress, buildActivateConditionInstruction, buildExecuteConditionRuleInstruction, buildObserveConditionInstruction } from "../conditionInstructions.js";
import type { KeeperConfig } from "../types.js";
import { ConditionScheduler, UncertainConditionSubmissionError } from "./service.js";
import type { ConditionConfirmation, ConditionRuntime, ConditionSchedulerObserver, ConditionSimulation } from "./service.js";
import { decodeConditionState } from "./state.js";
import type { ConditionAction, ConditionSnapshot } from "./scheduler.js";

const PYTH_RECEIVER_PROGRAM = new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

export type SolanaConditionOptions = KeeperConfig & { rpcUrl: string; signer?: Keypair };
type Prepared = { transaction: Transaction; lastValidBlockHeight: number };

export class SolanaConditionRuntime implements ConditionRuntime {
  private readonly connection: Connection;
  private readonly vaultKey: PublicKey;
  private readonly addresses: { vault: PublicKey; governance: PublicKey; policy: PublicKey; intent: PublicKey; condition: PublicKey };
  private readonly caller: PublicKey;
  private readonly prepared = new Map<string, Prepared>();
  private readonly submitted = new Map<string, Prepared>();
  private genesisVerified = false;

  constructor(private readonly options: SolanaConditionOptions) {
    if (options.cluster !== "localnet" && options.cluster !== "devnet") throw new Error("Condition scheduler accepts Localnet or Devnet only");
    if (!options.expectedGenesisHash || options.expectedGenesisHash === MAINNET_GENESIS) throw new Error("An explicit non-Mainnet genesis hash is required");
    if (options.cluster === "devnet" && options.expectedGenesisHash !== DEVNET_GENESIS) throw new Error("Devnet must use the pinned Solana Devnet genesis hash");
    if (options.cluster === "localnet" && options.expectedGenesisHash === DEVNET_GENESIS) throw new Error("A Devnet genesis hash cannot be labeled Localnet");
    if (!options.signer && !options.callerPublicKey) throw new Error("Dry-run requires an explicit caller public key");
    if (!(options.dryRun ?? true) && !options.signer) throw new Error("Submission requires a runtime caller keypair");
    this.connection = new Connection(options.rpcUrl, { commitment: "confirmed", confirmTransactionInitialTimeout: 30_000 });
    this.caller = options.signer?.publicKey ?? new PublicKey(options.callerPublicKey!);
    if (options.callerPublicKey && new PublicKey(options.callerPublicKey).toBase58() !== this.caller.toBase58()) throw new Error("Configured caller does not match runtime signer");
    const vault = new PublicKey(options.vaultAddress);
    const canonicalVault = PublicKey.findProgramAddressSync([Buffer.from("vault")], PROGRAM_ID)[0];
    if (!vault.equals(canonicalVault)) throw new Error("Configured address is not the canonical vault PDA");
    this.vaultKey = vault;
    this.addresses = {
      vault,
      governance: pda("governance", vault),
      policy: pda("auction_policy", vault),
      intent: pda("rebalance_intent", vault),
      condition: conditionStateAddress(vault),
    };
  }

  async readState(): Promise<ConditionSnapshot> {
    await this.ensureNetwork();
    const initial = await this.connection.getAccountInfoAndContext(this.addresses.vault, "confirmed");
    if (!initial.value) throw new Error("Vault PDA is absent");
    assertOwner(initial.value.owner, PROGRAM_ID, "Vault");
    const firstVault = decodeVault(initial.value.data);
    const accounts = await this.connection.getMultipleAccountsInfoAndContext(
      [this.addresses.vault, this.addresses.governance, this.addresses.policy, this.addresses.intent, this.addresses.condition, SOL_USD_FEED, USDC_USD_FEED],
      { commitment: "confirmed", minContextSlot: initial.context.slot },
    );
    const [vaultInfo, governanceInfo, policyInfo, intentInfo, conditionInfo, solFeedInfo, usdcFeedInfo] = accounts.value;
    if (!vaultInfo || !governanceInfo || !policyInfo) throw new Error("Vault governance or auction policy account is absent");
    assertOwner(vaultInfo.owner, PROGRAM_ID, "Vault");
    assertOwner(governanceInfo.owner, PROGRAM_ID, "GovernanceAccount");
    assertOwner(policyInfo.owner, PROGRAM_ID, "AuctionPolicy");
    const vault = decodeVault(vaultInfo.data);
    if (vault.authority !== this.addresses.vault.toBase58() || vault.configurationRevision < firstVault.configurationRevision) throw new Error("Vault authority or revision changed during the reconciliation read");
    const governance = decodeGovernance(governanceInfo.data);
    const policy = decodeAuctionPolicy(policyInfo.data);
    if (governance.vault !== this.vaultKey.toBase58() || policy.vault !== this.vaultKey.toBase58()) throw new Error("Governance or policy account is bound to a different vault");
    const intent = intentInfo ? (assertOwner(intentInfo.owner, PROGRAM_ID, "RebalanceIntent"), decodeIntent(intentInfo.data)) : null;
    const condition = conditionInfo ? (assertOwner(conditionInfo.owner, PROGRAM_ID, "ConditionState"), decodeConditionState(conditionInfo.data)) : null;
    if (condition && condition.vault !== this.vaultKey.toBase58()) throw new Error("ConditionState is bound to a different vault");
    const oracleAccountsReady = !!solFeedInfo && !!usdcFeedInfo
      && solFeedInfo.owner.equals(PYTH_RECEIVER_PROGRAM) && usdcFeedInfo.owner.equals(PYTH_RECEIVER_PROGRAM)
      && solFeedInfo.data.byteLength > 8 && usdcFeedInfo.data.byteLength > 8;
    const slot = Math.max(accounts.context.slot, await this.connection.getSlot("confirmed"));
    const blockTime = await this.connection.getBlockTime(slot);
    return {
      slot: BigInt(slot), unixTimestamp: blockTime === null ? null : BigInt(blockTime), vaultAddress: this.vaultKey.toBase58(),
      vault, governance, policy, intent, condition, oracleAccountsReady,
    };
  }

  async subscribe(onChange: () => void): Promise<() => Promise<void>> {
    await this.ensureNetwork();
    const ids = await Promise.all([this.addresses.vault, this.addresses.governance, this.addresses.policy, this.addresses.intent, this.addresses.condition, SOL_USD_FEED, USDC_USD_FEED]
      .map((key) => this.connection.onAccountChange(key, () => onChange(), "confirmed")));
    return async () => { await Promise.all(ids.map((id) => this.connection.removeAccountChangeListener(id))); };
  }

  async simulate(action: ConditionAction, _snapshot: ConditionSnapshot): Promise<ConditionSimulation> {
    await this.ensureNetwork();
    const prepared = await this.createTransaction(action);
    this.prepared.clear();
    this.prepared.set(actionKey(action), prepared);
    const feeResponse = await this.connection.getFeeForMessage(prepared.transaction.compileMessage(), "confirmed");
    try {
      const result = await this.connection.simulateTransaction(prepared.transaction);
      if (result.value.err) return { ok: false, feeLamports: feeResponse.value === null ? null : BigInt(feeResponse.value), reason: `Condition simulation failed: ${JSON.stringify(result.value.err)}` };
      return { ok: true, feeLamports: feeResponse.value === null ? null : BigInt(feeResponse.value) };
    } catch (error) {
      return { ok: false, feeLamports: feeResponse.value === null ? null : BigInt(feeResponse.value), reason: `Condition simulation RPC failed: ${safeError(error)}` };
    }
  }

  async submit(action: ConditionAction, _snapshot: ConditionSnapshot): Promise<string> {
    await this.ensureNetwork();
    if (this.options.dryRun ?? true) throw new Error("Dry-run mode cannot submit condition transactions");
    if (!this.options.signer) throw new Error("Condition submission requires the configured caller keypair");
    const key = actionKey(action);
    const prepared = this.prepared.get(key) ?? await this.createTransaction(action);
    this.prepared.delete(key);
    prepared.transaction.partialSign(this.options.signer);
    const signatureBytes = prepared.transaction.signature;
    if (!signatureBytes) throw new Error("Condition transaction signature was not produced");
    const signature = encodeBase58(signatureBytes);
    this.submitted.set(signature, prepared);
    try {
      const rpcSignature = await this.connection.sendRawTransaction(prepared.transaction.serialize(), { skipPreflight: false, maxRetries: 0, preflightCommitment: "confirmed" });
      if (rpcSignature !== signature) throw new Error("RPC returned a different signature for the submitted transaction");
      return signature;
    } catch (error) {
      throw new UncertainConditionSubmissionError(signature, `Submission RPC outcome is uncertain: ${safeError(error)}`);
    }
  }

  async confirm(signature: string): Promise<ConditionConfirmation> {
    const prepared = this.submitted.get(signature);
    if (!prepared) return { status: "unknown", reason: "No local confirmation window; the scheduler rereads chain state before retrying" };
    const deadline = Date.now() + 30_000;
    try {
      while (Date.now() < deadline) {
        const status = (await this.connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
        if (status?.err) { this.submitted.delete(signature); return { status: "failed", reason: JSON.stringify(status.err) }; }
        if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized" || status?.confirmations === null) {
          this.submitted.delete(signature);
          return { status: "confirmed" };
        }
        if (await this.connection.getBlockHeight("confirmed") > prepared.lastValidBlockHeight) {
          this.submitted.delete(signature);
          return { status: "failed", reason: "Recent blockhash expired before confirmation" };
        }
        await sleep(1_000);
      }
      return { status: "unknown", reason: "Condition confirmation was not observed before the bounded wait ended" };
    } catch (error) {
      return { status: "unknown", reason: `Condition confirmation RPC unavailable: ${safeError(error)}` };
    }
  }

  private async createTransaction(action: ConditionAction): Promise<Prepared> {
    const instruction = action.kind === "execute"
      ? buildExecuteConditionRuleInstruction(this.vaultKey)
      : action.kind === "observe"
        ? buildObserveConditionInstruction(this.vaultKey)
        : buildActivateConditionInstruction(this.vaultKey, action.ruleNonce);
    const latest = await this.connection.getLatestBlockhash("confirmed");
    const transaction = new Transaction({ feePayer: this.caller, recentBlockhash: latest.blockhash }).add(instruction);
    return { transaction, lastValidBlockHeight: latest.lastValidBlockHeight };
  }

  private async ensureNetwork(): Promise<void> {
    if (this.genesisVerified) return;
    const actual = await this.connection.getGenesisHash();
    if (actual === MAINNET_GENESIS || actual !== this.options.expectedGenesisHash) throw new Error("RPC genesis hash does not match the explicitly configured Localnet/Devnet cluster");
    this.genesisVerified = true;
  }
}

export function createConditionSchedulerFromEnvironment(
  observe?: ConditionSchedulerObserver,
) {
  const config = keeperConfigFromEnvironment();
  const signer = config.dryRun ? undefined : loadRuntimeSignerFromEnvironment();
  const runtime = new SolanaConditionRuntime({ ...config, signer });
  return new ConditionScheduler(config, runtime, observe);
}

function pda(seed: string, vault: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from(seed), vault.toBuffer()], PROGRAM_ID)[0];
}

function actionKey(action: ConditionAction): string { return `${action.kind}:${action.stateSequence}:${action.ruleNonce}`; }
function assertOwner(owner: PublicKey, expected: PublicKey, label: string): void { if (!owner.equals(expected)) throw new Error(`${label} account owner does not match the pinned program`); }
function safeError(error: unknown): string { return error instanceof Error ? error.message : "Unknown Solana RPC error"; }
function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

function encodeBase58(bytes: Uint8Array): string {
  let value = BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
  let output = "";
  while (value > 0n) { const digit = Number(value % 58n); value /= 58n; output = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"[digit]! + output; }
  for (const byte of bytes) { if (byte !== 0) break; output = `1${output}`; }
  return output || "1";
}
