import { useStore } from '../lib/store';
import { bookStatus, priceEntryOf, pricesFromBook } from '../lib/solana/price';
import { reserveKeypair, reserveDepthUsd } from '../lib/solana/reserve';
import { assetList } from '../lib/solana/assets';
import {
  CURVE_BASE_PCT,
  CURVE_CAP_PCT,
  PRICE_MAX_AGE_MS,
  RESERVE_SPREAD_PCT,
  RPC_URL,
} from '../lib/solana/config';
import { keysJson } from '../lib/solana/demo-keys';
import { explorerAddress } from '../lib/solana/connection';
import { fmtSol, fmtTimeAgo, fmtToken, fmtUsd, shortKey } from '../lib/format';
import { useNow } from '../hooks/useNow';
import { Screen, ScreenHeading } from '../components/ui/Screen';
import { LedgerPanel } from '../components/ui/LedgerPanel';
import { AssetSwatch, KeyValue, Notice, SignatureLink, StatusSwatch } from '../components/ui/primitives';

/** 04 / System — every subsystem the product depends on, shown live. */
export function SystemScreen() {
  useNow(1000);

  const rpc = useStore((s) => s.rpc);
  const price = useStore((s) => s.price);
  const priceError = useStore((s) => s.priceError);
  const reserve = useStore((s) => s.reserve);
  const vaults = useStore((s) => s.vaults);
  const logs = useStore((s) => s.logs);

  const status = bookStatus(price, PRICE_MAX_AGE_MS);
  const keysReady = Boolean(
    keysJson.reserveSecretB58 &&
    ['tusd', 'tbtc', 'teth'].every((id) => keysJson.mints?.[id]?.address),
  );
  const reserveAddress = keysReady ? reserveKeypair().publicKey.toBase58() : null;
  const reserveDepth = reserve && price ? reserveDepthUsd(reserve, pricesFromBook(price)) : null;
  const active = vaults.filter((v) => v.status === 'active').length;
  const paused = vaults.filter((v) => v.status === 'paused').length;
  const closed = vaults.filter((v) => v.status === 'closed').length;

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
            One book covers every asset: SOL, BTC and ETH mids come from Coinbase (Binance
            fallback), tUSD is fixed $1. Stale or missing observations block automation trades by
            design. Holdings stay withdrawable in kind.
          </p>
        </LedgerPanel>
      </div>

      <div className="mt-4">
        <LedgerPanel stripe="Demo reserve" meta={reserve ? 'funded' : 'reading'}>
          {keysReady ? (
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
                  { k: 'Depth at live mids', v: reserveDepth !== null ? fmtUsd(reserveDepth) : '…' },
                  { k: 'SOL for fees', v: reserve ? `${fmtSol(reserve.solLamports, 4)} SOL` : '…' },
                  { k: 'Spread', v: `${RESERVE_SPREAD_PCT.toFixed(2)}% flat` },
                  {
                    k: 'Curve fee',
                    v: `${CURVE_BASE_PCT.toFixed(2)}% · capped ${CURVE_CAP_PCT.toFixed(2)}%`,
                  },
                ]}
              />
              <p className="mt-3 text-[11px] leading-relaxed text-iron">
                Shared, finite, devnet-only inventory. The reserve keypair co-signs every swap;
                traders pay their own fees. The curve fee scales with trade size against total
                depth across all assets.
              </p>
            </>
          ) : (
            <Notice tone="brass" title="Demo keys missing">
              Run <code className="font-mono font-bold">npm run bootstrap:reserve</code> once to
              generate the reserve keypair, create the Test USD mint and fund the inventory. The
              app works right after.
            </Notice>
          )}
        </LedgerPanel>
      </div>

      <div className="mt-4">
        <LedgerPanel stripe="Scheduler" meta="in-app stand-in">
          <KeyValue
            rows={[
              { k: 'State', v: 'Running while the app is open' },
              { k: 'Tick', v: 'every 3 seconds' },
              { k: 'Vaults', v: `${active} active · ${paused} paused · ${closed} closed` },
            ]}
          />
          <p className="mt-3 text-[11px] leading-relaxed text-iron">
            The native design delegates execution to MagicBlock's engine so schedules survive a
            closed app. This web build keeps the same decision logic (fresh price, budget floor,
            drift threshold) in a local scheduler instead.
          </p>
        </LedgerPanel>
      </div>

      <div className="mt-4">
        <LedgerPanel stripe="Security" meta="device-local keys">
          <ul className="space-y-1.5 text-[12px] leading-relaxed">
            <li className="flex gap-2">
              <StatusSwatch tone="petrol" />
              <span>
                Owner key: BIP-39 mnemonic derived via SLIP-0010, stored in this browser only.
              </span>
            </li>
            <li className="flex gap-2">
              <StatusSwatch tone="petrol" />
              <span>Vault custody keypairs: separate per portfolio, signing authority for trades.</span>
            </li>
            <li className="flex gap-2">
              <StatusSwatch tone="brass" />
              <span>
                Demo reserve + synthetic mint authorities (tUSD, tBTC, tETH): devnet-only
                infrastructure, shipped with this build. Replace with a backend service outside
                devnet.
              </span>
            </li>
            <li className="flex gap-2">
              <StatusSwatch tone="ink" />
              <span>No pooled capital, no LP shares, no transferable vault tokens.</span>
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
