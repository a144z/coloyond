import { PublicKey, type Connection } from "@solana/web3.js";
import type { Vault } from "@symmetry-hq/sdk";
import { getSymmetry, type SymmetryNetwork } from "./config.js";
import type { AssetView, VaultBrief, VaultView } from "./types.js";

const KNOWN_MINTS: Record<string, { symbol: string; decimals: number }> = {
  So11111111111111111111111111111111111111112: { symbol: "WSOL", decimals: 9 },
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: "USDC", decimals: 6 },
  USDCoctVLVnvTXBEuP9s8hntucdJokbo17RwHuNXemT: { symbol: "USDCd", decimals: 6 },
};

const decimalsCache = new Map<string, number | null>();

function decToNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const asObj = v as { toNumber?: () => number };
  if (typeof asObj.toNumber === "function") {
    const n = asObj.toNumber();
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(String(v));
  return Number.isFinite(n) ? n : null;
}

async function describeMint(connection: Connection, mint: string): Promise<{ symbol: string; decimals: number | null }> {
  const known = KNOWN_MINTS[mint];
  if (known) return known;
  let decimals = decimalsCache.get(mint);
  if (decimals === undefined) {
    const info = await connection.getParsedAccountInfo(new PublicKey(mint));
    const parsed = info.value?.data;
    const value = parsed && "parsed" in parsed ? (parsed.parsed as { info?: { decimals?: number } }).info?.decimals : undefined;
    decimals = typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 18 ? value : null;
    decimalsCache.set(mint, decimals);
  }
  return { symbol: `${mint.slice(0, 4)}…${mint.slice(-4)}`, decimals };
}

function toBrief(vault: Vault, network: SymmetryNetwork): VaultBrief | null {
  const f = vault.formatted;
  if (!f) return null;
  return {
    pubkey: f.pubkey,
    mint: f.mint,
    name: f.name,
    symbol: f.symbol,
    network,
    supply: f.supply_outstanding,
    assets: f.composition.filter(a => a.active).length,
    automationEnabled: Boolean(f.automation_settings?.enabled),
    bountyBalance: f.bounty_balance ?? 0,
    lastKeeperAt: f.last_automation_execution_timestamp ? f.last_automation_execution_timestamp * 1000 : null,
  };
}

export async function listVaults(network: SymmetryNetwork): Promise<VaultBrief[]> {
  const { sdk } = getSymmetry(network);
  const vaults = await sdk.fetchAllVaults();
  return vaults
    .map(v => toBrief(v, network))
    .filter((v): v is VaultBrief => v !== null)
    .sort((a, b) => Number(b.automationEnabled) - Number(a.automationEnabled) || b.bountyBalance - a.bountyBalance);
}

export async function readVault(network: SymmetryNetwork, pubkey: string): Promise<VaultView> {
  const { sdk, connection } = getSymmetry(network);
  const base = await sdk.fetchVault(pubkey);

  let priced: Vault = base;
  let tvlUsd: number | null = null;
  try {
    priced = await sdk.loadVaultPrice(base);
    tvlUsd = decToNum(priced.tvl);
  } catch {
    tvlUsd = null;
  }

  const f = priced.formatted;
  const detail: AssetView[] = [];
  for (const asset of priced.composition) {
    if (!asset.active) continue;
    const mint = asset.mint.toBase58();
    const { symbol, decimals } = await describeMint(connection, mint);
    const amount = decimals === null ? null : Number(asset.amount.toString()) / 10 ** decimals;
    detail.push({
      mint,
      symbol,
      decimals,
      amount,
      targetPct: asset.weight / 100,
      actualPct: null,
      valueUsd: decToNum(asset.value),
      active: true,
    });
  }

  const priced_any_missing = detail.some(a => a.valueUsd === null);
  if (!priced_any_missing && tvlUsd && tvlUsd > 0) {
    for (const a of detail) a.actualPct = ((a.valueUsd as number) / tvlUsd) * 100;
  }

  const driftPp = detail.every(a => a.actualPct !== null)
    ? detail.reduce((sum, a) => sum + Math.abs((a.actualPct as number) - a.targetPct), 0)
    : null;

  const brief = toBrief(priced, network);
  if (!brief) throw new Error("vault has no formatted data");

  return {
    ...brief,
    tvlUsd,
    priceUsd: decToNum(priced.price),
    driftPp,
    detail,
    automation: {
      enabled: Boolean(f?.automation_settings?.enabled),
      absBps: f?.automation_settings?.rebalance_activation_threshold_abs_bps ?? 0,
      relBps: f?.automation_settings?.rebalance_activation_threshold_rel_bps ?? 0,
      cooldownSeconds: f?.automation_settings?.rebalance_activation_cooldown ?? 0,
      slippageBps: f?.automation_settings?.rebalance_slippage_threshold_bps ?? 0,
    },
    bountyMint: f?.bounty_mint ?? "",
    activeRebalance: f?.active_rebalance ?? 0,
  };
}
