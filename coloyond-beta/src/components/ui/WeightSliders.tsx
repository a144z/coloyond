import { assetList, type AssetId } from '../../lib/solana/assets';
import { AssetSwatch } from './primitives';

/**
 * Proportional weight editor. Each asset gets an independent share slider
 * (0-100); the displayed weights are the shares normalized to 100, so the
 * target mix is always valid while editing. A share of zero removes the
 * asset from the portfolio.
 */
export function WeightSliders({
  shares,
  onChange,
  ariaLabel = 'Target mix weights',
}: {
  shares: Record<AssetId, number>;
  onChange: (next: Record<AssetId, number>) => void;
  ariaLabel?: string;
}) {
  const specs = assetList();
  const total = specs.reduce((sum, s) => sum + (shares[s.id] ?? 0), 0);
  const pctOf = (id: AssetId): number => (total > 0 ? ((shares[id] ?? 0) / total) * 100 : 0);

  return (
    <div role="group" aria-label={ariaLabel}>
      {specs.map((spec) => {
        const share = shares[spec.id] ?? 0;
        return (
          <div key={spec.id} className="border-b border-hairline py-3 last:border-b-0">
            <label className="block">
              <span className="flex items-baseline justify-between gap-3">
                <span className="flex items-center gap-2 text-[12px] font-bold">
                  <AssetSwatch color={spec.color} />
                  {spec.symbol}
                  <span className="font-normal text-iron">· {spec.name}</span>
                </span>
                <strong className="font-mono text-[14px]">{pctOf(spec.id).toFixed(1)}%</strong>
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={share}
                onChange={(e) => onChange({ ...shares, [spec.id]: Number(e.target.value) })}
                className="ledger-range mt-1.5"
                aria-label={`${spec.symbol} share`}
                aria-valuetext={`${pctOf(spec.id).toFixed(1)} percent of the mix`}
              />
            </label>
          </div>
        );
      })}
      <div className="flex items-baseline justify-between gap-3 border-t border-hairline pt-3 text-[11px] text-iron">
        <span>{total > 0 ? 'Total target' : 'No assets selected'}</span>
        <strong className="font-mono">{total > 0 ? '100.0%' : '—'}</strong>
      </div>
    </div>
  );
}

/** Normalize raw shares into target percentages that sum to 100 (empty input → empty record). */
export function normalizeShares(shares: Record<AssetId, number>): Partial<Record<AssetId, number>> {
  const total = assetList().reduce((sum, s) => sum + (shares[s.id] ?? 0), 0);
  if (total <= 0) return {};
  const out: Partial<Record<AssetId, number>> = {};
  for (const spec of assetList()) {
    const share = shares[spec.id] ?? 0;
    if (share <= 0) continue;
    out[spec.id] = (share / total) * 100;
  }
  return out;
}

/** Read normalized shares back from target percentages (for editing existing targets). */
export function sharesFromTargets(targets: Record<string, number>): Record<AssetId, number> {
  const out = Object.fromEntries(assetList().map((s) => [s.id, 0])) as Record<AssetId, number>;
  for (const spec of assetList()) {
    out[spec.id] = Math.round(targets[spec.id] ?? 0);
  }
  return out;
}
