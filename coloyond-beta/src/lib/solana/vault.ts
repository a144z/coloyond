import { Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { assetList, assetSpec, knownAsset, mintOf } from './assets';
import { fetchBalances, wrapSolInstructions, type Balances } from './wallet';

/**
 * Vault lifecycle transactions.
 *
 * Every vault is a separate keypair with its own token accounts: custody,
 * automation authority and fee budget are genuinely separated from the owner
 * wallet. The owner wallet signs provisioning; the vault keypair signs
 * automated swaps and pays their fees out of its own SOL budget.
 *
 * A vault holds a fixed set of assets chosen at creation; provisioning
 * creates its token accounts for that whole set so closing can always
 * recover the rent.
 */

export interface ProvisionPlan {
  assets: string[];
  budgetLamports: number;
  /** Raw deposit per asset id. */
  deposits: Record<string, number>;
}

export interface FundPlan {
  budgetLamports: number;
  /** Raw deposit per asset id (must be within the vault's asset set). */
  deposits: Record<string, number>;
}

export function vaultAta(vault: PublicKey, id: string): PublicKey {
  return getAssociatedTokenAddressSync(mintOf(id), vault);
}

export function walletAta(wallet: PublicKey, id: string): PublicKey {
  return getAssociatedTokenAddressSync(mintOf(id), wallet);
}

function depositInstructions(
  wallet: Keypair,
  destAta: (id: string) => PublicKey,
  deposits: Record<string, number>,
): Transaction['instructions'] {
  const ix: Transaction['instructions'] = [];
  for (const spec of assetList()) {
    const dep = deposits[spec.id] ?? 0;
    if (dep <= 0) continue;
    if (spec.id === 'wsol') {
      ix.push(...wrapSolInstructions(wallet.publicKey, dep));
    } else {
      ix.push(
        createAssociatedTokenAccountIdempotentInstruction(
          wallet.publicKey,
          walletAta(wallet.publicKey, spec.id),
          wallet.publicKey,
          mintOf(spec.id),
        ),
      );
    }
    ix.push(
      createTransferInstruction(
        walletAta(wallet.publicKey, spec.id),
        destAta(spec.id),
        wallet.publicKey,
        dep,
      ),
    );
  }
  return ix;
}

/** One wallet-signed transaction: rent for the full asset set, budget, deposits. */
export function buildProvisionTx(wallet: Keypair, vault: Keypair, plan: ProvisionPlan): Transaction {
  const tx = new Transaction().add(
    ...plan.assets.map((id) =>
      createAssociatedTokenAccountIdempotentInstruction(
        wallet.publicKey,
        vaultAta(vault.publicKey, id),
        vault.publicKey,
        mintOf(id),
      ),
    ),
    SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: vault.publicKey, lamports: plan.budgetLamports }),
    ...depositInstructions(wallet, (id) => vaultAta(vault.publicKey, id), plan.deposits),
  );
  tx.feePayer = wallet.publicKey;
  return tx;
}

export function buildFundTx(wallet: Keypair, vault: Keypair, plan: FundPlan): Transaction {
  const tx = new Transaction();
  if (plan.budgetLamports > 0) {
    tx.add(
      SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: vault.publicKey, lamports: plan.budgetLamports }),
    );
  }
  tx.add(...depositInstructions(wallet, (id) => vaultAta(vault.publicKey, id), plan.deposits));
  tx.feePayer = wallet.publicKey;
  return tx;
}

/**
 * In-kind withdrawal: the vault returns a fraction of each token to the
 * wallet. The owner wallet pays fees so an exhausted budget cannot trap
 * assets.
 */
export function buildWithdrawTx(
  wallet: Keypair,
  vault: Keypair,
  bal: Balances,
  fraction: number,
): Transaction {
  const tx = new Transaction();
  for (const spec of assetList()) {
    const out = Math.floor((bal.tokens[spec.id] ?? 0) * fraction);
    if (out <= 0) continue;
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        wallet.publicKey,
        walletAta(wallet.publicKey, spec.id),
        wallet.publicKey,
        mintOf(spec.id),
      ),
      createTransferInstruction(
        vaultAta(vault.publicKey, spec.id),
        walletAta(wallet.publicKey, spec.id),
        vault.publicKey,
        out,
      ),
    );
  }
  tx.feePayer = wallet.publicKey;
  return tx;
}

/**
 * Close sequence: return every base unit, close the vault's token accounts
 * for its whole asset set (rent recovered), and sweep the remaining
 * automation budget back to the wallet. Assets move first; cleanup follows.
 */
export function buildCloseTx(wallet: Keypair, vault: Keypair, bal: Balances, assets: string[]): Transaction {
  const tx = new Transaction();
  for (const id of assets) {
    const out = bal.tokens[id] ?? 0;
    if (out > 0) {
      tx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          wallet.publicKey,
          walletAta(wallet.publicKey, id),
          wallet.publicKey,
          mintOf(id),
        ),
        createTransferInstruction(vaultAta(vault.publicKey, id), walletAta(wallet.publicKey, id), vault.publicKey, out),
      );
    }
  }
  for (const id of assets) {
    tx.add(createCloseAccountInstruction(vaultAta(vault.publicKey, id), vault.publicKey, vault.publicKey));
  }
  if (bal.solLamports > 0) {
    tx.add(
      SystemProgram.transfer({ fromPubkey: vault.publicKey, toPubkey: wallet.publicKey, lamports: bal.solLamports }),
    );
  }
  tx.feePayer = wallet.publicKey;
  return tx;
}

export async function fetchVaultBalances(vault: Keypair): Promise<Balances> {
  return fetchBalances(vault.publicKey);
}

/* ---------------- weight math (pure) ---------------- */

export interface AssetRow {
  assetId: string;
  raw: number;
  usd: number;
  pct: number;
}

/**
 * Value every held asset at live prices and normalize to weights. The row
 * order follows `order` (the vault's asset set) first, then any stray held
 * asset, so a vault holding something outside its target set still sees it.
 */
export function computeAssetRows(
  tokens: Record<string, number>,
  prices: Record<string, number>,
  order?: readonly string[],
): { rows: AssetRow[]; totalUsd: number } {
  const ids: string[] = [];
  for (const id of order ?? []) {
    if (knownAsset(id) && !ids.includes(id)) ids.push(id);
  }
  for (const spec of assetList()) {
    if ((tokens[spec.id] ?? 0) > 0 && !ids.includes(spec.id)) ids.push(spec.id);
  }

  const rows: AssetRow[] = [];
  let totalUsd = 0;
  for (const id of ids) {
    const spec = assetSpec(id);
    const raw = tokens[id] ?? 0;
    const usd = (raw / 10 ** spec.decimals) * (prices[id] ?? 0);
    totalUsd += usd;
    rows.push({ assetId: id, raw, usd, pct: 0 });
  }
  if (totalUsd > 0) {
    for (const r of rows) r.pct = (r.usd / totalUsd) * 100;
  }
  return { rows, totalUsd };
}

/** Largest single-asset deviation from target — the drift that triggers trades. */
export function maxDriftPct(rows: AssetRow[], targets: Record<string, number>): number {
  let max = 0;
  for (const [id, target] of Object.entries(targets)) {
    const actual = rows.find((r) => r.assetId === id)?.pct ?? 0;
    max = Math.max(max, Math.abs(actual - target));
  }
  return max;
}

export interface TradePlan {
  /** Asset the vault sells (overweight side). */
  inAsset: string;
  /** Asset the vault buys (underweight side). */
  outAsset: string;
  inRaw: number;
  usdValue: number;
}

/**
 * The trade sequence that pulls actual weights back onto target, capped by
 * holdings: pair the most-underweight asset with the most-overweight one,
 * trade the overlap, repeat. A two-asset vault yields exactly one trade; an
 * N-asset vault converges in at most N-1.
 */
export function planRebalance(
  tokens: Record<string, number>,
  targets: Record<string, number>,
  prices: Record<string, number>,
  maxTrades = 8,
): TradePlan[] {
  const assetIds = Object.keys(targets).filter(knownAsset);
  const vals: Record<string, number> = {};
  let total = 0;
  for (const id of assetIds) {
    const spec = assetSpec(id);
    const usd = ((tokens[id] ?? 0) / 10 ** spec.decimals) * (prices[id] ?? 0);
    vals[id] = usd;
    total += usd;
  }
  if (total <= 0) return [];

  // positive delta: underweight, buy it. negative: overweight, sell it.
  const deltas: Record<string, number> = {};
  for (const id of assetIds) deltas[id] = (targets[id] / 100) * total - vals[id];

  const holdings = { ...tokens };
  const trades: TradePlan[] = [];
  for (let round = 0; round < maxTrades; round++) {
    let buyId: string | null = null;
    let sellId: string | null = null;
    for (const id of assetIds) {
      if (deltas[id] > 0.01 && (buyId === null || deltas[id] > deltas[buyId])) buyId = id;
      if (deltas[id] < -0.01 && (sellId === null || deltas[id] < deltas[sellId])) sellId = id;
    }
    if (!buyId || !sellId) break;

    const usdTrade = Math.min(deltas[buyId], -deltas[sellId]);
    const sellSpec = assetSpec(sellId);
    const sellRaw = Math.min(
      Math.floor((usdTrade / prices[sellId]) * 10 ** sellSpec.decimals),
      holdings[sellId] ?? 0,
    );
    if (sellRaw <= 0) break; // nothing sellable left
    const actualUsd = (sellRaw / 10 ** sellSpec.decimals) * prices[sellId];
    trades.push({ inAsset: sellId, outAsset: buyId, inRaw: sellRaw, usdValue: actualUsd });

    holdings[sellId] = (holdings[sellId] ?? 0) - sellRaw;
    const buySpec = assetSpec(buyId);
    holdings[buyId] = (holdings[buyId] ?? 0) + Math.floor((actualUsd / prices[buyId]) * 10 ** buySpec.decimals);
    deltas[sellId] += actualUsd;
    deltas[buyId] -= actualUsd;
  }
  return trades;
}
