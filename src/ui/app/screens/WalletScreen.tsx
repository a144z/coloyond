import {transactionJournal,reconcileWalletTransaction,describeTxError} from '../lib/solana/tx.js';
import {SignatureLink} from '../components/ui/primitives.js';
import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useStore } from '../lib/store.js';
import { priceOf, type PriceBook } from '../lib/solana/price.js';
import { assetList } from '../lib/solana/assets.js';
import { explorerAddress } from '../lib/solana/connection.js';
import {
  fmtSol,
  fmtToken,
  fmtUsd,
  lamportsFromSol,
  parseAmount,
  shortKey,
} from '../lib/format.js';
import { useNow } from '../hooks/useNow.js';
import { Screen, ScreenHeading } from '../components/ui/Screen.js';
import { Button } from '../components/ui/Button.js';
import { LedgerPanel } from '../components/ui/LedgerPanel.js';
import { Sheet } from '../components/ui/Sheet.js';
import { Field, inputClass } from '../components/ui/Field.js';
import { AssetSwatch, KeyValue, MicroLabel, Notice, Skeleton } from '../components/ui/primitives.js';

/** Wallet tab: owner balances, SOL wrapping, and device-key controls. */
export function WalletScreen() {
  useNow(1000);
  const { disconnect } = useWallet();
  const toast = useStore((s) => s.toast);

  const wallet = useStore((s) => s.wallet);
  const connectedWallet = useStore((s) => s.connectedWallet);
  const balances = useStore((s) => s.walletBalances);
  const price = useStore((s) => s.price);
  const wrap = useStore((s) => s.wrap);
  const pushScreen = useStore((s) => s.pushScreen);

  const [checkingPending,setCheckingPending] = useState(false);
  const [pendingMessage,setPendingMessage] = useState('');
  const [resetOpen, setResetOpen] = useState(false);
  const [wrapOpen, setWrapOpen] = useState(false);
  const [wrapAmount, setWrapAmount] = useState('0.10');
  const [wrapSubmitting, setWrapSubmitting] = useState(false);

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
  const pending = transactionJournal.read(address);

  return (
    <Screen>
      <ScreenHeading
        micro="W / Owner wallet"
        title={external ? 'Your connected wallet.' : 'The owner key.'}
        sub={external
          ? 'Signs portfolio setup and owner actions, holds your SOL and token balances, and funds devnet transactions.'
          : 'Your device wallet signs portfolio setup and owner actions, holds your SOL and token balances, and funds devnet transactions.'}
      />

      {pending ? <div className="mb-4"><Notice tone="brass" title="Submitted · confirmation unresolved"><p className="text-[12px]">Check this signature before sending another transaction.</p><SignatureLink sig={pending.signature}/><div className="mt-3"><Button full loading={checkingPending} onClick={async()=>{setCheckingPending(true);try{const result=await reconcileWalletTransaction(address);setPendingMessage(result?'Confirmed. Refreshing wallet and portfolio reads.':'The blockhash expired with no transaction found. You may review a new transaction.');void useStore.getState().refreshBalances();for(const v of useStore.getState().vaults)void useStore.getState().refreshVaultBalances(v.id);}catch(e){setPendingMessage(describeTxError(e));}finally{setCheckingPending(false);}}}>Check confirmation</Button></div>{pendingMessage?<p className="mt-2 text-[11px]">{pendingMessage}</p>:null}</Notice></div>:null}
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

      {external ? <div className="mt-3"><Button full variant="secondary" onClick={() => void disconnect().catch((error: unknown) => toast('error', 'Could not disconnect', String(error)))}>Disconnect wallet</Button></div> : null}
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
              <div className="mt-4">
                <Button variant="secondary" full onClick={() => setWrapOpen(true)}>
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
          <p className="text-[12px] leading-relaxed text-iron">
            The owner key lives in this browser's local storage and signs your portfolio setup and
            owner actions. Resetting erases it along with every locally saved portfolio.
          </p>
          <div className="mt-4">
            <Button variant="danger" full onClick={() => setResetOpen(true)}>
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
        Resetting erases the owner key and every locally saved portfolio from this browser. On-chain
        vaults keep their assets, but this device can no longer sign for them. Make sure you have your
        own backup before you reset.
      </Notice>
    </Sheet>
  );
}
