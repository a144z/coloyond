import { useEffect, useMemo, useState } from 'react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { useStore } from '../lib/store.js';
import { PRICE_MAX_AGE_MS, REBALANCE_INTERVAL_SEC } from '../lib/solana/config.js';
import { assetList, isAssetId, type AssetId, type AssetSpec } from '../lib/solana/assets.js';
import { readNextShareSymbolSequence, shareSymbolForSequence, validateShareMetadataForm } from '../lib/solana/execution.js';
import { bookStatus, priceOf } from '../lib/solana/price.js';
import { fmtSol, fmtUsd, lamportsFromSol, parseAmountOrZero } from '../lib/format.js';
import { Screen, ScreenHeading } from '../components/ui/Screen.js';
import { Button } from '../components/ui/Button.js';
import { LedgerPanel } from '../components/ui/LedgerPanel.js';
import { Sheet } from '../components/ui/Sheet.js';
import { Field, inputClass } from '../components/ui/Field.js';
import { KeyValue, MicroLabel, Notice } from '../components/ui/primitives.js';
import { WeightSliders, normalizeShares, type WeightLocks } from '../components/ui/WeightSliders.js';
import { MixBar, segmentsOf } from '../components/ui/MixBar.js';
import { AssetPickerSheet } from '../components/ui/AssetPickerSheet.js';
import { ReferenceArt } from '../../ReferenceArt.js';
import { ShareMetadataEditor } from './ShareMetadataEditor.js';

/** SOL deposited into the separate Executor PDA for scheduling and Magic Actions. */
const TASK_SPONSOR_SOL = 0.05;
const SETUP_FEE_SOL = 0.02;

const defaultShares: Record<AssetId, number> = { wsol: 60, dusd: 40, tbtc: 0, teth: 0 };
/** 02 / Create a portfolio — assets, weights, SOL investment, cadence and review. */
export function CreateVault() {
  const { setVisible } = useWalletModal();
  const hasWallet = useStore((s) => !!(s.wallet || s.connectedWallet));
  const metadataWalletKey = useStore((s) => s.connectedWallet?.publicKey.toBase58() ?? s.wallet?.publicKey ?? null);
  const walletBalances = useStore((s) => s.walletBalances);
  const price = useStore((s) => s.price);
  const createVault = useStore((s) => s.createVault);
  const pushScreen = useStore((s) => s.pushScreen);
  const toast = useStore((s) => s.toast);
  const setupDraft = useStore((s) => {
    const owner = s.connectedWallet?.publicKey.toBase58() ?? s.wallet?.publicKey;
    return owner ? s.vaultSetupDrafts[owner] ?? null : null;
  });

  const [name, setName] = useState('Everyday mix');
  const [shares, setShares] = useState<Record<AssetId, number>>(defaultShares);
  const [locked, setLocked] = useState<WeightLocks>({});
  const [investmentSol, setInvestmentSol] = useState('0.20');
  const [threshold, setThreshold] = useState(2);
  const [shareDescription, setShareDescription] = useState('');
  const [shareImage, setShareImage] = useState('');
  const [shareMetadataUri, setShareMetadataUri] = useState('');
  const [shareSymbolSequence, setShareSymbolSequence] = useState<bigint | null>(null);
  const [sequenceLoading, setSequenceLoading] = useState(false);
  const [shareMetadataVerified, setShareMetadataVerified] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!setupDraft) return;
    const draft = setupDraft.input;
    setName(draft.name);
    setShares({ ...defaultShares, ...draft.targets });
    setInvestmentSol((draft.deposits.wsol / 1e9).toFixed(9).replace(/0+$/, '').replace(/\.$/, '') || '0');
    setThreshold(draft.thresholdPct);
    setShareDescription(draft.shareTokenDescription ?? '');
    setShareImage(draft.shareTokenImage ?? '');
    setShareMetadataUri(draft.shareTokenUri ?? '');
    setShareSymbolSequence(typeof draft.shareTokenSequence === 'string' && /^\d+$/u.test(draft.shareTokenSequence) ? BigInt(draft.shareTokenSequence) : null);
    setShareMetadataVerified(!!setupDraft.completed.metadata);
  }, [setupDraft]);

  useEffect(() => {
    let live = true;
    setSequenceLoading(true);
    void readNextShareSymbolSequence().then((sequence) => {
      if (live) setShareSymbolSequence(sequence);
    }).catch((error) => {
      if (live) toast('error', 'Could not read share symbol registry', error instanceof Error ? error.message : 'Retry the registry read before creating metadata.');
    }).finally(() => { if (live) setSequenceLoading(false); });
    return () => { live = false; };
  }, [toast, metadataWalletKey]);

  async function refreshShareSymbol() {
    setSequenceLoading(true);
    try {
      setShareSymbolSequence(await readNextShareSymbolSequence());
      setShareMetadataVerified(false);
    } catch (error) {
      toast('error', 'Could not refresh share symbol', error instanceof Error ? error.message : 'Retry the registry read.');
    } finally { setSequenceLoading(false); }
  }

  const solAvail = walletBalances ? walletBalances.solLamports : null;
  const metadataAlreadyAttached = !!setupDraft?.completed.metadata;
  const targets = normalizeShares(shares, undefined, locked);
  const selected = assetList().filter((s) => (targets[s.id] ?? 0) > 0);
  const selectedIds = selected.map((s) => s.id);
  const targetLabel = selected.map((s) => `${(targets[s.id] ?? 0).toFixed(0)} ${s.symbol}`).join(' · ');

  const investmentSolUnits = parseAmountOrZero(investmentSol);
  let shareSymbol: string | null = null;
  try { if (shareSymbolSequence !== null) shareSymbol = shareSymbolForSequence(shareSymbolSequence); } catch { /* require a registry refresh below */ }
  const priceOk = bookStatus(price, PRICE_MAX_AGE_MS) === 'fresh' && price !== null;
  const solUsd = priceOk ? priceOf(price, 'wsol') : null;
  const estimatedTotalUsd = investmentSolUnits !== null && solUsd !== null ? investmentSolUnits * solUsd : null;

  const errors = useMemo(() => {
    const errs: string[] = [];
    if (!name.trim()) errs.push('Portfolio name is required.');
    if (new TextEncoder().encode(name).length > 32) errs.push('Share-token name must be at most 32 UTF-8 bytes.');
    const symbol = shareSymbol;
    if (!symbol) errs.push('Waiting for the on-chain share symbol sequence.');
    else {
      const metadataErrors = validateShareMetadataForm({ name, description: shareDescription, image: shareImage, uri: shareMetadataUri }, symbol);
      if (metadataErrors.length) errs.push(...metadataErrors);
      if (shareMetadataUri.trim() && !shareMetadataVerified) errs.push('Verify the uploaded metadata JSON before creating this portfolio.');
    }
    if (selected.length < 2) errs.push('Pick at least two assets for the mix.');
    const targetTotal = selected.reduce((sum, s) => sum + (targets[s.id] ?? 0), 0);
    if (Math.abs(targetTotal - 100) > 0.05) {
      errs.push(`Unlocked weights must cover the remaining ${(100 - targetTotal).toFixed(0)}% of the mix.`);
    }
    if (investmentSolUnits === null) errs.push('Enter a valid SOL investment amount.');
    else if (lamportsFromSol(investmentSolUnits) <= 0) errs.push('Invest at least 0.000000001 SOL.');
    if (solAvail === null) errs.push(hasWallet ? 'Waiting for your wallet SOL balance.' : 'Connect a wallet to fund and create this portfolio.');
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
  }, [name, shares, locked, investmentSol, solAvail, hasWallet, shareDescription, shareImage, shareMetadataUri, shareSymbol, shareMetadataVerified]);

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
        shareTokenDescription: shareDescription,
        shareTokenImage: shareImage,
        shareTokenUri: shareMetadataUri,
        shareTokenSequence: shareSymbolSequence?.toString() ?? '',
        assets,
        targets: assetTargets,
        thresholdPct: threshold,
        cadenceSec: REBALANCE_INTERVAL_SEC,
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
        title={setupDraft ? 'Continue setup.' : 'Set the balance.'}
        sub={setupDraft
          ? `Resume ${setupDraft.input.name}: confirmed steps and the same Vault State are saved on this device.`
          : 'Pick the assets and their weights, then invest from your SOL balance. The vault starts with wrapped SOL and rebalances toward your mix on schedule.'}
      />

      <div
        className="relative mb-4 h-[96px] overflow-hidden rounded-lg border border-hairline bg-pulp-shade"
        aria-hidden="true"
      >
        <ReferenceArt
          variant="planes"
          className="absolute inset-0 h-full w-full opacity-80"
          title="Composition study · blue, yellow, violet, coral"
        />
      </div>

      {setupDraft ? (
        <div className="mb-4">
          <Notice tone="brass">
            This wallet has a saved setup for <strong>{setupDraft.input.name}</strong>. Continuing will reuse its Vault State and skip the {Object.keys(setupDraft.completed).length} confirmed step{Object.keys(setupDraft.completed).length === 1 ? '' : 's'}.
          </Notice>
        </div>
      ) : null}

      {metadataAlreadyAttached ? <div className="mb-4"><Notice tone="petrol" title="Share metadata already confirmed">This saved setup already attached its share metadata on Solana. Continue with the confirmed fields below; use the vault’s metadata manager after setup to update name or URI.</Notice></div> : null}

      <Field label="Portfolio name" error={name.trim() === '' ? 'Portfolio name is required.' : undefined}>
        <input
          value={name}
          maxLength={32}
          disabled={metadataAlreadyAttached}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
          placeholder="Everyday mix"
        />
      </Field>

      <div className="mt-4">
        <LedgerPanel stripe="Share-token identity" meta="Metaplex · standard SPL">
          <ShareMetadataEditor
            value={{ name, description: shareDescription, image: shareImage, uri: shareMetadataUri }}
            onChange={(value) => { setName(value.name); setShareDescription(value.description); setShareImage(value.image); setShareMetadataUri(value.uri); setShareMetadataVerified(false); }}
            symbol={shareSymbol}
            sequenceLoading={sequenceLoading}
            onRefreshSequence={() => void refreshShareSymbol()}
            verified={shareMetadataVerified}
            onVerifiedChange={setShareMetadataVerified}
            readOnly={metadataAlreadyAttached}
          />
        </LedgerPanel>
      </div>

      <LedgerPanel
        stripe="Target mix"
        meta={selected.length >= 2 ? selected.map((s) => (targets[s.id] ?? 0).toFixed(0)).join(' / ') : '—'}
        bodyClassName="pt-3"
      >
        {selected.length >= 2 ? (
          <MixBar
            className="mb-4"
            segments={segmentsOf(selected.map((s) => ({ assetId: s.id, pct: targets[s.id] ?? 0 })))}
            height={26}
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
        <LedgerPanel stripe="Unified schedule" meta="Every minute">
          <p className="text-[11px] leading-relaxed text-iron">
            One shared schedule checks every SPL asset in this portfolio together. The Hydra cranker also services all active portfolios; there is no per-token timing choice.
          </p>
        </LedgerPanel>
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
        {!hasWallet ? <div className="mb-3"><Button variant="primary" full onClick={() => setVisible(true)}>Connect wallet to continue</Button></div> : null}
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
          Every portfolio shares the same one-minute cadence; one callback evaluates its SPL assets together.
          Weight-only edits are on Solana; a 120-second cooldown applies.
        </p>
      </div>

      <Sheet
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        micro="Setup review · devnet"
        title={setupDraft ? 'Resume saved setup' : 'Review before signing'}
        footer={
          <Button variant="primary" full loading={submitting} disabled={errors.length > 0} onClick={onConfirm}>
            {setupDraft ? 'Resume on devnet' : 'Create on devnet'}
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
            { k: 'Rebalance schedule', v: 'Shared · about every 60 seconds' },
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
            <li>· Registers the shared one-minute Hydra schedule for this portfolio; one callback evaluates all its selected SPL assets together.</li>
          </ul>
        </div>
        <div className="mt-4">
          <InvestmentEstimate assets={selected} targets={targets} totalUsd={estimatedTotalUsd} />
        </div>
        <div className="mt-4">
          <Notice tone="petrol" title="How the investment is executed">
            This is an allocation estimate, not an instant swap quote. The scheduled ER instruction can request a Solana vault action toward {targetLabel} when drift passes {threshold.toFixed(1)}% and an oracle-backed price moves more than 0.1%. All portfolios use the same cadence; a running Hydra cranker pays trigger fees. The vault program checks time, feed identity and verification, slippage and replay protection before moving SPL assets.
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
