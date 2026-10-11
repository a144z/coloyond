import { useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { CADENCE_OPTIONS_SEC, PRICE_MAX_AGE_MS } from '../lib/solana/config';
import { assetList, type AssetId, type AssetSpec } from '../lib/solana/assets';
import { bookStatus, priceOf } from '../lib/solana/price';
import { fmtSol, fmtUsd, lamportsFromSol, parseAmount, parseAmountOrZero } from '../lib/format';
import { Screen, ScreenHeading } from '../components/ui/Screen';
import { Button } from '../components/ui/Button';
import { LedgerPanel } from '../components/ui/LedgerPanel';
import { Sheet } from '../components/ui/Sheet';
import { Field, inputClass, selectClass } from '../components/ui/Field';
import { KeyValue, MicroLabel, Notice } from '../components/ui/primitives';
import { WeightSliders, normalizeShares } from '../components/ui/WeightSliders';

const cadenceLabels: Record<number, string> = {
  60: 'Every 60 seconds · devnet cadence',
};

/** Owner SOL held back for the setup transaction's own fees. */
const SETUP_FEE_SOL = 0.02;

const defaultShares: Record<AssetId, number> = { wsol: 60, tusd: 40, tbtc: 0, teth: 0 };
/** 02 / Create a portfolio — assets, weights, SOL investment, cadence, budget, review. */
export function CreateVault() {
  const walletBalances = useStore((s) => s.walletBalances);
  const price = useStore((s) => s.price);
  const createVault = useStore((s) => s.createVault);
  const pushScreen = useStore((s) => s.pushScreen);
  const toast = useStore((s) => s.toast);

  const [name, setName] = useState('Everyday mix');
  const [shares, setShares] = useState<Record<AssetId, number>>(defaultShares);
  const [investmentSol, setInvestmentSol] = useState('0.20');
  const [budget, setBudget] = useState('0.05');
  const [cadenceSec, setCadenceSec] = useState<number>(CADENCE_OPTIONS_SEC[0]);
  const [threshold, setThreshold] = useState(2);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const solAvail = walletBalances ? walletBalances.solLamports : null;
  const targets = normalizeShares(shares);
  const selected = assetList().filter((s) => (shares[s.id] ?? 0) > 0);
  const selectedIds = selected.map((s) => s.id);
  const targetLabel = selected.map((s) => `${(targets[s.id] ?? 0).toFixed(0)} ${s.symbol}`).join(' · ');

  const investmentSolUnits = parseAmountOrZero(investmentSol);
  const budgetSol = parseAmount(budget);
  const priceOk = bookStatus(price, PRICE_MAX_AGE_MS) === 'fresh' && price !== null;
  const solUsd = priceOk ? priceOf(price, 'wsol') : null;
  const estimatedTotalUsd = investmentSolUnits !== null && solUsd !== null ? investmentSolUnits * solUsd : null;

  const errors = useMemo(() => {
    const errs: string[] = [];
    if (!name.trim()) errs.push('Portfolio name is required.');
    if (selected.length < 2) errs.push('Pick at least two assets for the mix.');
    if (investmentSolUnits === null) errs.push('Enter a valid SOL investment amount.');
    else if (lamportsFromSol(investmentSolUnits) <= 0) errs.push('Invest at least 0.000000001 SOL.');
    if (budgetSol === null) errs.push('Automation budget is not a valid amount.');
    if (solAvail === null) errs.push('Waiting for your wallet SOL balance.');
    if (solAvail !== null && budgetSol !== null && investmentSolUnits !== null) {
      const need = budgetSol + investmentSolUnits + SETUP_FEE_SOL;
      if (lamportsFromSol(need) > solAvail) {
        errs.push(
          `Wallet needs about ${need.toFixed(2)} SOL (investment + budget + setup fees). Available: ${fmtSol(solAvail)} SOL.`,
        );
      }
    }
    return errs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, shares, investmentSol, budget, solAvail]);

  async function onConfirm() {
    if (submitting || errors.length > 0 || budgetSol === null) return;
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
        budgetLamports: lamportsFromSol(budgetSol),
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
        <WeightSliders shares={shares} onChange={setShares} />
      </LedgerPanel>

      <div className="mt-4">
        <Notice tone="brass">
          Test USD, Test BTC and Test ETH are synthetic devnet assets. Their prices are live market
          mids (or fixed $1 for tUSD); their supply is minted by the demo reserve. They are not
          redeemable for real dollars, BTC or ETH.
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
          SOL is wrapped as WSOL in the vault first. If WSOL is not in your target mix, it is tracked at 0% until the scheduled rebalance moves toward your targets.
        </p>
      </div>

      <div className="mt-4">
        <Field label="Rebalance cadence" hint="How often an active portfolio is checked for drift.">
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
          label="Automation budget · separate from investment"
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
          Setup uses several devnet transactions. A funded vault stays recoverable in kind even if
          scheduled execution requires the deployed program and reserve authorization. Weight-only edits later keep the schedule and budget, with a
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
            { k: 'SOL investment', v: `${(investmentSolUnits ?? 0).toString()} SOL → WSOL` },
            { k: 'Wallet SOL balance', v: solAvail !== null ? `${fmtSol(solAvail)} SOL` : 'Loading' },
            {
              k: 'Estimated vault value',
              v: estimatedTotalUsd !== null ? fmtUsd(estimatedTotalUsd) : 'Unavailable · waiting for a fresh SOL/USD price',
            },
            { k: 'Automation budget', v: `${(budgetSol ?? 0).toFixed(4)} SOL (separate)` },
            { k: 'Cadence', v: cadenceLabels[cadenceSec] ?? `every ${cadenceSec}s` },
            { k: 'Deviation threshold', v: `± ${threshold.toFixed(1)}%` },
          ]}
        />
        <div className="mt-4">
          <MicroLabel>What setup does</MicroLabel>
          <ul className="mt-2 space-y-1.5 text-[11.5px] leading-relaxed text-iron">
            <li>· Generates a separate vault custody keypair on this device.</li>
            <li>· Creates the vault's token accounts for {selected.length} target assets{selectedIds.includes('wsol') ? '' : ' plus WSOL as the SOL funding asset'}.</li>
            <li>· Wraps your SOL as WSOL, then moves it and the separate fee budget to the vault.</li>
            <li>· Counterparty for future swaps: the program-authorized devnet reserve (spread 0.30% + curve fee, capped at 3.00%).</li>
            <li>· Execution: delegated to MagicBlock Ephemeral Rollups on a 60-second schedule.</li>
          </ul>
        </div>
        <div className="mt-4">
          <InvestmentEstimate assets={selected} targets={targets} totalUsd={estimatedTotalUsd} />
        </div>
        <div className="mt-4">
          <Notice tone="petrol" title="How the investment is executed">
            This is an allocation estimate, not an instant swap quote. After funding, the MagicBlock Ephemeral Rollups program checks the vault on its 60-second schedule and trades toward {targetLabel} when drift passes {threshold.toFixed(1)}%. Actual fills can differ because of fees and slippage. Scheduled trades wait for fresh required asset prices.
          </Notice>
        </div>
      </Sheet>
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
