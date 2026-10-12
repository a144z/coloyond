import { useEffect, useState } from 'react';
import { ArrowSquareOut } from '@phosphor-icons/react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { useStore } from '../lib/store.js';
import {
  formatRawAmount,
  parseTokenAmount,
  resolveMetadataUri,
  type ExploreVault,
} from '../lib/solana/explore.js';
import { explorerAddress } from '../lib/solana/connection.js';
import { bookStatus, priceOf } from '../lib/solana/price.js';
import { PRICE_MAX_AGE_MS } from '../lib/solana/config.js';
import { fmtUsd, shortKey } from '../lib/format.js';
import { Screen, ScreenHeading } from '../components/ui/Screen.js';
import { Button } from '../components/ui/Button.js';
import { Field, inputClass } from '../components/ui/Field.js';
import { LedgerPanel } from '../components/ui/LedgerPanel.js';
import { Sheet } from '../components/ui/Sheet.js';
import { KeyValue, MicroLabel, Notice, Skeleton, StatusSwatch } from '../components/ui/primitives.js';
import { ShareMetadataManager } from './ShareMetadataEditor.js';

export function ExploreScreen() {
  const vaults = useStore((state) => state.exploreVaults);
  const loading = useStore((state) => state.exploreLoading);
  const hasLoaded = useStore((state) => state.exploreHasLoaded);
  const error = useStore((state) => state.exploreError);
  const rejected = useStore((state) => state.exploreRejectedAccounts);
  const price = useStore((state) => state.price);
  const refreshExplore = useStore((state) => state.refreshExplore);
  const refreshPrice = useStore((state) => state.refreshPrice);
  const [investing, setInvesting] = useState<ExploreVault | null>(null);

  useEffect(() => {
    void refreshExplore();
    void refreshPrice();
  }, [refreshExplore, refreshPrice]);

  return (
    <Screen>
      <div className="flex items-start justify-between gap-3">
        <ScreenHeading
          micro="02 / Explore · Solana devnet"
          title="Portfolios on-chain."
          sub={<>Active Vault State accounts are read from Solana. Token metadata helps identify a share mint; verified vault facts always come from the program.</>}
        />
        <button type="button" onClick={() => void refreshExplore()} disabled={loading} aria-label="Refresh on-chain portfolios" className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center border border-panel bg-ledger text-ink disabled:opacity-50">
          <span aria-hidden className={`text-[22px] leading-none ${loading ? 'animate-spin' : ''}`}>↻</span>
        </button>
      </div>

      {rejected > 0 ? (
        <div className="mb-4">
          <Notice tone="brass" title="Some accounts were not listed">
            {rejected} account{rejected === 1 ? ' was' : 's were'} not listed because the Vault State, mint, PDA, asset, or custody checks failed. Valid verified portfolios remain visible below.
          </Notice>
        </div>
      ) : null}

      {error ? (
        <LedgerPanel stripe="Devnet read failed" meta="not cached">
          <Notice tone="danger" title="Could not read on-chain portfolios">{error}</Notice>
          <div className="mt-4"><Button full variant="secondary" onClick={() => void refreshExplore()}>Retry Solana read</Button></div>
        </LedgerPanel>
      ) : null}

      {loading || !hasLoaded ? (
        <LedgerPanel stripe="Reading Vault State accounts" meta="confirmed">
          <p className="mb-3 text-[11px] leading-relaxed text-iron">Checking the program accounts, active status, share mints and custody accounts on Solana devnet.</p>
          <div className="space-y-3"><Skeleton className="h-5 w-3/4" /><Skeleton className="h-20 w-full" /><Skeleton className="h-5 w-1/2" /></div>
        </LedgerPanel>
      ) : null}

      {!loading && hasLoaded && !error && vaults.length === 0 ? (
        <LedgerPanel stripe="No active portfolios" meta="on-chain query complete">
          <p className="py-5 text-center font-display text-[18px] font-bold">No verified active portfolios found.</p>
          <p className="mx-auto max-w-[38ch] text-center text-[12px] leading-relaxed text-iron">Explore checks Vault State accounts directly on Solana devnet. Your browser’s saved portfolio list is not used here.</p>
        </LedgerPanel>
      ) : null}

      {!error && vaults.length > 0 ? (
        <div className="space-y-4">
          {vaults.map((vault) => (
            <ExploreCard key={vault.address} vault={vault} price={price} onInvest={() => setInvesting(vault)} />
          ))}
        </div>
      ) : null}

      {investing ? <InvestSheet vault={investing} open onClose={() => setInvesting(null)} /> : null}
    </Screen>
  );
}

function ExploreCard({ vault, price, onInvest }: { vault: ExploreVault; price: ReturnType<typeof useStore.getState>['price']; onInvest: () => void }) {
  const name = vault.metadata?.name ?? `Vault ${shortKey(vault.address)}`;
  const totalEstimate = estimateUsd(vault.assets.map((asset) => ({ id: asset.id, raw: BigInt(asset.amountRaw), decimals: asset.decimals })), price);
  const metadataUri = vault.metadata?.uri;
  let metadataLink: string | null = null;
  if (metadataUri) {
    try { metadataLink = resolveMetadataUri(metadataUri); } catch { /* the verifier has already recorded the issue */ }
  }

  return (
    <LedgerPanel stripe={name} meta={vault.metadata?.symbol ? `$${vault.metadata.symbol}` : 'unlabelled share mint'} bodyClassName="pt-4">
      {vault.metadata?.image ? (
        <img src={vault.metadata.image} alt={`${name} token image`} loading="lazy" referrerPolicy="no-referrer" className="mb-4 h-36 w-full rounded-md border border-hairline bg-pulp-shade object-cover" />
      ) : null}

      <div className="mb-3 flex items-center gap-2 text-[11px] font-bold text-petrol"><StatusSwatch tone="petrol" />Verified active Vault State</div>
      {vault.metadata?.description ? <p className="mb-3 text-[12px] leading-relaxed text-iron">{vault.metadata.description}</p> : null}

      <KeyValue rows={[
        { k: 'Creator · on-chain owner', v: <ExplorerLink address={vault.creator} /> },
        { k: 'Vault State', v: <ExplorerLink address={vault.address} /> },
        { k: 'Share mint', v: <ExplorerLink address={vault.shareMint} /> },
        { k: 'Share supply', v: `${formatRawAmount(vault.shareSupplyRaw, 9)} shares` },
        { k: 'Estimated holdings value', v: totalEstimate === null ? 'Unavailable · missing or stale price' : fmtUsd(totalEstimate) },
      ]} />
      <p className="mt-2 text-[10.5px] leading-relaxed text-iron">Holdings and target weights are read from verified on-chain accounts. USD value is a display estimate: live market prices for WSOL/tBTC/tETH and the program’s fixed $1 demo accounting assumption for TUSD/dUSD. It is not protocol NAV; missing or stale live prices make the estimate unavailable.</p>

      <div className="mt-4 border-t border-hairline pt-3">
        <MicroLabel>Assets · live custody balance / target</MicroLabel>
        <div className="mt-2 space-y-2.5">
          {vault.assets.map((asset) => (
            <div key={asset.mint} className="flex items-center justify-between gap-3 text-[12px]">
              <span className="min-w-0"><i aria-hidden className="mr-2 inline-block h-2.5 w-2.5" style={{ backgroundColor: asset.color }} />{asset.symbol}<span className="ml-1 text-[10px] text-iron">{shortKey(asset.mint)}</span></span>
              <span className="shrink-0 text-right font-mono">{formatRawAmount(asset.amountRaw, asset.decimals)} <span className="text-iron">/ {(asset.targetBps / 100).toFixed(2)}%</span></span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 border-t border-hairline pt-3">
        <MicroLabel>Metaplex share metadata</MicroLabel>
        {vault.metadata ? (
          <KeyValue rows={[
            { k: 'Name / symbol', v: `${vault.metadata.name} · ${vault.metadata.symbol}` },
            { k: 'Metadata URI', v: metadataLink ? <a href={metadataLink} target="_blank" rel="noreferrer" className="break-all text-petrol underline">{vault.metadata.uri}</a> : vault.metadata.uri },
            { k: 'Vault Authority PDA', v: <ExplorerLink address={vault.authority} /> },
            { k: 'Metadata update authority', v: <ExplorerLink address={vault.metadata.updateAuthority} /> },
            { k: 'Update policy', v: !vault.metadata.isMutable
              ? 'Immutable · metadata updates disabled'
              : vault.metadata.updateAuthority === vault.authority
                ? 'Vault owner may update name and URI through the program; the generated symbol is fixed.'
                : 'Mutable, but the authority does not match this vault’s PDA; the program update path is unavailable.' },
          ]} />
        ) : (
          <Notice tone="brass" title={vault.metadataIssue?.startsWith('No Metaplex') ? 'Metadata missing' : 'Metadata unavailable'}>
            {vault.metadataIssue ?? 'The Metaplex metadata account could not be verified. Verified Vault State details remain available.'}
          </Notice>
        )}
        {vault.metadata && vault.metadataIssue ? <p className="mt-2 text-[11px] text-iron">{vault.metadataIssue} · On-chain metadata name, symbol and URI are still shown.</p> : null}
      </div>

      <ShareMetadataManager stateAddress={vault.address} />

      <div className="mt-4"><Button variant="primary" full onClick={onInvest}>Invest in this portfolio</Button></div>
    </LedgerPanel>
  );
}

function InvestSheet({ vault, open, onClose }: { vault: ExploreVault; open: boolean; onClose: () => void }) {
  const invest = useStore((state) => state.investExploreVault);
  const connectedWallet = useStore((state) => state.connectedWallet);
  const deviceWallet = useStore((state) => state.wallet);
  const setTab = useStore((state) => state.setTab);
  const { setVisible } = useWalletModal();
  const price = useStore((state) => state.price);
  const [amountText, setAmountText] = useState<Record<string, string>>({});
  const [minimumText, setMinimumText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const hasWallet = !!connectedWallet || !!deviceWallet;
  const parsed = vault.assets.map((asset) => ({ asset, amount: parseTokenAmount(amountText[asset.mint] ?? '', asset.decimals) }));
  const anyAmount = parsed.some(({ amount }) => amount !== null && amount > 0n);
  const inputAmounts = Object.fromEntries(parsed.filter(({ amount }) => amount !== null).map(({ asset, amount }) => [asset.mint, amount!])) as Record<string, bigint>;
  const minShares = parseTokenAmount(minimumText, 9);
  const validAmounts = parsed.every(({ amount }) => amount !== null && amount <= (1n << 64n) - 1n);
  const canSubmit = hasWallet && validAmounts && anyAmount && minShares !== null && minShares > 0n && minShares <= (1n << 64n) - 1n;
  return (
    <Sheet open={open} onClose={onClose} micro="Invest · on-chain NAV" title={vault.metadata?.name ?? `Vault ${shortKey(vault.address)}`} footer={
      <Button variant="primary" full loading={submitting} disabled={!canSubmit} onClick={async () => {
        if (!canSubmit || minShares === null) return;
        setSubmitting(true);
        try {
          if (await invest(vault.address, inputAmounts, minShares)) onClose();
        } finally {
          setSubmitting(false);
        }
      }}>Review deposit and mint shares</Button>
    }>
      <p className="mb-3 text-[12px] leading-relaxed text-iron">Enter exact token amounts for assets already configured in this vault. The program reads live custody balances and its configured oracle feeds, then mints transferable SPL shares atomically at on-chain NAV.</p>
      <div className="space-y-2">
        {vault.assets.map((asset) => (
          <Field key={asset.mint} label={`${asset.id === 'wsol' ? 'SOL to wrap · ' : ''}${asset.symbol} amount`} hint={`${asset.name} · ${asset.decimals} decimals · ${shortKey(asset.mint)}`}>
            <input inputMode="decimal" value={amountText[asset.mint] ?? ''} onChange={(event) => setAmountText((current) => ({ ...current, [asset.mint]: event.target.value }))} className={inputClass} aria-label={`${asset.symbol} amount`} placeholder="0" />
          </Field>
        ))}
      </div>

      <Field label="Minimum shares out · 9 decimals" hint="Enter the smallest share amount you are willing to receive. No display-price estimate is used for this transaction guard.">
        <input inputMode="decimal" value={minimumText} onChange={(event) => setMinimumText(event.target.value)} className={inputClass} aria-label="Minimum shares out" placeholder="Required" />
      </Field>

      <Notice tone="brass" title="Check the minimum before signing">
        Share output is calculated from on-chain oracle NAV. Choose and review your minimum explicitly; if the program would mint fewer shares, the transaction fails safely. {vault.assets.some((asset) => asset.id === 'wsol') ? 'WSOL amount is wrapped from native SOL in this transaction.' : ''}
      </Notice>
      {!hasWallet ? <div className="mt-3"><Button variant="secondary" full onClick={() => { onClose(); if (connectedWallet) setTab('wallet'); else if (deviceWallet) setTab('wallet'); else setVisible(true); }}>Connect or set up a wallet</Button></div> : null}
      <div className="mt-3"><KeyValue rows={[
        { k: 'Vault State', v: <ExplorerLink address={vault.address} /> },
        { k: 'Share mint', v: <ExplorerLink address={vault.shareMint} /> },
        { k: 'Minimum share output', v: minShares && minShares > 0n ? formatRawAmount(minShares.toString(), 9, 9) : 'Required' },
      ]} /></div>
    </Sheet>
  );
}

function estimateUsd(items: { id: string; raw: bigint; decimals: number }[], price: ReturnType<typeof useStore.getState>['price']): number | null {
  const hasLiveMarketAsset = items.some((item) => item.id !== 'dusd' && item.id !== 'tusd');
  if (hasLiveMarketAsset && bookStatus(price, PRICE_MAX_AGE_MS) !== 'fresh') return null;
  let total = 0;
  for (const item of items) {
    const usd = item.id === 'dusd' || item.id === 'tusd' ? 1 : priceOf(price, item.id);
    if (usd === null || !Number.isFinite(usd)) return null;
    total += Number(item.raw) / 10 ** item.decimals * usd;
  }
  return Number.isFinite(total) ? total : null;
}

function ExplorerLink({ address }: { address: string }) {
  return <a href={explorerAddress(address)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[11px] font-bold text-petrol underline underline-offset-2">{shortKey(address)} <ArrowSquareOut size={11} aria-hidden /></a>;
}
