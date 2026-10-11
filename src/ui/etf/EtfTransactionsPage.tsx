import { useCallback, useEffect, useRef, useState } from "react";
import { PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  ETF_DEVNET_GENESIS_HASH,
  deriveWalletAtaPreparationPlan,
  initialSharesFromNav,
  isQuoteDirectionImproving,
  normalizeUsdValue,
  quoteExactIn,
  buildCancelResumeProposalInstruction,
  buildCreateEtfTokenAccountInstruction,
  buildEligibilityPokeInstruction,
  buildInKindRedeemInstruction,
  buildInitializePoolInstruction,
  buildPauseRiskInstruction,
  buildProportionalDepositInstruction,
  buildProposeResumeInstruction,
  buildResumeRiskAfterDelayInstruction,
  buildSeedPoolInstruction,
  buildTraderFundedSwapInstruction,
  quoteProportionalDeposit,
  quoteProportionalRedeem,
  readDevnetCandidateState,
  readEtfSnapshot,
  reconcileWalletSubmission,
  submitWalletTransaction,
  verifyEtfManifest,
  type BuildOperation,
  type EtfPoolSnapshot,
  type TrackedTokenAccount,
  type VerifiedEtfManifest,
  type WalletSubmissionResult,
  type WalletNoTokenBalanceAction,
  type WalletAtaPreparationTarget,
} from "../../../packages/etf-client/src/index.js";
import { ConnectButton } from "../wallet/ConnectButton.js";
import { IndexedDbSubmissionJournal } from "./IndexedDbSubmissionJournal.js";
import { probeEtfDeployment, type DeploymentProbe } from "./deploymentProbe.js";
import "./devnet-read.css";
import "./transactions.css";

type ReceiptAction = "initialize" | "prepare_accounts" | "seed" | "deposit" | "redeem" | "swap" | "pause" | "poke" | "resume_propose" | "resume_execute" | "resume_cancel";
type UiOperation = Readonly<{ action: ReceiptAction; instruction?: TransactionInstruction; instructions?: readonly TransactionInstruction[] }>;
type ActionEvidence = Readonly<{
  action: ReceiptAction;
  baseline: EtfPoolSnapshot | null;
  wallet: string;
  expectedBalanceDeltas?: readonly Readonly<{ address: string; delta: string }>[];
  expectedSupplyDelta?: string;
  expectedFeeDeltas?: readonly string[];
  expectedSequence?: string;
  expectedLifecycle?: EtfPoolSnapshot["state"]["lifecycle"];
  expectedPaused?: boolean;
  expectedNewAccounts?: readonly Readonly<{ address: string; mint: string; share: boolean; decimals: number }> [];
  inputs?: readonly string[];
  sharesOut?: string;
  redeemShares?: string;
  amountsOut?: readonly string[];
  swap?: Readonly<{ assetIn: number; assetOut: number; amountIn: string; amountOut: string; feeAmount: string }>;
  proposalNonce?: string;
}>;

type JournalEntry = Readonly<{
  operationId: string;
  attempts: readonly Readonly<{ signature: string; state: "confirmed" | "rejected" | "unknown"; receipt: WalletSubmissionResult["receipt"]; postStateVerified?: boolean }>[];
  evidence?: ActionEvidence;
}>;

type PageData = Readonly<{
  loading: boolean;
  error: string | null;
  genesis: string | null;
  candidate: Awaited<ReturnType<typeof readDevnetCandidateState>> | null;
  context: VerifiedEtfManifest | null;
  manifestError: string | null;
  probe: DeploymentProbe | null;
  snapshot: EtfPoolSnapshot | null;
  entries: readonly JournalEntry[];
  journalError: string | null;
  checkedAt: string | null;
}>;

const MANIFEST_URL = "/etf-devnet/deployment-manifest.json";
const IDL_URL = "/idl/coloyond_etf.json";
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

function formatStatus(status: string): string { return status.replaceAll("_", " "); }
function tone(status: "good" | "warn" | "bad" | "neutral"): string { return `etf-tag etf-tag-${status}`; }
function exact(value: string | number | null | undefined): string { return value === null || value === undefined || value === "" ? "Not available from RPC" : String(value); }
function stringify(value: unknown): string { return JSON.stringify(value); }
function u64(value: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error("Enter an unsigned integer in token base units.");
  const parsed = BigInt(value);
  if (parsed > (1n << 64n) - 1n) throw new Error("Amount is outside the on-chain u64 range.");
  return parsed;
}
function seedQuote(context: VerifiedEtfManifest, snapshot: EtfPoolSnapshot, amounts: readonly string[]) {
  if (amounts.length < context.config.assets.length) throw new Error("Enter an amount for every admitted asset.");
  const inputs = context.config.assets.map((asset, index) => u64(amounts[index] ?? "0"));
  if (inputs.some((amount) => amount === 0n)) throw new Error("Every seed asset amount must be greater than zero.");
  const navQ = inputs.reduce((total, amount, index) => {
    const oracle = snapshot.assets[index]!.oracle;
    if (oracle.verification !== "full" || oracle.freshness !== "within_approved_limits" || oracle.rawPrice === null || oracle.exponent === null) throw new Error(`asset_${index}_oracle_not_ready`);
    return total + normalizeUsdValue(amount, context.config.assets[index]!.decimals, BigInt(oracle.rawPrice), oracle.exponent);
  }, 0n);
  return { inputs, navQ, sharesOut: initialSharesFromNav(navQ) };
}
function weightedSwapPreview(
  context: VerifiedEtfManifest,
  snapshot: EtfPoolSnapshot,
  assetIn: number,
  assetOut: number,
  amountInText: string,
  slippageText: string,
) {
  const amountIn = u64(amountInText);
  const slippageBps = u64(slippageText);
  if (slippageBps >= 10_000n) throw new Error("Slippage must be less than 10000 bps.");
  const balances = snapshot.assets.map((asset) => BigInt(asset.custodyAmount));
  const weightsBps = context.config.assets.map((asset) => asset.targetWeightBps);
  const feeBps = context.manifest.feePolicy.swapFeeBps;
  if (assetIn < 0 || assetIn >= balances.length || amountIn > balances[assetIn]! * BigInt(context.manifest.feePolicy.maximumInputBps) / 10_000n) throw new Error("amount_exceeds_accepted_pool_input_cap");
  const quote = quoteExactIn(balances, weightsBps, assetIn, assetOut, amountIn, feeBps);
  const marks = snapshot.assets.map((asset) => {
    if (asset.oracle.verification !== "full" || asset.oracle.freshness !== "within_approved_limits" || asset.oracle.rawPrice === null || asset.oracle.exponent === null) throw new Error(`asset_${asset.index}_oracle_not_ready`);
    return { mintDecimals: asset.decimals, rawPrice: BigInt(asset.oracle.rawPrice), priceExponent: asset.oracle.exponent };
  });
  const directionImproves = isQuoteDirectionImproving(balances, weightsBps, assetIn, assetOut, quote, feeBps, marks);
  const minAmountOut = quote.amountOut * (10_000n - slippageBps) / 10_000n;
  if (minAmountOut === 0n) throw new Error("Minimum output rounds to zero.");
  return { quote, minAmountOut, directionImproves, feeBps };
}
function stateWithout(snapshot: EtfPoolSnapshot, keys: readonly string[]): Record<string, unknown> {
  const state = { ...snapshot.state } as unknown as Record<string, unknown>;
  for (const key of keys) delete state[key];
  return state;
}
function poolBalances(snapshot: EtfPoolSnapshot): Map<string, bigint> {
  const balances = new Map<string, bigint>();
  for (const asset of snapshot.assets) balances.set(asset.custody, BigInt(asset.custodyAmount));
  for (const row of snapshot.wallet?.tokenAccounts ?? []) balances.set(row.address, BigInt(row.amount));
  for (const row of snapshot.wallet?.shareAccounts ?? []) balances.set(row.address, BigInt(row.amount));
  return balances;
}
function allFinancialState(snapshot: EtfPoolSnapshot): string {
  return stringify({
    state: snapshot.state,
    supply: snapshot.shares.supply,
    assets: snapshot.assets.map((asset) => [asset.custody, asset.custodyAmount, asset.cumulativeFeeBaseUnits]),
    wallet: snapshot.wallet ? {
      tokenAccounts: [...snapshot.wallet.tokenAccounts].map((row) => [row.address, row.mint, row.amount, row.frozen]).sort(),
      shareAccounts: [...snapshot.wallet.shareAccounts].map((row) => [row.address, row.amount, row.frozen]).sort(),
    } : null,
  });
}
function snapshotTrackedAccounts(snapshot: EtfPoolSnapshot, wallets: readonly Readonly<{ mint: string; tokenAccount: string }>[], shareAccount: string): TrackedTokenAccount[] {
  return [
    ...snapshot.assets.map((asset) => ({ address: asset.custody, mint: asset.mint })),
    ...wallets.map((row) => ({ address: row.tokenAccount, mint: row.mint })),
    { address: shareAccount, mint: snapshot.identity.shareMint },
  ].filter((account, index, all) => all.findIndex((candidate) => candidate.address === account.address) === index);
}
function ata(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID)[0];
}
function walletAssetAccounts(context: VerifiedEtfManifest, snapshot: EtfPoolSnapshot) {
  if (!snapshot.wallet) throw new Error("Wallet-specific verified RPC snapshot is required.");
  return context.config.assets.map((asset) => {
    const token = snapshot.wallet!.tokenAccounts.find((row) => row.mint === asset.mint.toBase58() && !row.frozen);
    if (!token) throw new Error(`Missing verified, unfrozen token account for ${asset.mint.toBase58()}. Create it, then refresh.`);
    return { mint: asset.mint.toBase58(), tokenAccount: token.address };
  });
}
function expectedDeltaMap(evidence: ActionEvidence): Map<string, bigint> {
  return new Map((evidence.expectedBalanceDeltas ?? []).map((row) => [row.address, BigInt(row.delta)]));
}
function deltaFor(before: EtfPoolSnapshot, after: EtfPoolSnapshot, address: string): bigint {
  const left = poolBalances(before).get(address) ?? 0n;
  const right = poolBalances(after).get(address) ?? 0n;
  return right - left;
}
function verifyTokenEffects(evidence: ActionEvidence, before: EtfPoolSnapshot, after: EtfPoolSnapshot, result: WalletSubmissionResult): boolean {
  const deltas = expectedDeltaMap(evidence);
  const beforeBalances = poolBalances(before);
  const afterBalances = poolBalances(after);
  const addresses = new Set([...beforeBalances.keys(), ...afterBalances.keys()]);
  for (const address of addresses) if (deltaFor(before, after, address) !== (deltas.get(address) ?? 0n)) return false;
  if (BigInt(after.shares.supply) - BigInt(before.shares.supply) !== BigInt(evidence.expectedSupplyDelta ?? "0")) return false;
  if (after.assets.length !== before.assets.length || after.assets.some((asset, index) => {
    const expectedFee = BigInt(before.assets[index]!.cumulativeFeeBaseUnits) + BigInt(evidence.expectedFeeDeltas?.[index] ?? "0");
    return BigInt(asset.cumulativeFeeBaseUnits) !== expectedFee;
  })) return false;
  if (!result.receipt?.tokenDeltas || result.receipt.tokenDeltas.length !== deltas.size) return false;
  for (const row of result.receipt.tokenDeltas) {
    if (row.account === null || !deltas.has(row.account)) return false;
    if (BigInt(row.delta) !== (deltas.get(row.account) ?? 0n)) return false;
  }
  const expectedSequence = BigInt(before.state.sequence) + 1n;
  if (BigInt(after.state.sequence) !== expectedSequence) return false;
  if (after.state.lifecycle !== evidence.expectedLifecycle || after.state.riskPaused !== evidence.expectedPaused) return false;
  if (stringify(stateWithout(before, ["sequence", "lifecycle", "riskPaused"])) !== stringify(stateWithout(after, ["sequence", "lifecycle", "riskPaused"]))) return false;
  return true;
}

function verifyStateAction(evidence: ActionEvidence, after: EtfPoolSnapshot): boolean {
  const before = evidence.baseline;
  if (evidence.action === "initialize") {
    return after.state.lifecycle === "unseeded" && after.state.riskPaused && after.state.sequence === "0" &&
      after.shares.supply === "0" && after.assets.every((asset) => asset.custodyAmount === "0" && asset.cumulativeFeeBaseUnits === "0");
  }
  if (evidence.action === "prepare_accounts") {
    if (!before) return false;
    const poolProjection = (value: EtfPoolSnapshot) => stringify({ state: value.state, supply: value.shares.supply, assets: value.assets.map((asset) => [asset.custody, asset.custodyAmount, asset.cumulativeFeeBaseUnits]) });
    if (poolProjection(before) !== poolProjection(after)) return false;
    const rows = [...(after.wallet?.tokenAccounts ?? []).map((row) => ({ address: row.address, mint: row.mint, amount: row.amount })), ...(after.wallet?.shareAccounts ?? []).map((row) => ({ address: row.address, mint: after.identity.shareMint, amount: row.amount }))];
    return (evidence.expectedNewAccounts ?? []).every((wanted) => rows.some((row) => row.address === wanted.address && row.mint === wanted.mint && row.amount === "0"));
  }
  if (!before) return false;
  if (evidence.action === "pause" || evidence.action === "poke" || evidence.action.startsWith("resume_")) {
    if (BigInt(after.state.sequence) !== BigInt(before.state.sequence) + 1n) return false;
    if (stringify({ ...stateWithout(before, ["sequence", "riskPaused", "pendingResume", "lastObservation"]), lifecycle: before.state.lifecycle }) !== stringify({ ...stateWithout(after, ["sequence", "riskPaused", "pendingResume", "lastObservation"]), lifecycle: after.state.lifecycle })) return false;
    if (evidence.action === "pause") return after.state.riskPaused && stringify(after.state.lastObservation) === stringify(before.state.lastObservation) && stringify(after.state.pendingResume) === stringify(before.state.pendingResume);
    if (evidence.action === "poke") return after.state.riskPaused === before.state.riskPaused && after.state.lifecycle === before.state.lifecycle && after.state.lastObservation !== null;
    if (evidence.action === "resume_propose") return after.state.riskPaused && after.state.pendingResume?.proposer === before.state.currentGovernance && after.state.pendingResume?.nonce === after.state.sequence && after.state.lastObservation === before.state.lastObservation;
    if (evidence.action === "resume_execute") return !after.state.riskPaused && after.state.pendingResume === null && before.state.pendingResume !== null && after.state.lastObservation === before.state.lastObservation;
    if (evidence.action === "resume_cancel") return after.state.riskPaused && after.state.pendingResume === null && before.state.pendingResume !== null && after.state.lastObservation === before.state.lastObservation;
  }
  return false;
}

async function verifyActionReadback(
  connection: Parameters<typeof readEtfSnapshot>[0],
  context: VerifiedEtfManifest,
  evidence: ActionEvidence,
  result: WalletSubmissionResult,
): Promise<boolean> {
  if (evidence.action === "initialize" && result.state === "rejected") {
    const probe = await probeEtfDeployment(connection, context);
    return probe.program === "verified" && probe.pool === "uninitialized";
  }
  const after = await readEtfSnapshot(connection, context, { walletAddress: evidence.wallet, commitment: "confirmed" });
  if (result.state === "rejected") return evidence.baseline !== null && result.receipt?.tokenBalancesUnchanged === true && allFinancialState(evidence.baseline) === allFinancialState(after);
  if (result.state !== "confirmed") return false;
  if (evidence.action === "initialize") return verifyStateAction(evidence, after);
  if (evidence.action === "prepare_accounts") {
    if (result.receipt?.tokenBalancesUnchanged !== true || !verifyStateAction(evidence, after) || !after.wallet || !context) return false;
    const allowed = new Map<string, number>([
      ...context.config.assets.map((asset) => [asset.mint.toBase58(), asset.decimals] as const),
      [context.addresses.shareMint.toBase58(), 6],
    ]);
    return (evidence.expectedNewAccounts ?? []).length > 0 && (evidence.expectedNewAccounts ?? []).every((wanted) => {
      const mint = new PublicKey(wanted.mint);
      const expectedAddress = ata(new PublicKey(evidence.wallet), mint).toBase58();
      const decimals = allowed.get(wanted.mint);
      if (decimals === undefined || wanted.decimals !== decimals || wanted.address !== expectedAddress) return false;
      if (wanted.share) return wanted.mint === context.addresses.shareMint.toBase58() && after.shares.decimals === decimals && after.wallet!.shareAccounts.some((row) => row.address === wanted.address && row.amount === "0");
      const asset = context.config.assets.find((row) => row.mint.toBase58() === wanted.mint);
      return asset !== undefined && after.assets[context.config.assets.indexOf(asset)]?.decimals === decimals && after.wallet!.tokenAccounts.some((row) => row.address === wanted.address && row.mint === wanted.mint && row.amount === "0");
    });
  }
  if (["pause", "poke", "resume_propose", "resume_execute", "resume_cancel"].includes(evidence.action)) return verifyStateAction(evidence, after);
  return evidence.baseline !== null && verifyTokenEffects(evidence, evidence.baseline, after, result);
}

function initialPageData(): PageData {
  return { loading: true, error: null, genesis: null, candidate: null, context: null, manifestError: null, probe: null, snapshot: null, entries: [], journalError: null, checkedAt: null };
}

export function EtfTransactionsPage() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const walletAddress = wallet.publicKey?.toBase58() ?? null;
  const request = useRef(0);
  const journal = useRef(new IndexedDbSubmissionJournal());
  const [page, setPage] = useState<PageData>(initialPageData);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [amounts, setAmounts] = useState<string[]>(["0", "0", "0"]);
  const [shares, setShares] = useState("0");
  const [swapAmount, setSwapAmount] = useState("0");
  const [swapIn, setSwapIn] = useState(0);
  const [swapOut, setSwapOut] = useState(1);
  const [slippageBps, setSlippageBps] = useState("0");
  const [proposalNonce, setProposalNonce] = useState("");
  const [ataRentLamports, setAtaRentLamports] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const requestId = ++request.current;
    setPage((current) => ({ ...current, loading: true, error: null }));
    let genesis: string | null = null;
    try {
      genesis = await connection.getGenesisHash();
      const candidate = await readDevnetCandidateState(connection, {
        commitment: "confirmed",
        walletAddress: walletAddress ?? undefined,
        draftOracleLimits: { status: "draft_not_approved", maximumAgeSeconds: 60, maximumConfidenceBps: 100 },
      });
      let context: VerifiedEtfManifest | null = null;
      let manifestError: string | null = null;
      let probe: DeploymentProbe | null = null;
      let snapshot: EtfPoolSnapshot | null = null;
      try {
        const [manifestResponse, idlResponse] = await Promise.all([fetch(MANIFEST_URL, { cache: "no-store" }), fetch(IDL_URL, { cache: "no-store" })]);
        if (!manifestResponse.ok || !idlResponse.ok) throw new Error(`accepted_deployment_manifest_or_idl_missing (${manifestResponse.status}/${idlResponse.status})`);
        const [manifest, idl] = await Promise.all([manifestResponse.json() as Promise<unknown>, idlResponse.json() as Promise<unknown>]);
        context = verifyEtfManifest(manifest, idl, genesis);
        probe = await probeEtfDeployment(connection, context);
        if (probe.program === "verified" && probe.pool === "initialized") snapshot = await readEtfSnapshot(connection, context, { walletAddress: walletAddress ?? undefined, commitment: "confirmed" });
      } catch (error) {
        manifestError = error instanceof Error ? error.message : "accepted_manifest_or_program_verification_failed";
      }
      let entries: readonly JournalEntry[] = [];
      let journalError: string | null = null;
      if (genesis && context && walletAddress) {
        try {
          const prefix = `${genesis}:${context.addresses.pool.toBase58()}:${walletAddress}:`;
          entries = await journal.current.listByPrefix(prefix) as readonly JournalEntry[];
        } catch (error) { journalError = error instanceof Error ? error.message : "indexed_db_read_failed"; }
      }
      if (requestId === request.current) setPage({ loading: false, error: null, genesis, candidate, context, manifestError, probe, snapshot, entries, journalError, checkedAt: new Date().toLocaleString() });
    } catch (error) {
      if (requestId === request.current) setPage({ ...initialPageData(), loading: false, error: error instanceof Error ? error.message : "rpc_read_failed", genesis, checkedAt: new Date().toLocaleString() });
    }
  }, [connection, walletAddress]);

  useEffect(() => { void refresh(); return () => { request.current += 1; }; }, [refresh]);
  useEffect(() => {
    let active = true;
    void connection.getMinimumBalanceForRentExemption(165, "confirmed").then((value) => { if (active && Number.isSafeInteger(value) && value >= 0) setAtaRentLamports(String(value)); }).catch(() => { if (active) setAtaRentLamports(null); });
    return () => { active = false; };
  }, [connection]);

  const context = page.context;
  const snapshot = page.snapshot;
  const acceptedContext = page.genesis === ETF_DEVNET_GENESIS_HASH && context !== null && page.probe?.program === "verified";
  const feedSafe = !!snapshot && snapshot.assets.every((asset) => asset.oracle.verification === "full" && asset.oracle.freshness === "within_approved_limits");
  const unresolvedEntries = page.entries.filter((entry) => entry.attempts.at(-1)?.state === "unknown");
  const journalReady = page.journalError === null;
  const canSign = wallet.connected && wallet.publicKey !== null && typeof wallet.signTransaction === "function" && acceptedContext && journalReady && unresolvedEntries.length === 0 && !busy;

    const execute = useCallback(async (operationId: string, operation: UiOperation, evidence: ActionEvidence, tracked: TrackedTokenAccount[], options: { noTokenBalanceAction?: WalletNoTokenBalanceAction; noTokenProgramId?: PublicKey; ataPreparationPlan?: readonly WalletAtaPreparationTarget[]; retryOfSignature?: string } = {}) => {
    if (!wallet.publicKey || !wallet.signTransaction || !page.context) throw new Error("A connected signing wallet and accepted manifest are required.");
    setBusy(true);
    setNotice(null);
    try {
      await journal.current.stageEvidence(operationId, evidence);
      const latest = await connection.getLatestBlockhash("confirmed");
      const instructions = operation.instructions ?? (operation.instruction ? [operation.instruction] : []);
      if (instructions.length === 0) throw new Error("wallet_transaction_has_no_instructions");
      const transaction = new Transaction({ feePayer: wallet.publicKey, recentBlockhash: latest.blockhash }).add(...instructions);
      const result = await submitWalletTransaction({
        connection,
        signer: { publicKey: wallet.publicKey, signTransaction: wallet.signTransaction },
        transaction,
        journal: journal.current,
        operationId,
        trackedTokenAccounts: tracked,
        ...(options.retryOfSignature ? { retryOfSignature: options.retryOfSignature } : {}),
        ...(options.noTokenBalanceAction ? { noTokenBalanceAction: options.noTokenBalanceAction, noTokenProgramId: options.noTokenProgramId ?? page.context.programId } : {}),
        ...(options.ataPreparationPlan ? { ataPreparationPlan: options.ataPreparationPlan } : {}),
        requirePostStateReadback: true,
        postStateVerifier: (receipt) => verifyActionReadback(connection, page.context!, evidence, receipt),
      });
      setNotice(result.state === "confirmed" && result.postStateVerified === true ? `${operation.action} confirmed and reconciled at slot ${result.receipt?.confirmationSlot ?? "unknown"}.` : result.state === "rejected" && result.retryAllowed ? `${operation.action} was rejected; RPC confirms unchanged balances and pool state. A manual retry is available.` : `${operation.action} outcome unresolved. Do not retry; refresh or reconcile the recorded signature first.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "wallet_transaction_failed");
    } finally {
      await refresh();
      setBusy(false);
    }
  }, [connection, page.context, refresh, wallet.publicKey, wallet.signTransaction]);

  const reconcile = useCallback(async (operationId: string) => {
    if (!page.context) return;
    setBusy(true);
    try {
      const evidence = await journal.current.readEvidence(operationId) as ActionEvidence | null;
      if (!evidence) throw new Error("Saved operation evidence is missing; result remains unresolved.");
      const result = await reconcileWalletSubmission({ connection, journal: journal.current, operationId, commitment: "confirmed", postStateVerifier: (receipt) => verifyActionReadback(connection, page.context!, evidence, receipt) });
      setNotice(result.state === "confirmed" && result.postStateVerified === true ? `Signature reconciled successfully at slot ${result.receipt?.confirmationSlot ?? "unknown"}.` : result.state === "rejected" && result.retryAllowed ? "RPC confirms this transaction was rejected and left tracked balances and pool state unchanged. You may manually retry." : "Still unresolved. No retry or success is offered until complete RPC receipt and state readback are available.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "signature_reconciliation_failed"); }
    finally { await refresh(); setBusy(false); }
  }, [connection, page.context, refresh]);

  const button = (label: string, blocked: string | null, onClick: () => void, risk = false) => <div className="tx-action-row" key={label}>
    <button type="button" className={risk ? "etf-refresh tx-risk" : "etf-refresh"} disabled={blocked !== null || !canSign || page.loading} onClick={onClick}>{busy ? "Waiting for RPC…" : label}</button>
    <small>{blocked ?? (canSign ? "Ready for wallet approval after a fresh read." : !wallet.connected ? "Connect a wallet to enable signing." : !acceptedContext ? "Blocked until an accepted, verified Devnet deployment is present." : unresolvedEntries.length ? "Reconcile the unresolved signature before any new signing." : !journalReady ? "Durable IndexedDB journal is unavailable." : "Risk action is paused by missing verified inputs.")}</small>
  </div>;

  const buildEvidence = (action: ReceiptAction, expected: Partial<ActionEvidence> = {}): ActionEvidence => ({ action, baseline: snapshot, wallet: walletAddress ?? "", ...expected });
  const makeOperationId = (action: ReceiptAction) => `${page.genesis}:${context!.addresses.pool.toBase58()}:${walletAddress}:${action}:${Date.now()}`;
  const noPool = page.probe?.pool === "uninitialized";
  const basePoolReady = acceptedContext && !!snapshot && !!wallet.publicKey && !unresolvedEntries.length;
  const noSnapshotReason = !acceptedContext ? page.manifestError ?? "Accepted manifest, program binary, or genesis verification is missing." : !snapshot ? page.probe?.reason ?? "Pool accounts are absent or incomplete; refresh after initialization." : null;
  let existingWallets: ReturnType<typeof walletAssetAccounts> | null = null;
  try { if (snapshot && context && wallet.publicKey) existingWallets = walletAssetAccounts(context, snapshot); } catch { existingWallets = null; }
  const shareAccount = snapshot?.wallet?.shareAccounts.find((row) => !row.frozen) ?? null;
  const shareAddress = context && wallet.publicKey ? ata(wallet.publicKey, context.addresses.shareMint).toBase58() : null;
  const missingAtas = context && wallet.publicKey && snapshot ? [
    ...context.config.assets.map((asset) => ({ address: ata(wallet.publicKey!, asset.mint), mint: asset.mint.toBase58(), share: false })),
    { address: ata(wallet.publicKey, context.addresses.shareMint), mint: context.addresses.shareMint.toBase58(), share: true },
  ].filter((wanted) => wanted.share
    ? !snapshot.wallet?.shareAccounts.some((row) => row.address === wanted.address.toBase58())
    : !snapshot.wallet?.tokenAccounts.some((row) => row.address === wanted.address.toBase58() && row.mint === wanted.mint)) : [];
  const seedPreview = (() => {
    if (!context || !snapshot) return { quote: null as ReturnType<typeof seedQuote> | null, error: "Accepted deployment and fresh pool readback are required." };
    try { return { quote: seedQuote(context, snapshot, amounts), error: null }; }
    catch (error) { return { quote: null, error: error instanceof Error ? error.message : "seed_quote_failed" }; }
  })();
  const swapPreview = (() => {
    if (!context || !snapshot) return { quote: null as ReturnType<typeof weightedSwapPreview> | null, error: "Accepted deployment and fresh pool readback are required." };
    try { return { quote: weightedSwapPreview(context, snapshot, swapIn, swapOut, swapAmount, slippageBps), error: null }; }
    catch (error) { return { quote: null, error: error instanceof Error ? error.message : "swap_quote_failed" }; }
  })();
  const genesisStatus = page.genesis === null ? "Awaiting RPC" : page.genesis === ETF_DEVNET_GENESIS_HASH ? "Pinned Devnet verified" : "Genesis mismatch";

  return <main className="etf-page cr-shell tx-page">
    <header className="etf-topbar">
      <a className="cr-brand" href="/"><span>coloyond</span><sup className="cr-brand-mark">●</sup></a>
      <div className="etf-topbar-actions"><a className="cr-reference-link" href="/etf-devnet">Live read surface ↗</a><span className="etf-live-label"><i aria-hidden="true" /> Devnet · wallet console</span><ConnectButton /></div>
    </header>
    <section className="etf-hero tx-hero">
      <div><p className="etf-eyebrow">Sprint 5 · real wallet transaction surface</p><h1>ETF<br />transaction desk</h1><p className="etf-lede">RPC-backed pool actions with signature reconciliation. No demo state can authorize a transaction.</p></div>
      <div className="etf-hero-side"><span className={tone(page.loading ? "neutral" : page.genesis === ETF_DEVNET_GENESIS_HASH ? "good" : "bad")}>{page.loading ? "Checking RPC" : genesisStatus}</span><p>Each action is held behind the accepted manifest, exact deployed binary, verified pool snapshot, fresh Full oracle reads where required, and a durable signature journal.</p><button className="etf-refresh" type="button" disabled={page.loading || busy} onClick={() => void refresh()}>Refresh Devnet state <span aria-hidden="true">↗</span></button></div>
    </section>
    {page.error ? <div className="etf-notice etf-notice-error" role="alert">RPC read failed: {page.error}</div> : null}
    {notice ? <div className={`etf-notice ${notice.includes("unresolved") || notice.includes("Blocked") ? "etf-notice-error" : ""}`} role="status">{notice}</div> : null}
    <section className="etf-section">
      <div className="etf-section-head"><div><p className="etf-eyebrow">Connection identity</p><h2>Network, deployment & wallet</h2></div><span className={tone(acceptedContext ? "good" : "warn")}>{acceptedContext ? "Manifest verified" : "Signing disabled"}</span></div>
      <div className="etf-network-grid">
        <article className="etf-card etf-network-card"><dl className="etf-fields">
          <div><dt>Cluster / genesis</dt><dd><code className="etf-value">{page.candidate?.status === "candidate_data" ? page.candidate.network.cluster : "Solana Devnet · status pending"} / {exact(page.genesis)}</code></dd></div>
          <div><dt>RPC endpoint</dt><dd><code className="etf-value">{connection.rpcEndpoint}</code></dd></div>
          <div><dt>Commitment / slot</dt><dd><code className="etf-value">{page.candidate?.status === "candidate_data" ? `${page.candidate.network.commitment} / ${page.candidate.network.contextSlot}` : "confirmed / unresolved"}</code></dd></div>
          <div><dt>Wallet</dt><dd><code className="etf-value">{walletAddress ?? "Not connected"}</code></dd></div>
          <div><dt>Program</dt><dd><code className="etf-value">{context?.programId.toBase58() ?? "Not available — accepted manifest missing"}</code></dd></div>
          <div><dt>Pool PDA</dt><dd><code className="etf-value">{context?.addresses.pool.toBase58() ?? "Not available — accepted manifest missing"}</code></dd></div>
          <div><dt>Program binary</dt><dd><code className="etf-value">{page.probe?.binarySha256 ?? "Not verified"} · authority {exact(page.probe?.upgradeAuthority)}</code></dd></div>
          <div><dt>Pool account status</dt><dd><span className={tone(page.probe?.pool === "initialized" ? "good" : "warn")}>{page.probe ? formatStatus(page.probe.pool) : "not verified"}</span></dd></div>
          <div><dt>Last RPC read</dt><dd><code className="etf-value">{page.checkedAt ?? "Pending"}</code></dd></div>
        </dl></article>
        <article className="etf-card etf-deployment-card"><p className="etf-eyebrow">Admission gate</p><span className={tone(acceptedContext ? "good" : "warn")}>{acceptedContext ? "Accepted manifest + on-chain identity verified" : "No accepted Devnet deployment manifest"}</span><p>{page.manifestError ?? "The page expects the reviewed deployment manifest and exact compiled IDL at the configured paths. Every action remains fail-closed until those files and the deployed binary agree."}</p><a className="cr-reference-link" href="/etf-devnet">Inspect live candidate feeds, mints and wallet balances ↗</a></article>
      </div>
    </section>
    <section className="etf-section">
      <div className="etf-section-head"><div><p className="etf-eyebrow">Exact configured accounts</p><h2>Assets & oracle state</h2></div><span className={tone(feedSafe ? "good" : "warn")}>{feedSafe ? "All feeds Full and within accepted limits" : "Risk-increasing actions blocked"}</span></div>
      {context && snapshot ? <div className="etf-card-grid">{snapshot.assets.map((asset) => <article className="etf-card" key={asset.mint}><div className="etf-card-head"><div><p className="etf-eyebrow">{asset.label}{asset.backing === "synthetic_unbacked" ? " · SYNTHETIC / UNBACKED" : ""}</p><h3>{asset.targetWeightBps / 100}% target weight</h3></div><span className={tone(asset.oracle.verification === "full" && asset.oracle.freshness === "within_approved_limits" ? "good" : "warn")}>{formatStatus(asset.oracle.freshness)}</span></div><dl className="etf-fields"><div><dt>Mint / decimals</dt><dd><code className="etf-value">{asset.mint} / {asset.decimals}</code></dd></div><div><dt>Mint owner / token program</dt><dd><code className="etf-value">{asset.mintOwner} / {asset.tokenProgram}</code></dd></div><div><dt>Custody / reserve</dt><dd><code className="etf-value">{asset.custody} / {asset.custodyAmount} base units</code></dd></div><div><dt>Feed owner / layout</dt><dd><code className="etf-value">{exact(asset.oracle.owner)} / {exact(asset.oracle.dataLength)} bytes</code></dd></div><div><dt>Feed account / ID</dt><dd><code className="etf-value">{asset.oracle.address} / {exact(asset.oracle.feedId)}</code></dd></div><div><dt>Verification / age</dt><dd><code className="etf-value">{asset.oracle.verification === "full" ? "Full" : asset.oracle.verification} / {exact(asset.oracle.ageSeconds)} s</code></dd></div><div><dt>Confidence / accepted limits</dt><dd><code className="etf-value">{exact(asset.oracle.confidenceBpsCeil)} bps / max {context.manifest.oraclePolicy.maximumConfidenceBps} bps</code></dd></div><div><dt>Freshness limit</dt><dd><code className="etf-value">max age {context.manifest.oraclePolicy.maximumAgeSeconds}s · Full verification required</code></dd></div></dl>{asset.backing === "synthetic_unbacked" ? <p className="etf-synthetic">Synthetic test mint. Not backed, not USDC, and not redeemable for USDC.</p> : null}</article>)}</div> : <article className="etf-card tx-blocked-card"><strong>Configured pool assets and feeds are not yet admitted.</strong><p>{noSnapshotReason ?? "The current RPC candidates are visible on the read route; they do not authorize pool actions."}</p>{page.candidate?.status === "candidate_data" ? <div className="etf-balance-list">{page.candidate.mints.map((mint) => <div className="etf-balance-row" key={mint.address}><div><strong>{mint.symbol}</strong><small>{mint.label}</small></div><code className="etf-value">{mint.address}</code></div>)}</div> : null}</article>}
      {page.candidate?.status === "candidate_data" && page.candidate.feeds.length ? <article className="etf-card tx-candidate-feeds"><p className="etf-callout">Draft diagnostic only: age ≤ 60 s and confidence ≤ 100 bps. These limits are not approved, do not establish accepted feed policy, and are not enforced by the program. Candidate mints and feeds remain unadmitted.</p>{page.candidate.feeds.map((feed) => <div className="etf-balance-row" key={feed.address}><div><strong>{feed.label}</strong><small>Candidate only · accepted pool feed unavailable until manifest verification</small></div><div><code className="etf-value">{feed.address} · owner {exact(feed.owner)} · {exact(feed.dataLength)} bytes · {exact(feed.feedId)}</code><small>{feed.verification === "full" ? "Full" : feed.verification} · observed age {exact(feed.ageSeconds)}s · confidence {exact(feed.confidenceBpsCeil)}bps · {formatStatus(feed.freshness)}</small></div></div>)}</article> : null}
    </section>
    <section className="etf-section">
      <div className="etf-section-head"><div><p className="etf-eyebrow">Wallet-signable actions</p><h2>Pool lifecycle & liquidity</h2></div><span className={tone(canSign ? "good" : "warn")}>{canSign ? "Ready after action-specific checks" : "All actions currently gated"}</span></div>
      <div className="tx-actions-grid">
        <article className="etf-card tx-action-card"><p className="etf-eyebrow">01 · Pool creation</p><h3>Initialize pool</h3><p>Creates the manifest-derived pool, state, share mint, and custody accounts. Post-state must prove zero supply and reserves.</p>{button("Initialize from accepted manifest", !acceptedContext ? page.manifestError ?? "Accepted manifest and deployed program are not verified." : !noPool ? "Pool is already present or partially initialized." : null, () => { if (!context || !wallet.publicKey) return; const operation = buildInitializePoolInstruction(context, wallet.publicKey); const evidence = buildEvidence("initialize"); void execute(makeOperationId("initialize"), operation, evidence, [], { noTokenBalanceAction: "initialize" }); }, true)}</article>
        <article className="etf-card tx-action-card"><p className="etf-eyebrow">02 · ATA-only wallet setup</p><h3>Create associated token accounts</h3><p>This setup transaction creates only missing ATAs; it does not initialize, seed, deposit into, or otherwise change the ETF pool. Exact rent and network fee are reconciled separately from RPC after confirmation.</p><p className="tx-inline-note">Current RPC rent minimum: {exact(ataRentLamports)} lamports per classic token account · {missingAtas.length} missing · estimated rent {ataRentLamports === null ? "unavailable" : `${(BigInt(ataRentLamports) * BigInt(missingAtas.length)).toString()} lamports`}.</p>{button("Create missing ATAs", !basePoolReady ? noSnapshotReason ?? "A wallet-specific verified pool snapshot is required." : !missingAtas.length ? "All required associated token accounts already exist." : null, () => {
          if (!context || !snapshot || !wallet.publicKey || !missingAtas.length) return;
          const instructions = missingAtas.map((item) => buildCreateEtfTokenAccountInstruction(context, wallet.publicKey!, wallet.publicKey!, new PublicKey(item.mint)));
          const operationId = makeOperationId("prepare_accounts");
          const expectedNewAccounts = missingAtas.map((item) => ({ address: item.address.toBase58(), mint: item.mint, share: item.share, decimals: item.share ? 6 : context.config.assets.find((asset) => asset.mint.toBase58() === item.mint)!.decimals }));
          const evidence = buildEvidence("prepare_accounts", { expectedNewAccounts });
          const ataPreparationPlan = deriveWalletAtaPreparationPlan(context, wallet.publicKey, missingAtas.map((item) => new PublicKey(item.mint)));
          void execute(operationId, { instructions, action: "prepare_accounts" }, evidence, [], { noTokenBalanceAction: "prepare_accounts", noTokenProgramId: ASSOCIATED_TOKEN_PROGRAM_ID, ataPreparationPlan });
        })}</article>
        <article className="etf-card tx-action-card"><p className="etf-eyebrow">03 · Delayed governance</p><h3>Resume risk after delay</h3><p>Initialization starts paused. Governance proposes; the on-chain 24-hour delay must elapse before any executor can resume risk.</p><div className="tx-form"><label>Proposal nonce<input inputMode="numeric" value={proposalNonce || snapshot?.state.pendingResume?.nonce || ""} onChange={(event) => setProposalNonce(event.target.value)} /></label></div>{button("Propose resume", !basePoolReady || !snapshot ? noSnapshotReason : !snapshot.state.riskPaused ? "Pool is not paused." : snapshot.state.pendingResume ? "A resume proposal is already pending." : walletAddress !== snapshot.state.currentGovernance ? `Connect governance wallet ${snapshot.state.currentGovernance}.` : null, () => { if (!context || !snapshot || !wallet.publicKey) return; const operation = buildProposeResumeInstruction(context, snapshot, wallet.publicKey, BigInt(snapshot.state.sequence)); void execute(makeOperationId("resume_propose"), operation, buildEvidence("resume_propose", { expectedSequence: String(BigInt(snapshot.state.sequence) + 1n) }), [], { noTokenBalanceAction: "resume_propose" }); })}{button("Execute delayed resume", !basePoolReady || !snapshot ? noSnapshotReason : !snapshot.state.pendingResume ? "No resume proposal exists." : snapshot.network.blockTime === null || BigInt(snapshot.network.blockTime) < BigInt(snapshot.state.pendingResume.executeAfter) ? `Delay ends at ${snapshot.state.pendingResume.executeAfter}; current RPC block time is ${exact(snapshot.network.blockTime)}.` : null, () => { if (!context || !snapshot || !wallet.publicKey || !snapshot.state.pendingResume) return; const operation = buildResumeRiskAfterDelayInstruction(context, snapshot, wallet.publicKey, BigInt(proposalNonce || snapshot.state.pendingResume.nonce), BigInt(snapshot.state.sequence)); void execute(makeOperationId("resume_execute"), operation, buildEvidence("resume_execute", { expectedSequence: String(BigInt(snapshot.state.sequence) + 1n) }), [], { noTokenBalanceAction: "resume_execute" }); })}{button("Cancel resume proposal", !basePoolReady || !snapshot ? noSnapshotReason : !snapshot.state.pendingResume ? "No resume proposal exists." : walletAddress !== snapshot.state.currentGovernance ? `Connect governance wallet ${snapshot.state.currentGovernance}.` : null, () => { if (!context || !snapshot || !wallet.publicKey || !snapshot.state.pendingResume) return; const operation = buildCancelResumeProposalInstruction(context, snapshot, wallet.publicKey, BigInt(proposalNonce || snapshot.state.pendingResume.nonce), BigInt(snapshot.state.sequence)); void execute(makeOperationId("resume_cancel"), operation, buildEvidence("resume_cancel", { expectedSequence: String(BigInt(snapshot.state.sequence) + 1n) }), [], { noTokenBalanceAction: "resume_cancel" }); })}</article>
        <article className="etf-card tx-action-card"><p className="etf-eyebrow">04 · Initial liquidity</p><h3>Seed pool</h3><p>Enter exact wallet-funded token base units. S5B integer NAV valuation determines shares; oracle and risk gates stay active.</p><AmountInputs context={context} amounts={amounts} setAmounts={setAmounts} />{seedPreview.quote ? <div className="tx-quote"><strong>Exact S5B initial quote · {seedPreview.quote.sharesOut} shares</strong><span>Portfolio NAV · 1e-12 USD units: {seedPreview.quote.navQ}</span>{seedPreview.quote.inputs.slice(0, context?.config.assets.length ?? 0).map((amount, index) => <span key={context!.config.assets[index]!.mint.toBase58()}>{snapshot?.assets[index]?.label}: seed {amount} base units</span>)}</div> : <p className="tx-inline-note">Initial quote unavailable: {seedPreview.error}</p>}{button("Seed at exact integer quote", !basePoolReady || !snapshot ? noSnapshotReason : !feedSafe ? "At least one feed is not Full and within accepted freshness/confidence limits." : snapshot.state.lifecycle !== "unseeded" ? "Pool is not unseeded." : snapshot.state.riskPaused ? "Pool risk is paused; use delayed governance resume first." : !shareAccount || !existingWallets ? "Create and refresh all required token and share accounts." : !seedPreview.quote ? seedPreview.error : null, () => {
          try { if (!context || !snapshot || !wallet.publicKey || !shareAccount || !existingWallets) return; const quote = seedQuote(context, snapshot, amounts); const deltas: Array<{ address: string; delta: string }> = []; snapshot.assets.forEach((asset, index) => { deltas.push({ address: asset.custody, delta: quote.inputs[index]!.toString() }); deltas.push({ address: existingWallets[index]!.tokenAccount, delta: (-quote.inputs[index]!).toString() }); }); deltas.push({ address: shareAccount.address, delta: quote.sharesOut.toString() }); const evidence = buildEvidence("seed", { expectedBalanceDeltas: deltas, expectedSupplyDelta: quote.sharesOut.toString(), expectedFeeDeltas: context.config.assets.map(() => "0"), expectedLifecycle: "active", expectedPaused: false, sharesOut: quote.sharesOut.toString() }); const operation = buildSeedPoolInstruction(context, snapshot, wallet.publicKey, quote.inputs, quote.sharesOut, new PublicKey(shareAccount.address), existingWallets); void execute(makeOperationId("seed"), operation, evidence, snapshotTrackedAccounts(snapshot, existingWallets, shareAccount.address)); } catch (error) { setNotice(error instanceof Error ? error.message : "seed_quote_failed"); }
        }, true)}</article>
        <article className="etf-card tx-action-card"><p className="etf-eyebrow">05 · Proportional entry</p><h3>Deposit with refund</h3><p>Supply maximum amounts in base units. The exact S5B share formula selects consumed amounts, share output, and per-asset refunds.</p><AmountInputs context={context} amounts={amounts} setAmounts={setAmounts} />{snapshot && context ? <QuoteReadout amounts={amounts} snapshot={snapshot} /> : null}{button("Deposit at exact integer quote", !basePoolReady || !snapshot ? noSnapshotReason : snapshot.state.riskPaused || snapshot.state.lifecycle !== "active" ? "Pool is not active with risk enabled." : !shareAccount || !existingWallets ? "Create and refresh all required token and share accounts." : null, () => {
          try { if (!context || !snapshot || !wallet.publicKey || !shareAccount || !existingWallets) return; const input = amounts.slice(0, context.config.assets.length).map(u64); const quote = quoteProportionalDeposit(input, snapshot.assets.map((asset) => BigInt(asset.custodyAmount)), BigInt(snapshot.shares.supply)); const consumed = quote.consumed.slice(0, context.config.assets.length); const delta: Array<{ address: string; delta: string }> = []; snapshot.assets.forEach((asset, index) => delta.push({ address: asset.custody, delta: consumed[index]!.toString() })); existingWallets.forEach((row, index) => delta.push({ address: row.tokenAccount, delta: (-consumed[index]!).toString() })); delta.push({ address: shareAccount.address, delta: quote.sharesOut.toString() }); const evidence = buildEvidence("deposit", { expectedBalanceDeltas: delta, expectedSupplyDelta: quote.sharesOut.toString(), expectedFeeDeltas: context.config.assets.map(() => "0"), expectedLifecycle: "active", expectedPaused: false, sharesOut: quote.sharesOut.toString() }); const operation = buildProportionalDepositInstruction(context, snapshot, wallet.publicKey, input, quote.sharesOut, new PublicKey(shareAccount.address), existingWallets); void execute(makeOperationId("deposit"), operation, evidence, snapshotTrackedAccounts(snapshot, existingWallets, shareAccount.address)); } catch (error) { setNotice(error instanceof Error ? error.message : "deposit_quote_failed"); }
        }, true)}</article>
        <article className="etf-card tx-action-card"><p className="etf-eyebrow">06 · In-kind exit</p><h3>Redeem shares</h3><p>Withdraw the same proportion of every custody asset. Redemption remains available while risk-increasing actions are paused.</p><div className="tx-form"><label>Shares to burn · base units<input inputMode="numeric" value={shares} onChange={(event) => setShares(event.target.value)} /></label></div>{snapshot ? <RedeemReadout shares={shares} snapshot={snapshot} /> : null}{button("Redeem in kind", !basePoolReady || !snapshot ? noSnapshotReason : snapshot.state.lifecycle !== "active" ? "Pool is not active." : !shareAccount || !existingWallets ? "Create and refresh all required token and share accounts." : null, () => {
          try { if (!context || !snapshot || !wallet.publicKey || !shareAccount || !existingWallets) return; const burn = u64(shares); const quote = quoteProportionalRedeem(burn, BigInt(snapshot.shares.supply), snapshot.assets.map((asset) => BigInt(asset.custodyAmount))); const outs = quote.amountsOut.slice(0, context.config.assets.length); const delta: Array<{ address: string; delta: string }> = []; snapshot.assets.forEach((asset, index) => delta.push({ address: asset.custody, delta: (-outs[index]!).toString() })); existingWallets.forEach((row, index) => delta.push({ address: row.tokenAccount, delta: outs[index]!.toString() })); delta.push({ address: shareAccount.address, delta: (-burn).toString() }); const lifecycle = burn === BigInt(snapshot.shares.supply) ? "closed" : "active"; const evidence = buildEvidence("redeem", { expectedBalanceDeltas: delta, expectedSupplyDelta: (-burn).toString(), expectedFeeDeltas: context.config.assets.map(() => "0"), expectedLifecycle: lifecycle, expectedPaused: snapshot.state.riskPaused, redeemShares: burn.toString(), amountsOut: outs.map(String) }); const operation = buildInKindRedeemInstruction(context, snapshot, wallet.publicKey, burn, outs, new PublicKey(shareAccount.address), existingWallets); void execute(makeOperationId("redeem"), operation, evidence, snapshotTrackedAccounts(snapshot, existingWallets, shareAccount.address)); } catch (error) { setNotice(error instanceof Error ? error.message : "redemption_quote_failed"); }
        })}</article>
        <article className="etf-card tx-action-card"><p className="etf-eyebrow">07 · Emergency control</p><h3>Pause risk</h3><p>Guardian-signed pause does not transfer pool assets. The receipt still requires exact state sequence and pool readback.</p>{button("Pause risk actions", !basePoolReady || !snapshot ? noSnapshotReason : walletAddress !== snapshot.state.currentGuardian ? `Connect guardian wallet ${snapshot.state.currentGuardian}.` : snapshot.state.riskPaused ? "Risk is already paused." : null, () => { if (!context || !snapshot || !wallet.publicKey) return; const operation = buildPauseRiskInstruction(context, snapshot, wallet.publicKey); void execute(makeOperationId("pause"), operation, buildEvidence("pause"), [], { noTokenBalanceAction: "pause" }); })}</article>
        <article className="etf-card tx-action-card"><p className="etf-eyebrow">08 · Eligibility only</p><h3>Manual poke</h3><p>Poke records eligibility only. It never transfers pool assets or creates a swap counterparty. A separately funded trader must submit every swap input.</p>{button("Poke eligibility", !basePoolReady || !snapshot ? noSnapshotReason : !feedSafe ? "All configured feeds must pass Full verification and accepted limits." : snapshot.state.lifecycle === "closed" ? "Pool is closed." : null, () => { if (!context || !snapshot || !wallet.publicKey) return; const operation = buildEligibilityPokeInstruction(context, snapshot, wallet.publicKey); void execute(makeOperationId("poke"), operation, buildEvidence("poke"), [], { noTokenBalanceAction: "poke" }); })}</article>
      </div>
    </section>
    <section className="etf-section">
      <div className="etf-section-head"><div><p className="etf-eyebrow">Independent trader input</p><h2>Weighted AMM swap</h2></div><span className={tone(feedSafe ? "warn" : "bad")}>No automatic counterparty</span></div>
      <article className="etf-card tx-action-card"><p>Swap input comes from the connected trader’s own verified token account. The pool does not rebalance itself, and a poke or scheduler cannot provide the opposite token.</p><div className="tx-form tx-form-grid"><label>Input asset<select value={swapIn} onChange={(event) => setSwapIn(Number(event.target.value))}>{(context?.config.assets ?? []).map((asset, index) => <option key={asset.mint.toBase58()} value={index}>{snapshot?.assets[index]?.label ?? asset.mint.toBase58()}</option>)}</select></label><label>Output asset<select value={swapOut} onChange={(event) => setSwapOut(Number(event.target.value))}>{(context?.config.assets ?? []).map((asset, index) => <option key={asset.mint.toBase58()} value={index}>{snapshot?.assets[index]?.label ?? asset.mint.toBase58()}</option>)}</select></label><label>Trader input · base units<input inputMode="numeric" value={swapAmount} onChange={(event) => setSwapAmount(event.target.value)} /></label><label>Minimum output · base units<output>{swapPreview.quote?.minAmountOut.toString() ?? "Unavailable"}</output></label><label>Slippage tolerance · bps<input inputMode="numeric" value={slippageBps} onChange={(event) => setSlippageBps(event.target.value)} /></label></div>{swapPreview.quote ? <div className="tx-quote"><strong>Exact S5B weighted quote</strong><span>Gross input: {swapPreview.quote.quote.amountIn} base units</span><span>Input after curve fee: {swapPreview.quote.quote.amountInAfterFee} base units</span><span>Fee retained in pool: {swapPreview.quote.quote.feeAmount} base units · {swapPreview.quote.feeBps} bps</span><span>Expected output: {swapPreview.quote.quote.amountOut} · minimum output: {swapPreview.quote.minAmountOut} base units</span><span>Oracle-marked deviation improves strictly: {swapPreview.quote.directionImproves ? "Yes" : "No"}</span></div> : <p className="tx-inline-note">Quote unavailable: {swapPreview.error}</p>}{button("Swap from trader wallet", !basePoolReady || !snapshot ? noSnapshotReason : !feedSafe ? "All configured feeds must pass Full verification and accepted limits." : snapshot.state.lifecycle !== "active" || snapshot.state.riskPaused ? "Swap is only available for an active, unpaused pool." : !existingWallets ? "Create and refresh all trader token accounts." : !swapPreview.quote ? swapPreview.error : !swapPreview.quote.directionImproves ? "This trade does not strictly improve the exact S5B target deviation." : null, () => {
        try { if (!context || !snapshot || !wallet.publicKey || !existingWallets || !swapPreview.quote) return; const amountIn = u64(swapAmount); const quote = swapPreview.quote; const deltas: Array<{ address: string; delta: string }> = []; snapshot.assets.forEach((asset, index) => { deltas.push({ address: asset.custody, delta: index === swapIn ? amountIn.toString() : index === swapOut ? (-quote.quote.amountOut).toString() : "0" }); deltas.push({ address: existingWallets[index]!.tokenAccount, delta: index === swapIn ? (-amountIn).toString() : index === swapOut ? quote.quote.amountOut.toString() : "0" }); }); if (shareAccount) deltas.push({ address: shareAccount.address, delta: "0" }); const feeDeltas = context.config.assets.map((_, index) => index === swapIn ? quote.quote.feeAmount.toString() : "0"); const evidence = buildEvidence("swap", { expectedBalanceDeltas: deltas, expectedSupplyDelta: "0", expectedFeeDeltas: feeDeltas, expectedLifecycle: "active", expectedPaused: false, swap: { assetIn: swapIn, assetOut: swapOut, amountIn: amountIn.toString(), amountOut: quote.quote.amountOut.toString(), feeAmount: quote.quote.feeAmount.toString() } }); const operation = buildTraderFundedSwapInstruction(context, snapshot, wallet.publicKey, swapIn, swapOut, amountIn, quote.minAmountOut, existingWallets); void execute(makeOperationId("swap"), operation, evidence, snapshotTrackedAccounts(snapshot, existingWallets, shareAccount?.address ?? context.addresses.shareMint.toBase58())); } catch (error) { setNotice(error instanceof Error ? error.message : "swap_quote_failed"); }
      }, true)}</article>
    </section>
    <section className="etf-section">
      <div className="etf-section-head"><div><p className="etf-eyebrow">RPC receipt journal</p><h2>Signatures & reconciliation</h2></div><span className={tone(unresolvedEntries.length ? "bad" : "good")}>{unresolvedEntries.length ? `${unresolvedEntries.length} unresolved — signing blocked` : "No unresolved signatures"}</span></div>
      {page.journalError ? <div className="etf-notice etf-notice-error">Durable browser journal unavailable: {page.journalError}. Signing is disabled.</div> : null}
      {!page.entries.length ? <article className="etf-card etf-empty">No wallet operations have been recorded for this exact Devnet, pool and wallet.</article> : <div className="etf-card-grid">{page.entries.flatMap((entry) => entry.attempts.map((attempt) => <article className="etf-card tx-receipt-card" key={`${entry.operationId}:${attempt.signature}`}><p className="etf-eyebrow">{entry.operationId.split(":").at(-2)} · {attempt.state}</p><h3>RPC transaction receipt</h3><dl className="etf-fields"><div><dt>Signature</dt><dd><a className="etf-value" href={`https://explorer.solana.com/tx/${attempt.signature}?cluster=devnet`} target="_blank" rel="noreferrer">{attempt.signature} ↗</a></dd></div><div><dt>Confirmation / slot</dt><dd><code className="etf-value">{exact(attempt.receipt?.confirmationStatus)} / {exact(attempt.receipt?.confirmationSlot)}</code></dd></div><div><dt>RPC network fee</dt><dd><code className="etf-value">{exact(attempt.receipt?.networkFeeLamports)} lamports · separate from ATA rent and protocol swap fee</code></dd></div>{entry.evidence?.action === "prepare_accounts" ? <div><dt>ATA rent · exact readback</dt><dd><code className="etf-value">{entry.evidence.expectedNewAccounts?.map((account) => { const lamports = attempt.receipt?.accountLamportDeltas?.find((row) => row.account === account.address); return `${account.address}: ${lamports?.postLamports ?? "unresolved"} lamports`; }).join(" · ") ?? "Unresolved"}</code></dd></div> : null}<div><dt>Lamport account changes</dt><dd><code className="etf-value">{attempt.receipt?.accountLamportDeltas?.map((row) => `${row.account}: ${row.deltaLamports}`).join(" · ") ?? "Incomplete RPC lamport metadata"}</code></dd></div><div><dt>Readback</dt><dd><code className="etf-value">{attempt.postStateVerified === true ? "Verified" : "Unresolved"}</code></dd></div><div><dt>Token/share deltas</dt><dd><code className="etf-value">{attempt.receipt?.tokenDeltas?.map((row) => `${row.account}: ${row.delta} ${row.mint}`).join(" · ") ?? "Incomplete RPC token metadata"}</code></dd></div><div><dt>Swap fee counter</dt><dd><code className="etf-value">Shown from fresh pool snapshot after full reconciliation; never combined with network fee.</code></dd></div></dl>{attempt.state === "unknown" ? <button type="button" className="etf-refresh" disabled={busy || !context} onClick={() => void reconcile(entry.operationId)}>Reconcile signature before any retry</button> : null}</article>))}</div>}
    </section>
    <footer className="etf-footer"><span>LIVE SOLANA DEVNET · RPC CONFIRMATION REQUIRED</span><span>Manual poke is eligibility-only · swap requires a distinct funded trader · no success from submission alone</span></footer>
  </main>;
}

function AmountInputs({ context, amounts, setAmounts }: { context: VerifiedEtfManifest | null; amounts: string[]; setAmounts: (value: string[]) => void }) {
  const assets = context?.config.assets ?? [];
  return <div className="tx-form">{assets.map((asset, index) => <label key={asset.mint.toBase58()}>{asset.targetWeightBps / 100}% {"· "}{asset.mint.toBase58()}{context?.manifest.assetLabels[index]?.backing === "synthetic_unbacked" ? " · synthetic / unbacked" : ""}<input inputMode="numeric" value={amounts[index] ?? "0"} onChange={(event) => { const next = [...amounts]; next[index] = event.target.value; setAmounts(next); }} /></label>)}</div>;
}

function QuoteReadout({ amounts, snapshot }: { amounts: readonly string[]; snapshot: EtfPoolSnapshot }) {
  try {
    const quote = quoteProportionalDeposit(amounts.slice(0, snapshot.assets.length).map(u64), snapshot.assets.map((asset) => BigInt(asset.custodyAmount)), BigInt(snapshot.shares.supply));
    return <div className="tx-quote"><strong>Exact S5B quote · {quote.sharesOut} shares</strong>{quote.consumed.slice(0, snapshot.assets.length).map((amount, index) => <span key={snapshot.assets[index]!.mint}>{snapshot.assets[index]!.label}: consume {amount} base units · refund {quote.refund[index]} base units</span>)}</div>;
  } catch (error) { return <p className="tx-inline-note">Quote unavailable: {error instanceof Error ? error.message : "invalid amounts or pool state"}</p>; }
}

function RedeemReadout({ shares, snapshot }: { shares: string; snapshot: EtfPoolSnapshot }) {
  try {
    const quote = quoteProportionalRedeem(u64(shares), BigInt(snapshot.shares.supply), snapshot.assets.map((asset) => BigInt(asset.custodyAmount)));
    return <div className="tx-quote"><strong>Exact S5B in-kind quote</strong>{quote.amountsOut.slice(0, snapshot.assets.length).map((amount, index) => <span key={snapshot.assets[index]!.mint}>{snapshot.assets[index]!.label}: {amount} base units</span>)}</div>;
  } catch (error) { return <p className="tx-inline-note">Quote unavailable: {error instanceof Error ? error.message : "invalid shares or pool state"}</p>; }
}
