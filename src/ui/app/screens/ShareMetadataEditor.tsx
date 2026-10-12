import { useEffect, useMemo, useRef, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { activeWalletSigner, useStore } from '../lib/store.js';
import {
  buildShareMetadataDocument,
  createShareTokenMetadata,
  loadShareTokenMetadata,
  readNextShareSymbolSequence,
  shareSymbolForSequence,
  updateShareTokenMetadata,
  validateShareMetadataForm,
  verifyShareMetadataUri,
  type LoadedShareMetadata,
  type ShareMetadataForm,
} from '../lib/solana/execution.js';
import { Button } from '../components/ui/Button.js';
import { Field, inputClass } from '../components/ui/Field.js';
import { LedgerPanel } from '../components/ui/LedgerPanel.js';
import { Notice } from '../components/ui/primitives.js';

export function ShareMetadataEditor({
  value,
  onChange,
  symbol,
  sequenceLoading = false,
  onRefreshSequence,
  verified,
  onVerifiedChange,
  readOnly = false,
}: {
  value: ShareMetadataForm;
  onChange: (value: ShareMetadataForm) => void;
  symbol: string | null;
  sequenceLoading?: boolean;
  onRefreshSequence?: () => void;
  verified: boolean;
  onVerifiedChange: (verified: boolean) => void;
  readOnly?: boolean;
}) {
  const [checking, setChecking] = useState(false);
  const [issue, setIssue] = useState<string | null>(null);
  const previousSymbol = useRef(symbol);
  const errors = useMemo(() => symbol ? validateShareMetadataForm(value, symbol) : ['Reading the on-chain share symbol sequence…'], [value, symbol]);

  useEffect(() => {
    if (previousSymbol.current !== symbol) {
      previousSymbol.current = symbol;
      onVerifiedChange(false);
      setIssue(null);
    }
    // A new registry sequence means the JSON must be regenerated and uploaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  function change(patch: Partial<ShareMetadataForm>) {
    onChange({ ...value, ...patch });
    onVerifiedChange(false);
    setIssue(null);
  }

  function downloadJson() {
    if (!symbol || errors.length) return;
    const jsonDocument = buildShareMetadataDocument(value, symbol);
    const blob = new Blob([`${JSON.stringify(jsonDocument, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${symbol.toLowerCase()}-metadata.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function verify() {
    if (!symbol || errors.length || checking) return;
    setChecking(true);
    setIssue(null);
    onVerifiedChange(false);
    try {
      await verifyShareMetadataUri(value, symbol);
      onVerifiedChange(true);
    } catch (error) {
      setIssue(error instanceof Error ? error.message : 'Metadata URI verification failed.');
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="space-y-3">
      <Notice tone="brass" title="Prepare and pin the token JSON">
        There is no upload provider or credential configured. Upload and pin the image first, then use its public URI above. Download this exact JSON, upload and pin that file with your IPFS/Arweave provider, and paste its public URI below. Pinning supports availability; a URI alone does not guarantee it. No transaction is sent until a GET verifies every field.
      </Notice>
      <div className="rounded-md border border-hairline bg-pulp-shade px-3 py-2 text-[11px] leading-relaxed text-iron">
        Generated symbol <strong className="font-mono text-ink">{symbol ?? 'Reading…'}</strong>. The creator may update the name and URI through the vault program; the generated symbol stays fixed.
        {onRefreshSequence ? <button type="button" className="ml-2 font-bold text-petrol underline" disabled={sequenceLoading || readOnly} onClick={onRefreshSequence}>{sequenceLoading ? 'Checking…' : 'Refresh symbol'}</button> : null}
      </div>
      <Field label="Share-token name · 32 UTF-8 bytes" error={value.name.trim() && new TextEncoder().encode(value.name).length > 32 ? 'At most 32 UTF-8 bytes.' : undefined}>
        <input value={value.name} maxLength={32} disabled={readOnly} onChange={(event) => change({ name: event.target.value })} className={inputClass} placeholder="Balanced portfolio" />
      </Field>
      <Field label="Description">
        <textarea value={value.description} disabled={readOnly} onChange={(event) => change({ description: event.target.value })} className={`${inputClass} min-h-24 py-3`} placeholder="What this portfolio represents" />
      </Field>
      <Field label="Token image URL" hint="Use an HTTPS, IPFS, or Arweave image URI.">
        <input value={value.image} disabled={readOnly} onChange={(event) => change({ image: event.target.value })} className={inputClass} placeholder="ipfs://…" />
      </Field>
      <Field label="Metadata JSON URI · max 200 UTF-8 bytes" error={value.uri && new TextEncoder().encode(value.uri).length > 200 ? 'At most 200 UTF-8 bytes.' : undefined}>
        <input value={value.uri} disabled={readOnly} onChange={(event) => change({ uri: event.target.value })} className={inputClass} placeholder="ipfs://…/metadata.json" />
      </Field>
      {issue ? <Notice tone="danger" title="Metadata could not be verified">{issue}</Notice> : null}
      {verified ? <Notice tone="petrol" title="Metadata JSON verified">The HTTPS/IPFS/Arweave URI returned JSON matching the form, including the fixed symbol.</Notice> : null}
      {errors.length ? <p className="text-[11px] text-danger">{errors[0]}</p> : null}
      <div className="grid grid-cols-2 gap-2">
        <Button full disabled={readOnly || errors.length > 0} onClick={downloadJson}>Download JSON</Button>
        <Button full variant="secondary" loading={checking} disabled={readOnly || errors.length > 0} onClick={() => void verify()}>{verified ? 'Verify again' : 'Verify uploaded JSON'}</Button>
      </div>
    </div>
  );
}

/** Owner-only create/backfill/update controls for a share token from on-chain state. */
export function ShareMetadataManager({ stateAddress }: { stateAddress: string }) {
  const connectedWallet = useStore((state) => state.connectedWallet);
  const deviceWallet = useStore((state) => state.wallet);
  const refreshExplore = useStore((state) => state.refreshExplore);
  const toast = useStore((state) => state.toast);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState<LoadedShareMetadata | null>(null);
  const [sequence, setSequence] = useState<bigint | null>(null);
  const [form, setForm] = useState<ShareMetadataForm>({ name: '', symbol: '', description: '', image: '', uri: '' } as ShareMetadataForm);
  const [verified, setVerified] = useState(false);
  const [working, setWorking] = useState(false);
  const [issue, setIssue] = useState<string | null>(null);
  const walletKey = connectedWallet?.publicKey.toBase58() ?? deviceWallet?.publicKey ?? null;
  const isOwner = !!loaded && loaded.owner.toBase58() === walletKey;
  const symbol = loaded?.metadata?.symbol ?? (sequence === null ? null : shareSymbolForSequence(sequence));
  const metadataExists = !!loaded?.metadata;
  const errors = useMemo(() => symbol ? validateShareMetadataForm(form, symbol) : ['Reading the on-chain share symbol sequence…'], [form, symbol]);

  async function openEditor() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    setLoading(true);
    setIssue(null);
    try {
      const chain = await loadShareTokenMetadata(new PublicKey(stateAddress));
      setLoaded(chain);
      setForm({
        name: chain.metadata?.name ?? '',
        description: chain.description,
        image: chain.image,
        uri: chain.metadata?.uri ?? '',
      });
      if (!chain.metadata) setSequence(await readNextShareSymbolSequence());
      if (chain.issue) setIssue(chain.issue);
    } catch (error) {
      setIssue(error instanceof Error ? error.message : 'Could not read this share mint from Solana.');
    } finally {
      setLoading(false);
    }
  }

  async function refreshSequence() {
    setLoading(true);
    try {
      setSequence(await readNextShareSymbolSequence());
      setVerified(false);
      setIssue('The symbol was refreshed. Regenerate and re-upload the JSON so its symbol matches.');
    } catch (error) {
      setIssue(error instanceof Error ? error.message : 'Could not read the share symbol registry.');
    } finally { setLoading(false); }
  }

  async function submit() {
    if (!isOwner || !loaded || !verified || errors.length || working) return;
    const signer = activeWalletSigner();
    if (!signer) return;
    setWorking(true);
    setIssue(null);
    try {
      if (metadataExists) {
        await updateShareTokenMetadata(signer, new PublicKey(stateAddress), form);
      } else {
        if (sequence === null) throw new Error('Share symbol registry is not ready. Refresh and verify the uploaded JSON.');
        await createShareTokenMetadata(signer, new PublicKey(stateAddress), sequence, form);
      }
      toast('ok', metadataExists ? 'Share metadata updated' : 'Share metadata created', 'The Metaplex metadata account is linked to the on-chain share mint.');
      setOpen(false);
      await refreshExplore();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Metadata transaction failed.';
      setIssue(message);
      if (/sequence changed/iu.test(message)) {
        try { setSequence(await readNextShareSymbolSequence()); } catch { /* keep the explicit transaction error */ }
        setVerified(false);
      }
    } finally { setWorking(false); }
  }

  return <div className="mt-3">
    <Button variant="secondary" full onClick={() => void openEditor()}>{open ? 'Close share metadata' : 'Manage share-token metadata'}</Button>
    {open ? <div className="mt-3">
      <LedgerPanel stripe="Metaplex Token Metadata" meta={metadataExists ? 'update' : 'create / backfill'} bodyClassName="pt-3">
        {loading && !loaded ? <p className="text-[12px] text-iron">Reading owner, share mint, metadata, and symbol registry from Solana…</p> : null}
        {loaded && !isOwner ? <Notice tone="brass" title="Owner signature required">Only the creator shown on-chain can manage this metadata. Connect the vault owner wallet to continue.</Notice> : null}
        {loaded && isOwner ? <>
          <p className="mb-3 text-[11px] leading-relaxed text-iron">The vault’s Authority PDA remains Metaplex update authority. The creator can update the name and URI through the program; the symbol is fixed. {loaded.metadata ? `Current symbol: ${loaded.metadata.symbol}.` : `Next unique symbol: ${symbol ?? 'reading…'}.`}</p>
          {issue ? <div className="mb-3"><Notice tone="brass" title="Metadata status">{issue}</Notice></div> : null}
          <ShareMetadataEditor
            value={form}
            onChange={(next) => { setForm(next); setVerified(false); setIssue(null); }}
            symbol={symbol}
            sequenceLoading={loading}
            onRefreshSequence={!metadataExists ? () => void refreshSequence() : undefined}
            verified={verified}
            onVerifiedChange={(value) => { setVerified(value); if (value) setIssue(null); }}
          />
          <div className="mt-3"><Button variant="primary" full loading={working} disabled={!verified || errors.length > 0} onClick={() => void submit()}>{metadataExists ? 'Update share metadata on Solana' : 'Create metadata on Solana'}</Button></div>
        </> : null}
      </LedgerPanel>
    </div> : null}
  </div>;
}
