import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Keypair, type Connection } from '@solana/web3.js';
import { mintOf } from './assets.js';
import { fetchBalances } from './wallet.js';

const owner = Keypair.generate().publicKey;

function rpc({
  sol = async () => 0,
  tokens = async () => ({ value: [] }),
}: {
  sol?: () => Promise<number>;
  tokens?: () => Promise<{ value: { account: { data: unknown } }[] }>;
} = {}) {
  return {
    solRpc: { getBalance: sol } as unknown as Connection,
    tokenRpc: { getParsedTokenAccountsByOwner: tokens } as unknown as Connection,
  };
}

function tokenAccount(mint: string, amount: string) {
  return { account: { data: { parsed: { info: { mint, tokenAmount: { amount } } } } } };
}

test('reads SOL and sums every account for a registered SPL mint', async () => {
  const { solRpc, tokenRpc } = rpc({
    sol: async () => 2_500_000_000,
    tokens: async () => ({ value: [
      tokenAccount(mintOf('dusd').toBase58(), '1250000'),
      tokenAccount(mintOf('dusd').toBase58(), '750000'),
      tokenAccount(Keypair.generate().publicKey.toBase58(), '999'),
    ] }),
  });

  const balances = await fetchBalances(owner, tokenRpc, solRpc);
  assert.equal(balances.solLamports, 2_500_000_000);
  assert.equal(balances.tokens.dusd, 2_000_000);
  assert.equal(balances.tokens.wsol, 0);
  assert.equal(balances.tokenError, undefined);
});

test('keeps the SOL balance when the token-account RPC fails', async () => {
  const { solRpc, tokenRpc } = rpc({
    sol: async () => 1_000_000_000,
    tokens: async () => { throw new Error('RPC rate limited'); },
  });

  const balances = await fetchBalances(owner, tokenRpc, solRpc);
  assert.equal(balances.solLamports, 1_000_000_000);
  assert.equal(balances.tokens.dusd, 0);
  assert.match(balances.tokenError ?? '', /RPC rate limited/);
});

test('publishes SOL before a slow token-account scan completes', async () => {
  let finishTokens!: (value: { value: { account: { data: unknown } }[] }) => void;
  const { solRpc, tokenRpc } = rpc({
    sol: async () => 900_000_000,
    tokens: () => new Promise((resolve) => { finishTokens = resolve; }),
  });
  let observedSol: number | undefined;
  const pending = fetchBalances(owner, tokenRpc, solRpc, (lamports) => { observedSol = lamports; });

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(observedSol, 900_000_000);
  finishTokens({ value: [] });
  assert.equal((await pending).solLamports, 900_000_000);
});

test('reports a failed SOL read instead of returning a false zero balance', async () => {
  const { solRpc, tokenRpc } = rpc({
    sol: async () => { throw new Error('RPC unavailable'); },
  });

  await assert.rejects(fetchBalances(owner, tokenRpc, solRpc), /Could not read SOL balance: RPC unavailable/);
});
