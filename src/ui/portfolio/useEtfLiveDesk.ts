// The desk's live hook: the vault registry (every accepted pool), a fresh
// snapshot per pool per refresh, and one journaled, wallet-signed, RPC-
// reconciled poke per tap. It adds no policy of its own: the etf-client gates
// (accepted manifests, pinned genesis, verified snapshots, the shared
// no-token-balance journal) decide everything, and every failure keeps the
// panel honest instead of optimistic.
import { useCallback, useEffect, useRef, useState } from "react";
import { Transaction } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  buildEligibilityPokeInstruction,
  buildTraderFundedSwapInstruction,
  readEtfSnapshot,
  submitWalletTransaction,
  type EtfPoolSnapshot,
  type VerifiedEtfManifest,
  type WalletSubmissionResult,
} from "../../../packages/etf-client/src/index.js";
import { IndexedDbSubmissionJournal } from "../etf/IndexedDbSubmissionJournal.js";
import { describeLiveEtfDesk, etfProgramVerbs, loadEtfVaultRegistry, planRebalanceSwap, type EtfLiveDeskState } from "./etfLiveDesk.js";

export interface EtfLivePoolView {
  readonly pool: string;
  readonly context: VerifiedEtfManifest;
  readonly snapshot: EtfPoolSnapshot | null;
  readonly snapshotError: string | null;
  readonly live: EtfLiveDeskState | null;
}

export type EtfLiveVerbs = Readonly<{ schedule: string | null; setTargets: string | null; close: string | null }>;

export interface EtfLiveDeskView {
  phase: "loading" | "awaiting_deployment" | "genesis_mismatch" | "unreachable" | "ready";
  reason: string | null;
  wallet: string | null;
  genesis: string | null;
  rejected: readonly { label: string; reason: string }[];
  verbs: EtfLiveVerbs | null;
  pools: readonly EtfLivePoolView[];
  busy: boolean;
  notice: string | null;
  refresh: () => Promise<void>;
  pokeNow: (pool: string) => Promise<void>;
  swapNow: (pool: string) => Promise<void>;
}

interface RegistryCache {
  genesis: string;
  contexts: readonly VerifiedEtfManifest[];
  rejected: readonly { label: string; reason: string }[];
  verbs: EtfLiveVerbs;
}

export function useEtfLiveDesk(): EtfLiveDeskView {
  const { connection } = useConnection();
  const wallet = useWallet();
  const walletAddress = wallet.publicKey?.toBase58() ?? null;
  const requestRef = useRef(0);
  const cacheRef = useRef<RegistryCache | null>(null);
  const poolsRef = useRef<readonly EtfLivePoolView[]>([]);
  const journalRef = useRef(new IndexedDbSubmissionJournal());
  const [view, setView] = useState<Omit<EtfLiveDeskView, "refresh" | "pokeNow" | "swapNow">>({
    phase: "loading", reason: null, wallet: null, genesis: null, rejected: [], verbs: null, pools: [], busy: false, notice: null,
  });

  const refresh = useCallback(async () => {
    const requestId = (requestRef.current += 1);
    let cache = cacheRef.current;
    if (cache === null) {
      const loaded = await loadEtfVaultRegistry(connection);
      if (requestId !== requestRef.current) return;
      if (loaded.status !== "ready") {
        setView((current) => ({ ...current, phase: loaded.status, reason: "reason" in loaded ? loaded.reason : loaded.actual === null ? "genesis_unreadable" : loaded.actual, rejected: [], verbs: null, pools: [], wallet: walletAddress, genesis: loaded.status === "genesis_mismatch" ? loaded.actual : null } as Omit<EtfLiveDeskView, "refresh" | "pokeNow" | "swapNow">));
        return;
      }
      cache = { genesis: loaded.genesis, contexts: loaded.contexts, rejected: loaded.rejected, verbs: etfProgramVerbs(loaded.instructionNames) };
      cacheRef.current = cache;
    }
    const results = await Promise.allSettled(cache.contexts.map((context) => readEtfSnapshot(connection, context, { walletAddress: walletAddress ?? undefined, commitment: "confirmed" })));
    if (requestId !== requestRef.current) return;
    const pools: EtfLivePoolView[] = cache.contexts.map((context, index) => {
      const result = results[index]!;
      if (result.status === "fulfilled") return { pool: context.addresses.pool.toBase58(), context, snapshot: result.value, snapshotError: null, live: describeLiveEtfDesk(result.value) };
      return { pool: context.addresses.pool.toBase58(), context, snapshot: null, snapshotError: result.reason instanceof Error ? result.reason.message : "snapshot_read_failed", live: null };
    });
    poolsRef.current = pools;
    setView({ phase: "ready", reason: null, wallet: walletAddress, genesis: cache.genesis, rejected: cache.rejected, verbs: cache.verbs, pools, busy: false, notice: null });
  }, [connection, walletAddress]);

  useEffect(() => {
    void refresh();
    return () => {
      requestRef.current += 1;
    };
  }, [refresh]);

  const pokeNow = useCallback(async (poolKey: string) => {
    const cache = cacheRef.current;
    const pool = poolsRef.current.find((entry) => entry.pool === poolKey);
    const baseline = pool?.snapshot ?? null;
    if (cache === null || pool === undefined || baseline === null || wallet.publicKey === null || wallet.signTransaction === undefined || pool.live === null || !pool.live.pokeReady || view.busy) return;
    const context = pool.context;
    const signerKey = wallet.publicKey;
    const signer = wallet.signTransaction;
    setView((current) => ({ ...current, busy: true, notice: null }));
    const scope = `${cache.genesis}:${poolKey}:${signerKey.toBase58()}`;
    const operationId = `${scope}:poke:${Date.now()}`;
    try {
      const result: WalletSubmissionResult = await journalRef.current.withSigningGate(`${scope}:`, async () => {
        const latest = await connection.getLatestBlockhash("confirmed");
        const operation = buildEligibilityPokeInstruction(context, baseline, signerKey);
        const transaction = new Transaction({ feePayer: signerKey, recentBlockhash: latest.blockhash }).add(operation.instruction);
        return submitWalletTransaction({
          connection,
          signer: { publicKey: signerKey, signTransaction: signer },
          transaction,
          journal: journalRef.current,
          operationId,
          trackedTokenAccounts: [],
          noTokenBalanceAction: "poke",
          noTokenProgramId: context.programId,
          requirePostStateReadback: true,
          postStateVerifier: async (submission) => {
            if (submission.state !== "confirmed") return false;
            try {
              const after = await readEtfSnapshot(connection, context, { walletAddress: walletAddress ?? undefined, commitment: "confirmed" });
              return after.state.sequence === (BigInt(baseline.state.sequence) + 1n).toString()
                && after.state.lastObservation !== null
                && after.state.lifecycle === baseline.state.lifecycle
                && after.state.riskPaused === baseline.state.riskPaused
                && after.shares.supply === baseline.shares.supply
                && after.assets.every((asset, index) => asset.custodyAmount === baseline.assets[index]!.custodyAmount && asset.cumulativeFeeBaseUnits === baseline.assets[index]!.cumulativeFeeBaseUnits);
            } catch {
              return false;
            }
          },
        });
      });
      setView((current) => ({
        ...current,
        notice: result.state === "confirmed" && result.postStateVerified === true
          ? `Poke confirmed and reconciled at slot ${result.receipt?.confirmationSlot ?? "unknown"}; the pool state now carries a fresh eligibility observation.`
          : result.state === "rejected" && result.retryAllowed
            ? "Poke was rejected on-chain; the journal records it and a retry is available on the transaction desk."
            : "Poke outcome unresolved; do not re-fire. Reconcile the recorded signature first (the transaction desk offers the reconciliation).",
      }));
    } catch (error) {
      setView((current) => ({ ...current, notice: error instanceof Error ? error.message : "poke_submission_failed" }));
    }
    await refresh();
  }, [connection, refresh, view.busy, wallet.publicKey, wallet.signTransaction]);

  const swapNow = useCallback(async (poolKey: string) => {
    const cache = cacheRef.current;
    const pool = poolsRef.current.find((entry) => entry.pool === poolKey);
    const baseline = pool?.snapshot ?? null;
    if (cache === null || pool === undefined || baseline === null || wallet.publicKey === null || wallet.signTransaction === undefined || view.busy) return;
    const { plan, reason } = planRebalanceSwap(pool.context, baseline);
    if (plan === null) {
      setView((current) => ({ ...current, notice: `No rebalance swap stands here right now: ${reason.replaceAll("_", " ")}.` }));
      return;
    }
    let traderWallets: { mint: string; tokenAccount: string }[];
    try {
      traderWallets = pool.context.config.assets.map((asset) => {
        const token = baseline.wallet?.tokenAccounts.find((row) => row.mint === asset.mint.toBase58() && !row.frozen);
        if (token === undefined) throw new Error(`Missing verified, unfrozen token account for ${asset.mint.toBase58()}. Create it, then refresh.`);
        return { mint: asset.mint.toBase58(), tokenAccount: token.address };
      });
    } catch (error) {
      setView((current) => ({ ...current, notice: error instanceof Error ? error.message : "wallet_token_accounts_unreadable" }));
      return;
    }
    const signerKey = wallet.publicKey;
    const signer = wallet.signTransaction;
    setView((current) => ({ ...current, busy: true, notice: null }));
    const scope = `${cache.genesis}:${poolKey}:${signerKey.toBase58()}`;
    const operationId = `${scope}:swap:${Date.now()}`;
    try {
      const result: WalletSubmissionResult = await journalRef.current.withSigningGate(`${scope}:`, async () => {
        const latest = await connection.getLatestBlockhash("confirmed");
        const operation = buildTraderFundedSwapInstruction(pool.context, baseline, signerKey, plan.assetIn, plan.assetOut, plan.amountIn, plan.minAmountOut, traderWallets);
        const transaction = new Transaction({ feePayer: signerKey, recentBlockhash: latest.blockhash }).add(operation.instruction);
        return submitWalletTransaction({
          connection,
          signer: { publicKey: signerKey, signTransaction: signer },
          transaction,
          journal: journalRef.current,
          operationId,
          trackedTokenAccounts: [],
          requirePostStateReadback: true,
          postStateVerifier: async (submission) => {
            if (submission.state !== "confirmed") return false;
            try {
              const after = await readEtfSnapshot(connection, pool.context, { walletAddress: walletAddress ?? undefined, commitment: "confirmed" });
              return after.state.sequence === (BigInt(baseline.state.sequence) + 1n).toString()
                && after.assets[plan.assetIn]!.custodyAmount === (BigInt(baseline.assets[plan.assetIn]!.custodyAmount) + plan.amountIn).toString()
                && BigInt(after.assets[plan.assetOut]!.custodyAmount) < BigInt(baseline.assets[plan.assetOut]!.custodyAmount)
                && after.shares.supply === baseline.shares.supply;
            } catch {
              return false;
            }
          },
        });
      });
      setView((current) => ({
        ...current,
        notice: result.state === "confirmed" && result.postStateVerified === true
          ? `Swap confirmed and reconciled at slot ${result.receipt?.confirmationSlot ?? "unknown"}; custody moved toward the target weights.`
          : result.state === "rejected" && result.retryAllowed
            ? "Swap was rejected on-chain; the journal records it and a retry is available on the transaction desk."
            : "Swap outcome unresolved; do not re-fire. Reconcile the recorded signature first (the transaction desk offers the reconciliation).",
      }));
    } catch (error) {
      setView((current) => ({ ...current, notice: error instanceof Error ? error.message : "swap_submission_failed" }));
    }
    await refresh();
  }, [connection, refresh, view.busy, wallet.publicKey, wallet.signTransaction]);

  return { ...view, refresh, pokeNow, swapNow };
}
