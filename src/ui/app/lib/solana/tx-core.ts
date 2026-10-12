import { Buffer } from "buffer";
import {
  Keypair,
  Transaction,
  PublicKey,
  Message,
  type Connection,
} from "@solana/web3.js";
export interface WalletSigner {
  publicKey: Keypair["publicKey"];
  signTransaction(transaction: Transaction): Promise<Transaction>;
}
export type OwnerSigner = Keypair | WalletSigner;
export interface TxResult {
  sig: string;
  slot: number;
}
export interface PendingTransaction {
  owner: string;
  intent: string;
  signature: string;
  blockhash: string;
  lastValidBlockHeight: number;
  createdAt: number;
  message: string;
}
export interface PendingJournal {
  read(owner: string): PendingTransaction | null;
  write(value: PendingTransaction): void;
  remove(owner: string): void;
}
export class UnresolvedTransaction extends Error {
  constructor(public pending: PendingTransaction) {
    super(
      `Transaction submitted; confirmation is unresolved. Check ${pending.signature} before trying another transaction.`,
    );
    this.name = "UnresolvedTransaction";
  }
}
export function transactionIntent(tx: Transaction, owner: OwnerSigner): string {
  const canonical = new Transaction();
  canonical.add(...tx.instructions);
  canonical.feePayer = owner.publicKey;
  canonical.recentBlockhash = PublicKey.default.toBase58();
  return Buffer.from(canonical.serializeMessage()).toString("base64");
}
export async function reconcilePending(
  rpc: Connection,
  journal: PendingJournal,
  owner: string,
): Promise<TxResult | null> {
  const pending = journal.read(owner);
  if (!pending) return null;
  const result = await rpc.getSignatureStatuses([pending.signature], {
    searchTransactionHistory: true,
  });
  const status = result.value[0];
  if (status?.err) {
    journal.remove(owner);
    throw new Error(
      `Previous transaction failed on-chain: ${pending.signature}`,
    );
  }
  if (
    status &&
    (status.confirmationStatus === "confirmed" ||
      status.confirmationStatus === "finalized")
  ) {
    return verifyConfirmed(rpc, journal, pending);
  }
  if (!status) {
    const [height, valid] = await Promise.all([
      rpc.getBlockHeight("finalized"),
      rpc.isBlockhashValid(pending.blockhash, { commitment: "finalized" }),
    ]);
    if (height > pending.lastValidBlockHeight && !valid.value) {
      const tx = await rpc.getTransaction(pending.signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      if (tx) {
        return verifyConfirmed(rpc, journal, pending);
      }
      journal.remove(owner);
      return null;
    }
  }
  throw new UnresolvedTransaction(pending);
}
export async function signSendConfirmWith(
  rpc: Connection,
  journal: PendingJournal,
  tx: Transaction,
  owner: OwnerSigner,
  additionalSigners: Keypair[] = [],
): Promise<TxResult> {
  const ownerKey = owner.publicKey.toBase58(),
    intent = transactionIntent(tx, owner);
  const prior = journal.read(ownerKey);
  if (prior) {
    const previous = await reconcilePending(rpc, journal, ownerKey);
    if (previous && prior.intent === intent) return previous;
  }
  const blockhash = await rpc.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash.blockhash;
  tx.lastValidBlockHeight = blockhash.lastValidBlockHeight;
  tx.feePayer = owner.publicKey;
  if (additionalSigners.length) tx.partialSign(...additionalSigners);
  const reviewed = Buffer.from(tx.serializeMessage());
  const signed =
    owner instanceof Keypair
      ? (tx.partialSign(owner), tx)
      : await owner.signTransaction(tx);
  if (!reviewed.equals(Buffer.from(signed.serializeMessage())))
    throw new Error(
      "Wallet returned a different transaction than the one reviewed. Nothing was broadcast.",
    );
  if (!signed.signature || !signed.verifySignatures())
    throw new Error(
      "The transaction is missing a valid required signature. Nothing was broadcast.",
    );
  // Save before network I/O: a send error can occur after a node accepted the transaction.
  const sig = encodeBase58(signed.signature);
  const pending = {
    owner: ownerKey,
    intent,
    signature: sig,
    ...blockhash,
    createdAt: Date.now(),
    message: reviewed.toString("base64"),
  };
  journal.write(pending);
  try {
    const returned = await rpc.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
    });
    if (returned !== sig) throw new UnresolvedTransaction(pending);
    const confirmation = await rpc.confirmTransaction(
      { signature: sig, ...blockhash },
      "confirmed",
    );
    if (confirmation.value.err) {
      journal.remove(ownerKey);
      throw new Error(`Transaction failed on-chain: ${sig}`);
    }
    journal.remove(ownerKey);
    return { sig, slot: confirmation.context.slot };
  } catch (e) {
    if (!journal.read(ownerKey)) throw e;
    throw new UnresolvedTransaction(pending);
  }
}
async function verifyConfirmed(
  rpc: Connection,
  journal: PendingJournal,
  pending: PendingTransaction,
): Promise<TxResult> {
  const receipt = await rpc.getTransaction(pending.signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (!receipt || !receipt.meta || receipt.meta.err)
    throw new UnresolvedTransaction(pending);
  const message = receipt.transaction.message;
  if (
    !(message instanceof Message) ||
    Buffer.from(message.serialize()).toString("base64") !== pending.message
  )
    throw new UnresolvedTransaction(pending);
  const observed = Transaction.populate(message);
  const key = new PublicKey(pending.owner);
  if (
    transactionIntent(observed, {
      publicKey: key,
      signTransaction: async (tx) => tx,
    }) !== pending.intent
  )
    throw new UnresolvedTransaction(pending);
  journal.remove(pending.owner);
  return { sig: pending.signature, slot: receipt.slot };
}
function encodeBase58(bytes: Uint8Array): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const byte of bytes) n = n * 256n + BigInt(byte);
  let out = "";
  while (n) {
    out = alphabet[Number(n % 58n)] + out;
    n /= 58n;
  }
  let zeros = 0;
  while (bytes[zeros] === 0 && zeros < bytes.length) zeros++;
  return "1".repeat(zeros) + out;
}
