import { Connection } from '@solana/web3.js';
import { CLUSTER, RPC_URL } from './config';

export const connection = new Connection(RPC_URL, 'confirmed');

export function explorerAddress(address: string): string {
  return `https://explorer.solana.com/address/${address}?cluster=${CLUSTER}`;
}

export function explorerTx(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=${CLUSTER}`;
}

export interface RpcStatus {
  slot: number;
  pingMs: number;
  at: number;
}

export async function fetchRpcStatus(): Promise<RpcStatus> {
  const t0 = performance.now();
  const slot = await connection.getSlot('confirmed');
  return { slot, pingMs: Math.round(performance.now() - t0), at: Date.now() };
}
