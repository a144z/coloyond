import { useState } from 'react';
import { useStore } from '../lib/store';
import { generateMnemonicPhrase, validateMnemonicPhrase } from '../lib/solana/wallet';
import { Screen } from '../components/ui/Screen';
import { Button } from '../components/ui/Button';
import { LedgerPanel } from '../components/ui/LedgerPanel';
import { Sheet } from '../components/ui/Sheet';
import { Field, inputClass } from '../components/ui/Field';
import { KeyValue, MicroLabel, Notice } from '../components/ui/primitives';
import { StencilArt } from '../components/brand/StencilArt';
import { Wordmark } from '../components/brand/BrandMark';

/**
 * Onboarding: the brand statement, the live-systems ledger, and the two
 * paths to an owner key (create on device / import a seed phrase).
 */
export function Onboarding() {
  const createWallet = useStore((s) => s.createWallet);
  const airdrop = useStore((s) => s.airdrop);
  const [importOpen, setImportOpen] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [creating, setCreating] = useState(false);

  const trimmed = phrase.trim().toLowerCase().replace(/\s+/g, ' ');
  const valid = validateMnemonicPhrase(trimmed);

  async function onCreateWallet() {
    if (creating) return;
    setCreating(true);
    try {
      const mnemonic = generateMnemonicPhrase();
      createWallet(mnemonic);
      // fund the fresh key from the devnet faucet right away
      await airdrop();
    } finally {
      setCreating(false);
    }
  }

  return (
    <Screen className="pb-[max(2.5rem,env(safe-area-inset-bottom))]">
      <div className="border-2 border-ink bg-ledger-subtle shadow-panel">
        <div className="flex items-center justify-between gap-3 border-b border-ink bg-ledger-subtle px-4 py-2.5">
          <span className="font-display text-[13px] font-bold tracking-[-0.01em]">Equilibrium Construct 0819</span>
          <MicroLabel>Autonomous counterbalance</MicroLabel>
        </div>
        <StencilArt className="block w-full" />
      </div>

      <header className="mt-7">
        <Wordmark className="text-[30px]" />
        <h1 className="mt-4 font-display text-[34px] font-bold leading-[1.02] tracking-[-0.03em]">
          Your mix.
          <br />A vault that keeps moving.
        </h1>
        <p className="mt-3 max-w-[46ch] text-[12.5px] leading-[1.6] text-iron">
          Create a portfolio. Choose its weights. Let scheduled execution maintain the allocation
          on Solana devnet — real transactions, a real price feed, and an honest swap counterparty.
        </p>
      </header>

      <div className="mt-6">
        <LedgerPanel stripe="Live systems" meta="No sample data">
          <KeyValue
            rows={[
              { k: 'Cluster', v: 'Solana devnet' },
              { k: 'Tokens', v: 'WSOL · dUSD (synthetic) · tBTC · tETH' },
              { k: 'Price feed', v: 'Coinbase spot · Binance fallback' },
              { k: 'Counterparty', v: 'Program-owned devnet test market' },
              { k: 'Scheduler', v: 'Permissionless Hydra · shared one-minute cadence' },
            ]}
          />
          <p className="mt-3 text-[11px] leading-relaxed text-iron">
            Balances come from Solana devnet. dUSD is capped synthetic test money with a fixed $1
            display price; it has no real-dollar backing or redemption value. Scheduled execution
            needs one active Hydra cranker per ER. Each portfolio task checks all of that portfolio's SPL assets together; ER slot cadence does not guarantee exact wall-clock timing.
          </p>
        </LedgerPanel>
      </div>

      <div className="mt-6 space-y-3">
        <Button variant="primary" full loading={creating} onClick={onCreateWallet}>
          Create a wallet on this device
        </Button>
        <Button variant="secondary" full onClick={() => setImportOpen(true)}>
          Import a seed phrase
        </Button>
        <p className="px-1 pt-1 text-[11px] leading-relaxed text-iron">
          Your owner key signs setup and owner actions from this device. On-chain Vault Authority
          PDAs control each portfolio's standard SPL token accounts; only the Executor PDA is
          delegated to MagicBlock.
        </p>
        <p className="px-1 text-[11px] leading-relaxed text-iron">
          Already have a Solana wallet? Connect it with the button in the header; it will sign actions for this session.
        </p>
      </div>

      <Sheet
        open={importOpen}
        onClose={() => setImportOpen(false)}
        micro="Import · BIP-39"
        title="Restore an owner key"
        footer={
          <Button
            variant="primary"
            full
            disabled={!valid}
            onClick={() => {
              if (!valid) return;
              createWallet(trimmed);
              setImportOpen(false);
            }}
          >
            Import and open
          </Button>
        }
      >
        <Field
          label="Seed phrase"
          hint="12 words, BIP-39. Derived at m/44'/501'/0'/0' via SLIP-0010."
          error={phrase.trim() !== '' && !valid ? 'Not a valid 12-word seed phrase.' : undefined}
        >
          <textarea
            rows={3}
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className={`${inputClass} resize-none py-3 leading-relaxed`}
            placeholder="word word word …"
          />
        </Field>
        <Notice tone="brass" title="Devnet demo">
          Only import seed phrases that hold devnet funds. This build stores the mnemonic in this
          browser's local storage.
        </Notice>
      </Sheet>
    </Screen>
  );
}
