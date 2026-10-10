import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  buildActivateConditionInstruction,
  buildExecuteConditionRuleInstruction,
  buildObserveConditionInstruction,
  buildProposeConditionRuleInstruction,
  conditionStateAddress,
} from "../../../../packages/keeper/src/conditionInstructions.js";
import { decodeGovernance, decodeIntent, decodeVault } from "../../../../packages/keeper/src/codec.js";
import { buildS2DInstruction, PROGRAM_ID } from "../../../../packages/keeper/src/solana.js";
import type { ChainSnapshot } from "../../../../packages/keeper/src/types.js";

type Manifest = {
  rpcUrl: string;
  expectedGenesisHash: string;
  programId: string;
  vault: string;
  governance: string;
  auctionPolicy: string;
  intent: string;
  startAmount: string;
  oraclePublishTime: string;
};

const manifestPath = process.env.COLOYOND_LOCALNET_MANIFEST ?? "public/localnet-manifest.json";
const runtimeHome = process.env.COLOYOND_LOCALNET_HOME ?? `${process.env.HOME}/.local/state/coloyond/localnet-conditions`;
const walletPath = process.env.COLOYOND_LOCALNET_WALLET ?? `${runtimeHome}/wallet.json`;
const emergencyPath = process.env.COLOYOND_LOCALNET_EMERGENCY_KEYPAIR ?? `${runtimeHome}/emergency-authority.json`;
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
const RPC_URL = process.env.COLOYOND_LOCALNET_RPC_URL ?? manifest.rpcUrl;
const wallet = keypairFromFile(walletPath);
const emergencyAuthority = keypairFromFile(emergencyPath);
const connection = new Connection(RPC_URL, { commitment: "confirmed" });
const vault = new PublicKey(manifest.vault);
const governance = new PublicKey(manifest.governance);
const policy = new PublicKey(manifest.auctionPolicy);
const intent = new PublicKey(manifest.intent);
const conditionState = conditionStateAddress(vault);

const governanceAuthority = new PublicKey(wallet.publicKey);
const minimumDelaySlots = BigInt(process.env.COLOYOND_LOCALNET_MIN_DELAY_SLOTS ?? "16");
const bounds = {
  maximumObservationAgeSeconds: 600n,
  minimumObservationSeparationSeconds: 1n,
  minimumObservationSeparationSlots: 1n,
  maximumRuleLifetimeSeconds: 1_800n,
  maximumRuleLifetimeSlots: 20_000n,
  maximumScheduleDelaySeconds: 300n,
  maximumScheduleDelaySlots: 1_000n,
  maximumHysteresisBps: 100,
};

async function main(): Promise<void> {
  assert.equal(manifest.programId, PROGRAM_ID.toBase58(), "fixture manifest has another program id");
  assert.equal(await connection.getGenesisHash(), manifest.expectedGenesisHash, "RPC genesis hash differs from the Localnet manifest");
  assert.equal((await connection.getAccountInfo(vault))?.owner.toBase58(), PROGRAM_ID.toBase58(), "vault is not owned by the deployed SBF program");
  assert.ok((await connection.getAccountInfo(governance))?.owner.equals(PROGRAM_ID), "governance PDA is not program-owned");
  assert.ok((await connection.getAccountInfo(policy))?.owner.equals(PROGRAM_ID), "auction policy PDA is not program-owned");
  assert.ok((await connection.getBalance(wallet.publicKey)) > 0, "Localnet fee payer is not funded");
  assert.ok(!wallet.publicKey.equals(emergencyAuthority.publicKey), "Localnet governance and emergency signers must be distinct");

  const attacker = Keypair.generate();
  const airdrop = await connection.requestAirdrop(attacker.publicKey, 1_000_000_000);
  await connection.confirmTransaction(airdrop, "confirmed");
  await expectFailure(
    "unauthorized authority cannot initialize a condition rule",
    [await proposeRule(attacker.publicKey, [6_000, 4_000])],
    [attacker],
    6005,
  );
  assert.equal(await connection.getAccountInfo(conditionState), null, "rejected proposal unexpectedly initialized the condition PDA");

  await submit("governance proposal initializes the condition PDA", [await proposeRule(governanceAuthority, [6_000, 4_000])], [wallet]);
  const initializedState = await connection.getAccountInfo(conditionState);
  assert.ok(initializedState, "condition PDA was not initialized by the deployed program");
  assert.ok(initializedState.owner.equals(PROGRAM_ID), "condition PDA has the wrong owner");
  assert.ok(initializedState.data.length > 8, "condition PDA has no serialized state");

  await expectFailure("condition proposal cannot execute before its slot delay", [buildExecuteConditionRuleInstruction(vault)], [], 7020);
  await waitForSlots(minimumDelaySlots + 2n);
  await submit("permissionless execution activates the delayed condition rule", [buildExecuteConditionRuleInstruction(vault)], []);
  await expectFailure("future oracle publication is rejected by the deployed oracle adapter", [buildObserveConditionInstruction(vault)], [], 6006);
  await waitForUnixTime(BigInt(manifest.oraclePublishTime) + 1n);
  await submit("Pyth-shaped Localnet fixture observation reaches the condition instruction", [buildObserveConditionInstruction(vault)], []);
  await expectFailure("wrong condition nonce is rejected on chain", [buildActivateConditionInstruction(vault, 999n)], [], 7014);
  assert.equal(decodeVault((await connection.getAccountInfo(vault))!.data).configurationRevision, 1n, "rejected nonce changed the vault revision");

  let currentVault = decodeVault((await connection.getAccountInfo(vault))!.data);
  const snapshot = makeSnapshot(currentVault, null);
  const start = buildS2DInstruction({
    kind: "start",
    expectedVaultSequence: currentVault.sequence,
    sellAsset: 0,
    initialSellAmount: BigInt(manifest.startAmount),
  }, snapshot, wallet.publicKey);
  await submit("a real rebalance auction opens an on-chain intent", [start], [wallet]);
  const openIntentInfo = await connection.getAccountInfo(intent);
  assert.ok(openIntentInfo, "rebalance intent was not initialized");
  assert.ok(openIntentInfo.owner.equals(PROGRAM_ID), "rebalance intent is not owned by the deployed program");
  const openIntent = decodeIntent(openIntentInfo.data);
  await expectFailure("active rebalance intent blocks conditional activation", [buildActivateConditionInstruction(vault, 1n)], [], 7021);

  await submit("emergency authority pauses risk on chain", [pauseRisk()], [emergencyAuthority]);
  assert.equal((await readGovernanceFlags()).riskPaused, true, "pause transaction did not persist the governance pause");
  await expectFailure("pause blocks conditional activation", [buildActivateConditionInstruction(vault, 1n)], [], 6007);
  await submit("governance authority resumes risk on chain", [resumeRisk()], [wallet]);

  await waitForAbsoluteSlot(openIntent.endSlot + 2n);
  currentVault = decodeVault((await connection.getAccountInfo(vault))!.data);
  const liveSnapshot = makeSnapshot(currentVault, openIntent);
  const finish = buildS2DInstruction({
    kind: "finish",
    expectedVaultSequence: currentVault.sequence,
    expectedIntentSequence: openIntent.sequence,
  }, liveSnapshot, wallet.publicKey);
  await submit("expired local auction closes through the deployed SBF program", [finish], [wallet]);
  assert.equal(await connection.getAccountInfo(intent), null, "expired auction intent PDA was not closed");

  await submit("matching condition nonce changes targets after the auction closes", [buildActivateConditionInstruction(vault, 1n)], []);
  assert.deepEqual(decodeVault((await connection.getAccountInfo(vault))!.data).assets.map((asset) => asset.targetBps), [6_000, 4_000]);
  await submit("second condition proposal is created for stale-revision coverage", [await proposeRule(governanceAuthority, [5_500, 4_500])], [wallet]);
  const revisionBeforeGovernanceChange = decodeVault((await connection.getAccountInfo(vault))!.data).configurationRevision;
  await submit("a separate governance target proposal is accepted", [proposeTargets(revisionBeforeGovernanceChange, [5_000, 5_000])], [wallet]);
  await expectFailure("ordinary governance target change is delayed", [activateTargets()], [], 6011);
  await waitForSlots(minimumDelaySlots + 2n);
  await submit("ordinary governance target proposal advances the vault revision", [activateTargets()], []);
  const changedVault = decodeVault((await connection.getAccountInfo(vault))!.data);
  assert.equal(changedVault.configurationRevision, revisionBeforeGovernanceChange + 1n);
  await expectFailure("condition execution rejects its stale configuration revision", [buildExecuteConditionRuleInstruction(vault)], [], 7005);

  console.log("PASS: condition PDA initialization, authority, delay, observation, nonce, activation, active-auction, pause and stale-revision transactions ran against Localnet SBF.");
  console.log("LIMIT: oracle accounts are deterministic synthetic PriceUpdateV2 fixtures; this validates consumer-side checks only, not Pyth signatures or market-data authenticity.");
}

async function proposeRule(authority: PublicKey, targetBps: readonly [number, number]): Promise<TransactionInstruction> {
  const slot = BigInt(await connection.getSlot("confirmed"));
  const now = BigInt(Math.floor(Date.now() / 1_000));
  const config = {
    targetBps,
    expiresAt: now + 1_200n,
    expiresSlot: slot + 20_000n,
    predicate: {
      kind: "schedule" as const,
      assetIndex: 0 as const,
      notBeforeUnixTimestamp: now + 2n,
      notBeforeSlot: slot + 20n,
    },
  };
  return buildProposeConditionRuleInstruction(vault, authority, config, bounds);
}

function pauseRisk(): TransactionInstruction {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [meta(vault, true), meta(governance, true), meta(emergencyAuthority.publicKey, false, true)],
    data: Buffer.from([221, 2, 34, 100, 217, 178, 42, 15]),
  });
}

function resumeRisk(): TransactionInstruction {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      meta(vault, true),
      meta(governance, true),
      meta(auctionPolicy),
      meta(governanceAuthority, false, true),
    ],
    data: Buffer.from([207, 89, 77, 209, 47, 207, 14, 13]),
  });
}

function proposeTargets(expectedRevision: bigint, targetBps: readonly [number, number]): TransactionInstruction {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [meta(vault, true), meta(governance, true), meta(governanceAuthority, false, true)],
    data: Buffer.concat([
      Buffer.from([173, 80, 241, 209, 171, 165, 93, 64]),
      u64(expectedRevision),
      u16(targetBps[0]),
      u16(targetBps[1]),
    ]),
  });
}

function activateTargets(): TransactionInstruction {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [meta(vault, true), meta(governance, true)],
    data: Buffer.from([181, 9, 93, 20, 130, 145, 243, 226]),
  });
}

async function submit(label: string, instructions: TransactionInstruction[], signers: Keypair[]): Promise<{ signature: string; slot: number }> {
  const latest = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({
    feePayer: wallet.publicKey,
    recentBlockhash: latest.blockhash,
  }).add(...instructions);
  transaction.partialSign(wallet, ...signers);
  const signature = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: true, maxRetries: 3 });
  const confirmation = await connection.confirmTransaction({ signature, ...latest }, "confirmed");
  const details = await readConfirmedTransaction(signature);
  assert.equal(confirmation.value.err, null, `${label} unexpectedly failed: ${JSON.stringify(details.meta?.err)}\n${details.meta?.logMessages?.join("\n")}`);
  assert.equal(details.meta?.err, null, `${label} failed on chain: ${details.meta?.logMessages?.join("\n")}`);
  console.log(`PASS ${label} — ${signature}`);
  return { signature, slot: details.slot };
}

async function expectFailure(label: string, instructions: TransactionInstruction[], signers: Keypair[], errorNumber: number): Promise<void> {
  const latest = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({
    feePayer: wallet.publicKey,
    recentBlockhash: latest.blockhash,
  }).add(...instructions);
  transaction.partialSign(wallet, ...signers);
  const signature = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: true, maxRetries: 3 });
  const confirmation = await connection.confirmTransaction({ signature, ...latest }, "confirmed");
  const details = await readConfirmedTransaction(signature);
  const logs = details.meta?.logMessages?.join("\n") ?? "";
  assert.notEqual(confirmation.value.err, null, `${label} unexpectedly succeeded`);
  assert.notEqual(details.meta?.err, null, `${label} unexpectedly succeeded (${signature})`);
  assert.ok(logs.includes(`Error Number: ${errorNumber}`), `${label} failed for an unexpected reason (${signature}):\n${logs}`);
  console.log(`PASS ${label} — confirmed rejection ${signature} (Anchor error ${errorNumber})`);
}

async function readConfirmedTransaction(signature: string) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const transaction = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (transaction) return transaction;
    await sleep(250);
  }
  throw new Error(`confirmed transaction details unavailable for ${signature}`);
}

async function waitForSlots(count: bigint): Promise<void> {
  const target = BigInt(await connection.getSlot("confirmed")) + count;
  await waitForAbsoluteSlot(target);
}

async function waitForAbsoluteSlot(target: bigint): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (BigInt(await connection.getSlot("confirmed")) < target) {
    if (Date.now() > deadline) throw new Error(`Localnet did not reach slot ${target} within 120 seconds`);
    await sleep(200);
  }
}

async function waitForUnixTime(target: bigint): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (true) {
    const slot = await connection.getSlot("confirmed");
    const blockTime = await connection.getBlockTime(slot);
    if (blockTime !== null && BigInt(blockTime) >= target) return;
    if (Date.now() > deadline) throw new Error(`Localnet did not reach timestamp ${target} within 120 seconds`);
    await sleep(250);
  }
}

async function readGovernanceFlags(): Promise<{ riskPaused: boolean }> {
  const account = await connection.getAccountInfo(governance);
  assert.ok(account, "governance PDA is missing");
  assert.ok(account.owner.equals(PROGRAM_ID), "governance PDA has the wrong owner");
  return { riskPaused: decodeGovernance(account.data).riskPaused };
}

function makeSnapshot(vaultState: ReturnType<typeof decodeVault>, intentState: ReturnType<typeof decodeIntent> | null): ChainSnapshot {
  return {
    slot: 0n,
    vaultAddress: manifest.vault,
    oracleAccountsReady: true,
    custodyAccountsReady: true,
    custodyAmounts: [0n, 0n],
    vault: vaultState,
    governance: null,
    policy: null,
    intent: intentState,
  };
}

function keypairFromFile(path: string): Keypair {
  const raw = JSON.parse(readFileSync(path, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function meta(pubkey: PublicKey, isWritable = false, isSigner = false) {
  return { pubkey, isWritable, isSigner };
}

function u16(value: number): Buffer {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16LE(value);
  return bytes;
}

function u64(value: bigint): Buffer {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(value);
  return bytes;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
