import { useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { CADENCE_OPTIONS_SEC, PRICE_MAX_AGE_MS } from '../lib/solana/config';
import { assetList, isAssetId, type AssetId, type AssetSpec } from '../lib/solana/assets';
import { bookStatus, priceOf } from '../lib/solana/price';
import { fmtSol, fmtUsd, lamportsFromSol, parseAmountOrZero } from '../lib/format';
import { Screen, ScreenHeading } from '../components/ui/Screen';
import { Button } from '../components/ui/Button';
import { LedgerPanel } from '../components/ui/LedgerPanel';
import { Sheet } from '../components/ui/Sheet';
import { Field, inputClass, selectClass } from '../components/ui/Field';
import { KeyValue, MicroLabel, Notice } from '../components/ui/primitives';
import { WeightSliders, normalizeShares, type WeightLocks } from '../components/ui/WeightSliders';
import { MixBar, segmentsOf } from '../components/ui/MixBar';
import { AssetPickerSheet } from '../components/ui/AssetPickerSheet';

const cadenceLabels: Record<number, string> = {
  60: 'About every 60 seconds · 5,700 ER slots',
  120: 'About every 2 minutes · 11,400 ER slots',
  300: 'About every 5 minutes · 28,500 ER slots',
  600: 'About every 10 minutes · 57,000 ER slots',
  1800: 'About every 30 minutes · 171,000 ER slots',
  3600: 'About every hour · 342,000 ER slots',
};

/** SOL deposited into the separate Executor PDA for scheduling and Magic Actions. */
const TASK_SPONSOR_SOL = 0.05;
const SETUP_FEE_SOL = 0.02;

const defaultShares: Record<AssetId, number> = { wsol: 60, dusd: 40, tbtc: 0, teth: 0 };
/** 02 / Create a portfolio — assets, weights, SOL investment, cadence and review. */
export function CreateVault() {
  const walletBalances = useStore((s) => s.walletBalances);
  const price = useStore((s) => s.price);
  const createVault = useStore((s) => s.createVault);
  const pushScreen = useStore((s) => s.pushScreen);
  const toast = useStore((s) => s.toast);

  const [name, setName] = useState('Everyday mix');
  const [shares, setShares] = useState<Record<AssetId, number>>(defaultShares);
  const [locked, setLocked] = useState<WeightLocks>({});
  const [investmentSol, setInvestmentSol] = useState('0.20');
  const [cadenceSec, setCadenceSec] = useState<number>(CADENCE_OPTIONS_SEC[0]);
  const [threshold, setThreshold] = useState(2);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const solAvail = walletBalances ? walletBalances.solLamports : null;
  const targets = normalizeShares(shares, undefined, locked);
  const selected = assetList().filter((s) => (targets[s.id] ?? 0) > 0);
  const selectedIds = selected.map((s) => s.id);
  const targetLabel = selected.map((s) => `${(targets[s.id] ?? 0).toFixed(0)} ${s.symbol}`).join(' · ');

  const investmentSolUnits = parseAmountOrZero(investmentSol);
  const priceOk = bookStatus(price, PRICE_MAX_AGE_MS) === 'fresh' && price !== null;
  const solUsd = priceOk ? priceOf(price, 'wsol') : null;
  const estimatedTotalUsd = investmentSolUnits !== null && solUsd !== null ? investmentSolUnits * solUsd : null;

  const errors = useMemo(() => {
    const errs: string[] = [];
    if (!name.trim()) errs.push('Portfolio name is required.');
    if (selected.length < 2) errs.push('Pick at least two assets for the mix.');
    const targetTotal = selected.reduce((sum, s) => sum + (targets[s.id] ?? 0), 0);
    if (Math.abs(targetTotal - 100) > 0.05) {
      errs.push(`Unlocked weights must cover the remaining ${(100 - targetTotal).toFixed(0)}% of the mix.`);
    }
    if (investmentSolUnits === null) errs.push('Enter a valid SOL investment amount.');
    else if (lamportsFromSol(investmentSolUnits) <= 0) errs.push('Invest at least 0.000000001 SOL.');
    if (solAvail === null) errs.push('Waiting for your wallet SOL balance.');
    if (solAvail !== null && investmentSolUnits !== null) {
      const need = TASK_SPONSOR_SOL + investmentSolUnits + SETUP_FEE_SOL;
      if (lamportsFromSol(need) > solAvail) {
        errs.push(
          `Wallet needs about ${need.toFixed(2)} SOL (investment + task sponsor + setup fees). Available: ${fmtSol(solAvail)} SOL.`,
        );
      }
    }
    return errs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, shares, locked, investmentSol, solAvail]);

  async function onConfirm() {
    if (submitting || errors.length > 0) return;
    setSubmitting(true);
    try {
      const solDepositLamports = lamportsFromSol(investmentSolUnits ?? 0);
      const assets = assetList()
        .filter((spec) => selectedIds.includes(spec.id) || (spec.id === 'wsol' && solDepositLamports > 0))
        .map((spec) => spec.id);
      const assetTargets = Object.fromEntries(assets.map((id) => [id, targets[id] ?? 0]));
      const id = await createVault({
        name: name.trim(),
        assets,
        targets: assetTargets,
        thresholdPct: threshold,
        cadenceSec,
        deposits: { wsol: solDepositLamports },
      });
      if (id) {
        setReviewOpen(false);
        pushScreen({ id: 'vault', vaultId: id });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      <ScreenHeading
        micro="02 / Create a portfolio"
        title="Set the balance."
        sub="Pick the assets and their weights, then invest from your SOL balance. The vault starts with wrapped SOL and rebalances toward your mix on schedule."
      />

      <Field label="Portfolio name" error={name.trim() === '' ? 'Portfolio name is required.' : undefined}>
        <input
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
          placeholder="Everyday mix"
        />
      </Field>

      <LedgerPanel
        stripe="Target mix"
        meta={selected.length >= 2 ? selected.map((s) => (targets[s.id] ?? 0).toFixed(0)).join(' / ') : '—'}
        bodyClassName="pt-3"
      >
        {selected.length >= 2 ? (
          <MixBar
            className="mb-4"
            segments={segmentsOf(selected.map((s) => ({ assetId: s.id, pct: targets[s.id] ?? 0 })))}
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
        <WeightSliders shares={shares} onChange={setShares} locked={locked} onLockedChange={setLocked} />
      </LedgerPanel>

      <div className="mt-3">
        <Button variant="secondary" full onClick={() => setPickerOpen(true)}>Add an executable asset</Button>
      </div>

      <div className="mt-4">
        <Notice tone="brass">
          dUSD is synthetic, program-issued Devnet USD. It uses a fixed $1 demo accounting price,
          has capped test supply and is not redeemable for real dollars. Test BTC and Test ETH are
          also devnet assets.
        </Notice>
      </div>

      <div className="mt-4">
        <Field
          label="Invest from wallet · SOL"
          hint={solAvail !== null ? `Available: ${fmtSol(solAvail)} SOL` : 'Checking your wallet SOL balance…'}
          error={
            investmentSolUnits === null
              ? 'Enter a valid SOL amount.'
              : lamportsFromSol(investmentSolUnits) <= 0
                ? 'Minimum investment is 0.000000001 SOL.'
                : undefined
          }
        >
          <input
            inputMode="decimal"
            value={investmentSol}
            onChange={(e) => setInvestmentSol(e.target.value)}
            className={inputClass}
            aria-label="SOL to invest"
            placeholder="0.00"
          />
        </Field>
        <div className="mt-3">
          <InvestmentEstimate assets={selected} targets={targets} totalUsd={estimatedTotalUsd} />
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-iron">
          SOL is wrapped into WSOL first. If WSOL is not in your target mix, it starts at 0% and a scheduled trade may move it toward your selected assets when the MagicBlock task runs.
        </p>
      </div>

      <div className="mt-4">
        <Field label="Minimum rebalance delay" hint="You configure this on Solana; the cranker pays trigger fees.">
          <select
            value={cadenceSec}
            onChange={(e) => setCadenceSec(Number(e.target.value))}
            className={selectClass}
          >
            {CADENCE_OPTIONS_SEC.map((sec) => (
              <option key={sec} value={sec}>
                {cadenceLabels[sec] ?? `Every ${sec} seconds`}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="mt-4">
        <LedgerPanel stripe="Deviation threshold" meta={`± ${threshold.toFixed(1)}%`} bodyClassName="pt-4">
          <input
            type="range"
            min={0.5}
            max={10}
            step={0.5}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="ledger-range"
            aria-label="Deviation threshold percentage"
          />
          <p className="text-[11px] leading-relaxed text-iron">
            Automation trades only when any asset drifts more than{' '}
            <strong>{threshold.toFixed(1)}%</strong> from its target. Below that, it just checks.
          </p>
        </LedgerPanel>
      </div>

      <div className="mt-5">
        <Button
          variant="primary"
          full
          disabled={errors.length > 0}
          onClick={() => {
            if (errors.length > 0) {
              toast('error', 'Fix the form first', errors[0]);
              return;
            }
            setReviewOpen(true);
          }}
        >
          Preview setup review
        </Button>
        {errors.length > 0 ? (
          <ul className="mt-3 space-y-1">
            {errors.map((e) => (
              <li key={e} className="text-[11px] font-bold leading-relaxed text-danger">
                · {e}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="mt-3 text-[11px] leading-relaxed text-iron">
          Setup creates on-chain vault accounts and a share mint, then registers one Hydra task.
          The selected delay is enforced on Solana; wall-clock cadence depends on ER slots and an active cranker.
          Weight-only edits are on Solana; a 120-second cooldown applies.
        </p>
      </div>

      <Sheet
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        micro="Setup review · devnet"
        title="Review before signing"
        footer={
          <Button variant="primary" full loading={submitting} disabled={errors.length > 0} onClick={onConfirm}>
            Create on devnet
          </Button>
        }
      >
        <KeyValue
          rows={[
            { k: 'Portfolio', v: name.trim() || '—' },
            { k: 'Target mix', v: targetLabel || '—' },
            { k: 'SOL investment', v: `${(investmentSolUnits ?? 0).toString()} SOL → WSOL` },
            { k: 'Wallet SOL balance', v: solAvail !== null ? `${fmtSol(solAvail)} SOL` : 'Loading' },
            {
              k: 'Estimated vault value',
              v: estimatedTotalUsd !== null ? fmtUsd(estimatedTotalUsd) : 'Unavailable · waiting for a fresh SOL/USD price',
            },
            { k: 'Executor funding', v: '0.05 SOL from setup · program controlled' },
            { k: 'Minimum delay', v: `${cadenceSec} seconds · about ${Math.ceil(cadenceSec * 5_700 / 60).toLocaleString()} ER slots` },
            { k: 'Deviation threshold', v: `± ${threshold.toFixed(1)}%` },
          ]}
        />
        <div className="mt-4">
          <MicroLabel>What setup does</MicroLabel>
          <ul className="mt-2 space-y-1.5 text-[11.5px] leading-relaxed text-iron">
            <li>· Creates a Vault State PDA, Vault Authority PDA and transferable share-token mint.</li>
            <li>· Creates standard SPL token accounts for {selected.length} target assets{selectedIds.includes('wsol') ? '' : ' plus zero-target WSOL for SOL funding'}.</li>
            <li>· Wraps your SOL in your wallet's WSOL account, deposits it, then mints shares using on-chain NAV.</li>
            <li>· Delegates only the Executor PDA. Vault State and asset token accounts stay on Solana.</li>
            <li>· Requests one Hydra task at the selected delay; execution depends on an active cranker, fresh prices, and more than 0.1% movement in a Pyth-backed asset.</li>
          </ul>
        </div>
        <div className="mt-4">
          <InvestmentEstimate assets={selected} targets={targets} totalUsd={estimatedTotalUsd} />
        </div>
        <div className="mt-4">
          <Notice tone="petrol" title="How the investment is executed">
            This is an allocation estimate, not an instant swap quote. The scheduled ER instruction can request a Solana vault action toward {targetLabel} when drift passes {threshold.toFixed(1)}% and an oracle-backed price moves more than 0.1%. The owner pays to configure the minimum delay; a running Hydra cranker pays trigger fees. The vault program checks time, price freshness, slippage and replay protection before moving SPL assets.
          </Notice>
        </div>
      </Sheet>
      <AssetPickerSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        exclude={selectedIds}
        onSelect={(id) => {
          if (!isAssetId(id)) return;
          setShares((previous) => ({ ...previous, [id]: previous[id] || 10 }));
        }}
      />
    </Screen>
  );
}

function InvestmentEstimate({
  assets,
  targets,
  totalUsd,
}: {
  assets: AssetSpec[];
  targets: Partial<Record<AssetId, number>>;
  totalUsd: number | null;
}) {
  return (
    <LedgerPanel
      stripe="Estimated allocation"
      meta={totalUsd !== null ? `Total · ${fmtUsd(totalUsd)}` : 'Total · unavailable'}
      bodyClassName="pt-3"
    >
      <div className="space-y-2">
        {assets.map((spec) => (
          <div key={spec.id} className="flex items-baseline justify-between gap-3 text-[12px]">
            <span className="font-bold">{spec.symbol}</span>
            <span className="font-mono text-iron">{(targets[spec.id] ?? 0).toFixed(1)}%</span>
            <strong className="ml-auto font-mono">
              {totalUsd !== null ? fmtUsd((totalUsd * (targets[spec.id] ?? 0)) / 100) : '—'}
            </strong>
          </div>
        ))}
      </div>
      <p className="mt-3 border-t border-hairline pt-2 text-[10.5px] leading-relaxed text-iron">
        {totalUsd !== null
          ? 'Estimated from your SOL amount and the fresh SOL/USD price. Target dollars are not guaranteed token quantities.'
          : 'A fresh SOL/USD price is unavailable. The estimate will appear when the price book refreshes.'}
      </p>
    </LedgerPanel>
  );
}
