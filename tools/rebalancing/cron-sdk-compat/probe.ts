import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { AnchorProvider, type Wallet } from "@coral-xyz/anchor";
import { createCronJob, init, type InitializeCronJobArgsV0 } from "@helium/cron-sdk";
import type { Cron } from "@helium/tuktuk-idls/lib/types/cron";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey } from "@solana/web3.js";

const CRON_PROGRAM_ID = new PublicKey("cronAjRZnJn3MTP3B9kE62NWDrjSuAPVXf9c4hu4grM");
const TUKTUK_PROGRAM_ID = new PublicKey("tuktukUrfhXT6ZT77QTU8RQtvgL967uRuVagWF57zVA");
const CRON_IDL_PATH = path.resolve(__dirname, "../etf-scheduler-probe/fixtures/helium-cron-idl-0.3.0.json");
let rpcCalls = 0;

function makeOfflineProvider(): AnchorProvider {
  const keypair = Keypair.generate();
  const wallet = {
    publicKey: keypair.publicKey,
    signTransaction: async (transaction: never) => transaction,
    signAllTransactions: async (transactions: never[]) => transactions,
  } as unknown as Wallet;
  const connection = new Connection("http://127.0.0.1:8899");
  (connection as unknown as { _rpcRequest: (...args: unknown[]) => Promise<never> })._rpcRequest = async () => {
    rpcCalls += 1;
    throw new Error("Offline compatibility probe must not make RPC requests");
  };
  return new AnchorProvider(connection, wallet, {});
}

function derivePda(seeds: Buffer[], programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

async function main(): Promise<void> {
  const provider = makeOfflineProvider();
  const cronIdl = JSON.parse(await readFile(CRON_IDL_PATH, "utf8")) as Cron;
  const cronProgram = await init(provider, CRON_PROGRAM_ID, cronIdl);
  const authority = provider.wallet.publicKey;

  // Stub only the two SDK account reads. No RPC, account creation, or transaction occurs.
  const userJobsAddress = derivePda([Buffer.from("user_cron_jobs"), authority.toBuffer()], CRON_PROGRAM_ID);
  const cronAccounts = cronProgram.account as unknown as {
    userCronJobsV0: { fetchNullable: (address: PublicKey) => Promise<unknown> };
  };
  cronAccounts.userCronJobsV0.fetchNullable = async (address) => {
    assert(address.equals(userJobsAddress));
    return { nextCronJobId: 7 };
  };

  const taskQueue = Keypair.generate().publicKey;
  const taskQueueState = { taskBitmap: new Uint8Array([0b0000_0101]), capacity: 8 };
  const tuktukProgram = {
    account: {
      taskQueueV0: {
        fetch: async (address: PublicKey) => {
          assert(address.equals(taskQueue));
          return taskQueueState;
        },
      },
    },
  } as never;
  const args: InitializeCronJobArgsV0 = {
    schedule: "*/10 * * * * *",
    name: "s5-cron-compat-probe",
    freeTasksPerTransaction: 0,
    numTasksPerQueueCall: 1,
  };

  const builder = await createCronJob(cronProgram, { tuktukProgram, taskQueue, args });
  const instruction = await builder.instruction();
  const taskId = Buffer.alloc(2);
  taskId.writeUInt16LE(1);
  const cronJobId = Buffer.alloc(4);
  cronJobId.writeUInt32LE(7);
  const expectedTask = derivePda([Buffer.from("task"), taskQueue.toBuffer(), taskId], TUKTUK_PROGRAM_ID);
  const expectedCronJob = derivePda([Buffer.from("cron_job"), authority.toBuffer(), cronJobId], CRON_PROGRAM_ID);
  const nameDigest = createHash("sha256").update(args.name).digest();
  const expectedNameMapping = derivePda([
    Buffer.from("cron_job_name_mapping"), authority.toBuffer(), nameDigest,
  ], CRON_PROGRAM_ID);

  assert(instruction.programId.equals(CRON_PROGRAM_ID));
  assert.equal(instruction.data.subarray(0, 8).toString("hex"), "f6408573a9548285");
  assert.deepEqual(instruction.data.subarray(8), Buffer.concat([
    Buffer.from([args.schedule.length, 0, 0, 0]), Buffer.from(args.schedule),
    Buffer.from([Buffer.byteLength(args.name), 0, 0, 0]), Buffer.from(args.name),
    Buffer.from([args.freeTasksPerTransaction, args.numTasksPerQueueCall]),
  ]));

  const expectedKeys = [
    authority, authority, // payer, queue authority
    derivePda([
      Buffer.from("task_queue_authority"), taskQueue.toBuffer(), authority.toBuffer(),
    ], TUKTUK_PROGRAM_ID),
    authority, // authority
    userJobsAddress,
    expectedCronJob,
    expectedNameMapping,
    taskQueue,
    expectedTask,
    ...[1, 2].map((id) => derivePda([
      Buffer.from("task_return_account_" + id), expectedCronJob.toBuffer(),
    ], CRON_PROGRAM_ID)),
    PublicKey.default, // system program
    TUKTUK_PROGRAM_ID,
  ];
  assert.deepEqual(instruction.keys.map(({ pubkey }) => pubkey.toBase58()), expectedKeys.map((key) => key.toBase58()));
  assert.deepEqual(instruction.keys.map(({ isWritable }) => isWritable), [
    true, false, false, false, true, true, true, true, true, true, true, false, false,
  ]);
  assert.deepEqual(instruction.keys.map(({ isSigner }) => isSigner), [
    true, true, false, true, false, false, false, false, false, false, false, false, false,
  ]);

  const computeBudgetIx = builder["_preInstructions"]?.[0];
  assert.ok(computeBudgetIx, "SDK adds its compute budget pre-instruction");
  assert.ok(ComputeBudgetProgram.programId.equals(computeBudgetIx.programId));
  assert.equal(rpcCalls, 0, "SDK builder path must not make an RPC request");
  console.log(JSON.stringify({
    result: "passed",
    anchorVersion: "0.32.1",
    cronSdkVersion: "0.1.1",
    instructionDataHex: instruction.data.toString("hex"),
    orderedAccountCount: instruction.keys.length,
    computeBudgetPreInstruction: true,
    rpcCalls,
    transactionsSent: 0,
  }));
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
