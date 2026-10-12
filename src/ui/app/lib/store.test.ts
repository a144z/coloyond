import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { Keypair, type PublicKey } from '@solana/web3.js';
import { emptyTokens } from './solana/assets.js';
import { connection } from './solana/connection.js';
import { keypairFromMnemonic } from './solana/wallet.js';
import type { WalletSigner } from './solana/tx.js';

const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  },
});

const { useStore } = await import('./store.js');
const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const deviceKey = keypairFromMnemonic(phrase).publicKey;

function setDeviceWallet() {
  storage.clear();
  useStore.setState({
    wallet: { mnemonic: phrase, publicKey: deviceKey.toBase58(), createdAt: 1 },
    connectedWallet: null,
    walletBalances: null,
    walletBalancesLoading: false,
    walletBalancesError: null,
    walletBalancesUpdatedAt: null,
  });
}

test('balance errors stop loading and a later refresh recovers', async () => {
  setDeviceWallet();
  let fail = true;
  mock.method(connection, 'getBalance', async () => {
    if (fail) throw new Error('RPC unavailable');
    return 1_234_000_000;
  });
  mock.method(connection, 'getParsedTokenAccountsByOwner', async () => ({ value: [] }));

  await useStore.getState().refreshBalances();
  assert.equal(useStore.getState().walletBalancesLoading, false);
  assert.match(useStore.getState().walletBalancesError ?? '', /RPC unavailable/);
  assert.equal(useStore.getState().walletBalances, null);

  fail = false;
  await useStore.getState().refreshBalances();
  assert.equal(useStore.getState().walletBalancesLoading, false);
  assert.equal(useStore.getState().walletBalancesError, null);
  assert.equal(useStore.getState().walletBalances?.solLamports, 1_234_000_000);
  assert.notEqual(useStore.getState().walletBalancesUpdatedAt, null);
});

test('a late response from a previous wallet cannot overwrite the active wallet', async () => {
  setDeviceWallet();
  let finishDeviceRead!: (lamports: number) => void;
  mock.method(connection, 'getBalance', async (owner: PublicKey) => {
    if (owner.equals(deviceKey)) return new Promise<number>((resolve) => { finishDeviceRead = resolve; });
    return 2_000_000_000;
  });
  mock.method(connection, 'getParsedTokenAccountsByOwner', async () => ({ value: [] }));

  const oldRequest = useStore.getState().refreshBalances();
  const connectedKey = Keypair.generate().publicKey;
  useStore.getState().setConnectedWallet({
    publicKey: connectedKey,
    signTransaction: async (transaction) => transaction,
  } as WalletSigner);
  await useStore.getState().refreshBalances();
  finishDeviceRead(500_000_000);
  await oldRequest;

  assert.equal(useStore.getState().walletBalances?.solLamports, 2_000_000_000);
  assert.equal(useStore.getState().connectedWallet?.publicKey.toBase58(), connectedKey.toBase58());
});

test('account notifications immediately update SOL while token balances remain explicit', () => {
  setDeviceWallet();
  useStore.getState().updateWalletSolBalance(deviceKey.toBase58(), 3_000_000_000);
  assert.equal(useStore.getState().walletBalances?.solLamports, 3_000_000_000);
  assert.equal(useStore.getState().walletBalances?.tokenError, 'Token balances are loading.');
  assert.equal(useStore.getState().walletBalancesUpdatedAt !== null, true);
});

test('a failed token scan keeps last known token amounts and refreshes SOL', async () => {
  setDeviceWallet();
  useStore.setState({ walletBalances: { solLamports: 1, tokens: { ...emptyTokens(), dusd: 2_500_000 } } });
  mock.method(connection, 'getBalance', async () => 2);
  mock.method(connection, 'getParsedTokenAccountsByOwner', async () => { throw new Error('token RPC unavailable'); });

  await useStore.getState().refreshBalances();
  assert.equal(useStore.getState().walletBalances?.solLamports, 2);
  assert.equal(useStore.getState().walletBalances?.tokens.dusd, 2_500_000);
  assert.match(useStore.getState().walletBalances?.tokenError ?? '', /token RPC unavailable/);
});
