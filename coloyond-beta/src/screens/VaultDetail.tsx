import { useEffect, useState } from 'react';
import { useStore, vaultTargetList, type VaultConfig } from '../lib/store';
import { computeAssetRows, maxDriftPct } from '../lib/solana/vault';
import { assetsPriced, pricesFromBook } from '../lib/solana/price';
import { PRICE_MAX_AGE_MS, REBALANCE_INTERVAL_SEC } from '../lib/solana/config';
import { assetSpec, type AssetId } from '../lib/solana/assets';
import { explorerAddress } from '../lib/solana/connection';
import { fmtCountdown, fmtSol, fmtToken, fmtTimeAgo, fmtUsd, rawFromToken, shortKey, parseAmountOrZero } from '../lib/format';
import { useNow } from '../hooks/useNow';
import { Screen, ScreenHeading } from '../components/ui/Screen';
import { Button } from '../components/ui/Button';
import { LedgerPanel } from '../components/ui/LedgerPanel';
import { MixBar, segmentsOf } from '../components/ui/MixBar';
import { Sheet } from '../components/ui/Sheet';
import { Field, inputClass } from '../components/ui/Field';
import { AssetSwatch, Divider, KeyValue, MicroLabel, Notice, SignatureLink, Skeleton, StatusSwatch } from '../components/ui/primitives';
import { WeightSliders, normalizeShares, sharesFromTargets, type WeightLocks } from '../components/ui/WeightSliders';
import { BlockedNotice, VaultStatusLine } from './PortfolioList';

/** Portfolio details are read from the Vault State PDA and standard SPL accounts. */
export function VaultDetail({ vaultId }: { vaultId: string }) {
  useNow(1000);

  const vaultIndex = useStore((s) => s.vaults.findIndex((v) => v.id === vaultId));
  const vault = useStore((s) => s.vaults.find((v) => v.id === vaultId) ?? null);
  const bal = useStore((s) => s.vaultBalances[vaultId] ?? null);
  const walletBalances = useStore((s) => s.walletBalances);
  const price = useStore((s) => s.price);
  const logs = useStore((s) => s.logs);
  const pauseVault = useStore((s) => s.pauseVault);
  const resumeVault = useStore((s) => s.resumeVault);
  const updateUnifiedCadence = useStore((s) => s.updateUnifiedCadence);
  const [fundOpen, setFundOpen] = useState(false);
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [weightsOpen, setWeightsOpen] = useState(false);

  useEffect(() => {
    void useStore.getState().refreshVaultBalances(vaultId);
  }, [vaultId]);

  if (!vault) {
    return <Screen><ScreenHeading micro="03 / Portfolio" title="Vault not found." /></Screen>;
  }
  if (vault.legacy || vault.status === 'legacy') return <LegacyVault vault={vault} />;

  const priceOk = assetsPriced(price, vault.assets, PRICE_MAX_AGE_MS);
  const valued = bal && priceOk && price ? computeAssetRows(bal.tokens, pricesFromBook(price), vault.assets) : null;
  const drift = valued ? maxDriftPct(valued.rows, vault.targets) : null;
  const paused = vault.status === 'paused';
  const closed = vault.status === 'closed';
  const number = String(vaultIndex >= 0 ? vaultIndex + 1 : 0).padStart(2, '0');
  const vaultLogs = logs.filter((entry) => entry.vaultId === vaultId).slice(0, 12);
  const targetEntries = vaultTargetList(vault);
  const targetTicks: number[] = [];
  for (const target of targetEntries.slice(0, -1)) targetTicks.push(targetEntries.slice(0, targetEntries.indexOf(target) + 1).reduce((sum, item) => sum + item.pct, 0));
  const actualEntries = valued ? valued.rows.filter((row) => row.pct > 0.05) : [];
  const assetLabel = vault.assets.map((id) => assetSpec(id).symbol).join(' + ');
  const userShares = bal ? Number(BigInt(bal.shareBalanceRaw)) / 1e9 : 0;

  return (
    <Screen>
      <ScreenHeading
        micro={`03 / Portfolio ${number}`}
        title={vault.name}
        sub={<>{assetLabel} · Solana devnet.<br />Vault Authority PDA custody · transferable SPL shares.</>}
      />

      <LedgerPanel stripe="Portfolio value" meta={valued ? fmtUsd(valued.totalUsd) : 'price unavailable'}>
        <KeyValue rows={[
          { k: 'Vault NAV', v: valued ? fmtUsd(valued.totalUsd) : 'Waiting for recent display quotes' },
          { k: 'Your wallet SOL', v: walletBalances ? `${fmtSol(walletBalances.solLamports, 6)} SOL` : 'Reading wallet…' },
          { k: 'Your transferable shares', v: bal ? userShares.toFixed(4) : 'Reading shares…' },
        ]} />
        <p className="mt-3 text-[10.5px] leading-relaxed text-iron">
          NAV uses the current display price book. dUSD is synthetic Devnet USD priced at a fixed $1 for demo accounting only.
        </p>
      </LedgerPanel>

      <div className="mt-4">
        <LedgerPanel stripe="Automation" meta={paused || closed ? 'Paused' : 'Active on Solana'}>
          <div className="flex items-center gap-2 text-[12.5px] font-bold"><VaultStatusLine vault={vault} /></div>
          <KeyValue rows={[
            { k: 'Shared cadence', v: vault.cadenceSec === REBALANCE_INTERVAL_SEC ? 'About every 60 seconds' : `Older schedule · about every ${vault.cadenceSec} seconds` },
            { k: 'Settled Magic Action nonce', v: bal ? String(vault.tradeCount) : 'Reading Vault State…' },
            { k: 'Last settlement observed', v: vault.lastTradeAt ? fmtTimeAgo(vault.lastTradeAt) : 'None observed yet' },
            { k: 'Deviation threshold', v: `± ${vault.thresholdPct.toFixed(1)}%` },
          ]} />
          {vault.cadenceSec !== REBALANCE_INTERVAL_SEC && !paused && !closed ? (
            <div className="mt-3">
              <Button variant="secondary" full onClick={() => void updateUnifiedCadence(vaultId)}>
                Switch to the shared 60-second schedule
              </Button>
            </div>
          ) : null}
          {vault.cadenceSec !== REBALANCE_INTERVAL_SEC && paused ? (
            <p className="mt-3 text-[11px] leading-relaxed text-iron">Resume this portfolio to register it on the shared 60-second schedule.</p>
          ) : null}
          {vault.blockedReason ? <div className="mt-3"><BlockedNotice reason={vault.blockedReason} /></div> : null}
          {!closed ? (
            <div className="mt-4">
              <Button variant="secondary" full onClick={() => void (paused ? resumeVault(vaultId) : pauseVault(vaultId))}>
                {paused ? 'Resume scheduled task' : 'Pause scheduled task'}
              </Button>
            </div>
          ) : null}
          <p className="mt-3 text-[11px] leading-relaxed text-iron">
            One portfolio task evaluates all of this vault's SPL assets together; the running cranker services every active portfolio. A rebalance needs drift and the configured Pyth movement guard, and can safely skip when no trade qualifies. Pyth feed age alone does not block settlement. Wall-clock timing depends on ER slots, the RPC and the active cranker.
          </p>
        </LedgerPanel>
      </div>

      <div className="mt-6">
        <MicroLabel>Target and actual allocation</MicroLabel>
        <div className="mt-3 space-y-3">
          <div>
            <MixBar segments={segmentsOf(targetEntries)} height={8} ariaLabel={`Target allocation: ${targetEntries.map((item) => `${assetSpec(item.assetId).symbol} ${item.pct.toFixed(0)}%`).join(', ')}`} />
            <p className="mt-1.5 text-[11px] text-iron">Target · {targetEntries.map((item) => `${item.pct.toFixed(0)} ${assetSpec(item.assetId).symbol}`).join(' / ')}</p>
          </div>
          <div>
            {valued ? <MixBar segments={segmentsOf(actualEntries)} ticks={targetTicks} ariaLabel={`Actual allocation: ${actualEntries.map((item) => `${assetSpec(item.assetId).symbol} ${item.pct.toFixed(1)}%`).join(', ')}`} /> : <Skeleton className="h-[10px] w-full border border-ink" />}
            <p className="mt-1.5 text-[11px] text-iron">{valued ? `Actual · ${actualEntries.map((item) => `${item.pct.toFixed(1)} ${assetSpec(item.assetId).symbol}`).join(' / ') || 'no holdings'}` : 'Actual · waiting for balances and recent display quotes'}{drift !== null ? ` · ${drift.toFixed(1)}% deviation` : ''}</p>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[440px] text-[12px]">
            <thead><tr className="text-left text-[10px] uppercase tracking-[0.08em] text-iron">
              <th scope="col" className="py-2 font-medium">Asset</th><th scope="col" className="py-2 text-right font-medium">Target</th><th scope="col" className="py-2 text-right font-medium">Vault balance</th><th scope="col" className="py-2 text-right font-medium">USD value</th><th scope="col" className="py-2 text-right font-medium">Actual</th>
            </tr></thead>
            <tbody>{vault.assets.map((id) => {
              const spec = assetSpec(id);
              const row = valued?.rows.find((item) => item.assetId === id);
              return <tr key={id} className="border-t border-hairline">
                <td className="py-2.5"><span className="flex items-center gap-2"><AssetSwatch color={spec.color} />{spec.symbol}</span></td>
                <td className="py-2.5 text-right font-bold">{(vault.targets[id] ?? 0).toFixed(2)}%</td>
                <td className="py-2.5 text-right font-mono">{bal ? fmtToken(bal.tokens[id] ?? 0, spec.decimals, 6) : '—'}</td>
                <td className="py-2.5 text-right font-bold">{row ? fmtUsd(row.usd) : '—'}</td>
                <td className="py-2.5 text-right font-bold">{row ? `${row.pct.toFixed(2)}%` : '—'}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      </div>

      <div className="mt-5">
        <LedgerPanel stripe="On-chain accounts" meta="standard SPL">
          <KeyValue rows={[
            { k: 'Vault State PDA', v: <AccountLink address={vault.publicKey} /> },
            { k: 'Share mint', v: vault.shareMint ? <AccountLink address={vault.shareMint} /> : 'Loading…' },
            { k: 'Your share balance', v: bal ? `${userShares.toFixed(4)} shares` : 'Loading…' },
          ]} />
          <p className="mt-3 text-[11px] leading-relaxed text-iron">
            Each vault asset is held in its own SPL token account controlled by the Vault Authority PDA. Shares are one transferable SPL token per vault; they represent a proportional claim on the assets.
          </p>
        </LedgerPanel>
      </div>

      {!closed ? <div className="mt-4 grid grid-cols-2 gap-2.5">
        <Button variant="secondary" onClick={() => setFundOpen(true)}>Deposit assets</Button>
        <Button variant="secondary" disabled={!bal || BigInt(bal.shareBalanceRaw) === 0n} onClick={() => setRedeemOpen(true)}>Redeem shares</Button>
        <Button variant="secondary" onClick={() => setWeightsOpen(true)}>Edit target weights</Button>
      </div> : null}

      <div className="mt-6">
        <LedgerPanel stripe="Execution log" meta={`${vaultLogs.length} entries`}>
          {vaultLogs.length === 0 ? <p className="text-[12px] text-iron">No Magic Action settlement has been observed yet.</p> : <ol>{vaultLogs.map((entry) => <li key={entry.id} className="border-b border-hairline py-3 last:border-b-0">
            <div className="flex items-start justify-between gap-3"><span className="flex items-center gap-2 text-[12px] font-bold leading-snug"><LogSwatch kind={entry.kind} />{entry.summary}</span><span className="shrink-0 pt-0.5 text-[10px] text-iron">{fmtTimeAgo(entry.at)}</span></div>
            {entry.detail ? <p className="mt-1 pl-[18px] text-[11px] leading-relaxed text-iron">{entry.detail}</p> : null}
            {entry.sig ? <p className="mt-1 pl-[18px]"><SignatureLink sig={entry.sig} slot={entry.slot} /></p> : null}
          </li>)}</ol>}
        </LedgerPanel>
      </div>

      <Divider className="mt-6" />
      <FundSheet vault={vault} open={fundOpen} onClose={() => setFundOpen(false)} />
      <RedeemSheet vault={vault} tokens={bal?.tokens ?? null} shareBalanceRaw={bal?.shareBalanceRaw ?? '0'} shareSupplyRaw={bal?.shareSupplyRaw ?? '0'} open={redeemOpen} onClose={() => setRedeemOpen(false)} />
      <EditWeightsSheet vault={vault} open={weightsOpen} onClose={() => setWeightsOpen(false)} />
    </Screen>
  );
}

function LegacyVault({ vault }: { vault: VaultConfig }) {
  return <Screen>
    <ScreenHeading micro="03 / Legacy portfolio" title={vault.name} sub="Old keypair custody · read-only in this version" />
    <Notice tone="brass" title="This address is not a Vault State PDA">
      This saved portfolio predates the on-chain Vault State and share mint. The current client will not reinterpret or sign its old address as a new vault. Its saved data remains in this browser; use the previous app version to manage or recover its assets before resetting this device.
    </Notice>
    <div className="mt-4"><LedgerPanel stripe="Saved legacy address" meta="old custody account"><p className="break-all font-mono text-[11px]">{vault.publicKey}</p></LedgerPanel></div>
  </Screen>;
}

function AccountLink({ address }: { address: string }) {
  return <a href={explorerAddress(address)} target="_blank" rel="noreferrer" className="font-mono text-[11px] font-bold text-petrol underline underline-offset-2">{shortKey(address)} ↗</a>;
}

function LogSwatch({ kind }: { kind: 'system' | 'check' | 'trade' | 'blocked' | 'owner' }) {
  const tones = { trade: 'petrol', owner: 'brass', blocked: 'danger', check: 'iron', system: 'ink' } as const;
  return <StatusSwatch tone={tones[kind]} pulse={kind === 'trade'} />;
}

function FundSheet({ vault, open, onClose }: { vault: VaultConfig; open: boolean; onClose: () => void }) {
  const walletBalances = useStore((s) => s.walletBalances);
  const fundVault = useStore((s) => s.fundVault);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const parsed: Record<string, number | null> = {};
  for (const id of vault.assets) parsed[id] = parseAmountOrZero(amounts[id] ?? '');
  const anyAmount = vault.assets.some((id) => (parsed[id] ?? 0) > 0);
  const solUnits = vault.assets.includes('wsol') ? (parsed.wsol ?? 0) : 0;
  const solOk = walletBalances !== null && solUnits + 0.01 <= walletBalances.solLamports / 1e9;
  const overAsset = walletBalances ? vault.assets.find((id) => id !== 'wsol' && parsed[id] !== null && rawFromToken(parsed[id] ?? 0, assetSpec(id).decimals) > (walletBalances.tokens[id] ?? 0)) : undefined;
  const allParsed = vault.assets.every((id) => parsed[id] !== null);
  const canSubmit = anyAmount && allParsed && walletBalances !== null && solOk && !overAsset;

  return <Sheet open={open} onClose={onClose} micro="Deposit · devnet" title="Deposit into portfolio" footer={<Button variant="primary" full loading={submitting} disabled={!canSubmit} onClick={async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const deposits = Object.fromEntries(vault.assets.map((id) => [id, rawFromToken(parsed[id] ?? 0, assetSpec(id).decimals)]));
      await fundVault(vault.id, { deposits });
      onClose();
    } finally { setSubmitting(false); }
  }}>Deposit and mint shares</Button>}>
    <p className="mb-4 text-[12px] leading-relaxed text-iron">Deposits mint transferable shares using on-chain NAV. Enter SOL for WSOL; it is wrapped in your wallet's WSOL account before the vault deposit. Token deposits must use assets already configured in this vault.</p>
    <div className="grid grid-cols-2 gap-3">{vault.assets.map((id) => {
      const spec = assetSpec(id);
      const over = overAsset === id ? `Exceeds your ${spec.symbol} balance.` : parsed[id] === null ? 'Not a valid amount.' : undefined;
      const hint = id === 'wsol' ? walletBalances ? `wraps SOL · ${fmtSol(walletBalances.solLamports)} SOL available` : 'Reading wallet SOL…' : walletBalances ? `${fmtToken(walletBalances.tokens[id] ?? 0, spec.decimals)} ${spec.symbol} available` : undefined;
      return <Field key={id} label={id === 'wsol' ? 'SOL to add · WSOL' : `${spec.symbol} to add`} hint={hint} error={over}>
        <input inputMode="decimal" value={amounts[id] ?? ''} onChange={(event) => setAmounts({ ...amounts, [id]: event.target.value })} className={inputClass} aria-label={`${spec.symbol} deposit amount`} placeholder="0.00" />
      </Field>;
    })}</div>
    {vault.assets.includes('wsol') ? <p className="mt-3 text-[10.5px] text-iron">Leave other fields at zero to deposit only SOL. About 0.01 SOL is kept available for network fees.</p> : null}
  </Sheet>;
}

function RedeemSheet({ vault, tokens, shareBalanceRaw, shareSupplyRaw, open, onClose }: { vault: VaultConfig; tokens: Record<AssetId, number> | null; shareBalanceRaw: string; shareSupplyRaw: string; open: boolean; onClose: () => void }) {
  const redeemVault = useStore((s) => s.withdrawVault);
  const [pct, setPct] = useState(100);
  const [submitting, setSubmitting] = useState(false);
  const userShares = BigInt(shareBalanceRaw);
  const supply = BigInt(shareSupplyRaw);
  const userFraction = supply > 0n ? Number(userShares) / Number(supply) : 0;
  const redeemFraction = pct / 100;

  return <Sheet open={open} onClose={onClose} micro="Redeem · in kind" title={pct === 100 ? 'Redeem all your shares' : 'Redeem part of your shares'} footer={<Button variant="primary" full loading={submitting} disabled={userShares === 0n} onClick={async () => {
    if (userShares === 0n) return;
    setSubmitting(true);
    try { await redeemVault(vault.id, redeemFraction); onClose(); } finally { setSubmitting(false); }
  }}>{pct === 100 ? 'Redeem all my shares' : `Redeem ${pct}% of my shares`}</Button>}>
    <p className="mb-4 text-[12px] leading-relaxed text-iron">Burns this wallet's transferable shares and returns its pro-rata claim in the vault's SPL assets. This is an in-kind redemption; it does not sell tokens.</p>
    <LedgerPanel stripe="Your share balance" meta={`${(Number(userShares) / 1e9).toFixed(4)} shares`} bodyClassName="pt-4">
      <input type="range" min={1} max={100} step={1} value={pct} onChange={(event) => setPct(Number(event.target.value))} className="ledger-range" aria-label="Percentage of shares to redeem" />
      <KeyValue rows={tokens ? vault.assets.map((id) => {
        const spec = assetSpec(id);
        const estimated = (tokens[id] ?? 0) * userFraction * redeemFraction;
        return { k: `${spec.symbol} estimated out`, v: fmtToken(estimated, spec.decimals, 6) };
      }) : [{ k: 'Vault assets', v: 'Reading balances…' }]} />
    </LedgerPanel>
    <div className="mt-4"><Notice tone="petrol" title="No vault swap on exit">Other holders keep their shares and pro-rata claim. The task is paused only if all outstanding shares are redeemed.</Notice></div>
  </Sheet>;
}

function EditWeightsSheet({ vault, open, onClose }: { vault: VaultConfig; open: boolean; onClose: () => void }) {
  const editWeights = useStore((s) => s.editWeights);
  const [shares, setShares] = useState<Record<AssetId, number>>(sharesFromTargets(vault.targets, vault.assets));
  const [locked, setLocked] = useState<WeightLocks>({});
  const [submitting, setSubmitting] = useState(false);
  const cooldownEndsAt = vault.lastWeightEditAt ? vault.lastWeightEditAt + 120_000 : 0;
  const cooling = cooldownEndsAt > Date.now();
  const nextTargets = normalizeShares(shares, vault.assets, locked);
  const nextTotal = Object.values(nextTargets).reduce((sum, pct) => sum + pct, 0);
  const totalOk = Math.abs(nextTotal - 100) <= 0.05;
  const changed = JSON.stringify(nextTargets) !== JSON.stringify(vault.targets);
  const nextLabel = Object.entries(nextTargets).filter(([, pct]) => pct > 0).map(([id, pct]) => `${pct.toFixed(0)} ${assetSpec(id as AssetId).symbol}`).join(' / ') || '—';

  return <Sheet open={open} onClose={onClose} micro="Edit weights · owner" title="Retarget the mix" footer={<Button variant="primary" full loading={submitting} disabled={cooling || !changed || !totalOk || Object.keys(nextTargets).length < 2} onClick={async () => {
    if (cooling || !changed) return;
    setSubmitting(true);
    try { await editWeights(vault.id, nextTargets as Record<string, number>); onClose(); } finally { setSubmitting(false); }
  }}>{cooling ? `App cooldown · ${fmtCountdown(cooldownEndsAt - Date.now())}` : 'Set new target on Solana'}</Button>}>
    <p className="mb-4 text-[12px] leading-relaxed text-iron">The target weights are configuration in Vault State; they are not token balances. The scheduled instruction reads the updated targets. This app applies a 120-second wait between owner edits.</p>
    <LedgerPanel stripe="New target" meta={nextLabel} bodyClassName="pt-3">
      {vault.assets.filter((id) => (nextTargets[id] ?? 0) > 0).length >= 2 ? (
        <MixBar
          className="mb-4"
          segments={segmentsOf(vault.assets.filter((id) => (nextTargets[id] ?? 0) > 0).map((assetId) => ({ assetId, pct: nextTargets[assetId] ?? 0 })))}
          height={20}
          interactive
          lockedKeys={Object.keys(locked)}
          onChange={(segments) => setShares((previous) => {
            const next = { ...previous };
            for (const segment of segments) {
              const id = segment.key as AssetId;
              if (locked[id] !== undefined) continue; // pinned weights are not draggable
              next[id] = Math.round(segment.pct);
            }
            return next;
          })}
          ariaLabel="Drag allocation handles to change target percentages"
        />
      ) : null}
      <WeightSliders shares={shares} onChange={setShares} assetIds={vault.assets} ariaLabel="New target weights" locked={locked} onLockedChange={setLocked} />
    </LedgerPanel>
    <p className="mt-3 text-[11px] leading-relaxed text-iron">The asset set stays fixed. Lock a weight to hold it in place while you move the others; unlocking restores it exactly. Set an asset's weight to zero to remove it from the target mix; its SPL account remains part of the vault.</p>
  </Sheet>;
}
