import { useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { CADENCE_OPTIONS_SEC } from '../lib/solana/config';
import { assetList, type AssetId } from '../lib/solana/assets';
import { bookStatus, priceOf } from '../lib/solana/price';
import { PRICE_MAX_AGE_MS } from '../lib/solana/config';
import { fmtSol, fmtToken, fmtUsd, lamportsFromSol, parseAmount, parseAmountOrZero, rawFromToken } from '../lib/format';
import { Screen, ScreenHeading } from '../components/ui/Screen';
import { Button } from '../components/ui/Button';
import { LedgerPanel } from '../components/ui/LedgerPanel';
import { Sheet } from '../components/ui/Sheet';
import { Field, inputClass, selectClass } from '../components/ui/Field';
import { KeyValue, MicroLabel, Notice } from '../components/ui/primitives';
import { WeightSliders, normalizeShares } from '../components/ui/WeightSliders';
import { MixBar, segmentsOf } from '../components/ui/MixBar';
import { AssetPickerSheet } from '../components/ui/AssetPickerSheet';

const cadenceLabels: Record<number, string> = {
  75: 'Every 75 seconds · demo cadence',
  3600: 'Every hour · production cadence',
};

/** Owner SOL held back for the setup transaction's own fees. */
const SETUP_FEE_SOL = 0.02;

const defaultShares: Record<AssetId, number> = { wsol: 60, tusd: 40, tbtc: 0, teth: 0 };
const defaultDeposits: Record<AssetId, string> = { wsol: '0.20', tusd: '', tbtc: '', teth: '' };

/** 02 / Create a portfolio — assets, weights, deposits, cadence, budget, review. */
export function CreateVault() {
  const walletBalances = useStore((s) => s.walletBalances);
  const price = useStore((s) => s.price);
  const createVault = useStore((s) => s.createVault);
  const pushScreen = useStore((s) => s.pushScreen);
  const toast = useStore((s) => s.toast);

  const [name, setName] = useState('Everyday mix');
  const [shares, setShares] = useState<Record<AssetId, number>>(defaultShares);
  const [depositStr, setDepositStr] = useState<Record<AssetId, string>>(defaultDeposits);
  const [budget, setBudget] = useState('0.05');
  const [cadenceSec, setCadenceSec] = useState<number>(CADENCE_OPTIONS_SEC[0]);
  const [threshold, setThreshold] = useState(2);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const solAvail = walletBalances ? walletBalances.solLamports : null;
  const tokensAvail = walletBalances?.tokens ?? null;

  const targets = normalizeShares(shares);
  const selected = assetList().filter((s) => (shares[s.id] ?? 0) > 0);
  const selectedIds = selected.map((s) => s.id);
  const targetLabel = selected.map((s) => `${(targets[s.id] ?? 0).toFixed(0)} ${s.symbol}`).join(' · ');

  const depositUnits: Partial<Record<AssetId, number | null>> = {};
  for (const spec of selected) {
    depositUnits[spec.id] = parseAmountOrZero(depositStr[spec.id] ?? '');
  }
  const budgetSol = parseAmount(budget);

  const errors = useMemo(() => {
    const errs: string[] = [];
    if (!name.trim()) errs.push('Portfolio name is required.');
    if (selected.length < 2) errs.push('Pick at least two assets for the mix.');
    if (selected.some((s) => depositUnits[s.id] === null)) {
      errs.push('One of the deposit amounts is not valid.');
    }
    if (budgetSol === null) errs.push('Automation budget is not a valid amount.');
    const anyDeposit = selected.some((s) => (depositUnits[s.id] ?? 0) > 0);
    if (!anyDeposit) errs.push('Deposit at least one asset.');
    if (solAvail !== null && budgetSol !== null) {
      const wsolUnits = depositUnits.wsol ?? 0;
      const need = budgetSol + wsolUnits + SETUP_FEE_SOL;
      if (lamportsFromSol(need) > solAvail) {
        errs.push(
          `Wallet needs about ${need.toFixed(2)} SOL (budget + WSOL deposit + fees). Available: ${fmtSol(solAvail)} SOL. Use the faucet from the Wallet tab.`,
        );
      }
    }
    if (tokensAvail) {
      for (const spec of selected) {
        const units = depositUnits[spec.id] ?? 0;
        if (units > 0 && rawFromToken(units, spec.decimals) > (tokensAvail[spec.id] ?? 0)) {
          errs.push(
            `${spec.symbol} deposit exceeds your balance of ${fmtToken(tokensAvail[spec.id] ?? 0, spec.decimals)} ${spec.symbol}.`,
          );
        }
      }
    }
    return errs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, shares, depositStr, budget, solAvail, tokensAvail]);

  const priceOk = bookStatus(price, PRICE_MAX_AGE_MS) === 'fresh' && price !== null;

  async function onConfirm() {
    if (submitting || errors.length > 0 || budgetSol === null) return;
    setSubmitting(true);
    try {
      const deposits: Record<string, number> = {};
      for (const spec of selected) {
        deposits[spec.id] = rawFromToken(depositUnits[spec.id] ?? 0, spec.decimals);
      }
      const id = await createVault({
        name: name.trim(),
        assets: selectedIds,
        targets: targets as Record<string, number>,
        thresholdPct: threshold,
        cadenceSec,
        budgetLamports: lamportsFromSol(budgetSol),
        deposits,
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
        sub="Pick the assets and their weights. One wallet signature sets up custody, budget and deposits. The vault keypair trades; your owner key stays out of it."
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
        {selected.length >= 2 && (
          <div className="mb-4">
            <MixBar
              segments={segmentsOf(selected.map((s) => ({ assetId: s.id, pct: targets[s.id] ?? 0 })))}
              height={24}
              interactive
              onChange={(nextSegs) => {
                const newShares = { ...shares };
                for (const seg of nextSegs) {
                  newShares[seg.key] = Math.round(seg.pct);
                }
                setShares(newShares);
              }}
              ariaLabel="Drag handles to adjust target weights"
            />
          </div>
        )}
        <WeightSliders shares={shares} onChange={setShares} />
      </LedgerPanel>

      <div className="mt-2.5">
        <Button variant="secondary" full onClick={() => setPickerOpen(true)}>
          Add asset · search the full Coinbase list
        </Button>
      </div>

      <div className="mt-4">
        <Notice tone="brass">
          Every asset here trades as a devnet stand-in. Test USD, Test BTC and Test ETH ship with
          the demo; anything added from the Coinbase list gets its own stand-in mint, created by
          the reserve on setup. Prices are live Coinbase mids (fixed $1 for tUSD) — none of it is
          redeemable for the real asset.
        </Notice>
      </div>

      <div className="mt-4">
        <MicroLabel>Deposits · the assets you picked</MicroLabel>
        <div className="mt-2 grid grid-cols-2 gap-3">
          {selected.map((spec) => (
            <Field
              key={spec.id}
              label={`Deposit ${spec.symbol}`}
              hint={
                spec.id === 'wsol'
                  ? solAvail !== null
                    ? `Wraps SOL · you hold ${fmtSol(solAvail)}`
                    : 'Wraps SOL from your wallet'
                  : tokensAvail && (tokensAvail[spec.id] ?? 0) > 0
                    ? `you hold ${fmtToken(tokensAvail[spec.id] ?? 0, spec.decimals)} ${spec.symbol}`
                    : '0 is fine — automation buys in at the target weight'
              }
            >
              <input
                inputMode="decimal"
                value={depositStr[spec.id] ?? ''}
                onChange={(e) => setDepositStr({ ...depositStr, [spec.id]: e.target.value })}
                className={inputClass}
                aria-label={`${spec.symbol} deposit`}
                placeholder="0.00"
              />
            </Field>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <Field label="Check cadence" hint="How often the scheduler measures drift while the app is open.">
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

      <div className="mt-4">
        <Field
          label="Automation budget · separate from tokens"
          hint={`Pays devnet fees for automated trades. 0.05 SOL ≈ 60+ swaps. You hold ${fmtSol(solAvail ?? 0)} SOL.`}
        >
          <input
            inputMode="decimal"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            className={inputClass}
            aria-label="Automation budget in SOL"
          />
        </Field>
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
          Setup is one reviewed transaction. A funded vault stays withdrawable in kind even if
          automation never runs. Weight-only edits later keep the schedule and budget, with a
          120-second cooldown.
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
            {
              k: 'Deposits',
              v:
                selected
                  .filter((s) => (depositUnits[s.id] ?? 0) > 0)
                  .map((s) => `${(depositUnits[s.id] ?? 0).toString()} ${s.symbol}`)
                  .join(' · ') || '—',
            },
            { k: 'Automation budget', v: `${(budgetSol ?? 0).toFixed(4)} SOL (separate)` },
            { k: 'Cadence', v: cadenceLabels[cadenceSec] ?? `every ${cadenceSec}s` },
            { k: 'Deviation threshold', v: `± ${threshold.toFixed(1)}%` },
          ]}
        />
        <div className="mt-4">
          <MicroLabel>What this transaction does</MicroLabel>
          <ul className="mt-2 space-y-1.5 text-[11.5px] leading-relaxed text-iron">
            <li>· Generates a separate vault custody keypair on this device.</li>
            <li>· Creates the vault's token accounts for all {selected.length} selected assets.</li>
            <li>· Creates a devnet stand-in mint for any Coinbase-listed pick that lacks one.</li>
            <li>· Moves the fee budget and every deposit in one atomic transfer.</li>
            <li>· Counterparty for future swaps: the funded devnet reserve (spread 0.30% + curve fee, capped at 3.00%).</li>
            <li>· Scheduler: in-app stand-in. It signs with the vault key while the app is open.</li>
          </ul>
        </div>
        <div className="mt-4">
          <Notice tone="petrol" title="Expected effect">
            The vault values every asset at{' '}
            {priceOk
              ? selected.length > 1
                ? 'live Coinbase/Binance mids'
                : 'the live mid'
              : 'the next fresh price observation'}{' '}
            and trades back onto {targetLabel} whenever drift passes {threshold.toFixed(1)}%.
            {priceOk && price ? ` Current mids: ${assetList()
              .filter((s) => (shares[s.id] ?? 0) > 0)
              .map((s) => `${s.symbol} ${fmtUsd(priceOf(price, s.id) ?? 0)}`)
              .join(' · ')}.` : ''}
          </Notice>
        </div>
      </Sheet>

      <AssetPickerSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        exclude={selectedIds}
        onSelect={(id) => {
          setShares((prev) => ((prev[id] ?? 0) > 0 ? prev : { ...prev, [id]: 8 }));
        }}
      />
    </Screen>
  );
}
