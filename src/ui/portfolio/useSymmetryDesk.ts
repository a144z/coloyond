import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { Transaction, VersionedTransaction } from "@solana/web3.js";
import { DEFAULT_NETWORK, type SymmetryNetwork } from "../../symmetry/config.js";
import { listVaults, readVault } from "../../symmetry/read.js";
import type { VaultBrief, VaultView } from "../../symmetry/types.js";
import { type WalletLike } from "../../symmetry/wallet.js";
import { fundAutomationReserve, keeperNudge } from "../../symmetry/actions.js";

export type SymmetryPhase = "idle" | "listing" | "reading" | "signing" | "sent" | "error";

export interface SymmetryDeskView {
  network: SymmetryNetwork;
  address: string | null;
  vaults: VaultBrief[];
  selected: string | null;
  detail: VaultView | null;
  phase: SymmetryPhase;
  status: string;
  busy: boolean;
  lastSignature: string | null;
  setNetwork: (network: SymmetryNetwork) => void;
  select: (pubkey: string) => void;
  refresh: () => void;
  fundReserve: (amountLamports: number) => Promise<void>;
  nudgeKeeper: () => Promise<void>;
}

const STORE_KEY = "coloyond.symmetry-desk.v1";

interface StoredCore {
  network: SymmetryNetwork;
  selected: string | null;
}

function readCore(): StoredCore {
  const fallback: StoredCore = { network: DEFAULT_NETWORK, selected: null };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<StoredCore>;
    const network: SymmetryNetwork = parsed.network === "mainnet" ? "mainnet" : "devnet";
    const selected = typeof parsed.selected === "string" ? parsed.selected : null;
    return { network, selected };
  } catch {
    return fallback;
  }
}

function shortSig(signatures: string[][]): string {
  const flat = signatures.flat();
  return flat.length > 0 ? flat[flat.length - 1] : "";
}

export function useSymmetryDesk(): SymmetryDeskView {
  const initial = useRef(readCore());
  const { publicKey, signTransaction, signAllTransactions } = useWallet();
  const [network, setNetworkState] = useState<SymmetryNetwork>(initial.current.network);
  const [vaults, setVaults] = useState<VaultBrief[]>([]);
  const [selected, setSelected] = useState<string | null>(initial.current.selected);
  const [detail, setDetail] = useState<VaultView | null>(null);
  const [phase, setPhase] = useState<SymmetryPhase>("idle");
  const [status, setStatus] = useState("Ready.");
  const [lastSignature, setLastSignature] = useState<string | null>(null);

  const listToken = useRef(0);
  const detailToken = useRef(0);

  const address = publicKey?.toBase58() ?? null;

  const signer = useMemo<WalletLike | null>(() => {
    if (!publicKey || !signTransaction || !signAllTransactions) return null;
    return {
      publicKey,
      signTransaction: <T extends Transaction | VersionedTransaction>(tx: T) => signTransaction<T>(tx),
      signAllTransactions: <T extends Transaction | VersionedTransaction>(txs: T[]) => signAllTransactions<T>(txs),
    };
  }, [publicKey, signTransaction, signAllTransactions]);

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ network, selected } satisfies StoredCore));
    } catch {
      /* ignore */
    }
  }, [network, selected]);

  const loadList = useCallback(() => {
    const token = ++listToken.current;
    setPhase("listing");
    setVaults([]);
    setStatus(`Reading Symmetry ${network} vaults…`);
    listVaults(network)
      .then(rows => {
        if (token !== listToken.current) return;
        setVaults(rows);
        setPhase("idle");
        setStatus(`${rows.length} ${network} vaults; ${rows.filter(v => v.automationEnabled).length} with keeper automation enabled.`);
      })
      .catch((err: unknown) => {
        if (token !== listToken.current) return;
        setPhase("error");
        setStatus(`Vault list failed: ${message(err)}`);
      });
  }, [network]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const loadDetail = useCallback(
    (pubkey: string) => {
      const token = ++detailToken.current;
      setPhase("reading");
      setDetail(null);
      setStatus(`Reading vault ${pubkey.slice(0, 8)}…`);
      readVault(network, pubkey)
        .then(v => {
          if (token !== detailToken.current) return;
          setDetail(v);
          setPhase("idle");
          const drift = v.driftPp === null ? "drift unavailable" : `drift ${v.driftPp.toFixed(1)} pp`;
          setStatus(`${v.name}: ${drift}; keeper automation ${v.automation.enabled ? "on" : "off"}.`);
        })
        .catch((err: unknown) => {
          if (token !== detailToken.current) return;
          setPhase("error");
          setStatus(`Vault read failed: ${message(err)}`);
        });
    },
    [network],
  );

  const select = useCallback((pubkey: string) => {
    setSelected(pubkey);
  }, []);

  useEffect(() => {
    if (selected) loadDetail(selected);
  }, [selected, network, loadDetail]);

  const refresh = useCallback(() => {
    loadList();
    if (selected) loadDetail(selected);
  }, [loadList, loadDetail, selected]);

  const setNetwork = useCallback((next: SymmetryNetwork) => {
    setNetworkState(next);
    setSelected(null);
    setDetail(null);
  }, []);

  const runSigned = useCallback(
    async (label: string, action: (wallet: WalletLike, detail: VaultView) => Promise<{ signatures: string[][] }>) => {
      if (!signer) {
        setStatus("Connect a wallet first.");
        return;
      }
      if (!detail) {
        setStatus("Select a vault first.");
        return;
      }
      setPhase("signing");
      setLastSignature(null);
      setStatus(`${label}: review in your wallet…`);
      try {
        const result = await action(signer, detail);
        const sig = shortSig(result.signatures);
        setLastSignature(sig || null);
        setPhase("sent");
        setStatus(sig ? `${label}: confirmed ${sig.slice(0, 12)}…` : `${label}: submitted.`);
      } catch (err) {
        setPhase("error");
        setStatus(`${label} failed: ${message(err)}`);
      }
    },
    [signer, detail],
  );

  const fundReserve = useCallback(
    (amountLamports: number) => runSigned("Fund automation reserve", (wallet, d) => fundAutomationReserve({ network, wallet, vault: d.pubkey, amountLamports })),
    [network, runSigned],
  );

  const nudgeKeeper = useCallback(
    () => runSigned("Keeper nudge", (wallet, d) => keeperNudge({ network, wallet, vaultMint: d.mint })),
    [network, runSigned],
  );

  const busy = phase === "listing" || phase === "reading" || phase === "signing";

  return {
    network,
    address,
    vaults,
    selected,
    detail,
    phase,
    status,
    busy,
    lastSignature,
    setNetwork,
    select,
    refresh,
    fundReserve,
    nudgeKeeper,
  };
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
