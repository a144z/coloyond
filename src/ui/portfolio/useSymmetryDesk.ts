import { useCallback, useEffect, useRef, useState } from "react";
import { listVaults, readVault } from "../../symmetry/read.js";
import type { VaultBrief, VaultView } from "../../symmetry/types.js";

export type SymmetryPhase = "idle" | "listing" | "reading" | "error";

export interface SymmetryDeskView {
  vaults: VaultBrief[];
  selected: string | null;
  detail: VaultView | null;
  phase: SymmetryPhase;
  status: string;
  busy: boolean;
  select: (pubkey: string) => void;
  refresh: () => void;
}

const STORE_KEY = "coloyond.symmetry-desk.v1";

function readSelected(): string | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const selected = (JSON.parse(raw) as { selected?: unknown }).selected;
    return typeof selected === "string" ? selected : null;
  } catch {
    return null;
  }
}

export function useSymmetryDesk(): SymmetryDeskView {
  const [vaults, setVaults] = useState<VaultBrief[]>([]);
  const [selected, setSelected] = useState<string | null>(readSelected);
  const [detail, setDetail] = useState<VaultView | null>(null);
  const [phase, setPhase] = useState<SymmetryPhase>("idle");
  const [status, setStatus] = useState("Symmetry Devnet comparison is read-only.");
  const listToken = useRef(0);
  const detailToken = useRef(0);

  const loadList = useCallback(() => {
    const token = ++listToken.current;
    setPhase("listing");
    setVaults([]);
    setStatus("Reading Symmetry vaults from Solana Devnet…");
    listVaults("devnet")
      .then(rows => {
        if (token !== listToken.current) return;
        setVaults(rows);
        setPhase("idle");
        setStatus(`${rows.length} vaults read from Solana Devnet. This comparison page is read-only.`);
      })
      .catch((err: unknown) => {
        if (token !== listToken.current) return;
        setPhase("error");
        setStatus(`Devnet vault list failed: ${message(err)}`);
      });
  }, []);

  useEffect(() => loadList(), [loadList]);

  const loadDetail = useCallback((pubkey: string) => {
    const token = ++detailToken.current;
    setPhase("reading");
    setDetail(null);
    setStatus(`Reading vault ${pubkey.slice(0, 8)} from Solana Devnet…`);
    readVault("devnet", pubkey)
      .then(v => {
        if (token !== detailToken.current) return;
        setDetail(v);
        setPhase("idle");
        const drift = v.driftPp === null ? "drift unavailable" : `drift ${v.driftPp.toFixed(1)} pp`;
        setStatus(`${v.name}: ${drift}; keeper automation ${v.automation.enabled ? "on" : "off"}. Read-only Devnet data.`);
      })
      .catch((err: unknown) => {
        if (token !== detailToken.current) return;
        setPhase("error");
        setStatus(`Devnet vault read failed: ${message(err)}`);
      });
  }, []);

  const select = useCallback((pubkey: string) => {
    setSelected(pubkey);
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ selected: pubkey }));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (selected) loadDetail(selected);
  }, [selected, loadDetail]);

  const refresh = useCallback(() => {
    loadList();
    if (selected) loadDetail(selected);
  }, [loadList, loadDetail, selected]);

  return { vaults, selected, detail, phase, status, busy: phase === "listing" || phase === "reading", select, refresh };
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
