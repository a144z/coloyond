import { useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";

function short(key: string): string {
  return key.length > 9 ? `${key.slice(0, 4)}…${key.slice(-4)}` : key;
}

export function ConnectButton() {
  const { publicKey, connected, connecting, disconnecting, wallet, connect, disconnect } = useWallet();
  const { setVisible } = useWalletModal();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const address = publicKey?.toBase58() ?? null;

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (connected && address) {
    const copy = () => {
      navigator.clipboard?.writeText(address).then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      }).catch(() => undefined);
    };
    return (
      <div className="cr-wallet-menu" ref={menuRef}>
        <button
          type="button"
          className="cr-wallet-btn is-connected"
          onClick={() => setOpen(value => !value)}
          title={`${wallet?.adapter.name ?? "Wallet"}: ${address}`}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <span className="cr-wallet-dot" aria-hidden="true" />
          {short(address)}
        </button>
        {open ? (
          <div className="cr-wallet-pop" role="menu">
            <p className="cr-wallet-pop-name">{wallet?.adapter.name ?? "Wallet"}</p>
            <button type="button" role="menuitem" onClick={copy}>{copied ? "Copied" : "Copy address"}</button>
            <a className="cr-wallet-pop-link" role="menuitem" href={`https://explorer.solana.com/address/${address}?cluster=devnet`} target="_blank" rel="noreferrer">View on Devnet Explorer</a>
            <button type="button" role="menuitem" onClick={() => { setOpen(false); void disconnect().catch(() => undefined); }}>
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  // Not connected: direct-connect if a wallet is already selected (e.g. remembered
  // from a previous visit), otherwise open the modal. The modal lists every detected
  // Wallet Standard extension and, on Android, the "Use Installed Wallet" MWA option.
  const onClick = () => {
    if (wallet) {
      void connect().catch(() => undefined);
      return;
    }
    setVisible(true);
  };

  return (
    <button type="button" className="cr-wallet-btn" onClick={onClick} disabled={connecting}>
      {connecting ? "Connecting…" : "Connect wallet"}
    </button>
  );
}
