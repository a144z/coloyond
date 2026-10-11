import { Buffer } from 'buffer';
import { PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { useStore, type VaultConfig } from './store';
import { mintOf, type AssetId } from './solana/assets';
import { RESERVE_OWNER, EXECUTION_PROGRAM, portfolioAddress, reserveDelegateAddress, vaultDelegateAddress } from './solana/execution';
import { ephemeralConnection } from './solana/connection';
import { REBALANCE_INTERVAL_SEC, PRICE_POLL_MS, BALANCE_POLL_MS, RESERVE_POLL_MS, RPC_POLL_MS } from './solana/config';
import { walletKeypair } from './store';

const REBALANCE_DISCRIMINATOR = Buffer.from([0x6c, 0x9e, 0x4d, 0x09, 0xd2, 0x34, 0x58, 0x3e]);
const ORACLE_FEEDS: Partial<Record<AssetId, PublicKey>> = {
  wsol: new PublicKey('ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu'),
  tbtc: new PublicKey('71wtTRDY8Gxgw56bXFt2oc6qeAbTxzStdNiC425Z51sr'),
  teth: new PublicKey('5vaYr1hpv8yrSpu8w3K95x22byYxUJCCNCSYJtqVWPvG'),
};

let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
let lastPriceFetch = 0;
let lastBalanceFetch = 0;
let lastReserveFetch = 0;
let lastRpcFetch = 0;
const seenTrades = new Map<string, number>();

/** The browser only mirrors ER state; the MagicBlock crank performs scheduled execution. */
export function ensureScheduler(): void {
  if (timer) return;
  timer = setInterval(() => void tick(), 10_000);
  void tick();
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Submit one immediate rebalance instruction to the Ephemeral Rollup. */
export function runCrank(vaultId: string): void {
  void runVaultCheck(vaultId, true);
}

async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const state = useStore.getState();
    if (!state.wallet) return;
    const now = Date.now();
    if (now - lastPriceFetch >= PRICE_POLL_MS) { lastPriceFetch = now; void state.refreshPrice(); }
    if (now - lastRpcFetch >= RPC_POLL_MS) { lastRpcFetch = now; void state.refreshRpc(); }
    if (now - lastBalanceFetch >= BALANCE_POLL_MS) {
      lastBalanceFetch = now;
      void state.refreshBalances();
      for (const vault of state.vaults) if (vault.status !== 'closed') void state.refreshVaultBalances(vault.id);
    }
    if (now - lastReserveFetch >= RESERVE_POLL_MS) { lastReserveFetch = now; void state.refreshReserve(); }
    for (const vault of useStore.getState().vaults) {
      if (vault.status !== 'closed') await syncPortfolio(vault);
    }
  } catch (err) {
    console.warn('[coloyond] ER state sync failed:', err);
  } finally {
    ticking = false;
  }
}

function decodePortfolioState(data: Buffer): { active: boolean; lastRunAt: number; tradeCount: number } {
  // Anchor discriminator, 3 pubkeys, bounded vectors (4 assets/mints/weights),
  // threshold, task id, active flag, timestamp and cumulative trade count.
  let offset = 8 + 32 * 3;
  const assetsLength = data.readUInt32LE(offset); offset += 4 + assetsLength;
  const mintsLength = data.readUInt32LE(offset); offset += 4 + mintsLength * 32;
  const targetsLength = data.readUInt32LE(offset); offset += 4 + targetsLength * 2;
  offset += 2 + 8;
  const active = data[offset] === 1; offset += 1;
  const lastRunAt = Number(data.readBigInt64LE(offset)); offset += 8;
  const tradeCount = Number(data.readBigUInt64LE(offset));
  return { active, lastRunAt, tradeCount };
}

async function syncPortfolio(cfg: VaultConfig): Promise<void> {
  const address = portfolioAddress(new PublicKey(cfg.publicKey));
  const info = await ephemeralConnection.getAccountInfo(address, 'confirmed');
  if (!info || !info.owner.equals(EXECUTION_PROGRAM)) return;
  const chain = decodePortfolioState(info.data);
  const previousTradeCount = seenTrades.get(cfg.id) ?? cfg.tradeCount;
  seenTrades.set(cfg.id, chain.tradeCount);
  if (chain.tradeCount > previousTradeCount) {
    useStore.getState().log({
      vaultId: cfg.id,
      kind: 'trade',
      summary: `MagicBlock executed ${chain.tradeCount - previousTradeCount} rebalance trade${chain.tradeCount - previousTradeCount === 1 ? '' : 's'}`,
      detail: `scheduled every ${REBALANCE_INTERVAL_SEC} seconds · cumulative ${chain.tradeCount}`,
    });
  }
  useStore.getState().patchVault(cfg.id, {
    status: chain.active ? 'active' : 'paused',
    tradeCount: chain.tradeCount,
    lastCheckAt: chain.lastRunAt > 0 ? chain.lastRunAt * 1000 : cfg.lastCheckAt,
    lastTradeAt: chain.tradeCount > previousTradeCount ? Date.now() : cfg.lastTradeAt,
    nextCheckAt: chain.active && chain.lastRunAt > 0 ? (chain.lastRunAt + REBALANCE_INTERVAL_SEC) * 1000 : cfg.nextCheckAt,
    blockedReason: null,
  });
}

function rebalanceInstruction(cfg: VaultConfig): TransactionInstruction {
  const vault = new PublicKey(cfg.publicKey);
  const assets = cfg.assets;
  const vaultAccounts = assets.map((id) => getAssociatedTokenAddressSync(mintOf(id), vault));
  const reserveAccounts = assets.map((id) => getAssociatedTokenAddressSync(mintOf(id), RESERVE_OWNER));
  const feeds = assets.flatMap((id) => ORACLE_FEEDS[id] ? [ORACLE_FEEDS[id]!] : []);
  return new TransactionInstruction({
    programId: EXECUTION_PROGRAM,
    keys: [
      { pubkey: portfolioAddress(vault), isSigner: false, isWritable: true },
      { pubkey: vaultDelegateAddress(vault), isSigner: false, isWritable: false },
      { pubkey: reserveDelegateAddress(), isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ...[...vaultAccounts, ...reserveAccounts].map((pubkey) => ({ pubkey, isSigner: false, isWritable: true })),
      ...feeds.map((pubkey) => ({ pubkey, isSigner: false, isWritable: false })),
    ],
    data: REBALANCE_DISCRIMINATOR,
  });
}

async function runVaultCheck(vaultId: string, manual: boolean): Promise<void> {
  const cfg = useStore.getState().vaults.find((item) => item.id === vaultId);
  const signer = walletKeypair();
  if (!cfg || cfg.status === 'closed' || !signer) return;
  const tx = new Transaction().add(rebalanceInstruction(cfg));
  tx.feePayer = signer.publicKey;
  try {
    const { blockhash, lastValidBlockHeight } = await ephemeralConnection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    const signature = await ephemeralConnection.sendTransaction(tx, [signer]);
    const result = await ephemeralConnection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
    if (result.value.err) throw new Error(JSON.stringify(result.value.err));
    if (manual) useStore.getState().log({ vaultId, kind: 'check', summary: 'Immediate ER rebalance submitted', sig: signature, slot: result.context.slot });
    await syncPortfolio(cfg);
  } catch (err) {
    useStore.getState().log({
      vaultId,
      kind: 'blocked',
      summary: 'Ephemeral Rollup rebalance failed',
      detail: err instanceof Error ? err.message.slice(0, 180) : 'Check the MagicBlock connection and portfolio setup.',
    });
  }
}
