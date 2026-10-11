import { useState } from 'react';
import { useStore } from '../lib/store';
import { quoteSwap } from '../lib/solana/reserve';
import { bookStatus, priceOf, pricesFromBook, type PriceBook } from '../lib/solana/price';
import { PRICE_MAX_AGE_MS } from '../lib/solana/config';
import { ASSET_IDS, assetList, assetSpec, type AssetId } from '../lib/solana/assets';
import { explorerAddress } from '../lib/solana/connection';
import {
  fmtSol,
  fmtToken,
  fmtUsd,
  lamportsFromSol,
  parseAmount,
  rawFromToken,
  shortKey,
} from '../lib/format';
import { useNow } from '../hooks/useNow';
import { Screen, ScreenHeading } from '../components/ui/Screen';
import { Button } from '../components/ui/Button';
import { LedgerPanel } from '../components/ui/LedgerPanel';
import { Sheet } from '../components/ui/Sheet';
import { Field, inputClass, selectClass } from '../components/ui/Field';
import { AssetSwatch, KeyValue, MicroLabel, Notice, Skeleton, StatusSwatch } from '../components/ui/primitives';

/** Wallet tab: the owner key, its balances, the faucet, the reserve desk, and seed controls. */
export function WalletScreen() {
  useNow(1000);

  const wallet = useStore((s) => s.wallet);
  const balances = useStore((s) => s.walletBalances);
  const price = useStore((s) => s.price);
  const reserve = useStore((s) => s.reserve);
  const airdrop = useStore((s) => s.airdrop);
  const wrap = useStore((s) => s.wrap);
  const convert = useStore((s) => s.convert);

  const [fromAsset, setFromAsset] = useState<AssetId>('wsol');
  const [toAsset, setToAsset] = useState<AssetId>('tusd');
  const [amount, setAmount] = useState('');
  const [seedOpen, setSeedOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [wrapOpen, setWrapOpen] = useState(false);
  const [wrapAmount, setWrapAmount] = useState('0.10');
  const [wrapSubmitting, setWrapSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!wallet) return null;

  const priceOk = bookStatus(price, PRICE_MAX_AGE_MS) === 'fresh' && price !== null;
  const fromSpec = assetSpec(fromAsset);
  const toSpec = assetSpec(toAsset);

  const units = parseAmount(amount);
  const inRaw = units === null ? null : units > 0 ? rawFromToken(units, fromSpec.decimals) : null;
  const maxRaw = balances ? balances.tokens[fromAsset] ?? 0 : null;
  const overBalance = inRaw !== null && maxRaw !== null && inRaw > maxRaw;

  const prices = price ? pricesFromBook(price) : null;
  let quote: ReturnType<typeof quoteSwap> | null = null;
  let quoteError: string | null = null;
  if (priceOk && prices && reserve && inRaw !== null && !overBalance) {
    try {
      quote = quoteSwap({ inAsset: fromAsset, outAsset: toAsset, inRaw, prices, reserve });
    } catch (err) {
      quoteError = err instanceof Error ? err.message : 'quote failed';
    }
  }

  const canConvert = quote !== null && priceOk && !overBalance && inRaw !== null;
  const solValue =
    balances && prices
      ? (balances.solLamports / 1e9) * (prices.wsol ?? 0) +
        assetList().reduce((sum, spec) => sum + ((balances.tokens[spec.id] ?? 0) / 10 ** spec.decimals) * (prices[spec.id] ?? 0), 0)
      : null;

  const bookMeta = priceBookMeta(price);

  return (
    <Screen>
      <ScreenHeading
        micro="W / Owner wallet"
        title="The owner key."
        sub="Provisions vaults, pays owner fees, and holds what automation earns. The faucet and the reserve desk live here."
      />

      <LedgerPanel stripe="Owner address" meta={shortKey(wallet.publicKey)}>
        <p className="break-all font-mono text-[11.5px] leading-relaxed font-bold">{wallet.publicKey}</p>
        <div className="mt-2.5 flex items-center justify-between gap-3">
          <MicroLabel>m/44'/501'/0'/0' · SLIP-0010</MicroLabel>
          <a
            href={explorerAddress(wallet.publicKey)}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[11px] font-bold text-petrol underline underline-offset-2"
          >
            View on explorer ↗
          </a>
        </div>
      </LedgerPanel>

      <div className="mt-4">
        <LedgerPanel stripe="Balances" meta={bookMeta}>
          {balances ? (
            <>
              <KeyValue
                rows={[
                  { k: 'SOL · unwrapped', v: `${fmtSol(balances.solLamports, 6)}` },
                  // core assets always; extended assets only when actually held
                  ...assetList()
                    .filter((spec) => spec.core || (balances.tokens[spec.id] ?? 0) > 0)
                    .map((spec) => ({
                      k: (
                        <span className="flex items-center gap-2">
                          <AssetSwatch color={spec.color} /> {spec.symbol}
                        </span>
                      ),
                      v: fmtToken(balances.tokens[spec.id] ?? 0, spec.decimals, 6),
                    })),
                  { k: 'Total value', v: solValue !== null ? fmtUsd(solValue) : '—' },
                ]}
              />
              <div className="mt-4 grid grid-cols-2 gap-2.5">
                <Button variant="secondary" onClick={() => void airdrop()}>
                  Faucet · 1 SOL
                </Button>
                <Button variant="secondary" onClick={() => setWrapOpen(true)}>
                  Wrap SOL → WSOL
                </Button>
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-iron">
                The reserve desk trades from WSOL. Wrap SOL first to swap it into any other asset.
              </p>
            </>
          ) : (
            <div className="space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          )}
        </LedgerPanel>
      </div>

      <div className="mt-4">
        <LedgerPanel stripe="Reserve desk" meta={reserve ? 'funded' : 'reading inventory'}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From">
              <select
                value={fromAsset}
                onChange={(e) => {
                  const next = e.target.value as AssetId;
                  setFromAsset(next);
                  if (next === toAsset) {
                    setToAsset(ASSET_IDS.find((id) => id !== next) ?? 'tusd');
                  }
                  setAmount('');
                }}
                className={selectClass}
                aria-label="Asset to convert from"
              >
                {assetList().map((spec) => (
                  <option key={spec.id} value={spec.id}>
                    {spec.symbol}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="To">
              <select
                value={toAsset}
                onChange={(e) => setToAsset(e.target.value as AssetId)}
                className={selectClass}
                aria-label="Asset to convert to"
              >
                {assetList()
                  .filter((spec) => spec.id !== fromAsset)
                  .map((spec) => (
                    <option key={spec.id} value={spec.id}>
                      {spec.symbol}
                    </option>
                  ))}
              </select>
            </Field>
          </div>

          <Field
            label={`Amount in ${fromSpec.symbol}`}
            hint={
              balances
                ? `you hold ${fmtToken(balances.tokens[fromAsset] ?? 0, fromSpec.decimals, 6)} ${fromSpec.symbol}`
                : undefined
            }
            error={
              overBalance
                ? 'Exceeds your balance.'
                : parseAmount(amount) === null && amount.trim() !== ''
                  ? 'Not a valid amount.'
                  : undefined
            }
          >
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={inputClass}
              aria-label="Amount to convert"
              placeholder="0.00"
            />
          </Field>

          {quote ? (
            <KeyValue
              rows={[
                {
                  k: 'You receive',
                  v: `${fmtToken(quote.outRaw, toSpec.decimals, 6)} ${toSpec.symbol}`,
                },
                { k: 'Total fee', v: `${quote.totalFeePct.toFixed(2)}% (spread 0.30 + curve ${quote.curvePct.toFixed(2)})` },
                {
                  k: 'Effective rate',
                  v: `${quote.effectivePrice.toPrecision(6)} ${toSpec.symbol} per ${fromSpec.symbol}`,
                },
              ]}
            />
          ) : quoteError ? (
            <div className="mt-2">
              <Notice tone="danger" title="Cannot quote">
                {quoteError}
              </Notice>
            </div>
          ) : !priceOk ? (
            <div className="mt-2">
              <Notice tone="brass" title="Waiting for a fresh price">
                The desk quotes only against live observations for both assets. It retries automatically.
              </Notice>
            </div>
          ) : null}

          <div className="mt-4">
            <Button
              variant="primary"
              full
              disabled={!canConvert}
              onClick={() => {
                if (canConvert && inRaw !== null) void convert(fromAsset, toAsset, inRaw);
              }}
            >
              Convert via reserve
            </Button>
          </div>

          {reserve ? (
            <p className="mt-3 flex items-center gap-1.5 text-[11px] leading-relaxed text-iron">
              <StatusSwatch tone="petrol" />
              Reserve holds{' '}
              {assetList()
                .filter((spec) => spec.core || (reserve.tokens[spec.id] ?? 0) > 0)
                .map((spec) => `${fmtToken(reserve.tokens[spec.id] ?? 0, spec.decimals, 2)} ${spec.symbol}`)
                .join(' · ')}
            </p>
          ) : null}
        </LedgerPanel>
      </div>

      <div className="mt-4">
        <LedgerPanel stripe="Owner key controls" meta="device-local">
          <div className="grid grid-cols-2 gap-2.5">
            <Button variant="secondary" onClick={() => setSeedOpen(true)}>
              Export seed
            </Button>
            <Button variant="danger" onClick={() => setResetOpen(true)}>
              Reset app
            </Button>
          </div>
        </LedgerPanel>
      </div>

      <WrapSheet
        open={wrapOpen}
        onClose={() => setWrapOpen(false)}
        wrap={wrap}
        amount={wrapAmount}
        setAmount={setWrapAmount}
        submitting={wrapSubmitting}
        setSubmitting={setWrapSubmitting}
        solLamports={balances?.solLamports ?? null}
      />

      <Sheet
        open={seedOpen}
        onClose={() => setSeedOpen(false)}
        micro="Export · BIP-39"
        title="Your seed phrase"
        footer={
          <Button
            variant="secondary"
            full
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(wallet.mnemonic);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? 'Copied to clipboard' : 'Copy seed phrase'}
          </Button>
        }
      >
        <div className="border-2 border-ink bg-ledger-subtle p-4">
          <p className="break-words font-mono text-[13px] font-bold leading-[1.9]">{wallet.mnemonic}</p>
        </div>
        <div className="mt-4">
          <Notice tone="danger" title="Anyone with these words owns the funds">
            Write them down and keep them offline. This demo stores the phrase unencrypted in this
            browser's local storage — devnet value only.
          </Notice>
        </div>
      </Sheet>

      <ResetSheet open={resetOpen} onClose={() => setResetOpen(false)} />
    </Screen>
  );
}

function priceBookMeta(price: PriceBook | null): string {
  if (!price) return 'price loading';
  const wsol = priceOf(price, 'wsol');
  if (wsol === null) return 'price loading';
  const fresh = assetList().filter((spec) => priceOf(price, spec.id) !== null).length;
  return `SOL $${wsol.toFixed(2)} · ${fresh}/${assetList().length} mids`;
}

function WrapSheet({
  open,
  onClose,
  wrap,
  amount,
  setAmount,
  submitting,
  setSubmitting,
  solLamports,
}: {
  open: boolean;
  onClose: () => void;
  wrap: (lamports: number) => Promise<void>;
  amount: string;
  setAmount: (v: string) => void;
  submitting: boolean;
  setSubmitting: (v: boolean) => void;
  solLamports: number | null;
}) {
  const parsed = parseAmount(amount);
  const over = solLamports !== null && parsed !== null && lamportsFromSol(parsed) > solLamports;
  const canWrap = parsed !== null && parsed > 0 && !over;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      micro="Wrap · devnet"
      title="Wrap SOL into WSOL"
      footer={
        <Button
          variant="primary"
          full
          loading={submitting}
          disabled={!canWrap}
          onClick={async () => {
            if (!canWrap || parsed === null) return;
            setSubmitting(true);
            try {
              await wrap(lamportsFromSol(parsed));
              onClose();
            } finally {
              setSubmitting(false);
            }
          }}
        >
          Wrap {parsed !== null && parsed > 0 ? `${parsed} SOL` : 'SOL'}
        </Button>
      }
    >
      <Field
        label="Amount in SOL"
        hint={solLamports !== null ? `you hold ${fmtSol(solLamports)} SOL unwrapped` : undefined}
        error={over ? 'Exceeds your unwrapped SOL.' : undefined}
      >
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className={inputClass}
          aria-label="SOL amount to wrap"
        />
      </Field>
      <Notice tone="petrol" title="WSOL stays an SPL token">
        Wrapping creates (or tops up) your wrapped-SOL token account. The vault setup and the
        reserve desk both trade from WSOL.
      </Notice>
    </Sheet>
  );
}

function ResetSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const resetApp = useStore((s) => s.resetApp);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      micro="Reset · destructive"
      title="Reset this device"
      footer={
        <Button
          variant="danger"
          full
          onClick={() => {
            resetApp();
            onClose();
          }}
        >
          Erase wallet and vaults
        </Button>
      }
    >
      <Notice tone="danger" title="Vaults must be emptied first">
        Resetting erases the owner mnemonic and every vault custody keypair from this device. Any
        SOL or tokens still inside vaults becomes unreachable. Withdraw or close your vaults
        before resetting.
      </Notice>
    </Sheet>
  );
}
