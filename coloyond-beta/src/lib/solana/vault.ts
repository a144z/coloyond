import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, getMint } from '@solana/spl-token';
import { assetList, assetSpec, isAssetId, type AssetId } from './assets';
import { connection } from './connection';
import { readVaultState, vaultAddressesForState, vaultAssetAccounts } from './execution';
import type { Balances } from './wallet';

export interface VaultBalances extends Balances {
  shareBalanceRaw: string;
  shareSupplyRaw: string;
}

export async function fetchVaultBalances(stateAddress: PublicKey, owner: PublicKey): Promise<VaultBalances> {
  const state = await readVaultState(stateAddress);
  const addresses = vaultAddressesForState(stateAddress);
  const tokenAccounts = vaultAssetAccounts(state, addresses.authority);
  const balances = await Promise.all(tokenAccounts.map(async (address) => {
    try {
      return Number((await connection.getTokenAccountBalance(address, 'confirmed')).value.amount);
    } catch {
      return 0;
    }
  }));
  const tokens = Object.fromEntries(assetList().map((asset) => [asset.id, 0])) as Record<AssetId, number>;
  state.assets.forEach((asset, index) => { tokens[asset.id] = balances[index]; });

  const ownerShares = getAssociatedTokenAddressSync(state.shareMint, owner);
  const [shareBalanceRaw, mint, solLamports] = await Promise.all([
    connection.getTokenAccountBalance(ownerShares, 'confirmed').then((result) => result.value.amount).catch(() => '0'),
    getMint(connection, state.shareMint),
    connection.getBalance(owner, 'confirmed'),
  ]);
  return { solLamports, tokens, shareBalanceRaw, shareSupplyRaw: mint.supply.toString() };
}

export interface AssetRow {
  assetId: AssetId;
  raw: number;
  usd: number;
  pct: number;
}

export function computeAssetRows(
  tokens: Record<string, number>,
  prices: Record<string, number>,
  order?: readonly string[],
): { rows: AssetRow[]; totalUsd: number } {
  const ids: AssetId[] = [];
  for (const id of order ?? []) if (isAssetId(id) && !ids.includes(id)) ids.push(id);
  for (const spec of assetList()) if ((tokens[spec.id] ?? 0) > 0 && !ids.includes(spec.id)) ids.push(spec.id);

  const rows: AssetRow[] = [];
  let totalUsd = 0;
  for (const id of ids) {
    const spec = assetSpec(id);
    const raw = tokens[id] ?? 0;
    const usd = (raw / 10 ** spec.decimals) * (prices[id] ?? 0);
    totalUsd += usd;
    rows.push({ assetId: id, raw, usd, pct: 0 });
  }
  if (totalUsd > 0) for (const row of rows) row.pct = row.usd / totalUsd * 100;
  return { rows, totalUsd };
}

export function maxDriftPct(rows: AssetRow[], targets: Record<string, number>): number {
  let max = 0;
  for (const [id, target] of Object.entries(targets)) {
    const actual = rows.find((row) => row.assetId === id)?.pct ?? 0;
    max = Math.max(max, Math.abs(actual - target));
  }
  return max;
}
