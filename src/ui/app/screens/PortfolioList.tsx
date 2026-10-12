import { useStore, vaultTargetList, type VaultConfig } from '../lib/store.js';
import { computeAssetRows, maxDriftPct } from '../lib/solana/vault.js';
import { bookStatus, pricesFromBook, priceOf } from '../lib/solana/price.js';
import { PRICE_MAX_AGE_MS } from '../lib/solana/config.js';
import { assetSpec } from '../lib/solana/assets.js';
import { fmtTimeAgo } from '../lib/format.js';
import { Screen, ScreenHeading } from '../components/ui/Screen.js';
import { Button } from '../components/ui/Button.js';
import { LedgerPanel } from '../components/ui/LedgerPanel.js';
import { MixBar, segmentsOf } from '../components/ui/MixBar.js';
import { Notice, Skeleton, StatusSwatch } from '../components/ui/primitives.js';

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
                Create a Vault State PDA, standard SPL asset accounts, a transferable share mint,
                and a permissionless Hydra task with an owner-configured minimum delay.
              </p>
            </div>
          </LedgerPanel>
        ) : null}
      </div>

      <p className="mt-5 text-[11px] leading-relaxed text-iron">
        Each vault enforces its owner-configured minimum delay and price-movement guard on Solana.
        Wall-clock timing depends on an active permissionless cranker; opening the app only refreshes state.
      </p>
    </Screen>
  );
}

function VaultCard({ vault, number, book }: { vault: VaultConfig; number: number; book: ReturnType<typeof useStore.getState>['price'] }) {
  const vaultBalances = useStore((s) => s.vaultBalances[vault.id]);
  const pushScreen = useStore((s) => s.pushScreen);

  if (vault.legacy || vault.status === 'legacy') {
    return (
      <LedgerPanel stripe={vault.name} meta={String(number).padStart(2, '0')} bodyClassName="pt-3.5">
        <p className="text-[11.5px] text-iron">Legacy keypair custody · read-only in this version</p>
        <p className="mt-3 text-[12px] leading-relaxed text-iron">
          This saved portfolio predates the on-chain Vault State and share mint. Its saved address is
          not treated as a PDA. Keep this device data intact and use the previous app version to
          manage or recover its assets.
        </p>
        <div className="mt-4">
          <Button variant="secondary" full onClick={() => pushScreen({ id: 'vault', vaultId: vault.id })}>
            View legacy details →
          </Button>
        </div>
      </LedgerPanel>
    );
  }

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
          ? 'Task stopped · review remaining on-chain balances.'
          : vault.lastTradeAt
            ? `Last settlement observed ${fmtTimeAgo(vault.lastTradeAt)} · ${vault.tradeCount} settled action${vault.tradeCount === 1 ? '' : 's'}`
            : 'No settled Magic Actions observed yet.'}
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
  if (vault.status === 'legacy' || vault.legacy) {
    return (
      <>
        <StatusSwatch tone="iron" />
        Legacy · read-only
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
      budget: 'Blocked · Executor funding',
      reserve: 'Blocked · market inventory',
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
      title: 'Executor funding is low',
      body: 'The program-controlled Executor PDA may need more devnet SOL to run scheduled actions. Holdings remain redeemable in kind.',
    },
    reserve: {
      title: 'Devnet market inventory is insufficient',
      body: 'The program-owned test market cannot fill this trade right now. Holdings remain redeemable in kind.',
    },
  } as const;
  return (
    <Notice tone="danger" title={copy[reason].title}>
      {copy[reason].body}
    </Notice>
  );
}
