// MagicBlock smoke test client for issue #38. Throwaway.
// Usage: node smoke.mjs <setup|s1|s2|observe>
//   KEYPAIR (default ~/.config/solana/coloyond-mb-smoke.json)
//   L1_RPC  (default https://api.devnet.solana.com)
//   ER_RPC  (default https://devnet-as.magicblock.app)
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
  sendAndConfirmTransaction, LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID, MINT_SIZE, ACCOUNT_SIZE, createInitializeMint2Instruction,
  createInitializeAccount3Instruction, createMintToInstruction, getAccount,
} from "@solana/spl-token";
import {
  DELEGATION_PROGRAM_ID, MAGIC_PROGRAM_ID, MAGIC_CONTEXT_ID, createTopUpEscrowInstruction,
  escrowPdaFromEscrowAuthority, delegateBufferPdaFromDelegatedAccountAndOwnerProgram, magicFeeVaultPdaFromValidator,
  delegationRecordPdaFromDelegatedAccount, delegationMetadataPdaFromDelegatedAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";

const PROGRAM_ID = new PublicKey("A9mTMCnEVm8PfoDBipSVnGeUwqWXQfs3XhXPQHi5CEEN");
const KEYPAIR = process.env.KEYPAIR ?? `${homedir()}/.config/solana/coloyond-mb-smoke.json`;
const L1_RPC = process.env.L1_RPC ?? "https://api.devnet.solana.com";
const ER_RPC = process.env.ER_RPC ?? "https://devnet-as.magicblock.app";
const STATE = "runs/state.json";

const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(KEYPAIR, "utf8"))));
const l1 = new Connection(L1_RPC, "confirmed");
const er = new Connection(ER_RPC, "confirmed");
const pda = (seed) => PublicKey.findProgramAddressSync([Buffer.from(seed)], PROGRAM_ID)[0];
const counter = pda("counter");
const l1Receipt = pda("l1");
const auth = pda("auth");
const vault = pda("vault");
const config = pda("config");
const disc = (name) => createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
const i64 = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
const ix = (name, keys, args = Buffer.alloc(0)) =>
  new TransactionInstruction({ programId: PROGRAM_ID, keys, data: Buffer.concat([disc(name), args]) });
const w = (pubkey, isSigner = false) => ({ pubkey, isSigner, isWritable: true });
const r = (pubkey, isSigner = false) => ({ pubkey, isSigner, isWritable: false });

mkdirSync("runs", { recursive: true });
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { log: [] };
const record = (step, extra) => {
  const entry = { at: new Date().toISOString(), step, ...extra };
  state.log.push(entry);
  writeFileSync(STATE, JSON.stringify(state, null, 2));
  console.log(JSON.stringify(entry));
};

async function sendL1(ixs, signers = []) {
  const tx = new Transaction().add(...ixs);
  return sendAndConfirmTransaction(l1, tx, [wallet, ...signers], { commitment: "confirmed" });
}

async function sendEr(ixs) {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = (await er.getLatestBlockhash()).blockhash;
  tx.sign(wallet);
  const sig = await er.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  const res = await er.confirmTransaction(sig, "confirmed");
  if (res.value.err) throw new Error(`ER tx ${sig} failed: ${JSON.stringify(res.value.err)}`);
  return sig;
}

async function readCounter(conn) {
  const info = await conn.getAccountInfo(counter);
  return info ? { owner: info.owner.toBase58(), count: Number(info.data.readBigUInt64LE(8)) } : null;
}

async function setup() {
  const bal = await l1.getBalance(wallet.publicKey);
  console.log(`wallet ${wallet.publicKey.toBase58()} ${bal / LAMPORTS_PER_SOL} SOL`);
  const validator = new PublicKey((await (await fetch(ER_RPC, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getIdentity" }),
  })).json()).result.identity);

  // Test mint (0 decimals), a vault-PDA-owned source account and a wallet-owned destination.
  const mint = Keypair.generate();
  const source = Keypair.generate();
  const destination = Keypair.generate();
  const mintRent = await l1.getMinimumBalanceForRentExemption(MINT_SIZE);
  const acctRent = await l1.getMinimumBalanceForRentExemption(ACCOUNT_SIZE);
  const tokenSig = await sendL1([
    SystemProgram.createAccount({ fromPubkey: wallet.publicKey, newAccountPubkey: mint.publicKey, lamports: mintRent, space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }),
    createInitializeMint2Instruction(mint.publicKey, 0, wallet.publicKey, null),
    SystemProgram.createAccount({ fromPubkey: wallet.publicKey, newAccountPubkey: source.publicKey, lamports: acctRent, space: ACCOUNT_SIZE, programId: TOKEN_PROGRAM_ID }),
    createInitializeAccount3Instruction(source.publicKey, mint.publicKey, vault),
    SystemProgram.createAccount({ fromPubkey: wallet.publicKey, newAccountPubkey: destination.publicKey, lamports: acctRent, space: ACCOUNT_SIZE, programId: TOKEN_PROGRAM_ID }),
    createInitializeAccount3Instruction(destination.publicKey, mint.publicKey, wallet.publicKey),
    createMintToInstruction(mint.publicKey, source.publicKey, wallet.publicKey, 100),
  ], [mint, source, destination]);
  state.mint = mint.publicKey.toBase58();
  state.source = source.publicKey.toBase58();
  state.destination = destination.publicKey.toBase58();
  record("tokens", { sig: tokenSig, mint: state.mint, source: state.source, destination: state.destination });

  const initSig = await sendL1([ix("initialize",
    [w(counter), w(l1Receipt), w(config), w(auth), w(wallet.publicKey, true), r(SystemProgram.programId)],
    Buffer.concat([source.publicKey.toBuffer(), destination.publicKey.toBuffer()]))]);
  record("initialize", { sig: initSig });

  // Fund the action escrow derived from the auth PDA, then delegate the counter.
  const escrow = escrowPdaFromEscrowAuthority(auth);
  const delegateIx = (name, account) => ix(name, [
    r(wallet.publicKey, true),
    w(delegateBufferPdaFromDelegatedAccountAndOwnerProgram(account, PROGRAM_ID)),
    w(delegationRecordPdaFromDelegatedAccount(account)),
    w(delegationMetadataPdaFromDelegatedAccount(account)),
    w(account),
    r(PROGRAM_ID),
    r(DELEGATION_PROGRAM_ID),
    r(SystemProgram.programId),
    r(validator),
  ]);
  const delSig = await sendL1([
    createTopUpEscrowInstruction(escrow, auth, wallet.publicKey, 0.05 * LAMPORTS_PER_SOL),
    delegateIx("delegate", counter),
    delegateIx("delegate_auth", auth),
  ]);
  record("delegate", { sig: delSig, validator: validator.toBase58(), escrow: escrow.toBase58(), auth: auth.toBase58() });
}

async function s1() {
  const before = await readCounter(er);
  const sig = await sendEr([ix("schedule_increment",
    [r(MAGIC_PROGRAM_ID), w(wallet.publicKey, true), w(counter), r(PROGRAM_ID)],
    Buffer.concat([i64(1), i64(2000), i64(5)]))]);
  record("s1.schedule", { sig, before });
  for (let t = 0; t < 20; t++) {
    await new Promise((res) => setTimeout(res, 2000));
    const c = await readCounter(er);
    console.log(`  t+${(t + 1) * 2}s ER count ${c?.count}`);
    if (c && before && c.count >= before.count + 5) break;
  }
  const after = await readCounter(er);
  record("s1.result", { after });
  if (!before || !after || after.count < before.count + 5) {
    throw new Error(`S1 FAIL: expected +5 increments, before=${before?.count} after=${after?.count}`);
  }
  console.log("S1 PASS");
}

async function s2() {
  const validator = new PublicKey(state.log.find((e) => e.step === "delegate").validator);
  const feeVault = magicFeeVaultPdaFromValidator(validator);
  const taskId = Number(process.env.TASK_ID ?? 3);
  const sig = await sendEr([ix("schedule_tick",
    [r(MAGIC_PROGRAM_ID), w(MAGIC_CONTEXT_ID), w(wallet.publicKey, true), w(counter), w(auth), r(config), w(feeVault), r(PROGRAM_ID)],
    Buffer.concat([i64(taskId), i64(15000), i64(4)]))]);
  record("s2.schedule", { sig, taskId, feeVault: feeVault.toBase58(), note: "client exits now; run observe later" });
}

async function observe() {
  const receipt = await l1.getAccountInfo(l1Receipt);
  const hits = receipt ? Number(receipt.data.readBigUInt64LE(8)) : null;
  const lastCount = receipt ? Number(receipt.data.readBigUInt64LE(16)) : null;
  const src = state.source ? (await getAccount(l1, new PublicKey(state.source))).amount.toString() : null;
  const dst = state.destination ? (await getAccount(l1, new PublicKey(state.destination))).amount.toString() : null;
  const sigs = (await l1.getSignaturesForAddress(l1Receipt, { limit: 10 })).map((s) => ({ sig: s.signature, err: s.err, time: s.blockTime }));
  record("observe", { erCounter: await readCounter(er), l1Counter: await readCounter(l1), l1Hits: hits, l1LastCount: lastCount, sourceTokens: src, destinationTokens: dst, l1ReceiptSigs: sigs });
}

const steps = { setup, s1, s2, observe };
const step = process.argv[2];
if (!steps[step]) { console.error("usage: node smoke.mjs <setup|s1|s2|observe>"); process.exit(2); }
steps[step]().catch((e) => { console.error(e); record(`${step}.error`, { error: String(e?.message ?? e), logs: e?.logs }); process.exit(1); });
