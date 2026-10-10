import { getSymmetry, type SymmetryNetwork } from "./config.js";
import { toSdkWallet, type WalletLike } from "./wallet.js";

export const FUND_PRESETS_LAMPORTS = [
  { label: "0.01 SOL", lamports: 10_000_000 },
  { label: "0.05 SOL", lamports: 50_000_000 },
];

export interface ActionResult {
  signatures: string[][];
}

// Permissionless: anyone can top up a vault's automation reserve. The protocol's
// keepers later pay to rebalance out of this reserve, so the holder pays nothing per rebalance.
export async function fundAutomationReserve(params: {
  network: SymmetryNetwork;
  wallet: WalletLike;
  vault: string;
  amountLamports: number;
}): Promise<ActionResult> {
  const { sdk } = getSymmetry(params.network);
  const sdkWallet = toSdkWallet(params.wallet);
  const sequence = await sdk.addBountyTx({
    keeper: sdkWallet.publicKey.toBase58(),
    vault: params.vault,
    amount: params.amountLamports,
  });
  const signatures = await sdk.signAndSendTxPayloadBatchSequence({
    txPayloadBatchSequence: sequence,
    wallet: sdkWallet,
    simulateTransactions: false,
  });
  return { signatures };
}

// Permissionless keeper entry point: submits the rebalance auction the program
// allows only when the on-chain drift/automation policy is satisfied.
export async function keeperNudge(params: {
  network: SymmetryNetwork;
  wallet: WalletLike;
  vaultMint: string;
}): Promise<ActionResult> {
  const { sdk } = getSymmetry(params.network);
  const sdkWallet = toSdkWallet(params.wallet);
  const sequence = await sdk.rebalanceVaultTx({
    keeper: sdkWallet.publicKey.toBase58(),
    vault_mint: params.vaultMint,
  });
  const signatures = await sdk.signAndSendTxPayloadBatchSequence({
    txPayloadBatchSequence: sequence,
    wallet: sdkWallet,
    simulateTransactions: false,
  });
  return { signatures };
}
