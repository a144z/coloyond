import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { Keypair } from '@solana/web3.js';
import { describeTxError, signSendConfirm, type TxResult } from './solana/tx';
import { fetchBalances, keypairFromMnemonic, decodeSecret, encodeSecret, requestAirdrop, buildWrapTx } from './solana/wallet';
import { fetchRpcStatus, type RpcStatus } from './solana/connection';
import { fetchPriceBook, type PriceBook } from './solana/price';
import { fetchReserveState, type ReserveState } from './solana/reserve-read';
import { buildFundTx, buildProvisionTx, buildWithdrawTx, buildCloseTx, fetchVaultBalances } from './solana/vault';
import { assetSpec, type AssetId } from './solana/assets';
import { REBALANCE_INTERVAL_SEC } from './solana/config';
import { initializeAndSchedulePortfolio, setPortfolioActive, updatePortfolioTargets } from './solana/execution';
import { reserveIsReady } from './solana/reserve-read';
import { fmtToken } from './format';

/* ---------------- types ---------------- */

export type ScreenId = 'onboarding' | 'wallet' | 'portfolios' | 'create' | 'vault' | 'system';
export type TabId = 'portfolios' | 'wallet' | 'system';

export interface Screen {
  id: ScreenId;
  vaultId?: string;
}

export type VaultStatus = 'active' | 'paused' | 'closed';
export type BlockedReason = 'price' | 'budget' | 'reserve' | null;

export interface VaultConfig {
  id: string;
  name: string;
  createdAt: number;
  secret: string;
  publicKey: string;
  /** The vault's asset set: token accounts provisioned at creation. */
  assets: AssetId[];
  /** Target weight per asset id, summing to 100 over the nonzero entries. */
  targets: Record<string, number>;
  thresholdPct: number;
  cadenceSec: number;
  status: VaultStatus;
  blockedReason: BlockedReason;
  lastCheckAt: number | null;
  nextCheckAt: number | null;
  lastTradeAt: number | null;
  lastTradeSig: string | null;
  lastTradeSlot: number | null;
  lastWeightEditAt: number | null;
  /** Cumulative raw deposits per asset id (record keeping). */
  deposited: Record<string, number>;
  tradeCount: number;
}

export type LogKind = 'system' | 'check' | 'trade' | 'blocked' | 'owner';

export interface LogEntry {
  id: string;
  at: number;
  vaultId: string | null;
  kind: LogKind;
  summary: string;
  detail?: string;
  sig?: string;
  slot?: number;
}

export interface ToastItem {
  id: string;
  kind: 'ok' | 'error' | 'info';
  title: string;
  body?: string;
}

export interface FlowStepRuntime {
  label: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  note?: string;
  sig?: string;
}

export interface FlowState {
  title: string;
  micro: string;
  steps: FlowStepRuntime[];
  finishedAt: number | null;
  error: string | null;
}

export interface CreateVaultInput {
  name: string;
  assets: AssetId[];
  targets: Record<string, number>;
  thresholdPct: number;
  cadenceSec: number;
  budgetLamports: number;
  /** Raw deposit per asset id. */
  deposits: Record<string, number>;
}

export interface FundVaultInput {
  budgetLamports: number;
  /** Raw deposit per asset id. */
  deposits: Record<string, number>;
}

/* ---------------- key caches (never persisted) ---------------- */

let cachedMnemonic = '';
let cachedWalletKp: Keypair | null = null;

export function walletKeypair(): Keypair | null {
  const mnemonic = useStore.getState().wallet?.mnemonic;
  if (!mnemonic) return null;
  if (mnemonic !== cachedMnemonic || !cachedWalletKp) {
    cachedWalletKp = keypairFromMnemonic(mnemonic);
    cachedMnemonic = mnemonic;
  }
  return cachedWalletKp;
}

const vaultKpCache = new Map<string, Keypair>();

export function vaultKeypairOf(cfg: VaultConfig): Keypair {
  let kp = vaultKpCache.get(cfg.id);
  if (!kp) {
    kp = decodeSecret(cfg.secret);
    vaultKpCache.set(cfg.id, kp);
  }
  return kp;
}

function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function amountList(raws: Record<string, number>): string {
  return Object.entries(raws)
    .filter(([, raw]) => raw > 0)
    .map(([id, raw]) => `+${fmtToken(raw, assetSpec(id as AssetId).decimals, 6)} ${assetSpec(id as AssetId).symbol}`)
    .join(' · ');
}

/* ---------------- store ---------------- */

interface ColoyondState {
  // persisted
  wallet: { mnemonic: string; publicKey: string; createdAt: number } | null;
  vaults: VaultConfig[];
  logs: LogEntry[];

  // runtime
  activeTab: TabId;
  stack: Screen[];
  walletBalances: Awaited<ReturnType<typeof fetchBalances>> | null;
  vaultBalances: Record<string, Awaited<ReturnType<typeof fetchBalances>>>;
  price: PriceBook | null;
  priceError: string | null;
  reserve: ReserveState | null;
  rpc: RpcStatus | null;
  toasts: ToastItem[];
  flow: FlowState | null;

  // navigation
  setTab: (tab: TabId) => void;
  pushScreen: (screen: Screen) => void;
  popScreen: () => void;

  // logging + toasts
  log: (entry: Omit<LogEntry, 'id' | 'at'> & { at?: number }) => void;
  toast: (kind: ToastItem['kind'], title: string, body?: string) => void;
  dismissToast: (id: string) => void;

  // wallet lifecycle
  createWallet: (mnemonic: string) => void;
  resetApp: () => void;

  // refreshers
  refreshPrice: () => Promise<void>;
  refreshReserve: () => Promise<void>;
  refreshBalances: () => Promise<void>;
  refreshRpc: () => Promise<void>;
  refreshVaultBalances: (vaultId: string) => Promise<void>;

  // flows
  runFlow: (
    title: string,
    micro: string,
    steps: { label: string; run: () => Promise<{ note?: string; sig?: string }> }[],
  ) => Promise<boolean>;
  dismissFlow: () => void;

  // actions
  airdrop: () => Promise<void>;
  wrap: (lamports: number) => Promise<void>;
  createVault: (input: CreateVaultInput) => Promise<string | null>;
  fundVault: (vaultId: string, input: FundVaultInput) => Promise<void>;
  withdrawVault: (vaultId: string, fraction: number) => Promise<void>;
  closeVault: (vaultId: string) => Promise<void>;
  pauseVault: (vaultId: string) => void;
  resumeVault: (vaultId: string) => void;
  editWeights: (vaultId: string, targets: Record<string, number>) => Promise<void>;
  patchVault: (vaultId: string, patch: Partial<VaultConfig>) => void;
}

export const useStore = create<ColoyondState>()(
  persist(
    (set, get) => ({
      wallet: null,
      vaults: [],
      logs: [],

      activeTab: 'portfolios',
      stack: [{ id: 'onboarding' }],
      walletBalances: null,
      vaultBalances: {},
      price: null,
      priceError: null,
      reserve: null,
      rpc: null,
      toasts: [],
      flow: null,

      setTab: (tab) => set({ activeTab: tab, stack: [{ id: tab }] }),
      pushScreen: (screen) => set((st) => ({ stack: [...st.stack, screen] })),
      popScreen: () => set((st) => (st.stack.length > 1 ? { stack: st.stack.slice(0, -1) } : {})),

      log: (entry) =>
        set((st) => ({
          logs: [{ id: uid(), at: entry.at ?? Date.now(), ...entry }, ...st.logs].slice(0, 150),
        })),

      toast: (kind, title, body) => {
        const item: ToastItem = { id: uid(), kind, title, body };
        set((st) => ({ toasts: [...st.toasts, item] }));
        setTimeout(() => get().dismissToast(item.id), kind === 'error' ? 7000 : 4500);
      },
      dismissToast: (id) => set((st) => ({ toasts: st.toasts.filter((t) => t.id !== id) })),

      createWallet: (mnemonic) => {
        const kp = keypairFromMnemonic(mnemonic);
        cachedMnemonic = mnemonic;
        cachedWalletKp = kp;
        set({ wallet: { mnemonic, publicKey: kp.publicKey.toBase58(), createdAt: Date.now() } });
        get().log({ vaultId: null, kind: 'owner', summary: 'Wallet created on this device' });
        get().setTab('portfolios');
      },

      resetApp: () => {
        set({ wallet: null, vaults: [], logs: [], vaultBalances: {}, walletBalances: null, stack: [{ id: 'onboarding' }] });
        useStore.persist.clearStorage();
      },

      refreshPrice: async () => {
        try {
          const price = await fetchPriceBook();
          set({ price, priceError: null });
        } catch (err) {
          set({ priceError: err instanceof Error ? err.message : 'price feed failed' });
        }
      },

      refreshReserve: async () => {
        try {
          const reserve = await fetchReserveState();
          set({ reserve });
        } catch {
          // keep last known state; reserve module errors surface at swap time
        }
      },

      refreshBalances: async () => {
        const kp = walletKeypair();
        if (!kp) return;
        try {
          const walletBalances = await fetchBalances(kp.publicKey);
          set({ walletBalances });
        } catch {
          // devnet hiccup; keep last known
        }
      },

      refreshRpc: async () => {
        try {
          const rpc = await fetchRpcStatus();
          set({ rpc });
        } catch {
          // offline; badge will show degraded state
        }
      },

      refreshVaultBalances: async (vaultId) => {
        const cfg = get().vaults.find((v) => v.id === vaultId);
        if (!cfg) return;
        // closed vaults are still readable (zeroed accounts) so the close
        // sequence and rent recovery can verify their state on demand
        try {
          const bal = await fetchVaultBalances(vaultKeypairOf(cfg));
          set((st) => ({ vaultBalances: { ...st.vaultBalances, [vaultId]: bal } }));
        } catch {
          // keep last known
        }
      },

      runFlow: async (title, micro, steps) => {
        set({
          flow: {
            title,
            micro,
            steps: steps.map((s) => ({ label: s.label, status: 'pending' as const })),
            finishedAt: null,
            error: null,
          },
        });
        for (let i = 0; i < steps.length; i += 1) {
          set((st) => ({
            flow: st.flow
              ? { ...st.flow, steps: st.flow.steps.map((s, j) => (j === i ? { ...s, status: 'running' } : s)) }
              : st.flow,
          }));
          try {
            const res = await steps[i].run();
            set((st) => ({
              flow: st.flow
                ? {
                    ...st.flow,
                    steps: st.flow.steps.map((s, j) =>
                      j === i ? { ...s, status: 'done' as const, note: res?.note, sig: res?.sig } : s,
                    ),
                  }
                : st.flow,
            }));
          } catch (err) {
            const msg = describeTxError(err);
            set((st) => ({
              flow: st.flow
                ? {
                    ...st.flow,
                    error: msg,
                    steps: st.flow.steps.map((s, j) => (j === i ? { ...s, status: 'failed' as const, note: msg } : s)),
                  }
                : st.flow,
            }));
            return false;
          }
        }
        set((st) => (st.flow ? { flow: { ...st.flow, finishedAt: Date.now() } } : {}));
        return true;
      },

      dismissFlow: () => set({ flow: null }),

      airdrop: async () => {
        const kp = walletKeypair();
        if (!kp) return;
        const ok = await get().runFlow('Devnet faucet', 'AIRDROP · 1 SOL', [
          {
            label: 'Request 1 SOL from the devnet faucet',
            run: async () => {
              const sig = await requestAirdrop(kp);
              return { sig, note: 'confirmed on devnet' };
            },
          },
        ]);
        if (ok) {
          get().toast('ok', 'Faucet delivered 1 SOL');
          get().refreshBalances();
        }
      },

      wrap: async (lamports) => {
        const kp = walletKeypair();
        if (!kp) return;
        const ok = await get().runFlow('Wrap SOL into WSOL', 'WRAP · DEVNET', [
          {
            label: 'Build the wrap transaction',
            run: async () => ({ note: `${(lamports / 1e9).toFixed(4)} SOL into the owner WSOL account` }),
          },
          {
            label: 'Sign and send to devnet',
            run: async () => {
              const tx = buildWrapTx(kp, lamports);
              const r = await signSendConfirm(tx, [kp]);
              return { sig: r.sig, note: `confirmed in slot ${r.slot}` };
            },
          },
        ]);
        if (ok) {
          get().log({
            vaultId: null,
            kind: 'owner',
            summary: `Wrapped ${(lamports / 1e9).toFixed(4)} SOL into WSOL`,
            detail: 'WSOL stays an SPL token — unwrap by swapping or withdrawing in kind',
          });
          get().refreshBalances();
        }
      },

      createVault: async (input) => {
        const wallet = walletKeypair();
        if (!wallet) return null;
        if (!(await reserveIsReady(input.assets))) {
          get().toast('error', 'Devnet execution reserve is not ready', 'Deploy the program and run `npm run bootstrap:execution-reserve` before creating a scheduled portfolio.');
          return null;
        }

        const vaultKp = Keypair.generate();
        const id = uid();
        const captured: { result: TxResult | null; provisioned: boolean } = { result: null, provisioned: false };
        const plan = {
          assets: input.assets,
          budgetLamports: input.budgetLamports,
          deposits: input.deposits,
        };

        const ok = await get().runFlow('Create portfolio', 'SETUP · DEVNET', [
          {
            label: 'Generate vault custody keypair',
            run: async () => ({ note: 'separate custody, budget and automation authority' }),
          },
          {
            label: 'Build the setup transaction',
            run: async () => {
              const tx = buildProvisionTx(wallet, vaultKp, plan);
              return { note: `${tx.instructions.length} instructions · one wallet signature` };
            },
          },
          {
            label: 'Sign and send to devnet',
            run: async () => {
              const tx = buildProvisionTx(wallet, vaultKp, plan);
              const r = await signSendConfirm(tx, [wallet]);
              captured.result = r;
              captured.provisioned = true;
              return { sig: r.sig, note: `confirmed in slot ${r.slot}` };
            },
          },
          {
            label: 'Delegate the portfolio and schedule its 60-second ER rebalance',
            run: async () => {
              const setup = await initializeAndSchedulePortfolio({
                owner: wallet,
                vault: vaultKp,
                assets: input.assets,
                targets: input.targets,
                thresholdPct: input.thresholdPct,
                taskId: Date.now(),
              });
              return { sig: setup.schedule.sig, note: `MagicBlock task scheduled · portfolio ${setup.delegate.sig.slice(0, 12)}…` };
            },
          },
        ]);

        if (!captured.provisioned || !captured.result) return null;
        const txResult = captured.result;

        const cfg: VaultConfig = {
          id,
          name: input.name,
          createdAt: Date.now(),
          secret: encodeSecret(vaultKp),
          publicKey: vaultKp.publicKey.toBase58(),
          assets: input.assets,
          targets: input.targets,
          thresholdPct: input.thresholdPct,
          cadenceSec: input.cadenceSec,
          status: ok ? 'active' : 'paused',
          blockedReason: null,
          lastCheckAt: null,
          nextCheckAt: ok ? Date.now() + REBALANCE_INTERVAL_SEC * 1000 : null,
          lastTradeAt: null,
          lastTradeSig: null,
          lastTradeSlot: null,
          lastWeightEditAt: null,
          deposited: input.deposits,
          tradeCount: 0,
        };

        set((st) => ({ vaults: [cfg, ...st.vaults] }));
        if (!ok) {
          get().log({
            vaultId: id,
            kind: 'blocked',
            summary: 'Vault funded; MagicBlock setup is incomplete',
            detail: 'The vault recovery key was saved locally. Finish the execution setup after checking the required devnet program and reserve setup.',
          });
        }
        get().log({
          vaultId: id,
          kind: 'owner',
          summary: `Vault created: ${input.name}`,
          detail: `target ${vaultTargetList(cfg)
            .map((t) => `${t.pct.toFixed(0)} ${assetSpec(t.assetId).symbol}`)
            .join(' · ')} · threshold ${input.thresholdPct.toFixed(1)}%`,
          sig: txResult.sig,
          slot: txResult.slot,
        });
        get().refreshBalances();
        get().refreshVaultBalances(id);
        return id;
      },

      fundVault: async (vaultId, input) => {
        const wallet = walletKeypair();
        const cfg = get().vaults.find((v) => v.id === vaultId);
        if (!wallet || !cfg) return;

        let sig: string | undefined;
        const ok = await get().runFlow('Add funds', 'FUND · DEVNET', [
          {
            label: 'Build the funding transaction',
            run: async () => ({ note: 'proportional to the entered amounts' }),
          },
          {
            label: 'Sign and send to devnet',
            run: async () => {
              const tx = buildFundTx(wallet, vaultKeypairOf(cfg), input);
              const r = await signSendConfirm(tx, [wallet]);
              sig = r.sig;
              return { sig: r.sig, note: `confirmed in slot ${r.slot}` };
            },
          },
        ]);
        if (ok) {
          const deposited = { ...cfg.deposited };
          for (const [id, raw] of Object.entries(input.deposits)) {
            deposited[id] = (deposited[id] ?? 0) + raw;
          }
          get().patchVault(vaultId, { deposited });
          get().log({
            vaultId,
            kind: 'owner',
            summary: 'Funds added',
            detail: amountList(input.deposits) || 'budget top-up only',
            sig,
          });
          get().refreshBalances();
          get().refreshVaultBalances(vaultId);
        }
      },

      withdrawVault: async (vaultId, fraction) => {
        const wallet = walletKeypair();
        const cfg = get().vaults.find((v) => v.id === vaultId);
        if (!wallet || !cfg) return;
        const bal = get().vaultBalances[vaultId];
        if (!bal) return;

        let sig: string | undefined;
        const holdingsNote = amountList(bal.tokens) || 'empty vault';
        const ok = await get().runFlow(
          fraction >= 0.999 ? 'Withdraw in kind' : 'Partial withdrawal',
          'EXIT · DEVNET',
          [
            {
              label: 'Read current holdings',
              run: async () => ({ note: holdingsNote }),
            },
            {
              label: 'Sign and send the vault transfer',
              run: async () => {
                const tx = buildWithdrawTx(wallet, vaultKeypairOf(cfg), bal, fraction);
                const r = await signSendConfirm(tx, [wallet, vaultKeypairOf(cfg)]);
                sig = r.sig;
                return { sig: r.sig, note: `confirmed in slot ${r.slot}` };
              },
            },
          ],
        );
        if (ok) {
          const full = fraction >= 0.999;
          get().log({
            vaultId,
            kind: 'owner',
            summary: full ? 'In-kind withdrawal: every base unit returned' : 'Partial in-kind withdrawal',
            detail: full ? 'automation continues on remaining funds' : `${Math.round(fraction * 100)}% of each token`,
            sig,
          });
          if (full) {
            get().patchVault(vaultId, { status: 'closed', blockedReason: null, nextCheckAt: null });
          }
          get().refreshBalances();
          get().refreshVaultBalances(vaultId);
        }
      },

      closeVault: async (vaultId) => {
        const wallet = walletKeypair();
        const cfg = get().vaults.find((v) => v.id === vaultId);
        if (!wallet || !cfg) return;
        const bal = get().vaultBalances[vaultId];
        if (!bal) return;

        let sig: string | undefined;
        const ok = await get().runFlow('Close vault', 'CLOSE · DEVNET', [
          {
            label: 'Return all tokens to the owner wallet',
            run: async () => ({ note: amountList(bal.tokens) || 'no tokens held' }),
          },
          {
            label: 'Stop automation and close accounts',
            run: async () => ({ note: `${cfg.assets.length} token accounts · rent recovered, then swept` }),
          },
          {
            label: 'Sign and send the close sequence',
            run: async () => {
              const tx = buildCloseTx(wallet, vaultKeypairOf(cfg), bal, cfg.assets);
              const r = await signSendConfirm(tx, [wallet, vaultKeypairOf(cfg)]);
              sig = r.sig;
              return { sig: r.sig, note: `confirmed in slot ${r.slot}` };
            },
          },
        ]);
        if (ok) {
          get().patchVault(vaultId, { status: 'closed', blockedReason: null, nextCheckAt: null });
          get().log({
            vaultId,
            kind: 'owner',
            summary: 'Vault closed: assets returned, automation stopped',
            sig,
          });
          get().refreshBalances();
          get().refreshReserve();
        }
      },

      pauseVault: async (vaultId) => {
        const cfg = get().vaults.find((v) => v.id === vaultId);
        if (!cfg) return;
        const wallet = walletKeypair();
        if (!wallet) return;
        try {
          const result = await setPortfolioActive(wallet, vaultKeypairOf(cfg).publicKey, false);
          get().patchVault(vaultId, { status: 'paused', blockedReason: null, nextCheckAt: null });
          get().log({ vaultId, kind: 'owner', summary: 'Automation paused by owner', sig: result.sig, slot: result.slot });
        } catch (err) {
          get().toast('error', 'Pause failed', err instanceof Error ? err.message : 'Unable to pause on MagicBlock.');
        }
      },

      resumeVault: async (vaultId) => {
        const cfg = get().vaults.find((v) => v.id === vaultId);
        if (!cfg) return;
        const wallet = walletKeypair();
        if (!wallet) return;
        try {
          const result = await setPortfolioActive(wallet, vaultKeypairOf(cfg).publicKey, true);
          get().patchVault(vaultId, { status: 'active', nextCheckAt: Date.now() + REBALANCE_INTERVAL_SEC * 1000 });
          get().log({ vaultId, kind: 'owner', summary: 'Automation resumed by owner', sig: result.sig, slot: result.slot });
        } catch (err) {
          get().toast('error', 'Resume failed', err instanceof Error ? err.message : 'Unable to resume on MagicBlock.');
        }
      },

      editWeights: async (vaultId, targets) => {
        const cfg = get().vaults.find((v) => v.id === vaultId);
        if (!cfg) return;
        if (cfg.lastWeightEditAt && Date.now() - cfg.lastWeightEditAt < 120_000) {
          get().toast('error', 'Edit cooldown active', 'Weight edits wait 120 seconds between changes.');
          return;
        }
        const wallet = walletKeypair();
        if (!wallet) return;
        try {
          await updatePortfolioTargets(wallet, vaultKeypairOf(cfg).publicKey, cfg.assets, targets);
        } catch (err) {
          get().toast('error', 'Weight update failed', err instanceof Error ? err.message : 'Unable to update targets on MagicBlock.');
          return;
        }
        get().patchVault(vaultId, { targets, lastWeightEditAt: Date.now(), nextCheckAt: Date.now() + REBALANCE_INTERVAL_SEC * 1000 });
        get().log({
          vaultId,
          kind: 'owner',
          summary: `Weights set to ${Object.entries(targets)
            .filter(([, pct]) => pct > 0)
            .map(([id, pct]) => `${pct.toFixed(0)} ${assetSpec(id as AssetId).symbol}`)
            .join(' · ')}`,
          detail: 'scheduler and budget kept; a 120 second cooldown applies',
        });
        get().toast('ok', 'Target weights updated', 'The next check trades toward the new target.');
      },

      patchVault: (vaultId, patch) =>
        set((st) => ({ vaults: st.vaults.map((v) => (v.id === vaultId ? { ...v, ...patch } : v)) })),
    }),
    {
      name: 'coloyond.v1',
      version: 3,
      storage: createJSONStorage(() => localStorage),
      partialize: (st) => ({ wallet: st.wallet, vaults: st.vaults, logs: st.logs }),
      migrate: (persisted, _version) => {
        const p = persisted as { vaults?: Record<string, unknown>[] } | undefined;
        if (p && Array.isArray(p.vaults)) {
          p.vaults = p.vaults.map((v) => {
            if (v && typeof v.targetWsolPct === 'number' && !v.targets) {
              const { targetWsolPct, depositedWsolLamports, depositedUsdRaw, ...rest } = v as {
                targetWsolPct: number;
                depositedWsolLamports?: number;
                depositedUsdRaw?: number;
              } & Record<string, unknown>;
              return {
                ...rest,
                assets: ['wsol', 'tusd'],
                targets: { wsol: targetWsolPct, tusd: 100 - targetWsolPct },
                deposited: { wsol: depositedWsolLamports ?? 0, tusd: depositedUsdRaw ?? 0 },
          cadenceSec: REBALANCE_INTERVAL_SEC,
              };
            }
            return { ...v, cadenceSec: REBALANCE_INTERVAL_SEC };
          });
        }
        return p as unknown as { wallet: ColoyondState['wallet']; vaults: VaultConfig[]; logs: LogEntry[] };
      },
    },
  ),
);

/* ---------------- derived helpers ---------------- */

export function currentScreen(st: Pick<ColoyondState, 'stack'>): Screen {
  return st.stack[st.stack.length - 1];
}

export function findVault(st: Pick<ColoyondState, 'vaults'>, id: string | undefined): VaultConfig | null {
  if (!id) return null;
  return st.vaults.find((v) => v.id === id) ?? null;
}

/** Nonzero targets in vault asset order — the label-facing target mix. */
export function vaultTargetList(cfg: VaultConfig): { assetId: AssetId; pct: number }[] {
  return cfg.assets
    .filter((id) => (cfg.targets[id] ?? 0) > 0)
    .map((id) => ({ assetId: id, pct: cfg.targets[id] ?? 0 }));
}
