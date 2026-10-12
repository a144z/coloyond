import { useState } from 'react';
import { useStore } from '../lib/store';
import { priceOf, type PriceBook } from '../lib/solana/price';
import { assetList } from '../lib/solana/assets';
import { explorerAddress } from '../lib/solana/connection';
import {
  fmtSol,
  fmtToken,
  fmtUsd,
  lamportsFromSol,
  parseAmount,
  shortKey,
} from '../lib/format';
import { useNow } from '../hooks/useNow';
import { Screen, ScreenHeading } from '../components/ui/Screen';
import { Button } from '../components/ui/Button';
import { LedgerPanel } from '../components/ui/LedgerPanel';
import { Sheet } from '../components/ui/Sheet';
import { Field, inputClass } from '../components/ui/Field';
import { AssetSwatch, KeyValue, MicroLabel, Notice, Skeleton } from '../components/ui/primitives';

/** Wallet tab: owner balances, SOL wrapping, the faucet, and seed controls. */
export function WalletScreen() {
  useNow(1000);

  const wallet = useStore((s) => s.wallet);
  const connectedWallet = useStore((s) => s.connectedWallet);
  const balances = useStore((s) => s.walletBalances);
  const price = useStore((s) => s.price);
  const airdrop = useStore((s) => s.airdrop);
  const wrap = useStore((s) => s.wrap);
  const pushScreen = useStore((s) => s.pushScreen);

  const [seedOpen, setSeedOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [wrapOpen, setWrapOpen] = useState(false);
  const [wrapAmount, setWrapAmount] = useState('0.10');
  const [wrapSubmitting, setWrapSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

  const external = connectedWallet !== null;
  const address = connectedWallet?.publicKey.toBase58() ?? wallet?.publicKey;
  if (!address) return null;

  const prices = price ? Object.fromEntries(assetList().map((spec) => [spec.id, priceOf(price, spec.id) ?? 0])) : null;

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
        title={external ? 'Your connected wallet.' : 'The owner key.'}
        sub={external
          ? 'Signs portfolio setup and owner actions, holds your SOL and token balances, and funds devnet transactions.'
          : 'Your device wallet signs portfolio setup and owner actions, holds your SOL and token balances, and funds devnet transactions.'}
      />

      <LedgerPanel stripe={external ? 'Connected wallet' : 'Owner address'} meta={shortKey(address)}>
        <p className="break-all font-mono text-[11.5px] leading-relaxed font-bold">{address}</p>
        <div className="mt-2.5 flex items-center justify-between gap-3">
          <MicroLabel>{external ? 'browser wallet · devnet' : "m/44'/501'/0'/0' · SLIP-0010"}</MicroLabel>
          <a
            href={explorerAddress(address)}
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
                  ...assetList().map((spec) => ({
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
                SOL is wrapped into WSOL when you fund a portfolio. Scheduled tasks trade vault assets toward your chosen mix.
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
        <LedgerPanel stripe="Swap into portfolio assets" meta="scheduled · devnet">
          <p className="text-[12px] leading-relaxed text-iron">
            Choose an allocation and deposit SOL. The app wraps it as WSOL and mints transferable vault shares; the Hydra task can trade the vault's standard SPL assets toward those weights.
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-iron">
            This build does not execute an instant wallet swap. Portfolio cranks use the owner-configured delay and need more than 0.1% movement in a Pyth-backed asset. dUSD is synthetic Devnet USD with a fixed $1 display price.
          </p>
          <Button variant="primary" full onClick={() => pushScreen({ id: 'create' })}>
            Create portfolio →
          </Button>
        </LedgerPanel>
      </div>

      {!external && wallet ? <div className="mt-4">
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
      </div> : null}

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
                if (!wallet) return;
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
        {wallet ? <div className="border-2 border-ink bg-ledger-subtle p-4">
          <p className="break-words font-mono text-[13px] font-bold leading-[1.9]">{wallet.mnemonic}</p>
        </div> : null}
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
  const priced = assetList().filter((spec) => priceOf(price, spec.id) !== null).length;
  return `SOL $${wsol.toFixed(2)} · ${priced}/${assetList().length} mids`;
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
        Wrapping creates (or tops up) your wrapped-SOL token account. Portfolio deposits can wrap SOL into the owner's WSOL ATA before depositing it.
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
      <Notice tone="danger" title="Save access before resetting">
        Resetting erases the owner mnemonic and locally saved portfolio data. You need the mnemonic
        to authorize future deposits, redemptions and weight changes. Older keypair-based portfolios
        are read-only here; use the previous app version to recover them before resetting.
      </Notice>
    </Sheet>
  );
}
