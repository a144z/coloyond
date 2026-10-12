import { useStore } from '../lib/store.js';
import { bookStatus, priceEntryOf, pricesFromBook } from '../lib/solana/price.js';
import { reserveOwner } from '../lib/solana/reserve-read.js';
import { reserveDepthUsd } from '../lib/solana/reserve-quote.js';
import { assetList } from '../lib/solana/assets.js';
import {
  PRICE_MAX_AGE_MS,
  RPC_URL,
} from '../lib/solana/config.js';
import { explorerAddress } from '../lib/solana/connection.js';
import { fmtTimeAgo, fmtToken, fmtUsd, shortKey } from '../lib/format.js';
import { useNow } from '../hooks/useNow.js';
import { Screen, ScreenHeading } from '../components/ui/Screen.js';
import { LedgerPanel } from '../components/ui/LedgerPanel.js';
import { AssetSwatch, KeyValue, Notice, SignatureLink, StatusSwatch } from '../components/ui/primitives.js';

/** 04 / System — every subsystem the product depends on, shown live. */
export function SystemScreen() {
  useNow(1000);

  const rpc = useStore((s) => s.rpc);
  const price = useStore((s) => s.price);
  const priceError = useStore((s) => s.priceError);
  const reserve = useStore((s) => s.reserve);
  const vaults = useStore((s) => s.vaults);
  const logs = useStore((s) => s.logs);
  const wallet = useStore((s) => s.wallet);
  const connectedWallet = useStore((s) => s.connectedWallet);

  const status = bookStatus(price, PRICE_MAX_AGE_MS);
  const reserveAddress = reserveOwner.toBase58();
  const reserveDepth = reserve && price ? reserveDepthUsd(reserve, pricesFromBook(price)) : null;
  const active = vaults.filter((v) => v.status === 'active').length;
  const paused = vaults.filter((v) => v.status === 'paused').length;
  const closed = vaults.filter((v) => v.status === 'closed').length;
  const legacy = vaults.filter((v) => v.legacy || v.status === 'legacy').length;

  return (
    <Screen>
      <ScreenHeading
        micro="04 / System"
        title="The working parts."
        sub="No sample data anywhere: each panel reads the live devnet RPC, the price feed, or this device."
      />

      <LedgerPanel stripe="RPC" meta={rpc ? `slot ${rpc.slot}` : '…'}>
        {rpc ? (
          <KeyValue
            rows={[
              { k: 'Cluster', v: 'devnet' },
              { k: 'Endpoint', v: <span className="break-all">{RPC_URL.replace('https://', '')}</span> },
              { k: 'Ping', v: `${rpc.pingMs} ms` },
              { k: 'Confirmed slot', v: String(rpc.slot) },
              { k: 'Last read', v: fmtTimeAgo(rpc.at) },
            ]}
          />
        ) : (
          <p className="text-[12px] text-iron">Reading the RPC…</p>
        )}
      </LedgerPanel>

      <div className="mt-4">
        <LedgerPanel stripe="Price observation" meta={status}>
          {price ? (
            <KeyValue
              rows={[
                ...assetList().map((spec) => {
                  const entry = priceEntryOf(price, spec.id);
                  return {
                    k: (
                      <span className="flex items-center gap-2">
                        <AssetSwatch color={spec.color} /> {spec.symbol}
                      </span>
                    ),
                    v: entry
                      ? `${fmtUsd(entry.usd)} · ${
                          entry.source === 'coinbase' ? 'Coinbase spot' : entry.source === 'binance' ? 'Binance spot' : 'fixed $1'
                        }`
                      : 'unavailable',
                  };
                }),
                { k: 'Observed', v: fmtTimeAgo(price.observedAt) },
                { k: 'Age limit', v: `${PRICE_MAX_AGE_MS / 1000} seconds` },
                {
                  k: 'Status',
                  v: (
                    <span className="inline-flex items-center gap-1.5">
                      <StatusSwatch tone={status === 'fresh' ? 'petrol' : 'danger'} pulse={status === 'fresh'} />
                      {status}
                    </span>
                  ),
                },
              ]}
            />
          ) : (
            <p className="text-[12px] text-iron">
              {priceError ?? 'Waiting for the first observation…'}
            </p>
          )}
          <p className="mt-3 text-[11px] leading-relaxed text-iron">
            This display book shows SOL, BTC and ETH mids from Coinbase (Binance fallback), with
            synthetic dUSD fixed at $1. Execution reads on-chain Pyth updates and checks feed identity
            and full verification; it does not reject a price based on its publish time.
          </p>
        </LedgerPanel>
      </div>

      <div className="mt-4">
        <LedgerPanel stripe="Program-owned test market" meta={reserve ? 'funded' : 'reading'}>
          {reserveAddress ? (
            <>
              <KeyValue
                rows={[
                  {
                    k: 'Reserve address',
                    v: (
                      <a
                        href={explorerAddress(reserveAddress ?? '')}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-[11px] font-bold text-petrol underline underline-offset-2"
                      >
                        {shortKey(reserveAddress ?? '')} ↗
                      </a>
                    ),
                  },
                  ...assetList().map((spec) => ({
                    k: (
                      <span className="flex items-center gap-2">
                        <AssetSwatch color={spec.color} /> {spec.symbol} inventory
                      </span>
                    ),
                    v: reserve ? fmtToken(reserve.tokens[spec.id] ?? 0, spec.decimals, 2) : '…',
                  })),
                  { k: 'Inventory at display prices', v: reserveDepth !== null ? fmtUsd(reserveDepth) : '…' },
                ]}
              />
              <p className="mt-3 text-[11px] leading-relaxed text-iron">
                The execution program controls these devnet market accounts. This is synthetic
                inventory with no real value; portfolio custody remains in each vault's own SPL
                accounts.
              </p>
            </>
          ) : (
            <Notice tone="brass" title="Test market unavailable">
              Program-owned devnet market token accounts are not initialized yet.
            </Notice>
          )}
        </LedgerPanel>
      </div>

      <div className="mt-4">
        <LedgerPanel stripe="Scheduler" meta="MagicBlock Ephemeral Rollups">
          <KeyValue
            rows={[
              { k: 'Execution', v: 'ER calculation → Magic Action → Solana vault program' },
              { k: 'Interval', v: 'Owner-configured per vault · 60 seconds to 24 hours' },
              { k: 'Dashboard sync', v: 'every 10 seconds while open' },
              { k: 'Vaults', v: `${active} active · ${paused} paused · ${closed} closed · ${legacy} legacy` },
            ]}
          />
          <p className="mt-3 text-[11px] leading-relaxed text-iron">
            One Hydra task is registered per active portfolio. Only its Executor PDA is delegated;
            Vault State and SPL token accounts stay on Solana. Wall-clock timing depends on an
            active permissionless Hydra cranker. The ER task skips early runs unless a Pyth-backed
            asset moves more than 0.1%; the vault program rechecks the guards before moving assets.
          </p>
        </LedgerPanel>
      </div>

      <div className="mt-4">
        <LedgerPanel stripe="Security" meta={connectedWallet ? 'browser wallet connected' : 'device-local keys'}>
          <ul className="space-y-1.5 text-[12px] leading-relaxed">
            <li className="flex gap-2">
              <StatusSwatch tone="petrol" />
              <span>
                {connectedWallet
                  ? `Connected owner wallet: ${connectedWallet.publicKey.toBase58()}. Transactions are approved by the wallet.`
                  : wallet
                    ? 'Device owner key: BIP-39 mnemonic derived via SLIP-0010, stored in this browser only.'
                    : 'No owner wallet connected.'}
              </span>
            </li>
            <li className="flex gap-2">
              <StatusSwatch tone="petrol" />
              <span>Vault Authority PDAs control portfolio SPL accounts; transferable shares use one SPL mint per vault.</span>
            </li>
            <li className="flex gap-2">
              <StatusSwatch tone="brass" />
              <span>
                Synthetic dUSD is capped at its program-issued devnet supply and displays at $1;
                it is not redeemable for real dollars. Test BTC and ETH are also devnet assets.
              </span>
            </li>
            <li className="flex gap-2">
              <StatusSwatch tone="ink" />
              <span>Each vault has its own fungible, transferable SPL share-token mint.</span>
            </li>
          </ul>
        </LedgerPanel>
      </div>

      <div className="mt-4">
        <LedgerPanel stripe="Recent activity" meta={`${logs.length} entries`}>
          {logs.length === 0 ? (
            <p className="text-[12px] text-iron">Nothing logged yet.</p>
          ) : (
            <ol>
              {logs.slice(0, 8).map((l) => (
                <li key={l.id} className="flex items-start justify-between gap-3 border-b border-hairline py-2.5 last:border-b-0">
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-bold">{l.summary}</span>
                    {l.sig ? <SignatureLink sig={l.sig} slot={l.slot} /> : null}
                  </span>
                  <span className="shrink-0 pt-0.5 text-[10px] text-iron">{fmtTimeAgo(l.at)}</span>
                </li>
              ))}
            </ol>
          )}
        </LedgerPanel>
      </div>

      <div className="mt-4">
        <LedgerPanel stripe="About" meta="coloyond beta">
          <KeyValue
            rows={[
              { k: 'Build', v: 'coloyond 0.2.0 · devnet demo' },
              { k: 'Assets', v: assetList().map((s) => s.symbol).join(' · ') },
              { k: 'Design', v: 'lacquerboard system · monumental stencil' },
              { k: 'Stack', v: 'React · Tailwind v4 · Solana web3.js' },
              { k: 'Android', v: 'Capacitor shell (see README)' },
            ]}
          />
        </LedgerPanel>
      </div>
    </Screen>
  );
}
