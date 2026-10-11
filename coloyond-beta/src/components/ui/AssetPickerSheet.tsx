import { useEffect, useMemo, useState } from 'react';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { useStore } from '../../lib/store';
import { assetList, assetSpec } from '../../lib/solana/assets';
import { ALIASED_COINBASE_IDS } from '../../lib/solana/coinbase';
import { priceOf } from '../../lib/solana/price';
import { fmtUsd } from '../../lib/format';
import { Sheet } from './Sheet';
import { inputClass } from './Field';
import { AssetSwatch, Notice } from './primitives';

/** Hard cap on rendered universe rows — refine the search to see more. */
const MAX_ROWS = 60;

/**
 * Asset picker: the demo reserve's core assets, then the full list of assets
 * available from Coinbase (live USD markets only), filtered by search.
 * Picking an id hands it to the caller; selection state stays outside.
 */
export function AssetPickerSheet({
  open,
  onClose,
  onSelect,
  exclude,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (assetId: string) => void;
  exclude: string[];
}) {
  const universe = useStore((s) => s.universe);
  const universeError = useStore((s) => s.universeError);
  const refreshUniverse = useStore((s) => s.refreshUniverse);
  const price = useStore((s) => s.price);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (open && universe.length === 0) void refreshUniverse();
  }, [open, universe.length, refreshUniverse]);

  const q = query.trim().toLowerCase();
  const core = assetList().filter((s) => s.core);
  const results = useMemo(() => {
    return universe
      .filter((a) => !exclude.includes(a.id) && !ALIASED_COINBASE_IDS.includes(a.id))
      .filter((a) => !q || a.symbol.toLowerCase().includes(q) || a.name.toLowerCase().includes(q));
  }, [universe, exclude, q]);
  const shown = results.slice(0, MAX_ROWS);

  function pick(id: string) {
    onSelect(id);
    setQuery('');
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} micro="Asset picker · live from Coinbase" title="Add an asset">
      <div className="relative">
        <MagnifyingGlass size={16} weight="bold" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-iron" aria-hidden />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={`${inputClass} pl-9`}
          placeholder="Search the Coinbase list…"
          aria-label="Search assets by symbol or name"
          autoComplete="off"
        />
      </div>

      <div className="mt-4">
        <p className="font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-iron">Demo reserve assets</p>
        <ul className="mt-1">
          {core
            .filter((s) => !exclude.includes(s.id))
            .map((s) => (
              <li key={s.id}>
                <PickRow id={s.id} symbol={s.symbol} name={`${s.name} · devnet stand-in`} price={priceOf(price, s.id)} onPick={pick} />
              </li>
            ))}
        </ul>
      </div>

      <div className="mt-4">
        <p className="font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-iron">
          Coinbase universe · {results.length} with live USD markets
        </p>
        <ul className="mt-1">
          {shown.map((a) => (
            <li key={a.id}>
              <PickRow
                id={a.id}
                symbol={a.symbol}
                name={a.name}
                price={priceOf(price, a.id)}
                onPick={pick}
              />
            </li>
          ))}
        </ul>
        {results.length > shown.length ? (
          <p className="py-2.5 text-[11px] text-iron">
            {results.length - shown.length} more — refine the search to narrow the list.
          </p>
        ) : null}
        {universe.length === 0 && !universeError ? (
          <p className="py-2.5 text-[12px] text-iron">Reading the Coinbase list…</p>
        ) : null}
        {universeError ? (
          <div className="mt-2">
            <Notice tone="brass" title="Coinbase list unavailable">
              {universeError} The demo reserve assets below still work; the list retries on the
              next scheduler tick.
            </Notice>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

function PickRow({
  id,
  symbol,
  name,
  price,
  onPick,
}: {
  id: string;
  symbol: string;
  name: string;
  price: number | null;
  onPick: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(id)}
      className="flex w-full items-center justify-between gap-3 border-b border-hairline py-2.5 text-left last:border-b-0 hover:bg-ink/5"
    >
      <span className="flex min-w-0 items-center gap-2 text-[12px] font-bold">
        <AssetSwatch color={assetSpec(id).color} />
        {symbol}
        <span className="truncate font-normal text-iron">· {name}</span>
      </span>
      <span className="shrink-0 font-mono text-[11px] text-iron">{price !== null ? fmtUsd(price) : '—'}</span>
    </button>
  );
}
