import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { Keypair, PublicKey } from '@solana/web3.js';
import { describeTxError, signSendConfirm, type OwnerSigner, type TxResult, type WalletSigner } from './solana/tx.js';
import { fetchBalances, keypairFromMnemonic, buildWrapTx } from './solana/wallet.js';
import { fetchRpcStatus, type RpcStatus } from './solana/connection.js';
import { fetchPriceBook, type PriceBook } from './solana/price.js';
import { fetchReserveState, type ReserveState } from './solana/reserve-read.js';
import { fetchVaultBalances, type VaultBalances } from './solana/vault.js';
import { assetSpec, type AssetId } from './solana/assets.js';
import { fetchCoinbaseUniverse, type UniverseAsset } from './solana/coinbase.js';
import { REBALANCE_INTERVAL_SEC } from './solana/config.js';
import {
  cancelVaultSchedule,
  createVaultTokenAccounts,
  depositToVault,
  fetchRecentVaultSettlements,
  initializeVault,
  readVaultState,
  redeemFromVault,
  scheduleVault,
  setVaultActive,
  updateVaultTargets,
  deriveVaultAddresses,
  vaultAddressesForState,
  buildRedeemMinimums,
} from './solana/execution.js';
import { fmtToken } from './format.js';

/* ---------------- types ---------------- */

export type ScreenId = 'onboarding' | 'wallet' | 'portfolios' | 'create' | 'vault' | 'system';
export type TabId = 'portfolios' | 'wallet' | 'system';

export interface Screen {
  id: ScreenId;
  vaultId?: string;
}

export type VaultStatus = 'active' | 'paused' | 'closed' | 'legacy';
export type BlockedReason = 'price' | 'budget' | 'reserve' | null;

export interface VaultConfig {
  id: string;
  name: string;
  createdAt: number;
  /** On-chain Vault State PDA. */
  publicKey: string;
  shareMint?: string;
  legacy?: boolean;
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
  /** Raw deposit per asset id. */
  deposits: Record<string, number>;
}

/** Durable progress for a multi-transaction setup; keyed by wallet public key. */
export interface VaultSetupDraft {
  id: string;
  owner: string;
  input: CreateVaultInput;
  chainId: string;
  stateAddress: string;
  createdAt: number;
  completed: Partial<Record<'initialize' | 'accounts' | 'deposit' | 'schedule', TxResult>>;
}

export interface FundVaultInput {
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

/** Connected browser wallets take precedence; otherwise use the device wallet. */
export function activeWalletSigner(): OwnerSigner | null {
  return useStore.getState().connectedWallet ?? walletKeypair();
}

function activeWalletId(state: Pick<ColoyondState, 'wallet' | 'connectedWallet'>): string | null {
  return state.connectedWallet?.publicKey.toBase58() ?? state.wallet?.publicKey ?? null;
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
  allVaults: Record<string, VaultConfig[]>;
  vaultSetupDrafts: Record<string, VaultSetupDraft>;
  vaults: VaultConfig[];
  logs: LogEntry[];

  // runtime
  connectedWallet: WalletSigner | null;
  activeTab: TabId;
  stack: Screen[];
  walletBalances: Awaited<ReturnType<typeof fetchBalances>> | null;
  vaultBalances: Record<string, VaultBalances>;
  price: PriceBook | null;
  priceError: string | null;
  universe: UniverseAsset[];
  universeError: string | null;
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
  setConnectedWallet: (wallet: WalletSigner | null) => void;
  resetApp: () => void;

  // refreshers
  refreshPrice: () => Promise<void>;
  refreshUniverse: () => Promise<void>;
  refreshReserve: () => Promise<void>;
  refreshBalances: () => Promise<void>;
  refreshRpc: () => Promise<void>;
  refreshVaultBalances: (vaultId: string) => Promise<void>;

  // flows
  runFlow: (
    title: string,
    micro: string,
    steps: { label: string; run: () => Promise<{ note?: string; sig?: string }> }[],
    initialSteps?: FlowStepRuntime[],
  ) => Promise<boolean>;
  dismissFlow: () => void;

  // actions
  wrap: (lamports: number) => Promise<void>;
  createVault: (input: CreateVaultInput) => Promise<string | null>;
  fundVault: (vaultId: string, input: FundVaultInput) => Promise<void>;
  withdrawVault: (vaultId: string, fraction: number) => Promise<void>;
  pauseVault: (vaultId: string) => void;
  resumeVault: (vaultId: string) => void;
  updateCadence: (vaultId: string, cadenceSec: number) => Promise<void>;
  editWeights: (vaultId: string, targets: Record<string, number>) => Promise<void>;
  patchVault: (vaultId: string, patch: Partial<VaultConfig>) => void;
}

export const useStore = create<ColoyondState>()(
  persist(
    (set, get) => ({
      wallet: null,
      allVaults: {},
      vaultSetupDrafts: {},
      vaults: [],
      logs: [],

      activeTab: 'portfolios',
      connectedWallet: null,
      stack: [{ id: 'onboarding' }],
      walletBalances: null,
      vaultBalances: {},
      price: null,
      priceError: null,
      universe: [],
      universeError: null,
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
        const publicKey = kp.publicKey.toBase58();
        const allVaults = useStore.getState().allVaults;
        set({ wallet: { mnemonic, publicKey, createdAt: Date.now() }, vaults: allVaults[publicKey] ?? [] });
        get().log({ vaultId: null, kind: 'owner', summary: 'Wallet created on this device' });
        get().setTab('portfolios');
      },

      setConnectedWallet: (connectedWallet) => {
        const state = get();
        const walletId = connectedWallet?.publicKey.toBase58() ?? null;
        set({
          connectedWallet,
          walletBalances: null,
          vaultBalances: {},
          vaults: walletId
            ? state.allVaults[walletId] ?? []
            : state.wallet?.publicKey
              ? state.allVaults[state.wallet.publicKey] ?? []
              : [],
          stack: [{ id: connectedWallet || state.wallet ? 'portfolios' : 'onboarding' }],
          activeTab: 'portfolios',
        });
        if (connectedWallet) void get().refreshBalances();
      },

      resetApp: () => {
        set({ wallet: null, vaults: [], allVaults: {}, logs: [], vaultBalances: {}, walletBalances: null, stack: [{ id: 'onboarding' }] });
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

      refreshUniverse: async () => {
        try {
          const universe = await fetchCoinbaseUniverse();
          set({ universe, universeError: null });
        } catch (err) {
          set({ universeError: err instanceof Error ? err.message : 'asset list unavailable' });
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
        const kp = activeWalletSigner();
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
        const owner = activeWalletSigner();
        if (!cfg || cfg.legacy || !owner) return;
        try {
          const [bal, chain] = await Promise.all([
            fetchVaultBalances(new PublicKey(cfg.publicKey), owner.publicKey),
            readVaultState(new PublicKey(cfg.publicKey)),
          ]);
          const previousTradeCount = cfg.tradeCount;
          const tradeCount = Number(chain.lastSettledNonce);
          const settlements = tradeCount > previousTradeCount
            ? await fetchRecentVaultSettlements(new PublicKey(cfg.publicKey), tradeCount - previousTradeCount)
            : [];
          const latestSettlement = settlements[0];
          set((st) => ({ vaultBalances: { ...st.vaultBalances, [vaultId]: bal } }));
          get().patchVault(vaultId, {
            shareMint: chain.shareMint.toBase58(),
            assets: chain.assets.map((asset) => asset.id),
            targets: Object.fromEntries(chain.assets.map((asset) => [asset.id, asset.targetBps / 100])),
            thresholdPct: chain.thresholdBps / 100,
            status: chain.active ? 'active' : 'paused',
            tradeCount,
            ...(latestSettlement ? {
              lastTradeAt: latestSettlement.blockTime ? latestSettlement.blockTime * 1000 : Date.now(),
              lastTradeSig: latestSettlement.signature,
              lastTradeSlot: latestSettlement.slot,
            } : {}),
            nextCheckAt: null,
          });
          for (const settlement of settlements) {
            if (get().logs.some((entry) => entry.sig === settlement.signature)) continue;
            get().log({
              vaultId,
              kind: 'trade',
              summary: `Magic Action settled ${settlement.legs} rebalance leg${settlement.legs === 1 ? '' : 's'}`,
              detail: `on-chain nonce ${settlement.nonce} · slot ${settlement.slot}`,
              sig: settlement.signature,
              slot: settlement.slot,
              at: settlement.blockTime ? settlement.blockTime * 1000 : undefined,
            });
          }
        } catch {
          // keep last known
        }
      },

      runFlow: async (title, micro, steps, initialSteps) => {
        set({
          flow: {
            title,
            micro,
            steps: steps.map((s, index) => initialSteps?.[index] ?? { label: s.label, status: 'pending' as const }),
            finishedAt: null,
            error: null,
          },
        });
        for (let i = 0; i < steps.length; i += 1) {
          if (initialSteps?.[i]?.status === 'done') continue;
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

      wrap: async (lamports) => {
        const kp = activeWalletSigner();
        if (!kp) return;
        const ok = await get().runFlow('Wrap SOL into WSOL', 'WRAP · DEVNET', [
          {
            label: 'Build the wrap transaction',
            run: async () => ({ note: `${(lamports / 1e9).toFixed(4)} SOL into the owner WSOL account` }),
          },
          {
            label: 'Sign and send to devnet',
            run: async () => {
              const tx = buildWrapTx(kp.publicKey, lamports);
              const r = await signSendConfirm(tx, kp);
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
        const wallet = activeWalletSigner();
        if (!wallet) return null;
        const ownerKey = wallet.publicKey.toBase58();
        let draft = get().vaultSetupDrafts[ownerKey];
        if (!draft) {
          const chainId = BigInt(Date.now()) * 1_000n + BigInt(Math.floor(Math.random() * 1_000));
          const addresses = deriveVaultAddresses(wallet.publicKey, chainId);
          draft = {
            id: uid(),
            owner: ownerKey,
            input,
            chainId: chainId.toString(),
            stateAddress: addresses.state.toBase58(),
            createdAt: Date.now(),
            completed: {},
          };
          set((st) => ({ vaultSetupDrafts: { ...st.vaultSetupDrafts, [ownerKey]: draft! } }));
        }
        const id = draft.id;
        const chainId = BigInt(draft.chainId);
        const setupInput = draft.input;
        const stateAddress = new PublicKey(draft.stateAddress);
        const captured: {
          addresses: ReturnType<typeof vaultAddressesForState> | null;
          init: TxResult | null;
          deposit: TxResult | null;
          schedule: TxResult | null;
        } = {
          addresses: vaultAddressesForState(stateAddress),
          init: draft.completed.initialize ?? null,
          deposit: draft.completed.deposit ?? null,
          schedule: draft.completed.schedule ?? null,
        };
        const markComplete = (step: keyof VaultSetupDraft['completed'], result: TxResult) => {
          const next = { ...draft!, completed: { ...draft!.completed, [step]: result } };
          draft = next;
          set((st) => ({ vaultSetupDrafts: { ...st.vaultSetupDrafts, [ownerKey]: next } }));
        };
        const assets = setupInput.assets;
        const targets = setupInput.targets;
        const setupStepLabels = [
          ['initialize', 'Create Vault State, Authority and share mint'],
          ['accounts', 'Create standard SPL token accounts'],
          ['deposit', 'Wrap SOL and deposit into the vault'],
          ['schedule', `Register the ${setupInput.cadenceSec}-second MagicBlock task`],
        ] as const;
        const initialSteps: FlowStepRuntime[] = setupStepLabels.map(([key, label]) => {
          const result = draft!.completed[key as keyof VaultSetupDraft['completed']];
          return {
            label,
            status: result ? 'done' : 'pending',
            sig: result?.sig || undefined,
            note: result
              ? key === 'initialize'
                ? `Vault State ${stateAddress.toBase58().slice(0, 8)}…`
                : result.sig
                  ? 'Confirmed on Solana devnet'
                  : 'Already confirmed on Solana devnet'
              : undefined,
          } as FlowStepRuntime;
        });

        const ok = await get().runFlow('Create portfolio', 'SETUP · DEVNET', [
          {
            label: 'Create Vault State, Authority and share mint',
            run: async () => {
              const result = await initializeVault(wallet, chainId, assets, targets, setupInput.thresholdPct);
              captured.addresses = result.addresses;
              captured.init = result.result;
              markComplete('initialize', result.result);
              return { sig: result.result.sig, note: `Vault State ${result.addresses.state.toBase58().slice(0, 8)}…` };
            },
          },
          {
            label: 'Create standard SPL token accounts',
            run: async () => {
              if (!captured.addresses) throw new Error('Vault State was not initialized.');
              const result = await createVaultTokenAccounts(wallet, captured.addresses.state, assets);
              markComplete('accounts', result);
              return { sig: result.sig, note: `${assets.length} SPL accounts controlled by the Vault Authority PDA` };
            },
          },
          {
            label: 'Wrap SOL and deposit into the vault',
            run: async () => {
              if (!captured.addresses) throw new Error('Vault State was not initialized.');
              const result = await depositToVault(wallet, captured.addresses.state, setupInput.deposits, 1n);
              captured.deposit = result;
              markComplete('deposit', result);
              return { sig: result.sig, note: 'Deposit mints transferable shares at the on-chain NAV' };
            },
          },
          {
            label: `Register the ${setupInput.cadenceSec}-second MagicBlock task`,
            run: async () => {
              if (!captured.addresses) throw new Error('Vault State was not initialized.');
              const result = await scheduleVault(wallet, captured.addresses.state, setupInput.cadenceSec);
              captured.schedule = result;
              markComplete('schedule', result);
              return { sig: result.sig, note: `${Math.ceil(setupInput.cadenceSec * 5_700 / 60)}-slot interval verified; Hydra cranker required` };
            },
          },
        ], initialSteps);

        if (!captured.addresses || !captured.init || !captured.deposit) return null;
        if (!ok) {
          try { await setVaultActive(wallet, captured.addresses.state, false); } catch { /* show the funded vault as paused locally */ }
        }

        const cfg: VaultConfig = {
          id,
          name: setupInput.name,
          createdAt: draft.createdAt,
          publicKey: captured.addresses.state.toBase58(),
          shareMint: captured.addresses.shareMint.toBase58(),
          assets: setupInput.assets,
          targets: setupInput.targets,
          thresholdPct: setupInput.thresholdPct,
          cadenceSec: setupInput.cadenceSec,
          status: ok ? 'active' : 'paused',
          blockedReason: null,
          lastCheckAt: null,
          nextCheckAt: null,
          lastTradeAt: null,
          lastTradeSig: null,
          lastTradeSlot: null,
          lastWeightEditAt: null,
          deposited: setupInput.deposits,
          tradeCount: 0,
        };

        set((st) => {
          const vaults = [cfg, ...st.vaults.filter((vault) => vault.id !== id)];
          const walletId = activeWalletId(st);
          return {
            vaults,
            vaultSetupDrafts: ok
              ? Object.fromEntries(Object.entries(st.vaultSetupDrafts).filter(([key]) => key !== ownerKey))
              : st.vaultSetupDrafts,
            ...(walletId ? { allVaults: { ...st.allVaults, [walletId]: vaults } } : {}),
          };
        });
        if (!ok) {
          get().log({
            vaultId: id,
            kind: 'blocked',
            summary: 'Vault funded; scheduled execution is paused',
            detail: 'The standard SPL vault and share mint are on Solana. Register the MagicBlock task again after checking Devnet connectivity.',
          });
        }
        get().log({
          vaultId: id,
          kind: 'owner',
          summary: `Vault created: ${setupInput.name}`,
          detail: `target ${vaultTargetList(cfg)
            .map((t) => `${t.pct.toFixed(0)} ${assetSpec(t.assetId).symbol}`)
            .join(' · ')} · threshold ${setupInput.thresholdPct.toFixed(1)}%`,
          sig: captured.deposit.sig,
          slot: captured.deposit.slot,
        });
        get().refreshBalances();
        get().refreshVaultBalances(id);
        return id;
      },

      fundVault: async (vaultId, input) => {
        const wallet = activeWalletSigner();
        const cfg = get().vaults.find((v) => v.id === vaultId);
        if (!wallet || !cfg || cfg.legacy) return;

        let sig: string | undefined;
        const ok = await get().runFlow('Add funds', 'FUND · DEVNET', [
          {
            label: 'Build the funding transaction',
            run: async () => ({ note: 'on-chain pricing determines the share tokens minted' }),
          },
          {
            label: 'Sign and send to devnet',
            run: async () => {
              const r = await depositToVault(wallet, new PublicKey(cfg.publicKey), input.deposits, 1n);
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
            detail: amountList(input.deposits),
            sig,
          });
          get().refreshBalances();
          get().refreshVaultBalances(vaultId);
        }
      },

      withdrawVault: async (vaultId, fraction) => {
        const wallet = activeWalletSigner();
        const cfg = get().vaults.find((v) => v.id === vaultId);
        if (!wallet || !cfg || cfg.legacy) return;
        const bal = get().vaultBalances[vaultId];
        if (!bal || BigInt(bal.shareBalanceRaw) <= 0n) return;

        const state = await readVaultState(new PublicKey(cfg.publicKey));
        const totalShares = BigInt(bal.shareSupplyRaw);
        const shares = BigInt(bal.shareBalanceRaw) * BigInt(Math.round(fraction * 10_000)) / 10_000n;
        const minimums = buildRedeemMinimums(state, bal.tokens, shares, totalShares);

        let sig: string | undefined;
        const holdingsNote = `${(Number(shares) / 1e9).toFixed(4)} transferable shares`;
        const ok = await get().runFlow(
          fraction >= 0.999 ? 'Redeem shares' : 'Partial redemption',
          'EXIT · DEVNET',
          [
            {
              label: 'Read current share balance',
              run: async () => ({ note: holdingsNote }),
            },
            {
              label: 'Burn shares and redeem assets in kind',
              run: async () => {
                const r = await redeemFromVault(wallet, new PublicKey(cfg.publicKey), shares, minimums);
                sig = r.sig;
                return { sig: r.sig, note: `confirmed in slot ${r.slot}` };
              },
            },
          ],
        );
        if (ok) {
          const fullyRedeemed = fraction >= 0.999;
          const emptied = fullyRedeemed && shares === totalShares;
          get().log({
            vaultId,
            kind: 'owner',
            summary: fullyRedeemed ? 'Portfolio shares redeemed in kind' : 'Portfolio shares partially redeemed',
            detail: `${Math.round(fraction * 100)}% of your share balance was burned`,
            sig,
          });
          if (emptied) {
            try {
              await setVaultActive(wallet, new PublicKey(cfg.publicKey), false);
              await cancelVaultSchedule(wallet, new PublicKey(cfg.publicKey));
            } catch {
              // The on-chain redemption is complete; display still follows the Vault State.
            }
            get().patchVault(vaultId, { status: 'paused', blockedReason: null, nextCheckAt: null });
          }
          get().refreshBalances();
          get().refreshVaultBalances(vaultId);
        }
      },

      pauseVault: async (vaultId) => {
        const cfg = get().vaults.find((v) => v.id === vaultId);
        if (!cfg || cfg.legacy) return;
        const wallet = activeWalletSigner();
        if (!wallet) return;
        try {
          const result = await setVaultActive(wallet, new PublicKey(cfg.publicKey), false);
          get().patchVault(vaultId, { status: 'paused', blockedReason: null, nextCheckAt: null });
          try { await cancelVaultSchedule(wallet, new PublicKey(cfg.publicKey)); } catch { /* inactive state prevents settlement */ }
          get().log({ vaultId, kind: 'owner', summary: 'Automation paused by owner', sig: result.sig, slot: result.slot });
        } catch (err) {
          get().toast('error', 'Pause failed', err instanceof Error ? err.message : 'Unable to pause this Solana vault.');
        }
      },

      resumeVault: async (vaultId) => {
        const cfg = get().vaults.find((v) => v.id === vaultId);
        if (!cfg || cfg.legacy) return;
        const wallet = activeWalletSigner();
        if (!wallet) return;
        try {
          const stateAddress = new PublicKey(cfg.publicKey);
          await setVaultActive(wallet, stateAddress, true);
          const result = await scheduleVault(wallet, stateAddress, cfg.cadenceSec);
          get().patchVault(vaultId, { status: 'active', nextCheckAt: null });
          const ownerKey = wallet.publicKey.toBase58();
          const draft = get().vaultSetupDrafts[ownerKey];
          if (draft?.stateAddress === stateAddress.toBase58()) {
            set((st) => ({ vaultSetupDrafts: Object.fromEntries(Object.entries(st.vaultSetupDrafts).filter(([key]) => key !== ownerKey)) }));
          }
          get().log({ vaultId, kind: 'owner', summary: 'MagicBlock task registered again', detail: `${cfg.cadenceSec}-second minimum interval`, sig: result.sig, slot: result.slot });
        } catch (err) {
          try { await setVaultActive(wallet, new PublicKey(cfg.publicKey), false); } catch { /* leave paused locally */ }
          get().toast('error', 'Resume failed', err instanceof Error ? err.message : 'Unable to register the MagicBlock task.');
        }
      },

      updateCadence: async (vaultId, cadenceSec) => {
        const cfg = get().vaults.find((v) => v.id === vaultId);
        if (!cfg || cfg.legacy || cfg.status !== 'active') return;
        const wallet = activeWalletSigner();
        if (!wallet) return;
        try {
          const result = await scheduleVault(wallet, new PublicKey(cfg.publicKey), cadenceSec);
          get().patchVault(vaultId, { cadenceSec, nextCheckAt: null });
          get().log({
            vaultId,
            kind: 'owner',
            summary: `Minimum rebalance delay set to ${cadenceSec} seconds`,
            detail: 'Updated on Solana and registered the Hydra task at the matching interval; the cranker pays trigger fees.',
            sig: result.sig,
            slot: result.slot,
          });
          get().toast('ok', 'Crank interval updated', 'The operator pays trigger fees; this owner-signed update sets the vault delay.');
        } catch (err) {
          get().toast('error', 'Interval update failed', err instanceof Error ? err.message : 'Unable to update the on-chain crank policy.');
        }
      },

      editWeights: async (vaultId, targets) => {
        const cfg = get().vaults.find((v) => v.id === vaultId);
        if (!cfg || cfg.legacy) return;
        if (cfg.lastWeightEditAt && Date.now() - cfg.lastWeightEditAt < 120_000) {
          get().toast('error', 'Edit cooldown active', 'Weight edits wait 120 seconds between changes.');
          return;
        }
        const wallet = activeWalletSigner();
        if (!wallet) return;
        try {
          await updateVaultTargets(wallet, new PublicKey(cfg.publicKey), targets);
        } catch (err) {
          get().toast('error', 'Weight update failed', err instanceof Error ? err.message : 'Unable to update targets on Solana.');
          return;
        }
        get().patchVault(vaultId, { targets, lastWeightEditAt: Date.now(), nextCheckAt: null });
        get().log({
          vaultId,
          kind: 'owner',
          summary: `Weights set to ${Object.entries(targets)
            .filter(([, pct]) => pct > 0)
            .map(([id, pct]) => `${pct.toFixed(0)} ${assetSpec(id as AssetId).symbol}`)
            .join(' · ')}`,
          detail: 'updated in the base-layer Vault State; the registered task reads these targets',
        });
        get().toast('ok', 'Target weights updated', 'The next check trades toward the new target.');
      },

      patchVault: (vaultId, patch) =>
        set((st) => {
          const vaults = st.vaults.map((v) => (v.id === vaultId ? { ...v, ...patch } : v));
          const walletId = activeWalletId(st);
          return {
            vaults,
            ...(walletId ? { allVaults: { ...st.allVaults, [walletId]: vaults } } : {}),
          };
        }),
    }),
    {
      name: 'coloyond.v1',
      version: 5,
      storage: createJSONStorage(() => localStorage),
      partialize: (st) => ({ wallet: st.wallet, allVaults: st.allVaults, vaults: st.vaults, vaultSetupDrafts: st.vaultSetupDrafts, logs: st.logs }),
      migrate: (persisted, _version) => {
        const p = persisted as { wallet?: ColoyondState['wallet']; allVaults?: Record<string, VaultConfig[]>; vaults?: Record<string, unknown>[] } | undefined;
        if (p && Array.isArray(p.vaults)) {
          p.vaults = p.vaults.map((v) => {
            let normalized = v;
            if (v && typeof v.targetWsolPct === 'number' && !v.targets) {
              const { targetWsolPct, depositedWsolLamports, depositedUsdRaw, ...rest } = v as {
                targetWsolPct: number;
                depositedWsolLamports?: number;
                depositedUsdRaw?: number;
              } & Record<string, unknown>;
              normalized = {
                ...rest,
                assets: ['wsol', 'tusd'],
                targets: { wsol: targetWsolPct, tusd: 100 - targetWsolPct },
                deposited: { wsol: depositedWsolLamports ?? 0, tusd: depositedUsdRaw ?? 0 },
              };
            }
            const hasPdaCustody = typeof normalized?.shareMint === 'string' && normalized.legacy !== true;
            return {
              ...normalized,
              cadenceSec: typeof normalized.cadenceSec === 'number' ? normalized.cadenceSec : REBALANCE_INTERVAL_SEC,
              ...(!hasPdaCustody ? { legacy: true, status: 'legacy' } : {}),
            };
          });
        }
        const walletId = p?.wallet?.publicKey;
        const vaults = (p?.vaults ?? []) as unknown as VaultConfig[];
        const allVaults = p?.allVaults ?? (walletId ? { [walletId]: vaults } : {});
        return { ...p, allVaults, vaults: walletId ? (allVaults[walletId] ?? []) : vaults } as unknown as ColoyondState;
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
