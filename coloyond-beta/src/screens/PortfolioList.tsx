import { useStore, vaultTargetList, type VaultConfig } from '../lib/store';
import { computeAssetRows, maxDriftPct } from '../lib/solana/vault';
import { bookStatus, pricesFromBook, priceOf } from '../lib/solana/price';
import { PRICE_MAX_AGE_MS } from '../lib/solana/config';
import { assetSpec } from '../lib/solana/assets';
import { fmtTimeAgo } from '../lib/format';
import { Screen, ScreenHeading } from '../components/ui/Screen';
import { Button } from '../components/ui/Button';
import { LedgerPanel } from '../components/ui/LedgerPanel';
import { MixBar, segmentsOf } from '../components/ui/MixBar';
import { Notice, Skeleton, StatusSwatch } from '../components/ui/primitives';

/** 01 / Your portfolios — the tab-level list of vaults. */
export function PortfolioList() {
  const vaults = useStore((s) => s.vaults);
  const pushScreen = useStore((s) => s.pushScreen);
  const price = useStore((s) => s.price);

  return (
    <Screen>
      <ScreenHeading
        micro="01 / Your portfolios"
        title="A mix of your own."
        sub={
          <>
            Create a portfolio. Choose its assets and weights.
            <br />
            See what each vault actually holds.
          </>
        }
      />

      <Button variant="primary" full onClick={() => pushScreen({ id: 'create' })}>
        + Create portfolio
      </Button>

      <div className="mt-4 space-y-4">
        {vaults.map((v, i) => (
          <VaultCard key={v.id} vault={v} number={i + 1} book={price} />
        ))}

        {vaults.length === 0 ? (
          <LedgerPanel stripe="Empty ledger" meta="00">
            <div className="py-6 text-center">
              <p className="font-display text-[19px] font-bold tracking-[-0.01em]">No portfolios yet.</p>
              <p className="mx-auto mt-2 max-w-[34ch] text-[12px] leading-relaxed text-iron">
                Your first vault takes one wallet signature: custody keypair, fee budget and
                deposits, all in one setup transaction.
              </p>
            </div>
          </LedgerPanel>
        ) : null}
      </div>

      <p className="mt-5 text-[11px] leading-relaxed text-iron">
        Closing this app pauses nothing you own — but automation checks only run while the app is
        open. On device, delegated execution would keep the schedule unattended.
      </p>
    </Screen>
  );
}

function VaultCard({ vault, number, book }: { vault: VaultConfig; number: number; book: ReturnType<typeof useStore.getState>['price'] }) {
  const vaultBalances = useStore((s) => s.vaultBalances[vault.id]);
  const pushScreen = useStore((s) => s.pushScreen);

  const bal = vaultBalances ?? null;
  const priced =
    book !== null &&
    bookStatus(book, PRICE_MAX_AGE_MS) === 'fresh' &&
    vault.assets.every((id) => priceOf(book, id) !== null);
  const valued = bal && priced ? computeAssetRows(bal.tokens, pricesFromBook(book), vault.assets) : null;
  const drift = valued ? maxDriftPct(valued.rows, vault.targets) : null;
  const closed = vault.status === 'closed';

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
    <LedgerPanel
      stripe={vault.name}
      meta={String(number).padStart(2, '0')}
      bodyClassName="pt-3.5"
    >
      <p className="text-[11.5px] text-iron">{assetLabel} · Solana devnet</p>

      <div className="mt-4">
        {valued ? (
          <MixBar segments={segmentsOf(actualEntries)} ticks={targetTicks} />
        ) : (
          <Skeleton className="h-[10px] w-full border border-ink" />
        )}
        <div className="mt-2 flex items-baseline justify-between gap-3 text-[11px] text-iron">
          <span>
            {targetEntries.map((t) => t.pct.toFixed(0)).join(' / ')} target
          </span>
          <span>
            {drift !== null ? `${drift.toFixed(1)}% deviation` : 'weights loading'}
          </span>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-hairline pt-3.5 text-[12px] font-bold">
        <VaultStatusLine vault={vault} />
      </div>

      <p className="mt-1.5 text-[11px] text-iron">
        {closed
          ? 'Automation stopped · assets returned in kind.'
          : vault.lastTradeAt
            ? `Last trade ${fmtTimeAgo(vault.lastTradeAt)} · ${vault.tradeCount} automated trade${vault.tradeCount === 1 ? '' : 's'}`
            : 'No automated trades yet.'}
      </p>

      {!closed ? (
        <div className="mt-4">
          <Button variant="secondary" full onClick={() => pushScreen({ id: 'vault', vaultId: vault.id })}>
            Open portfolio →
          </Button>
        </div>
      ) : (
        <div className="mt-4">
          <Button variant="ghost" full onClick={() => pushScreen({ id: 'vault', vaultId: vault.id })}>
            Review closed vault →
          </Button>
        </div>
      )}
    </LedgerPanel>
  );
}

export function VaultStatusLine({ vault }: { vault: VaultConfig }) {
  if (vault.status === 'closed') {
    return (
      <>
        <StatusSwatch tone="iron" />
        Closed
      </>
    );
  }
  if (vault.status === 'paused') {
    return (
      <>
        <StatusSwatch tone="iron" />
        Paused
      </>
    );
  }
  if (vault.blockedReason) {
    const labels = {
      price: 'Blocked · price unavailable',
      budget: 'Blocked · automation budget exhausted',
      reserve: 'Blocked · reserve inventory',
    } as const;
    return (
      <>
        <StatusSwatch tone="danger" />
        {labels[vault.blockedReason]}
      </>
    );
  }
  return (
    <>
      <StatusSwatch tone="petrol" pulse />
      Automation active
    </>
  );
}

/** Shared blocked-state copy, from the reference's exit screen. */
export function BlockedNotice({ reason }: { reason: Exclude<VaultConfig['blockedReason'], null> }) {
  const copy = {
    price: {
      title: 'Price unavailable',
      body: 'The required price is older than the configured limit. Automation cannot exchange tokens using that observation.',
    },
    budget: {
      title: 'Automation budget exhausted',
      body: 'The vault keypair holds too little SOL to pay devnet fees. Add budget to resume automated trades. Holdings stay withdrawable in kind.',
    },
    reserve: {
      title: 'Reserve inventory insufficient',
      body: 'The funded devnet reserve cannot fill this trade right now. Automation retries on the next check. Holdings stay withdrawable in kind.',
    },
  } as const;
  return (
    <Notice tone="danger" title={copy[reason].title}>
      {copy[reason].body}
    </Notice>
  );
}
