import { Buffer } from 'buffer';
import { PublicKey } from '@solana/web3.js';
import { AccountLayout, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { assetList, emptyTokens, mintOf, type AssetId } from './assets';
import { EXECUTION_PROGRAM } from './execution';
import { connection } from './connection';
import type { Balances } from './wallet';

export type ReserveState = Balances;
const MARKET_AUTHORITY_SEED = Buffer.from('market-authority');
export const reserveOwner = PublicKey.findProgramAddressSync([MARKET_AUTHORITY_SEED], EXECUTION_PROGRAM)[0];

export function reserveAta(id: AssetId): PublicKey {
  return getAssociatedTokenAddressSync(mintOf(id), reserveOwner, true);
}

export async function fetchReserveState(): Promise<ReserveState> {
  const tokens = emptyTokens();
  const ids = assetList().map((asset) => asset.id);
  const infos = await connection.getMultipleAccountsInfo(ids.map(reserveAta), 'confirmed');
  infos.forEach((info, index) => {
    if (!info || !info.owner.equals(TOKEN_PROGRAM_ID)) return;
    const decoded = AccountLayout.decode(info.data);
    tokens[ids[index]] = Number(decoded.amount);
  });
  return { solLamports: 0, tokens };
}

export async function reserveIsReady(assets: AssetId[]): Promise<boolean> {
  const infos = await connection.getMultipleAccountsInfo(assets.map(reserveAta), 'confirmed');
  return infos.every((info) => info !== null && info.owner.equals(TOKEN_PROGRAM_ID));
}
