#!/usr/bin/env node
"use strict";

// Localnet-only S5E transaction probe. It creates disposable local token mints,
// never connects to a public cluster, and never stores the throwaway signer.
const crypto = require("node:crypto");
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} = require("@solana/web3.js");

const RPC_URL = process.env.COLOYOND_ETF_LOCALNET_RPC_URL || "http://127.0.0.1:18899";
const PROGRAM_ID = new PublicKey(
  process.env.COLOYOND_ETF_LOCALNET_PROGRAM_ID || "H3CkHowYVQcxrKXWkyswMW2rqRNzRQYaQr7N8LKXFUt9",
);
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const PYTH_RECEIVER_PROGRAM_ID = new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
const SOL_USD_ACCOUNT = new PublicKey("7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE");
const USDC_USD_ACCOUNT = new PublicKey("Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX");
const SOL_USD_FEED_ID = Buffer.from("ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d", "hex");
const USDC_USD_FEED_ID = Buffer.from("eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a", "hex");
const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const ZERO32 = Buffer.alloc(32);

function u16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
}

function u64(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}

function instructionDiscriminator(name) {
  return crypto.createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

function accountDiscriminator(name) {
  return crypto.createHash("sha256").update(`account:${name}`).digest().subarray(0, 8);
}

function encodeAsset({ mint, decimals, oracleMode, oracleAccount, feedId, weightBps }) {
  return Buffer.concat([
    mint.toBuffer(),
    TOKEN_PROGRAM_ID.toBuffer(),
    Buffer.from([decimals, oracleMode]),
    PYTH_RECEIVER_PROGRAM_ID.toBuffer(),
    oracleAccount.toBuffer(),
    feedId,
    u16(weightBps),
  ]);
}

function encodeConfig({ mints, governance, guardian, invalidFirstFeed = false }) {
  const assets = [
    {
      mint: mints[0].publicKey,
      decimals: 9,
      oracleMode: 0, // Fixed PushFeed is the first profile's enum tag.
      oracleAccount: SOL_USD_ACCOUNT,
      feedId: invalidFirstFeed ? Buffer.alloc(32, 0x7f) : SOL_USD_FEED_ID,
      weightBps: 5000,
    },
    {
      mint: mints[1].publicKey,
      decimals: 6,
      oracleMode: 0,
      oracleAccount: USDC_USD_ACCOUNT,
      feedId: USDC_USD_FEED_ID,
      weightBps: 5000,
    },
  ];
  const bytes = Buffer.concat([
    Buffer.from([1]),
    u32(assets.length),
    ...assets.map(encodeAsset),
    u16(0), // Draft math version.
    ZERO32, u32(0), // Unconfigured fee schema.
    ZERO32, u32(0), // Unconfigured risk schema.
    governance.toBuffer(),
    guardian.toBuffer(),
    u64(86_400),
  ]);
  const hash = crypto.createHash("sha256")
    .update(Buffer.from("coloyond:etf:config:v1", "utf8"))
    .update(bytes)
    .digest();
  return { bytes, hash, assets };
}

function validateDraftConfigWire(config, mints, governance, guardian) {
  const data = config.bytes;
  ensure(data.length === 479, `Two-asset empty-policy config should be 479 bytes, got ${data.length}`);
  ensure(data[0] === 1 && data.readUInt32LE(1) === 2, "Config version/count wire fields mismatch");
  for (let index = 0; index < 2; index += 1) {
    const start = 5 + index * 164;
    const expectedAccount = index === 0 ? SOL_USD_ACCOUNT : USDC_USD_ACCOUNT;
    const expectedFeed = index === 0 ? SOL_USD_FEED_ID : USDC_USD_FEED_ID;
    ensure(data.subarray(start, start + 32).equals(mints[index].publicKey.toBuffer()), `Asset ${index} mint field mismatch`);
    ensure(data.subarray(start + 32, start + 64).equals(TOKEN_PROGRAM_ID.toBuffer()), `Asset ${index} token program field mismatch`);
    ensure(data[start + 64] === (index === 0 ? 9 : 6), `Asset ${index} decimals field mismatch`);
    ensure(data[start + 65] === 0, `Asset ${index} must use PushFeed wire tag 0`);
    ensure(data.subarray(start + 66, start + 98).equals(PYTH_RECEIVER_PROGRAM_ID.toBuffer()), `Asset ${index} Receiver owner field mismatch`);
    ensure(data.subarray(start + 98, start + 130).equals(expectedAccount.toBuffer()), `Asset ${index} pinned feed address mismatch`);
    ensure(data.subarray(start + 130, start + 162).equals(expectedFeed), `Asset ${index} pinned feed ID mismatch`);
    ensure(data.readUInt16LE(start + 162) === 5000, `Asset ${index} target weight mismatch`);
  }
  const tail = 5 + 2 * 164;
  ensure(data.readUInt16LE(tail) === 0, "Draft math-version field mismatch");
  ensure(data.subarray(tail + 2, tail + 34).equals(ZERO32), "Fee schema ID should be unconfigured");
  ensure(data.readUInt32LE(tail + 34) === 0, "Fee schema params should be empty");
  ensure(data.subarray(tail + 38, tail + 70).equals(ZERO32), "Risk schema ID should be unconfigured");
  ensure(data.readUInt32LE(tail + 70) === 0, "Risk schema params should be empty");
  ensure(data.subarray(tail + 74, tail + 106).equals(governance.toBuffer()), "Initial governance field mismatch");
  ensure(data.subarray(tail + 106, tail + 138).equals(guardian.toBuffer()), "Initial guardian field mismatch");
  ensure(data.readBigUInt64LE(tail + 138) === 86_400n, "Governance delay field mismatch");
}

function derivePdas(configHash) {
  const [pool] = PublicKey.findProgramAddressSync([Buffer.from("etf_pool_v1"), configHash], PROGRAM_ID);
  const [poolState] = PublicKey.findProgramAddressSync([Buffer.from("etf_pool_state_v1"), pool.toBuffer()], PROGRAM_ID);
  const [shareMint] = PublicKey.findProgramAddressSync([Buffer.from("etf_share_v1"), pool.toBuffer()], PROGRAM_ID);
  const [authority] = PublicKey.findProgramAddressSync([Buffer.from("etf_authority_v1"), pool.toBuffer()], PROGRAM_ID);
  const custodies = [];
  const assetStates = [];
  for (let index = 0; index < 2; index += 1) {
    custodies.push(PublicKey.findProgramAddressSync([Buffer.from("etf_custody_v1"), pool.toBuffer(), Buffer.from([index])], PROGRAM_ID)[0]);
    assetStates.push(PublicKey.findProgramAddressSync([Buffer.from("etf_asset_v1"), pool.toBuffer(), Buffer.from([index])], PROGRAM_ID)[0]);
  }
  return { pool, poolState, shareMint, authority, custodies, assetStates };
}

function associatedTokenAddress(owner, mint) {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

function initializeMint2Instruction(mint, decimals, authority) {
  const data = Buffer.alloc(35);
  data[0] = 20;
  data[1] = decimals;
  authority.toBuffer().copy(data, 2);
  data[34] = 0; // No freeze authority.
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [{ pubkey: mint, isSigner: false, isWritable: true }],
    data,
  });
}

function createAtaInstruction(payer, ata, owner, mint) {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]), // CreateIdempotent.
  });
}

function mintToInstruction(mint, destination, authority, amount) {
  const data = Buffer.alloc(9);
  data[0] = 7;
  data.writeBigUInt64LE(BigInt(amount), 1);
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data,
  });
}

function initInstruction(config, pdas, mints, payer, badState = null) {
  const data = Buffer.concat([
    instructionDiscriminator("initialize_pool"),
    config.hash,
    u32(config.bytes.length),
    config.bytes,
  ]);
  const keys = [
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: pdas.pool, isSigner: false, isWritable: true },
    { pubkey: badState || pdas.poolState, isSigner: false, isWritable: true },
    { pubkey: pdas.shareMint, isSigner: false, isWritable: true },
    { pubkey: pdas.authority, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  for (let index = 0; index < 2; index += 1) {
    keys.push(
      { pubkey: mints[index].publicKey, isSigner: false, isWritable: false },
      { pubkey: pdas.custodies[index], isSigner: false, isWritable: true },
      { pubkey: pdas.assetStates[index], isSigner: false, isWritable: true },
    );
  }
  return new TransactionInstruction({ programId: PROGRAM_ID, keys, data });
}

function seedInstruction({ payer, config, pdas, mints, userTokenAccounts, shareAccount }) {
  const keys = [
    { pubkey: payer.publicKey, isSigner: true, isWritable: false },
    { pubkey: pdas.pool, isSigner: false, isWritable: true },
    { pubkey: pdas.poolState, isSigner: false, isWritable: true },
    { pubkey: pdas.shareMint, isSigner: false, isWritable: true },
    { pubkey: pdas.authority, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    // Fixed addresses with no data are intentionally used here. This is a
    // wrong/incomplete Localnet feed fixture, not synthetic Pyth verification.
    { pubkey: SOL_USD_ACCOUNT, isSigner: false, isWritable: false },
    { pubkey: USDC_USD_ACCOUNT, isSigner: false, isWritable: false },
    { pubkey: PROGRAM_ID, isSigner: false, isWritable: false }, // Optional feed 2 sentinel.
    { pubkey: shareAccount, isSigner: false, isWritable: true },
  ];
  for (let index = 0; index < 2; index += 1) {
    keys.push(
      { pubkey: mints[index].publicKey, isSigner: false, isWritable: false },
      { pubkey: pdas.custodies[index], isSigner: false, isWritable: true },
      { pubkey: userTokenAccounts[index], isSigner: false, isWritable: true },
      { pubkey: pdas.assetStates[index], isSigner: false, isWritable: true },
    );
  }
  const data = Buffer.concat([
    instructionDiscriminator("seed_pool"),
    u32(2), u64(1_000), u64(1_000), u64(1),
  ]);
  return new TransactionInstruction({ programId: PROGRAM_ID, keys, data });
}

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

async function sendTransaction(connection, payer, transaction, extraSigners = [], expectation = "success") {
  const latest = await connection.getLatestBlockhash("confirmed");
  transaction.feePayer = payer.publicKey;
  transaction.recentBlockhash = latest.blockhash;
  transaction.sign(payer, ...extraSigners);
  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: expectation !== "success",
    maxRetries: 0,
    preflightCommitment: "confirmed",
  });
  const confirmation = await connection.confirmTransaction({
    signature,
    blockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
  }, "confirmed");
  let result = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  for (let attempt = 0; !result && attempt < 12; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    result = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
  }
  ensure(result && result.meta, `RPC did not return confirmed transaction metadata for ${signature}`);
  const error = confirmation.value.err || result.meta.err;
  ensure(expectation === "either" || (expectation === "error" ? Boolean(error) : !error), expectation === "error"
    ? `Expected a confirmed on-chain rejection, but ${signature} succeeded`
    : `Transaction ${signature} failed: ${JSON.stringify(error)}`);
  return { signature, slot: result.slot, feeLamports: result.meta.fee, error: error || null, logs: result.meta.logMessages || [] };
}

async function tokenAmount(connection, tokenAccount) {
  const account = await connection.getTokenAccountBalance(tokenAccount, "confirmed");
  return account.value.amount;
}

async function assertAbsent(connection, addresses, label) {
  const accounts = await connection.getMultipleAccountsInfo(addresses, "confirmed");
  ensure(accounts.every((account) => account === null), `${label}: expected all derived accounts to remain absent`);
}

function customErrorCode(error) {
  const instructionError = error?.InstructionError;
  const failure = Array.isArray(instructionError) ? instructionError[1] : null;
  return failure && typeof failure === "object" ? failure.Custom : null;
}

function parsePool(account, expectedConfig, expectedPdas, payer) {
  const data = account.data;
  ensure(account.owner.equals(PROGRAM_ID), "Pool PDA has an unexpected owner");
  ensure(data.subarray(0, 8).equals(accountDiscriminator("EtfPoolV1")), "Pool account discriminator mismatch");
  ensure(data[8] === 1, "Pool version mismatch");
  ensure(data.subarray(10, 42).equals(expectedConfig.hash), "Pool config hash mismatch");
  const configLength = data.readUInt32LE(42);
  ensure(data.subarray(46, 46 + configLength).equals(expectedConfig.bytes), "Pool stored config bytes mismatch");
  const shareMintOffset = 46 + configLength;
  ensure(new PublicKey(data.subarray(shareMintOffset, shareMintOffset + 32)).equals(expectedPdas.shareMint), "Pool share mint PDA mismatch");
  ensure(new PublicKey(data.subarray(shareMintOffset + 32, shareMintOffset + 64)).equals(payer.publicKey), "Pool initializer mismatch");
}

function parseState(account, expectedPdas) {
  const data = account.data;
  ensure(account.owner.equals(PROGRAM_ID), "Pool-state PDA has an unexpected owner");
  ensure(data.length === 300, `Pool-state allocation should be 300 bytes, got ${data.length}`);
  ensure(data.subarray(0, 8).equals(accountDiscriminator("EtfPoolStateV1")), "Pool-state discriminator mismatch");
  ensure(data[8] === 1, "Pool-state version mismatch");
  ensure(new PublicKey(data.subarray(10, 42)).equals(expectedPdas.pool), "Pool-state parent address mismatch");
  ensure(data[106] === 0, "New pool lifecycle should be Unseeded");
  ensure(data[107] === 1, "New pool must begin risk-paused");
  ensure(data.readBigUInt64LE(108) === 0n, "New pool sequence should be zero");
  ensure(data[116] === 0 && data[160] === 0 && data[209] === 0, "New pool optional state fields should be absent");
  ensure(data[291] === 0 && data.readBigUInt64LE(292) === 0n, "Scheduler should be disabled at generation zero");
}

function parseMint(account, expectedAuthority, expectedDecimals) {
  ensure(account.owner.equals(TOKEN_PROGRAM_ID), "Share mint is not owned by classic SPL Token");
  ensure(account.data.length === 82, "Share mint allocation should be 82 bytes");
  ensure(account.data.readUInt32LE(0) === 1, "Share mint authority option is not set");
  ensure(new PublicKey(account.data.subarray(4, 36)).equals(expectedAuthority), "Share mint authority PDA mismatch");
  ensure(account.data[44] === expectedDecimals, "Share mint decimals mismatch");
  ensure(account.data[45] === 1, "Share mint should be initialized");
  ensure(account.data.readBigUInt64LE(36) === 0n, "Share mint supply should start at zero");
  ensure(account.data.subarray(46, 82).equals(Buffer.alloc(36)), "Share mint should have no freeze authority");
}

async function main() {
  const parsedRpc = new URL(RPC_URL);
  ensure(parsedRpc.protocol === "http:" && ["127.0.0.1", "localhost"].includes(parsedRpc.hostname), "Refusing non-Localnet RPC URL");
  const connection = new Connection(RPC_URL, "confirmed");
  const genesisHash = await connection.getGenesisHash();
  ensure(genesisHash !== DEVNET_GENESIS, "RPC is Devnet; refusing to run this Localnet-only harness");
  const programAccount = await connection.getAccountInfo(PROGRAM_ID, "confirmed");
  ensure(programAccount && programAccount.executable, "ETF SBF program is not loaded at the draft Localnet program ID");

  const payer = Keypair.generate();
  const airdropBlockhash = await connection.getLatestBlockhash("confirmed");
  const airdropSignature = await connection.requestAirdrop(payer.publicKey, 10 * 1_000_000_000);
  const airdropConfirmation = await connection.confirmTransaction({
    signature: airdropSignature,
    blockhash: airdropBlockhash.blockhash,
    lastValidBlockHeight: airdropBlockhash.lastValidBlockHeight,
  }, "confirmed");
  ensure(!airdropConfirmation.value.err, "Localnet faucet did not confirm the throwaway payer airdrop");

  const mints = [Keypair.generate(), Keypair.generate()];
  const decimals = [9, 6];
  const mintRent = await connection.getMinimumBalanceForRentExemption(82, "confirmed");
  const createMints = new Transaction();
  for (let index = 0; index < 2; index += 1) {
    createMints.add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mints[index].publicKey,
        lamports: mintRent,
        space: 82,
        programId: TOKEN_PROGRAM_ID,
      }),
      initializeMint2Instruction(mints[index].publicKey, decimals[index], payer.publicKey),
    );
  }
  const mintReceipt = await sendTransaction(connection, payer, createMints, mints);

  const userTokenAccounts = mints.map((mint) => associatedTokenAddress(payer.publicKey, mint.publicKey));
  const createAndFund = new Transaction();
  for (let index = 0; index < 2; index += 1) {
    createAndFund.add(
      createAtaInstruction(payer.publicKey, userTokenAccounts[index], payer.publicKey, mints[index].publicKey),
      mintToInstruction(mints[index].publicKey, userTokenAccounts[index], payer.publicKey, index === 0 ? 1_000_000_000 : 1_000_000),
    );
  }
  const tokenReceipt = await sendTransaction(connection, payer, createAndFund);
  const governance = Keypair.generate().publicKey;
  let guardian = Keypair.generate().publicKey;
  while (guardian.equals(governance)) guardian = Keypair.generate().publicKey;
  const config = encodeConfig({ mints, governance, guardian });
  validateDraftConfigWire(config, mints, governance, guardian);
  const pdas = derivePdas(config.hash);
  const accountAddresses = [pdas.pool, pdas.poolState, pdas.shareMint, ...pdas.custodies, ...pdas.assetStates];

  // The changed feed ID should reject after mode validation. At pinned f9db9c1,
  // the older ReceiverFull-only condition masks that later check.
  const wrongFeedConfig = encodeConfig({ mints, governance, guardian, invalidFirstFeed: true });
  const wrongFeedPdas = derivePdas(wrongFeedConfig.hash);
  const tokenBeforeWrongFeed = await Promise.all(userTokenAccounts.map((address) => tokenAmount(connection, address)));
  const wrongFeedReceipt = await sendTransaction(
    connection,
    payer,
    new Transaction().add(initInstruction(wrongFeedConfig, wrongFeedPdas, mints, payer)),
    [],
    "error",
  );
  await assertAbsent(connection, [wrongFeedPdas.pool, wrongFeedPdas.poolState, wrongFeedPdas.shareMint, ...wrongFeedPdas.custodies, ...wrongFeedPdas.assetStates], "wrong-feed config rejection");
  const wrongFeedBalancesAfter = await Promise.all(userTokenAccounts.map((address) => tokenAmount(connection, address)));
  ensure(JSON.stringify(tokenBeforeWrongFeed) === JSON.stringify(wrongFeedBalancesAfter), "Wrong-feed rejection changed user token balances");

  // A mismatched state PDA must fail Anchor account validation before init creates anything.
  const tokenBeforeBadState = await Promise.all(userTokenAccounts.map((address) => tokenAmount(connection, address)));
  const badState = Keypair.generate().publicKey;
  const badStateReceipt = await sendTransaction(
    connection,
    payer,
    new Transaction().add(initInstruction(config, pdas, mints, payer, badState)),
    [],
    "error",
  );
  await assertAbsent(connection, accountAddresses, "wrong-state-PDA rejection");
  const badStateBalancesAfter = await Promise.all(userTokenAccounts.map((address) => tokenAmount(connection, address)));
  ensure(JSON.stringify(tokenBeforeBadState) === JSON.stringify(badStateBalancesAfter), "Wrong-state-PDA rejection changed user token balances");

  const tokenBeforeInit = await Promise.all(userTokenAccounts.map((address) => tokenAmount(connection, address)));
  const initReceipt = await sendTransaction(connection, payer, new Transaction().add(initInstruction(config, pdas, mints, payer)), [], "either");
  if (initReceipt.error) {
    ensure(customErrorCode(initReceipt.error) === 6000, `PushFeed config hit unexpected on-chain error: ${JSON.stringify(initReceipt.error)}`);
    ensure(initReceipt.logs.some((line) => line.includes("src/config.rs:29")), "Pinned-base rejection did not originate at the S5E mode/feed identity check");
    await assertAbsent(connection, accountAddresses, "pinned-base PushFeed-mode rejection");
    const unchangedTokenBalances = await Promise.all(userTokenAccounts.map((address) => tokenAmount(connection, address)));
    ensure(JSON.stringify(tokenBeforeInit) === JSON.stringify(unchangedTokenBalances), "Pinned-base rejection changed user token balances");
    const report = {
      status: "EXPECTED_PINNED_BASE_GAP",
      cluster: "localnet",
      rpcUrl: RPC_URL,
      genesisHash,
      programId: PROGRAM_ID.toBase58(),
      testWallet: payer.publicKey.toBase58(),
      localMints: mints.map((mint, index) => ({ address: mint.publicKey.toBase58(), decimals: decimals[index], label: `Disposable Localnet test mint ${index + 1}; unbacked` })),
      oracleAddresses: [SOL_USD_ACCOUNT.toBase58(), USDC_USD_ACCOUNT.toBase58()],
      configBytesLength: config.bytes.length,
      configModeTags: [config.bytes[70], config.bytes[70 + 164]],
      receiverProgramId: PYTH_RECEIVER_PROGRAM_ID.toBase58(),
      wireChecks: "479-byte Borsh v1 config; both PushFeed tags are 0; exact fixed-feed keys/IDs and Receiver owner bytes; both 5,000 bps weights; distinct generated authorities; empty unconfigured fee/risk payloads; 86,400-second draft delay",
      signatures: {
        nonProfileFeedConfigRejectedByOldModeGate: wrongFeedReceipt.signature,
        invalidStatePdaRejected: badStateReceipt.signature,
        pinnedPushFeedInitRejected: initReceipt.signature,
      },
      successfulSetupTransactions: [mintReceipt, tokenReceipt].map(({ signature, slot, feeLamports }) => ({ signature, slot, feeLamports })),
      feesLamports: {
        nonProfileFeedConfig: wrongFeedReceipt.feeLamports,
        invalidStatePda: badStateReceipt.feeLamports,
        pinnedPushFeedInit: initReceipt.feeLamports,
      },
      rejectedInitError: initReceipt.error,
      rejectedInitLogs: initReceipt.logs,
      nonProfileFeedConfigError: wrongFeedReceipt.error,
      nonProfileFeedConfigLogs: wrongFeedReceipt.logs,
      invalidStatePdaError: badStateReceipt.error,
      invalidStatePdaLogs: badStateReceipt.logs,
      tokenBalancesUnchanged: unchangedTokenBalances,
      poolDerivedAccountsPresent: false,
      reason: "This harness is pinned to f9db9c1, whose config decoder accepts ReceiverFull mode only. The first profile was corrected to fixed PushFeed by cf4fcbc after that base. The config bytes were independently checked for exact length, both pinned feed address/ID pairs, Receiver owner, mint/token-program fields, weights, authorities, and empty draft policies; its only mismatch with f9db9c1's line-29 predicate is PushFeed tag 0 versus the old ReceiverFull requirement. The on-chain init attempt was rejected as InvalidConfig and all derived pool accounts remain absent. Rerun this harness after integrating cf4fcbc.",
      disclaimer: "This is an expected Localnet source-baseline incompatibility, not a Devnet result or a successful pool initialization.",
    };
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const [poolAccount, stateAccount, shareMintAccount, ...rest] = await connection.getMultipleAccountsInfo(
    [pdas.pool, pdas.poolState, pdas.shareMint, ...pdas.custodies, ...pdas.assetStates],
    "confirmed",
  );
  ensure(poolAccount && stateAccount && shareMintAccount, "Init did not create all primary pool PDAs");
  parsePool(poolAccount, config, pdas, payer);
  parseState(stateAccount, pdas);
  parseMint(shareMintAccount, pdas.authority, 6);
  const custodyAccounts = rest.slice(0, 2);
  const assetStateAccounts = rest.slice(2);
  for (let index = 0; index < 2; index += 1) {
    ensure(custodyAccounts[index] && custodyAccounts[index].data.length === 165, `Custody ${index} missing or wrong allocation`);
    ensure(custodyAccounts[index].owner.equals(TOKEN_PROGRAM_ID), `Custody ${index} is not a classic SPL account`);
    ensure(new PublicKey(custodyAccounts[index].data.subarray(0, 32)).equals(mints[index].publicKey), `Custody ${index} mint mismatch`);
    ensure(new PublicKey(custodyAccounts[index].data.subarray(32, 64)).equals(pdas.authority), `Custody ${index} authority mismatch`);
    ensure(custodyAccounts[index].data.readBigUInt64LE(64) === 0n, `Custody ${index} should start empty`);
    ensure(assetStateAccounts[index] && assetStateAccounts[index].data.length === 59, `Asset state ${index} missing or wrong allocation`);
    ensure(assetStateAccounts[index].owner.equals(PROGRAM_ID), `Asset state ${index} owner mismatch`);
    ensure(assetStateAccounts[index].data.subarray(0, 8).equals(accountDiscriminator("EtfAssetStateV1")), `Asset state ${index} discriminator mismatch`);
    ensure(assetStateAccounts[index].data[42] === index, `Asset state ${index} index mismatch`);
    ensure(assetStateAccounts[index].data.subarray(43, 59).equals(Buffer.alloc(16)), `Asset state ${index} fee counter should start at zero`);
  }

  const duplicateBefore = await connection.getMultipleAccountsInfo([pdas.pool, pdas.poolState, pdas.shareMint, ...pdas.custodies, ...pdas.assetStates], "confirmed");
  const tokenBeforeDuplicate = await Promise.all(userTokenAccounts.map((address) => tokenAmount(connection, address)));
  const duplicateInitReceipt = await sendTransaction(connection, payer, new Transaction().add(initInstruction(config, pdas, mints, payer)), [], "error");
  const duplicateAfter = await connection.getMultipleAccountsInfo([pdas.pool, pdas.poolState, pdas.shareMint, ...pdas.custodies, ...pdas.assetStates], "confirmed");
  ensure(duplicateBefore.every((account, index) => account && duplicateAfter[index] && account.data.equals(duplicateAfter[index].data)), "Duplicate-init rejection changed derived account state");
  const duplicateTokenAfter = await Promise.all(userTokenAccounts.map((address) => tokenAmount(connection, address)));
  ensure(JSON.stringify(tokenBeforeDuplicate) === JSON.stringify(duplicateTokenAfter), "Duplicate-init rejection changed user token balances");

  const shareAta = associatedTokenAddress(payer.publicKey, pdas.shareMint);
  const createShareAtaReceipt = await sendTransaction(connection, payer, new Transaction().add(createAtaInstruction(payer.publicKey, shareAta, payer.publicKey, pdas.shareMint)));
  const balancesBeforeSeed = await Promise.all([...userTokenAccounts, ...pdas.custodies, shareAta].map((address) => tokenAmount(connection, address)));
  const seedReceipt = await sendTransaction(
    connection,
    payer,
    new Transaction().add(seedInstruction({ payer, config, pdas, mints, userTokenAccounts, shareAccount: shareAta })),
    [],
    "error",
  );
  const balancesAfterSeed = await Promise.all([...userTokenAccounts, ...pdas.custodies, shareAta].map((address) => tokenAmount(connection, address)));
  ensure(JSON.stringify(balancesBeforeSeed) === JSON.stringify(balancesAfterSeed), "Rejected seed changed a user, custody, or share token balance");
  const stateAfterSeed = await connection.getAccountInfo(pdas.poolState, "confirmed");
  ensure(stateAfterSeed && stateAfterSeed.data.equals(stateAccount.data), "Rejected seed changed pool state");

  const report = {
    status: "LOCALNET_ONLY_PASS",
    disclaimer: "Synthetic Localnet configuration and disposable local mints only. No Devnet mint backing, oracle authenticity, accepted policy, or CP5 proof is implied.",
    cluster: "localnet",
    rpcUrl: RPC_URL,
    genesisHash,
    programId: PROGRAM_ID.toBase58(),
    testWallet: payer.publicKey.toBase58(),
    localMints: mints.map((mint, index) => ({ address: mint.publicKey.toBase58(), decimals: decimals[index], label: `Disposable Localnet test mint ${index + 1}; unbacked` })),
    oracleAddresses: [SOL_USD_ACCOUNT.toBase58(), USDC_USD_ACCOUNT.toBase58()],
    pool: pdas.pool.toBase58(),
    poolState: pdas.poolState.toBase58(),
    shareMint: pdas.shareMint.toBase58(),
    custody: pdas.custodies.map((address) => address.toBase58()),
    assetState: pdas.assetStates.map((address) => address.toBase58()),
    successfulTransactions: [mintReceipt, tokenReceipt, initReceipt, createShareAtaReceipt].map(({ signature, slot, feeLamports }) => ({ signature, slot, feeLamports })),
    rejectedTransactions: [wrongFeedReceipt, badStateReceipt, duplicateInitReceipt, seedReceipt].map(({ signature, slot, feeLamports, error }) => ({ signature, slot, feeLamports, error })),
    tokenBalanceChecks: [
      { action: "wrong-feed config rejection", accounts: userTokenAccounts.map((address, index) => ({ address: address.toBase58(), before: tokenBeforeWrongFeed[index], after: wrongFeedBalancesAfter[index] })) },
      { action: "invalid pool-state PDA rejection", accounts: userTokenAccounts.map((address, index) => ({ address: address.toBase58(), before: tokenBeforeBadState[index], after: badStateBalancesAfter[index] })) },
      { action: "duplicate initialization rejection", accounts: userTokenAccounts.map((address, index) => ({ address: address.toBase58(), before: tokenBeforeDuplicate[index], after: duplicateTokenAfter[index] })) },
      { action: "seed rejected on absent Localnet oracle data", accounts: [...userTokenAccounts, ...pdas.custodies, shareAta].map((address, index) => ({ address: address.toBase58(), before: balancesBeforeSeed[index], after: balancesAfterSeed[index] })) },
    ],
    checks: [
      "ETF SBF program loaded as executable in a fresh Localnet genesis",
      "Local wallet signed classic SPL mint setup and pool initialization transactions",
      "Pool/config/state/share/custody/asset-state PDA contents and allocations reconciled from RPC",
      "Wrong pinned feed config rejected with no derived accounts or token changes",
      "Invalid pool-state PDA rejected with no derived accounts or token changes",
      "Duplicate initialization rejected with all existing account data unchanged",
      "Seed attempt rejected on incomplete Localnet oracle accounts; token/share balances and pool state unchanged",
    ],
    gaps: [
      "No confirmed Devnet transaction or program deployment.",
      "No genuine Pyth feed update/Full verification was used; the Localnet seed rejection is caused by absent feed data.",
      "Delayed governance resume exists in the current draft, but this harness does not transact it. Seed/deposit/redeem/swap remain unusable: valid seed and swap still return PolicyNotFrozen, and seed did not reach that gate because Localnet has no Pyth account data.",
      "This harness does not validate fee/economic policy, approved mint/feed manifest, governance, or scheduler behavior.",
    ],
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(`Localnet ETF probe failed: ${error?.stack || error}`);
  process.exitCode = 1;
});
