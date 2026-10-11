#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { exerciseGovernedPolicySequence } from "./policy-sequence.mjs";

const require = createRequire(import.meta.url);
const web3 = require("@solana/web3.js");

const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} = web3;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const PROGRAM_ID = new PublicKey("FN7uGX34qyijmVX69gqEkMugWjE5Sjso8Pe7gWU6B2N6");
const PythProgram = new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
const SolUsdFeed = new PublicKey("7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE");
const UsdcUsdFeed = new PublicKey("Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX");
const WsolMint = new PublicKey("So11111111111111111111111111111111111111112");
const DevnetUsdcMint = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const TokenProgram = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const AssociatedTokenProgram = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const UpgradeableLoader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const SolFeedId = Buffer.from("ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d", "hex");
const UsdcFeedId = Buffer.from("eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a", "hex");
const DISCRIMINATOR = Uint8Array.of(48, 191, 163, 44, 71, 129, 63, 164);
const AUTO_RUNTIME = !process.env.COLOYOND_BOOTSTRAP_HOME;
const runtime = process.env.COLOYOND_BOOTSTRAP_HOME
  ? path.resolve(process.env.COLOYOND_BOOTSTRAP_HOME)
  : mkdtempSync(path.join(os.tmpdir(), "coloyond-bootstrap-"));
const ledger = path.join(runtime, "ledger");
const fixtures = path.join(runtime, "fixtures");
const keyPath = path.join(runtime, "bootstrap-authority.json");
const logPath = path.join(runtime, "validator.log");
const rpcPort = Number(process.env.COLOYOND_BOOTSTRAP_RPC_PORT ?? 18_989);
const faucetPort = Number(process.env.COLOYOND_BOOTSTRAP_FAUCET_PORT ?? rpcPort + 1_000);
const gossipPort = Number(process.env.COLOYOND_BOOTSTRAP_GOSSIP_PORT ?? rpcPort + 2);
const dynamicPortRange = process.env.COLOYOND_BOOTSTRAP_DYNAMIC_PORT_RANGE ?? `${rpcPort + 10}-${rpcPort + 109}`;
const rpcUrl = `http://127.0.0.1:${rpcPort}`;
const solanaBin = process.env.SOLANA_BIN_DIR ?? path.join(os.homedir(), ".local/share/solana/install/active_release/bin");
const validatorBin = process.env.SOLANA_TEST_VALIDATOR ?? path.join(solanaBin, "solana-test-validator");
const buildBin = process.env.CARGO_BUILD_SBF ?? path.join(solanaBin, "cargo-build-sbf");
const toolsVersion = process.env.COLOYOND_SBF_TOOLS_VERSION ?? "v1.57";
const sbfRustc = process.env.SOLANA_SBF_RUSTC ?? path.join(os.homedir(), ".cache/solana", toolsVersion, "platform-tools/rust/bin/rustc");
const programSo = path.join(ROOT, "target/deploy/coloyond_vault.so");
let validator;
let connection;
let failed = false;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function pubkeyMeta(pubkey, isWritable = false, isSigner = false) {
  return { pubkey, isWritable, isSigner };
}

function u16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function u64(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
}

function associatedTokenAddress(owner, mint) {
  return PublicKey.findProgramAddressSync([
    owner.toBuffer(), TokenProgram.toBuffer(), mint.toBuffer(),
  ], AssociatedTokenProgram)[0];
}

function createAssociatedTokenAccountInstruction(payer, address, owner, mint) {
  return new TransactionInstruction({
    programId: AssociatedTokenProgram,
    keys: [
      pubkeyMeta(payer, true, true), pubkeyMeta(address, true), pubkeyMeta(owner), pubkeyMeta(mint),
      pubkeyMeta(SystemProgram.programId), pubkeyMeta(TokenProgram),
    ],
    data: Buffer.alloc(0),
  });
}

function mintToInstruction(mint, destination, authority, amount) {
  return new TransactionInstruction({
    programId: TokenProgram,
    keys: [pubkeyMeta(mint, true), pubkeyMeta(destination, true), pubkeyMeta(authority, false, true)],
    data: Buffer.concat([Buffer.from([7]), u64(amount)]),
  });
}

async function tokenAmount(address) {
  const info = await connection.getAccountInfo(address);
  assert(info?.owner.equals(TokenProgram), `${address.toBase58()} is missing or not owned by classic SPL Token`);
  assert(info.data.length === 165, `token account ${address.toBase58()} has length ${info.data.length}, expected 165`);
  return info.data.readBigUInt64LE(64);
}

async function readMint(address) {
  const info = await connection.getAccountInfo(address);
  assert(info?.owner.equals(TokenProgram), `${address.toBase58()} mint is missing or not owned by classic SPL Token`);
  assert(info.data.length === 82, `mint ${address.toBase58()} has length ${info.data.length}, expected 82`);
  return {
    mintAuthority: info.data.readUInt32LE(0) === 1 ? new PublicKey(info.data.subarray(4, 36)) : null,
    supply: info.data.readBigUInt64LE(36),
    decimals: info.data[44],
    initialized: info.data[45] === 1,
    freezeAuthority: info.data.readUInt32LE(46) === 1 ? new PublicKey(info.data.subarray(50, 82)) : null,
  };
}

function encodeInitializeVault({ governanceAuthority, emergencyAuthority, seedAmounts, minDelaySlots }) {
  return Buffer.concat([
    Buffer.from(DISCRIMINATOR),
    u64(1),
    u16(5_000), u16(5_000),
    u64(seedAmounts[0]), u64(seedAmounts[1]),
    u64(20_000_000), u64(2_000_000),
    u64(1_000_000),
    governanceAuthority.toBuffer(), emergencyAuthority.toBuffer(),
    u64(minDelaySlots), u64(120), u16(1_000), u16(500),
  ]);
}

function initializeInstruction(accounts, init) {
  const keys = [
    pubkeyMeta(accounts.vault, true),
    pubkeyMeta(accounts.governance, true),
    pubkeyMeta(accounts.shareMint, true),
    pubkeyMeta(accounts.seeder, true, true),
    pubkeyMeta(accounts.bootstrapAuthority, false, true),
    pubkeyMeta(accounts.governanceAuthority, false, true),
    pubkeyMeta(accounts.emergencyAuthority, false, true),
    pubkeyMeta(PROGRAM_ID),
    pubkeyMeta(accounts.programData),
    pubkeyMeta(accounts.seederShares, true),
    pubkeyMeta(accounts.seederAssetA, true),
    pubkeyMeta(accounts.seederAssetB, true),
    pubkeyMeta(accounts.custodyA, true),
    pubkeyMeta(accounts.custodyB, true),
    pubkeyMeta(WsolMint),
    pubkeyMeta(DevnetUsdcMint),
    pubkeyMeta(SolUsdFeed),
    pubkeyMeta(UsdcUsdFeed),
    pubkeyMeta(TokenProgram),
    pubkeyMeta(SystemProgram.programId),
  ];
  return new TransactionInstruction({ programId: PROGRAM_ID, keys, data: encodeInitializeVault(init) });
}

function accountDump(pubkey, owner, data) {
  return {
    pubkey: pubkey.toBase58(),
    account: {
      lamports: 10_000_000_000,
      data: [Buffer.from(data).toString("base64"), "base64"],
      owner: owner.toBase58(),
      executable: false,
      rentEpoch: 0,
    },
  };
}

function writeDump(file, dump) {
  writeFileSync(path.join(fixtures, file), `${JSON.stringify(dump, null, 2)}\n`, { mode: 0o600 });
}

function writeMintGenesis(mint, authority, decimals, name) {
  const data = Buffer.concat([u32(1), authority.publicKey.toBuffer(), u64(0), Buffer.from([decimals, 1]), u32(0), Buffer.alloc(32)]);
  assert(data.length === 82, `classic SPL mint fixture length was ${data.length}`);
  writeDump(`${name}.json`, accountDump(mint, TokenProgram, data));
}

function writePriceGenesis(address, feedId, price, name) {
  const discriminator = createHash("sha256").update("account:PriceUpdateV2").digest().subarray(0, 8);
  const publishTime = BigInt(Math.floor(Date.now() / 1_000));
  const data = Buffer.concat([
    discriminator,
    Keypair.generate().publicKey.toBuffer(),
    Buffer.from([1]), // Borsh enum variant Full; fixture bytes are not Pyth-verified.
    feedId,
    i64(price), u64(0), i32(0), i64(publishTime), i64(publishTime - 1n), i64(price), u64(0),
    u64(0),
  ]);
  assert(data.byteLength === 133, `PriceUpdateV2 fixture length was ${data.byteLength}, expected 133`);
  writeDump(`${name}.json`, accountDump(address, PythProgram, data));
}

function i64(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigInt64LE(BigInt(value));
  return buffer;
}

function i32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32LE(value);
  return buffer;
}

function saveKeypair(file, keypair) {
  writeFileSync(file, `${JSON.stringify(Array.from(keypair.secretKey))}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}

function runBuild() {
  if (process.env.COLOYOND_SKIP_SBF_BUILD === "1") {
    assert(existsSync(programSo), `COLOYOND_SKIP_SBF_BUILD=1 but ${programSo} is missing`);
    return;
  }
  assert(existsSync(sbfRustc), `Missing SBF rustc at ${sbfRustc}; set SOLANA_SBF_RUSTC`);
  const result = spawnSync(buildBin, [
    "--no-rustup-override", "--tools-version", toolsVersion,
    "--manifest-path", path.join(ROOT, "programs/coloyond-vault/Cargo.toml"),
    "--sbf-out-dir", path.dirname(programSo), "--", "--offline",
  ], { cwd: ROOT, encoding: "utf8", env: { ...process.env, RUSTC: sbfRustc }, stdio: "inherit" });
  assert(result.status === 0, `SBF build failed with status ${result.status}`);
  assert(existsSync(programSo), `SBF build did not produce ${programSo}`);
}

function startValidator() {
  mkdirSync(ledger, { recursive: true, mode: 0o700 });
  const args = [
    "--reset", "--ledger", ledger,
    "--bind-address", "127.0.0.1",
    "--rpc-port", String(rpcPort),
    "--faucet-port", String(faucetPort),
    "--gossip-port", String(gossipPort),
    "--dynamic-port-range", dynamicPortRange,
    "--upgradeable-program", PROGRAM_ID.toBase58(), programSo, keyPath,
    "--account", SolUsdFeed.toBase58(), path.join(fixtures, "sol-usd.json"),
    "--account", UsdcUsdFeed.toBase58(), path.join(fixtures, "usdc-usd.json"),
    "--account", WsolMint.toBase58(), path.join(fixtures, "wsol-mint.json"),
    "--account", DevnetUsdcMint.toBase58(), path.join(fixtures, "usdc-mint.json"),
  ];
  const log = require("node:fs").openSync(logPath, "w", 0o600);
  validator = spawn(validatorBin, args, { cwd: ROOT, stdio: ["ignore", log, log], env: process.env });
  validator.unref();
}

async function waitForValidator() {
  connection = new Connection(rpcUrl, "confirmed");
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (validator.exitCode !== null) throw new Error(`Local validator exited; see ${logPath}`);
    try {
      await connection.getVersion();
      return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error(`Local validator did not become ready at ${rpcUrl}; see ${logPath}`);
}

async function submit(instructions, signers, options = {}) {
  const transaction = new Transaction().add(...instructions);
  const blockhash = await connection.getLatestBlockhash("confirmed");
  transaction.feePayer = signers[0].publicKey;
  transaction.recentBlockhash = blockhash.blockhash;
  transaction.sign(...signers);
  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    preflightCommitment: "confirmed",
    ...options,
  });
  await waitForSignature(signature, blockhash.lastValidBlockHeight);
  return signature;
}

async function waitForSignature(signature, lastValidBlockHeight) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
    if (status?.err) {
      const error = new Error(`Localnet transaction failed: ${JSON.stringify(status.err)}`);
      error.signature = signature;
      error.slot = status.slot;
      const transaction = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      error.logs = transaction?.meta?.logMessages ?? [];
      throw error;
    }
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return;
    const currentHeight = await connection.getBlockHeight("confirmed");
    if (currentHeight > lastValidBlockHeight) throw new Error(`Localnet transaction expired before confirmation: ${signature}`);
    await sleep(250);
  }
  throw new Error(`Localnet transaction was not confirmed before timeout: ${signature}`);
}

async function expectFailure(instruction, signers, label, expectedLog) {
  let error;
  try {
    await submit([instruction], signers, { skipPreflight: true });
  } catch (caught) {
    error = caught;
  }
  assert(error, `${label} unexpectedly succeeded`);
  assert(error.signature, `${label} failed before receiving a transaction signature; on-chain failure was not proven`);
  let transaction;
  for (let attempt = 0; attempt < 20 && !transaction; attempt++) {
    transaction = await connection.getTransaction(error.signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (!transaction) await sleep(250);
  }
  assert(transaction?.meta?.err, `${label} did not land as a failed transaction on the Localnet ledger`);
  const logs = error.logs?.length ? error.logs : (transaction?.meta?.logMessages ?? []);
  const joined = logs.join("\n").toLowerCase();
  if (expectedLog) assert(joined.includes(expectedLog.toLowerCase()), `${label} failed without expected log '${expectedLog}': ${joined}`);
  const evidence = { signature: error.signature, slot: transaction.slot, error: transaction.meta.err, logs };
  console.log(`PASS ${label}: ${JSON.stringify(evidence)}`);
  return evidence;
}

async function assertEmptyBootstrapState(vault, governance, custodyA, custodyB, shareMint, userA, userB, userShares) {
  assert((await connection.getAccountInfo(vault)) === null, "failed initialization left a vault PDA behind");
  assert((await connection.getAccountInfo(governance)) === null, "failed initialization left a governance PDA behind");
  assert((await tokenAmount(custodyA)) === 0n, "failed initialization changed asset A custody");
  assert((await tokenAmount(custodyB)) === 0n, "failed initialization changed asset B custody");
  assert((await readMint(shareMint)).supply === 0n, "failed initialization changed share supply");
  assert((await tokenAmount(userA)) === 1_000_000_000n, "failed initialization did not roll back the first asset transfer");
  assert((await tokenAmount(userB)) === 100_000_000n, "failed initialization changed the second source balance");
  assert((await tokenAmount(userShares)) === 0n, "failed initialization minted shares");
  return {
    vaultAbsent: true,
    governanceAbsent: true,
    custody: [(await tokenAmount(custodyA)).toString(), (await tokenAmount(custodyB)).toString()],
    shareSupply: (await readMint(shareMint)).supply.toString(),
    sourceBalances: [(await tokenAmount(userA)).toString(), (await tokenAmount(userB)).toString()],
    seederShares: (await tokenAmount(userShares)).toString(),
  };
}

async function run() {
  const policyDelaySlots = BigInt(process.env.COLOYOND_BOOTSTRAP_POLICY_DELAY_SLOTS ?? "32");
  assert(policyDelaySlots >= 10n && policyDelaySlots <= 1_024n, "policy delay must be between 10 and 1,024 slots");
  mkdirSync(runtime, { recursive: true, mode: 0o700 });
  chmodSync(runtime, 0o700);
  mkdirSync(fixtures, { recursive: true, mode: 0o700 });
  const bootstrapAuthority = Keypair.generate();
  const rejectedAuthority = Keypair.generate();
  const seeder = Keypair.generate();
  const governanceAuthority = Keypair.generate();
  const emergencyAuthority = Keypair.generate();
  const assetMintAuthority = Keypair.generate();
  const shareMintKeypair = Keypair.generate();
  saveKeypair(keyPath, bootstrapAuthority);

  const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault")], PROGRAM_ID);
  const [governance] = PublicKey.findProgramAddressSync([Buffer.from("governance"), vault.toBuffer()], PROGRAM_ID);
  const [programData] = PublicKey.findProgramAddressSync([PROGRAM_ID.toBuffer()], UpgradeableLoader);

  writeMintGenesis(WsolMint, assetMintAuthority, 9, "wsol-mint");
  writeMintGenesis(DevnetUsdcMint, assetMintAuthority, 6, "usdc-mint");
  writePriceGenesis(SolUsdFeed, SolFeedId, 100, "sol-usd");
  writePriceGenesis(UsdcUsdFeed, UsdcFeedId, 1, "usdc-usd");

  console.log(`Building and launching an isolated Localnet at ${rpcUrl}.`);
  runBuild();
  startValidator();
  try {
    await waitForValidator();
    const genesisHash = await connection.getGenesisHash();
    const validatorVersion = await connection.getVersion();
    const airdrop = await connection.requestAirdrop(seeder.publicKey, 25 * web3.LAMPORTS_PER_SOL);
    await waitForSignature(airdrop, Number.MAX_SAFE_INTEGER);
    const governanceAirdrop = await connection.requestAirdrop(governanceAuthority.publicKey, 2 * web3.LAMPORTS_PER_SOL);
    await waitForSignature(governanceAirdrop, Number.MAX_SAFE_INTEGER);
    const emergencyAirdrop = await connection.requestAirdrop(emergencyAuthority.publicKey, web3.LAMPORTS_PER_SOL);
    await waitForSignature(emergencyAirdrop, Number.MAX_SAFE_INTEGER);

    const programInfo = await connection.getAccountInfo(PROGRAM_ID);
    const programDataInfo = await connection.getAccountInfo(programData);
    assert(programInfo?.executable, "deployed program account is missing or not executable");
    assert(programInfo.owner.equals(UpgradeableLoader), "program is not owned by the upgradeable loader");
    assert(programDataInfo?.owner.equals(UpgradeableLoader), "ProgramData is missing or has the wrong owner");
    assert(programDataInfo.data.readUInt32LE(0) === 3, "ProgramData loader state discriminant is not ProgramData");
    assert(programDataInfo.data[12] === 1, "ProgramData does not have an upgrade authority");
    assert(new PublicKey(programDataInfo.data.subarray(13, 45)).equals(bootstrapAuthority.publicKey), "ProgramData authority does not match the Localnet bootstrap signer");

    const wsolAta = associatedTokenAddress(seeder.publicKey, WsolMint);
    const usdcAta = associatedTokenAddress(seeder.publicKey, DevnetUsdcMint);
    await submit([
      createAssociatedTokenAccountInstruction(seeder.publicKey, wsolAta, seeder.publicKey, WsolMint),
      createAssociatedTokenAccountInstruction(seeder.publicKey, usdcAta, seeder.publicKey, DevnetUsdcMint),
    ], [seeder]);
    await submit([
      SystemProgram.transfer({ fromPubkey: seeder.publicKey, toPubkey: wsolAta, lamports: 1_000_000_000 }),
      new TransactionInstruction({ programId: TokenProgram, keys: [pubkeyMeta(wsolAta, true)], data: Buffer.from([17]) }),
    ], [seeder]);
    await submit([mintToInstruction(DevnetUsdcMint, usdcAta, assetMintAuthority.publicKey, 100_000_000n)], [seeder, assetMintAuthority]);

    const shareMint = shareMintKeypair.publicKey;
    const shareMintRent = await connection.getMinimumBalanceForRentExemption(82);
    await submit([
      SystemProgram.createAccount({ fromPubkey: seeder.publicKey, newAccountPubkey: shareMint, lamports: shareMintRent, space: 82, programId: TokenProgram }),
      new TransactionInstruction({
        programId: TokenProgram,
        keys: [pubkeyMeta(shareMint, true)],
        data: Buffer.concat([Buffer.from([20, 6]), vault.toBuffer(), Buffer.from([0])]),
      }),
    ], [seeder, shareMintKeypair]);
    const userShares = associatedTokenAddress(seeder.publicKey, shareMint);
    await submit([createAssociatedTokenAccountInstruction(seeder.publicKey, userShares, seeder.publicKey, shareMint)], [seeder]);
    const custodyA = associatedTokenAddress(vault, WsolMint);
    const custodyB = associatedTokenAddress(vault, DevnetUsdcMint);
    await submit([
      createAssociatedTokenAccountInstruction(seeder.publicKey, custodyA, vault, WsolMint),
      createAssociatedTokenAccountInstruction(seeder.publicKey, custodyB, vault, DevnetUsdcMint),
    ], [seeder]);

    const accounts = {
      vault,
      governance,
      shareMint,
      mintA: WsolMint,
      mintB: DevnetUsdcMint,
      seeder: seeder.publicKey,
      bootstrapAuthority: bootstrapAuthority.publicKey,
      governanceAuthority: governanceAuthority.publicKey,
      emergencyAuthority: emergencyAuthority.publicKey,
      programData,
      seederShares: userShares,
      seederAssetA: wsolAta,
      seederAssetB: usdcAta,
      custodyA,
      custodyB,
    };
    const baseInit = {
      governanceAuthority: governanceAuthority.publicKey,
      emergencyAuthority: emergencyAuthority.publicKey,
      seedAmounts: [1_000_000_000n, 100_000_000n],
      minDelaySlots: policyDelaySlots,
    };

    const wrongAuthorityEvidence = await expectFailure(
      initializeInstruction({ ...accounts, bootstrapAuthority: rejectedAuthority.publicKey }, baseInit),
      [seeder, rejectedAuthority, governanceAuthority, emergencyAuthority],
      "wrong upgrade authority rejected",
      "invalidbootstrapauthority",
    );
    const wrongAuthorityRollback = await assertEmptyBootstrapState(vault, governance, custodyA, custodyB, shareMint, wsolAta, usdcAta, userShares);
    console.log(`PASS wrong-authority rollback readback: ${JSON.stringify(wrongAuthorityRollback)}`);

    const transferFailure = initializeInstruction({ ...accounts, bootstrapAuthority: bootstrapAuthority.publicKey }, {
      ...baseInit,
      seedAmounts: [1_000_000_000n, 100_000_001n],
    });
    const cpiFailureEvidence = await expectFailure(
      transferFailure,
      [seeder, bootstrapAuthority, governanceAuthority, emergencyAuthority],
      "second seed transfer failure rolled back first CPI and PDA initialization",
      "insufficient funds",
    );
    const cpiRollback = await assertEmptyBootstrapState(vault, governance, custodyA, custodyB, shareMint, wsolAta, usdcAta, userShares);
    console.log(`PASS CPI rollback readback: ${JSON.stringify(cpiRollback)}`);

    const successSignature = await submit([
      initializeInstruction({ ...accounts, bootstrapAuthority: bootstrapAuthority.publicKey }, baseInit),
    ], [seeder, bootstrapAuthority, governanceAuthority, emergencyAuthority]);
    const successTransaction = await connection.getTransaction(successSignature, {
      commitment: "confirmed", maxSupportedTransactionVersion: 0,
    });
    assert(successTransaction && successTransaction.meta?.err === null, "successful initializer transaction is missing or failed");

    const vaultInfo = await connection.getAccountInfo(vault);
    const governanceInfo = await connection.getAccountInfo(governance);
    assert(vaultInfo?.owner.equals(PROGRAM_ID), "created vault has the wrong program owner");
    assert(governanceInfo?.owner.equals(PROGRAM_ID), "created governance account has the wrong program owner");
    assert(vaultInfo.data.length === 353, `vault account length ${vaultInfo.data.length} != 353`);
    assert(vaultInfo.data[8] === 1, "vault version is not initialized");
    assert(vaultInfo.data[10] === 2, "vault did not start paused");
    assert(new PublicKey(vaultInfo.data.subarray(249, 281)).equals(shareMint), "vault share mint does not match");
    const expectedNavQ9 = 200_000_000_000n;
    const expectedShares = expectedNavQ9 / 1_000n;
    assert(vaultInfo.data.readBigUInt64LE(281) === expectedShares, "vault share count is not the floor of the conservative seed NAV at $1/share");
    assert(vaultInfo.data.readBigUInt64LE(289) === 1_000_000n, "minimum locked share amount does not match");
    assert(vaultInfo.data.readBigUInt64LE(297) === 1_000_000_000n && vaultInfo.data.readBigUInt64LE(305) === 100_000_000n, "accounted seed balances do not match");
    assert(vaultInfo.data.readBigUInt64LE(313) === 20_000_000n && vaultInfo.data.readBigUInt64LE(321) === 2_000_000n, "bootstrap reserve subledger does not match");
    assert(governanceInfo.data.length >= 231, "governance account is shorter than the serialized fields");
    assert(governanceInfo.data[229] === 0 && governanceInfo.data[230] === 1, "governance was not initialized with no pending proposal and risk paused");
    assert(new PublicKey(governanceInfo.data.subarray(137, 169)).equals(governanceAuthority.publicKey), "governance authority does not match");
    assert(new PublicKey(governanceInfo.data.subarray(169, 201)).equals(emergencyAuthority.publicKey), "emergency authority does not match");

    const custodyAmountA = await tokenAmount(custodyA);
    const custodyAmountB = await tokenAmount(custodyB);
    const shareMintState = await readMint(shareMint);
    const supply = shareMintState.supply;
    const userSharesAmount = await tokenAmount(userShares);
    assert(custodyAmountA === 1_000_000_000n && custodyAmountB === 100_000_000n, "custody balances do not match the seed");
    assert(supply === expectedShares && userSharesAmount === expectedShares, "share mint supply or seeder balance does not match NAV-derived shares");
    assert(shareMintState.initialized && shareMintState.decimals === 6, "share mint is not initialized with 6 decimals");
    assert(shareMintState.freezeAuthority === null, "share mint unexpectedly has a freeze authority");
    assert(shareMintState.mintAuthority.equals(vault), "share mint authority is not the vault PDA");

    const governedPolicy = await exerciseGovernedPolicySequence({
      connection,
      programId: PROGRAM_ID,
      accounts,
      seeder,
      governanceAuthority,
      emergencyAuthority,
      delaySlots: policyDelaySlots,
      submitTransaction: submit,
      expectFailedTransaction: expectFailure,
      tokenAmount,
    });

    const result = {
      cluster: "localnet",
      validatorVersion: validatorVersion["solana-core"],
      genesisHash,
      programId: PROGRAM_ID.toBase58(),
      programData: programData.toBase58(),
      bootstrapAuthority: bootstrapAuthority.publicKey.toBase58(),
      seeder: seeder.publicKey.toBase58(),
      governanceAuthority: governanceAuthority.publicKey.toBase58(),
      emergencyAuthority: emergencyAuthority.publicKey.toBase58(),
      vault: vault.toBase58(),
      governance: governance.toBase58(),
      shareMint: shareMint.toBase58(),
      shareAccount: userShares.toBase58(),
      custodyAccounts: [custodyA.toBase58(), custodyB.toBase58()],
      seederAssetAccounts: [wsolAta.toBase58(), usdcAta.toBase58()],
      rejectedAuthorityTx: wrongAuthorityEvidence,
      wrongAuthorityRollback,
      cpiFailureTx: cpiFailureEvidence,
      cpiRollback,
      successSignature,
      successSlot: successTransaction.slot,
      status: "active after delayed governed policy sequence",
      configuredPolicyDelaySlots: policyDelaySlots.toString(),
      seedAmounts: ["1000000000", "100000000"],
      reserveContributions: ["20000000", "2000000"],
      conservativeNavQ9: expectedNavQ9.toString(),
      shareSupply: expectedShares.toString(),
      custodyBalances: [custodyAmountA.toString(), custodyAmountB.toString()],
      wrongAuthorityRejected: true,
      secondTransferRollbackVerified: true,
      governedPolicy,
      oracleFixture: "synthetic Full-shaped PriceUpdateV2; not Pyth authenticated",
    };
    console.log("PASS bootstrap, governed policy delay, resume, and all post-state/rollback assertions");
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await stopValidator();
  }
}

async function stopValidator() {
  if (validator && validator.exitCode === null) {
    validator.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => validator.once("exit", resolve)),
      sleep(5_000),
    ]);
    if (validator.exitCode === null) validator.kill("SIGKILL");
  }
}

try {
  await run();
} catch (error) {
  failed = true;
  console.error(error?.stack ?? error);
  if (logPath) {
    try { console.error(`Validator log: ${logPath}`); } catch { /* no-op */ }
  }
} finally {
  try { await stopValidator(); } catch { /* no-op */ }
  try { rmSync(keyPath, { force: true }); } catch { /* no-op */ }
  if (AUTO_RUNTIME) rmSync(runtime, { recursive: true, force: true });
}
if (failed) process.exitCode = 1;
