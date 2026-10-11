import { useEffect, useState } from 'react';
import { useStore, vaultTargetList, type VaultConfig } from '../lib/store';
import { runCrank } from '../lib/automation';
import { computeAssetRows, maxDriftPct } from '../lib/solana/vault';
import { bookStatus, pricesFromBook, priceOf } from '../lib/solana/price';
import { PRICE_MAX_AGE_MS } from '../lib/solana/config';
import { assetList, assetSpec, type AssetId } from '../lib/solana/assets';
import { explorerAddress } from '../lib/solana/connection';
import {
  fmtCountdown,
  fmtSol,
  fmtToken,
  fmtTokenFull,
  fmtTimeAgo,
  fmtUsd,
  lamportsFromSol,
  parseAmountOrZero,
  rawFromToken,
  shortKey,
} from '../lib/format';
import { useNow } from '../hooks/useNow';
import { Screen, ScreenHeading } from '../components/ui/Screen';
import { Button } from '../components/ui/Button';
import { LedgerPanel } from '../components/ui/LedgerPanel';
import { MixBar, segmentsOf } from '../components/ui/MixBar';
import { Sheet } from '../components/ui/Sheet';
import { Field, inputClass } from '../components/ui/Field';
import { AssetSwatch, Divider, KeyValue, MicroLabel, Notice, SignatureLink, Skeleton, StatusSwatch } from '../components/ui/primitives';
import { WeightSliders, normalizeShares, sharesFromTargets } from '../components/ui/WeightSliders';
import { BlockedNotice, VaultStatusLine } from './PortfolioList';

/** 03 / Portfolio N — automation state, target vs actual, actions, evidence. */
export function VaultDetail({ vaultId }: { vaultId: string }) {
  useNow(1000);

  const vaultIndex = useStore((s) => s.vaults.findIndex((v) => v.id === vaultId));
  const vault = useStore((s) => s.vaults.find((v) => v.id === vaultId) ?? null);
  const bal = useStore((s) => s.vaultBalances[vaultId] ?? null);
  const price = useStore((s) => s.price);
  const logs = useStore((s) => s.logs);
  const pauseVault = useStore((s) => s.pauseVault);
  const resumeVault = useStore((s) => s.resumeVault);

  const [fundOpen, setFundOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [weightsOpen, setWeightsOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);

  useEffect(() => {
    void useStore.getState().refreshVaultBalances(vaultId);
  }, [vaultId]);

  if (!vault) {
    return (
      <Screen>
        <ScreenHeading micro="03 / Portfolio" title="Vault not found." />
      </Screen>
    );
  }

  const priceOk =
    price !== null &&
    bookStatus(price, PRICE_MAX_AGE_MS) === 'fresh' &&
    vault.assets.every((id) => priceOf(price, id) !== null);
  const prices = priceOk && price ? pricesFromBook(price) : null;
  const valued = bal && prices ? computeAssetRows(bal.tokens, prices, vault.assets) : null;
  const drift = valued ? maxDriftPct(valued.rows, vault.targets) : null;
  const closed = vault.status === 'closed';
  const paused = vault.status === 'paused';
  const number = String(vaultIndex >= 0 ? vaultIndex + 1 : 0).padStart(2, '0');
  const vaultLogs = logs.filter((l) => l.vaultId === vaultId).slice(0, 12);

  const targetEntries = vaultTargetList(vault);
  const targetTicks: number[] = [];
  {
    let acc = 0;
    for (const t of targetEntries.slice(0, -1)) {
      acc += t.pct;
      targetTicks.push(acc);
    }
  }
  const actualEntries = valued ? valued.rows.filter((r) => r.pct > 0.05) : [];
  const assetLabel = vault.assets.map((id) => assetSpec(id).symbol).join(' + ');

  return (
    <Screen>
      <ScreenHeading
        micro={`03 / Portfolio ${number}`}
        title={vault.name}
        sub={
          <>
            {assetLabel} · Solana devnet.
            <br />
            Separate custody, schedule and budget.
          </>
        }
      />

      {!closed ? (
        <LedgerPanel stripe="Automation" meta={paused ? 'Paused' : vault.blockedReason ? 'Blocked' : 'Active'}>
          <div className="flex items-center gap-2 text-[12.5px] font-bold">
            <VaultStatusLine vault={vault} />
          </div>
          <KeyValue
            rows={[
              { k: 'Last check', v: fmtTimeAgo(vault.lastCheckAt) },
              vault.lastTradeAt
                ? {
                    k: 'Last actual trade',
                    v: (
                      <span className="inline-flex flex-wrap items-center justify-end gap-2">
                        {fmtTimeAgo(vault.lastTradeAt)}
                        {vault.lastTradeSig ? <SignatureLink sig={vault.lastTradeSig} slot={vault.lastTradeSlot ?? undefined} /> : null}
                      </span>
                    ),
                  }
                : { k: 'Last actual trade', v: 'none yet' },
              {
                k: 'Next check',
                v: paused || vault.nextCheckAt === null ? '—' : `in ${fmtCountdown(vault.nextCheckAt - Date.now())}`,
              },
              { k: 'Automated trades', v: String(vault.tradeCount) },
            ]}
          />
          {vault.blockedReason ? (
            <div className="mt-3">
              <BlockedNotice reason={vault.blockedReason} />
            </div>
          ) : null}
          {!paused ? (
            <div className="mt-4">
              <Button variant="secondary" full onClick={() => runCrank(vaultId)}>
                Run check now
              </Button>
            </div>
          ) : (
            <div className="mt-4">
              <Button variant="secondary" full onClick={() => resumeVault(vaultId)}>
                Resume automation
              </Button>
            </div>
          )}
        </LedgerPanel>
      ) : (
        <LedgerPanel stripe="Automation" meta="Closed">
          <p className="text-[12px] leading-relaxed text-iron">
            Automation stopped. Assets were returned in kind; the vault keypair holds no
            instructions anymore.
          </p>
        </LedgerPanel>
      )}

      <div className="mt-6">
        <MicroLabel>Target and actual</MicroLabel>
        <div className="mt-3 space-y-3">
          <div>
            <MixBar
              segments={segmentsOf(targetEntries)}
              height={8}
              ariaLabel={`Target: ${targetEntries.map((t) => `${assetSpec(t.assetId).symbol} ${t.pct.toFixed(0)}%`).join(', ')}`}
            />
            <p className="mt-1.5 text-[11px] text-iron">
              Target · {targetEntries.map((t) => `${t.pct.toFixed(0)} ${assetSpec(t.assetId).symbol}`).join(' / ')}
            </p>
          </div>
          <div>
            {valued ? (
              <MixBar
                segments={segmentsOf(actualEntries)}
                ticks={targetTicks}
                ariaLabel={`Actual: ${actualEntries.map((r) => `${assetSpec(r.assetId).symbol} ${r.pct.toFixed(1)}%`).join(', ')}`}
              />
            ) : (
              <Skeleton className="h-[10px] w-full border border-ink" />
            )}
            <p className="mt-1.5 text-[11px] text-iron">
              {valued
                ? `Actual · ${actualEntries.map((r) => `${r.pct.toFixed(1)} ${assetSpec(r.assetId).symbol}`).join(' / ')}`
                : 'Actual · weights loading'}
              {drift !== null ? ` · ${drift.toFixed(1)}% deviation` : ''}
            </p>
          </div>
        </div>

        <table className="mt-4 w-full text-[12px]">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-[0.08em] text-iron">
              <th scope="col" className="py-2 font-medium">Asset</th>
              <th scope="col" className="py-2 text-right font-medium">Target</th>
              <th scope="col" className="py-2 text-right font-medium">Actual</th>
            </tr>
          </thead>
          <tbody>
            {vault.assets.map((id) => {
              const spec = assetSpec(id);
              const row = valued?.rows.find((r) => r.assetId === id);
              return (
                <tr key={id} className="border-t border-hairline">
                  <td className="py-2.5">
                    <span className="flex items-center gap-2">
                      <AssetSwatch color={spec.color} /> {spec.symbol}
                    </span>
                  </td>
                  <td className="py-2.5 text-right font-bold">{(vault.targets[id] ?? 0).toFixed(2)}%</td>
                  <td className="py-2.5 text-right font-bold">{row ? `${row.pct.toFixed(2)}%` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-6">
        <LedgerPanel
          stripe="Holdings"
          meta={
            priceOk && price
              ? vault.assets
                  .map((id) => `${assetSpec(id).symbol} ${fmtUsd(priceOf(price, id) ?? 0)}`)
                  .slice(0, 2)
                  .join(' · ') + (vault.assets.length > 2 ? ' …' : '')
              : 'price unavailable'
          }
        >
          {bal ? (
            <KeyValue
              rows={[
                ...assetList()
                  .filter((spec) => (bal.tokens[spec.id] ?? 0) > 0)
                  .map((spec) => ({
                    k: (
                      <span className="flex items-center gap-2">
                        <AssetSwatch color={spec.color} /> {spec.symbol}
                      </span>
                    ),
                    v:
                      vault.blockedReason === 'price'
                        ? fmtTokenFull(bal.tokens[spec.id] ?? 0, spec.decimals)
                        : fmtToken(bal.tokens[spec.id] ?? 0, spec.decimals, 6),
                  })),
                { k: 'Live USD value', v: valued ? fmtUsd(valued.totalUsd) : 'Unavailable' },
                { k: 'Live weight deviation', v: drift !== null ? `${drift.toFixed(2)}%` : 'Unavailable' },
              ]}
            />
          ) : (
            <div className="space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          )}
        </LedgerPanel>
      </div>

      {!closed ? (
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <Button variant="secondary" onClick={() => setFundOpen(true)}>
            Add funds
          </Button>
          <Button variant="secondary" onClick={() => setWithdrawOpen(true)}>
            Withdraw
          </Button>
          <Button variant="secondary" onClick={() => setWeightsOpen(true)}>
            Edit weights
          </Button>
          <Button variant="secondary" onClick={() => (paused ? resumeVault(vaultId) : pauseVault(vaultId))}>
            {paused ? 'Resume' : 'Pause'}
          </Button>
        </div>
      ) : null}

      <div className="mt-6">
        <LedgerPanel stripe="Automation budget" meta={bal ? `${fmtSol(bal.solLamports, 4)} SOL` : '…'}>
          <KeyValue
            rows={[
              { k: 'Remaining SOL', v: bal ? `${fmtSol(bal.solLamports, 6)} SOL` : '…' },
              { k: 'Curve-fee margin', v: '0.30% base · capped 3.00%' },
              { k: 'Reserve spread', v: '0.30%' },
              { k: 'Counterparty', v: 'Funded devnet reserve' },
            ]}
          />
          <p className="mt-3 text-[11px] leading-relaxed text-iron">
            Network execution costs are separate from token fees. Reserve inventory is shared and
            finite; below 0.002 SOL the vault halts trades instead of trapping assets.
          </p>
        </LedgerPanel>
      </div>

      <div className="mt-4">
        <LedgerPanel stripe="Sovereignty" meta="1 owner / 1 vault">
          <KeyValue
            rows={[
              {
                k: 'Owner authority',
                v: (
                  <a
                    href={explorerAddress(useStore.getState().wallet?.publicKey ?? '')}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[11px] font-bold text-petrol underline underline-offset-2"
                  >
                    {shortKey(useStore.getState().wallet?.publicKey ?? '—')}
                  </a>
                ),
              },
              {
                k: 'Custody keypair',
                v: (
                  <a
                    href={explorerAddress(vault.publicKey)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[11px] font-bold text-petrol underline underline-offset-2"
                  >
                    {shortKey(vault.publicKey)}
                  </a>
                ),
              },
              { k: 'Automation authority', v: 'Vault keypair · in-app scheduler' },
              { k: 'LP mint', v: 'Disabled — no pooled capital' },
            ]}
          />
        </LedgerPanel>
      </div>

      <div className="mt-6">
        <LedgerPanel stripe="Execution log" meta={`${vaultLogs.length} entries`}>
          {vaultLogs.length === 0 ? (
            <p className="text-[12px] text-iron">No automation evidence yet. The first check lands on the cadence.</p>
          ) : (
            <ol>
              {vaultLogs.map((l) => (
                <li key={l.id} className="border-b border-hairline py-3 last:border-b-0">
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex items-center gap-2 text-[12px] font-bold leading-snug">
                      <LogSwatch kind={l.kind} />
                      {l.summary}
                    </span>
                    <span className="shrink-0 pt-0.5 text-[10px] text-iron">{fmtTimeAgo(l.at)}</span>
                  </div>
                  {l.detail ? <p className="mt-1 pl-[18px] text-[11px] leading-relaxed text-iron">{l.detail}</p> : null}
                  {l.sig ? (
                    <p className="mt-1 pl-[18px]">
                      <SignatureLink sig={l.sig} slot={l.slot} />
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </LedgerPanel>
      </div>

      <Divider className="mt-6" />
      <div className="mt-4">
        {closed ? (
          bal && (assetList().some((s) => (bal.tokens[s.id] ?? 0) > 0) || bal.solLamports > 0) ? (
            <Button variant="danger" full onClick={() => setCloseOpen(true)}>
              Recover rent & close accounts
            </Button>
          ) : (
            <p className="text-center text-[11px] text-iron">Vault closed · accounts settled.</p>
          )
        ) : (
          <Button variant="danger" full onClick={() => setCloseOpen(true)}>
            Close vault
          </Button>
        )}
      </div>

      <FundSheet vault={vault} open={fundOpen} onClose={() => setFundOpen(false)} />
      <WithdrawSheet
        vaultId={vaultId}
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        tokens={bal?.tokens ?? null}
      />
      <EditWeightsSheet vault={vault} open={weightsOpen} onClose={() => setWeightsOpen(false)} />
      <CloseSheet vaultId={vaultId} open={closeOpen} onClose={() => setCloseOpen(false)} />
    </Screen>
  );
}

function LogSwatch({ kind }: { kind: 'system' | 'check' | 'trade' | 'blocked' | 'owner' }) {
  const tones = { trade: 'petrol', owner: 'brass', blocked: 'danger', check: 'iron', system: 'ink' } as const;
  return <StatusSwatch tone={tones[kind]} pulse={kind === 'trade'} />;
}

/* ---------------- sheets ---------------- */

function FundSheet({ vault, open, onClose }: { vault: VaultConfig; open: boolean; onClose: () => void }) {
  useNow(1000);
  const walletBalances = useStore((s) => s.walletBalances);
  const fundVault = useStore((s) => s.fundVault);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [budget, setBudget] = useState('0.01');
  const [submitting, setSubmitting] = useState(false);

  const budgetSol = parseAmountOrZero(budget);
  const parsed: Record<string, number | null> = {};
  for (const id of vault.assets) {
    parsed[id] = parseAmountOrZero(amounts[id] ?? '');
  }
  const anyAmount = vault.assets.some((id) => (parsed[id] ?? 0) > 0) || (budgetSol ?? 0) > 0;
  const wsolUnits = vault.assets.includes('wsol') ? (parsed.wsol ?? 0) : 0;
  const solOk =
    walletBalances === null ||
    (budgetSol !== null && lamportsFromSol(budgetSol + wsolUnits + 0.01) <= walletBalances.solLamports);
  const overAsset = walletBalances
    ? vault.assets.find(
        (id) => id !== 'wsol' && parsed[id] !== null && parsed[id] !== undefined && rawFromToken(parsed[id] ?? 0, assetSpec(id).decimals) > (walletBalances.tokens[id] ?? 0),
      )
    : undefined;
  const allParsed = vault.assets.every((id) => parsed[id] !== null);
  const canSubmit = anyAmount && solOk && !overAsset && allParsed && budgetSol !== null;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      micro="Add funds · devnet"
      title="Add funds"
      footer={
        <Button
          variant="primary"
          full
          loading={submitting}
          disabled={!canSubmit}
          onClick={async () => {
            if (!canSubmit || budgetSol === null) return;
            setSubmitting(true);
            try {
              const deposits: Record<string, number> = {};
              for (const id of vault.assets) {
                deposits[id] = rawFromToken(parsed[id] ?? 0, assetSpec(id).decimals);
              }
              await fundVault(vault.id, {
                budgetLamports: lamportsFromSol(budgetSol),
                deposits,
              });
              onClose();
            } finally {
              setSubmitting(false);
            }
          }}
        >
          Fund this vault
        </Button>
      }
    >
      <p className="mb-4 text-[12px] leading-relaxed text-iron">
        Proportional funding adds to the current custody mix. It does not reset trade allowances.
        Deposits are limited to the vault's asset set: {vault.assets.map((id) => assetSpec(id).symbol).join(', ')}.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {vault.assets.map((id) => {
          const spec = assetSpec(id);
          const over =
            overAsset === id
              ? `Exceeds your ${spec.symbol} balance.`
              : parsed[id] === null
                ? 'Not a valid amount.'
                : undefined;
          const hint =
            id === 'wsol'
              ? walletBalances
                ? `wraps SOL · you hold ${fmtSol(walletBalances.solLamports)}`
                : 'wraps SOL from your wallet'
              : walletBalances
                ? `you hold ${fmtToken(walletBalances.tokens[id] ?? 0, spec.decimals)} ${spec.symbol}`
                : undefined;
          return (
            <Field key={id} label={spec.symbol} hint={hint} error={over}>
              <input
                inputMode="decimal"
                value={amounts[id] ?? ''}
                onChange={(e) => setAmounts({ ...amounts, [id]: e.target.value })}
                className={inputClass}
                aria-label={`${spec.symbol} to add`}
                placeholder="0.00"
              />
            </Field>
          );
        })}
      </div>
      <Field
        label="Top up automation budget"
        hint="Optional SOL for the vault keypair's fees."
        error={!solOk ? 'Budget + WSOL exceed your SOL.' : undefined}
      >
        <input inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} className={inputClass} aria-label="Budget top-up in SOL" />
      </Field>
    </Sheet>
  );
}

function WithdrawSheet({
  vaultId,
  open,
  onClose,
  tokens,
}: {
  vaultId: string;
  open: boolean;
  onClose: () => void;
  tokens: Record<AssetId, number> | null;
}) {
  useNow(1000);
  const withdrawVault = useStore((s) => s.withdrawVault);
  const [pct, setPct] = useState(100);
  const [submitting, setSubmitting] = useState(false);
  const fraction = pct / 100;
  const full = pct >= 100;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      micro="Withdraw · in kind"
      title={full ? 'Withdraw in kind' : 'Partial withdrawal'}
      footer={
        <Button
          variant="primary"
          full
          loading={submitting}
          onClick={async () => {
            setSubmitting(true);
            try {
              await withdrawVault(vaultId, fraction);
              onClose();
            } finally {
              setSubmitting(false);
            }
          }}
        >
          {full ? 'Withdraw everything in kind' : `Withdraw ${pct}% of each token`}
        </Button>
      }
    >
      <p className="mb-4 text-[12px] leading-relaxed text-iron">
        Returns a proportion of each token to your owner wallet. A full exit returns every base
        unit and disables automation atomically.
      </p>
      <LedgerPanel stripe="Fraction" meta={`${pct}%`} bodyClassName="pt-4">
        <input
          type="range"
          min={1}
          max={100}
          step={1}
          value={pct}
          onChange={(e) => setPct(Number(e.target.value))}
          className="ledger-range"
          aria-label="Withdrawal percentage"
        />
        <KeyValue
          rows={
            tokens
              ? assetList()
                  .filter((spec) => (tokens[spec.id] ?? 0) > 0)
                  .map((spec) => ({
                    k: `${spec.symbol} out`,
                    v: fmtToken(Math.floor((tokens[spec.id] ?? 0) * fraction), spec.decimals, 6),
                  }))
              : [{ k: 'Holdings', v: 'reading…' }]
          }
        />
      </LedgerPanel>
      <div className="mt-4">
        <Notice tone="petrol" title="In kind">
          The vault sells nothing on the way out. Every token stays itself; the reserve is not
          involved.
        </Notice>
      </div>
    </Sheet>
  );
}

function EditWeightsSheet({ vault, open, onClose }: { vault: VaultConfig; open: boolean; onClose: () => void }) {
  useNow(1000);
  const editWeights = useStore((s) => s.editWeights);
  const [shares, setShares] = useState<Record<AssetId, number>>(sharesFromTargets(vault.targets));
  const [submitting, setSubmitting] = useState(false);

  const cooldownEndsAt = vault.lastWeightEditAt ? vault.lastWeightEditAt + 120_000 : 0;
  const cooling = cooldownEndsAt > Date.now();
  const nextTargets = normalizeShares(shares);
  const changed = JSON.stringify(nextTargets) !== JSON.stringify(vault.targets);
  const nextLabel =
    Object.entries(nextTargets)
      .filter(([, pct]) => pct > 0)
      .map(([id, pct]) => `${pct.toFixed(0)} ${assetSpec(id as AssetId).symbol}`)
      .join(' / ') || '—';

  return (
    <Sheet
      open={open}
      onClose={onClose}
      micro="Edit weights · owner"
      title="Retarget the mix"
      footer={
        <Button
          variant="primary"
          full
          loading={submitting}
          disabled={cooling || !changed || Object.keys(nextTargets).length < 2}
          onClick={async () => {
            if (cooling || !changed) return;
            setSubmitting(true);
            try {
              await editWeights(vault.id, nextTargets as Record<string, number>);
              onClose();
            } finally {
              setSubmitting(false);
            }
          }}
        >
          {cooling ? `Cooldown · ${fmtCountdown(cooldownEndsAt - Date.now())}` : 'Set new target'}
        </Button>
      }
    >
      <p className="mb-4 text-[12px] leading-relaxed text-iron">
        A weight-only edit keeps the schedule and the budget. The next check trades toward the new
        target; a 120-second cooldown applies between edits.
      </p>
      <LedgerPanel stripe="New target" meta={nextLabel} bodyClassName="pt-3">
        <WeightSliders shares={shares} onChange={setShares} ariaLabel="New target weights" />
      </LedgerPanel>
      <p className="mt-3 text-[11px] leading-relaxed text-iron">
        The vault's token accounts cover the full asset set, so re-adding an asset you removed
        earlier works without another setup transaction.
      </p>
    </Sheet>
  );
}

function CloseSheet({ vaultId, open, onClose }: { vaultId: string; open: boolean; onClose: () => void }) {
  const closeVault = useStore((s) => s.closeVault);
  const [submitting, setSubmitting] = useState(false);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      micro="Close · devnet"
      title="Close this vault"
      footer={
        <Button
          variant="danger"
          full
          loading={submitting}
          onClick={async () => {
            setSubmitting(true);
            try {
              await closeVault(vaultId);
              onClose();
            } finally {
              setSubmitting(false);
            }
          }}
        >
          Close vault
        </Button>
      }
    >
      <p className="mb-3 text-[12px] leading-relaxed text-iron">
        Assets return first. Then automation stops, the vault's token accounts close and rent plus
        the remaining budget sweep back to your wallet.
      </p>
      <Notice tone="danger" title="Sequence">
        Return assets → stop stale work → reconcile rent/budget refunds. Cleanup can remain
        pending without holding the tokens.
      </Notice>
    </Sheet>
  );
}
