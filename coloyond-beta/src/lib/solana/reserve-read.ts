import { PublicKey } from '@solana/web3.js';
import { AccountLayout, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { DEMO_RESERVE_PUBLIC_KEY } from './config';
import { mintOf, type AssetId } from './assets';
import { ephemeralConnection } from './connection';
import { fetchEphemeralBalances, type Balances } from './wallet';

export type ReserveState = Balances;
export const reserveOwner = new PublicKey(DEMO_RESERVE_PUBLIC_KEY);

export function reserveAta(id: AssetId): PublicKey {
  return getAssociatedTokenAddressSync(mintOf(id), reserveOwner);
}

export async function fetchReserveState(): Promise<ReserveState> {
  return fetchEphemeralBalances(reserveOwner);
}

export async function reserveIsReady(assets: AssetId[]): Promise<boolean> {
  const accounts = assets.map(reserveAta);
  const infos = await ephemeralConnection.getMultipleAccountsInfo(accounts, 'confirmed');
  return infos.every((info) => {
    if (!info || !info.owner.equals(TOKEN_PROGRAM_ID)) return false;
    const token = AccountLayout.decode(info.data);
    return token.delegateOption === 1 && token.delegatedAmount > 0n;
  });
}
