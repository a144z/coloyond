import { expect, test } from '@playwright/test';
import { Keypair } from '@solana/web3.js';

const RPC_URL = 'https://api.devnet.solana.com';
const blockhash = Keypair.fromSeed(new Uint8Array(32).fill(3)).publicKey.toBase58();

test('connects and disconnects a Wallet Standard wallet in the app', async ({ page }) => {
  const owner = Keypair.fromSeed(new Uint8Array(32).fill(17));
  const address = owner.publicKey.toBase58();
  const sentMethods: string[] = [];
  await page.addInitScript(installMockWallet, {
    address,
    publicKey: Array.from(owner.publicKey.toBytes()),
  });
  await page.route(/api\.devnet\.solana\.com/, async (route) => {
    const request = route.request().postDataJSON() as { method?: string };
    const method = request.method ?? '';
    sentMethods.push(method);
    const result = rpcResult(method, blockhash);
    await route.fulfill({ json: { jsonrpc: '2.0', id: 1, result } });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await page.getByRole('button', { name: /Coloyond E2E Wallet.*Detected/ }).click();
  await expect(page.getByRole('button', { name: `Disconnect wallet ${address}` })).toBeVisible();

  await page.getByRole('button', { name: 'Wallet', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your connected wallet.' })).toBeVisible();
  await expect(page.getByText(address, { exact: true })).toBeVisible();
  await expect.poll(() => sentMethods).toContain('getBalance');
  await expect.poll(() => sentMethods).toContain('getTokenAccountsByOwner');

  await page.getByRole('button', { name: `Disconnect wallet ${address}` }).click();
  await expect(page.getByRole('button', { name: 'Connect wallet' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create a wallet on this device' })).toBeVisible();
});

function rpcResult(method: string, latestBlockhash: string): unknown {
  switch (method) {
    case 'getLatestBlockhash':
      return { context: { slot: 42 }, value: { blockhash: latestBlockhash, lastValidBlockHeight: 500 } };
    case 'getBalance':
      return { context: { slot: 42 }, value: 2_000_000_000 };
    case 'getTokenAccountsByOwner':
      return { context: { slot: 42 }, value: [] };
    case 'getSlot':
      return 42;
    case 'getHealth':
      return 'ok';
    default:
      return { context: { slot: 42 }, value: null };
  }
}

function installMockWallet({ address, publicKey }: { address: string; publicKey: number[] }) {
  type MockAccount = {
    address: string;
    publicKey: Uint8Array;
    chains: string[];
    features: string[];
  };
  type MockWallet = {
    version: string;
    name: string;
    icon: string;
    chains: string[];
    accounts: MockAccount[];
    features: Record<string, unknown>;
  };
  const signTransactionFeature = 'solana:signTransaction';
  const account = {
    address,
    publicKey: new Uint8Array(publicKey),
    chains: ['solana:devnet'],
    features: [signTransactionFeature],
  };
  const listeners = new Set<(event: unknown) => void>();
  let wallet: MockWallet;
  wallet = {
    version: '1.0.0',
    name: 'Coloyond E2E Wallet',
    icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiLz4=',
    chains: ['solana:devnet'],
    accounts: [] as MockAccount[],
    features: {
      'standard:connect': { version: '1.0.0', connect: async () => { wallet.accounts = [account]; return { accounts: wallet.accounts }; } },
      'standard:disconnect': { version: '1.0.0', disconnect: async () => { wallet.accounts = []; } },
      'standard:events': { version: '1.0.0', on: (_event: string, listener: (event: unknown) => void) => { listeners.add(listener); return () => listeners.delete(listener); } },
      [signTransactionFeature]: {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy'],
        signTransaction: async (...inputs: { account: typeof account; transaction: Uint8Array }[]) => inputs.map((input) => ({ signedTransaction: input.transaction, account: input.account })),
      },
    },
  };

  const register = ({ register: addWallet }: { register: (wallet: MockWallet) => void }) => addWallet(wallet);
  window.addEventListener('wallet-standard:app-ready', (event) => (event as CustomEvent<{ register: (wallet: MockWallet) => void }>).detail.register(wallet));
  window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: register }));
}
