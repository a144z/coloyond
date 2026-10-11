import { readFileSync } from "node:fs";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

const rpcUrl = process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899";
const programId = new PublicKey(required("ETF_MATH_BENCH_PROGRAM_ID"));
const payerPath = required("ETF_MATH_BENCH_PAYER_KEYPAIR");
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(payerPath, "utf8"))));
const connection = new Connection(rpcUrl, "confirmed");
const max = (1n << 64n) - 1n;

const cases = [
  {
    name: "near-u64 99:1 tiny input",
    balances: [max - 1_000n, max],
    weights: [9_900, 100],
    assetIn: 0,
    assetOut: 1,
    amountIn: 1n,
    feeBps: 0,
  },
  {
    name: "three-asset near-u64 boundary",
    balances: [max - 1_000n, max, 1n],
    weights: [9_800, 100, 100],
    assetIn: 0,
    assetOut: 1,
    amountIn: 1_000n,
    feeBps: 30,
  },
  {
    name: "balanced fee quote",
    balances: [1_000_000n, 1_000_000n],
    weights: [5_000, 5_000],
    assetIn: 0,
    assetOut: 1,
    amountIn: 100_000n,
    feeBps: 30,
  },
];

await connection.confirmTransaction(
  await connection.requestAirdrop(payer.publicKey, LAMPORTS_PER_SOL),
  "confirmed",
);

const results = [];
for (const testCase of cases) {
  const data = encodeCase(testCase);
  const instruction = new TransactionInstruction({ programId, keys: [], data });
  const signature = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(instruction),
    [payer],
    { commitment: "confirmed" },
  );
  const transaction = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (!transaction?.meta || transaction.meta.err) {
    throw new Error(`${testCase.name} failed: ${JSON.stringify(transaction?.meta?.err)}`);
  }
  results.push({
    case: testCase.name,
    signature,
    slot: transaction.slot,
    computeUnitsConsumed: transaction.meta.computeUnitsConsumed,
    programLog: transaction.meta.logMessages?.find((line) => line.includes("q96 assets=")),
  });
}
console.log(JSON.stringify({ rpcUrl, programId: programId.toBase58(), results }, null, 2));

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function encodeCase(testCase) {
  const { balances, weights, assetIn, assetOut, amountIn, feeBps } = testCase;
  if (balances.length !== weights.length || ![2, 3].includes(balances.length)) {
    throw new Error(`${testCase.name}: expected two or three balances and weights`);
  }
  const data = Buffer.alloc(43);
  data[0] = balances.length;
  balances.forEach((value, index) => data.writeBigUInt64LE(value, 1 + index * 8));
  weights.forEach((value, index) => data.writeUInt16LE(value, 25 + index * 2));
  data[31] = assetIn;
  data[32] = assetOut;
  data.writeBigUInt64LE(amountIn, 33);
  data.writeUInt16LE(feeBps, 41);
  return data;
}
