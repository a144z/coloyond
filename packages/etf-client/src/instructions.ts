import { PublicKey, SystemProgram, TransactionInstruction, type AccountMeta } from "@solana/web3.js";
import { ETF_DEVNET_TOKEN_PROGRAM } from "./devnet-read.js";
import { assertRiskOracleReady, assertVerifiedEtfSnapshot, type VerifiedEtfSnapshot } from "./readback.js";
import { assertVerifiedEtfManifest, ETF_CLASSIC_TOKEN_PROGRAM, type VerifiedEtfManifest } from "./manifest.js";
import { quoteProportionalDeposit, quoteProportionalRedeem } from "./shares.js";

const U64_MAX = (1n << 64n) - 1n;
const TOKEN_PROGRAM = new PublicKey(ETF_DEVNET_TOKEN_PROGRAM);
const SYSTEM_PROGRAM = SystemProgram.programId;
const ASSOCIATED_TOKEN_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

export type AssetWalletAccounts = Readonly<{ mint: string; tokenAccount: string }>;
export type BuildOperation = Readonly<{ instruction: TransactionInstruction; action: "initialize" | "seed" | "deposit" | "redeem" | "swap" | "pause" | "poke" | "resume_propose" | "resume_execute" | "resume_cancel"; riskIncreasing: boolean }>;

function u64(value: bigint, label: string): Buffer {
  if (typeof value !== "bigint" || value < 0n || value > U64_MAX) throw new Error(`${label}_outside_u64`);
  const output = Buffer.alloc(8);
  output.writeBigUInt64LE(value);
  return output;
}
function u32(value: number, label: string): Buffer {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) throw new Error(`${label}_outside_u32`);
  const output = Buffer.alloc(4);
  output.writeUInt32LE(value);
  return output;
}
function u8(value: number, label: string): Buffer {
  if (!Number.isInteger(value) || value < 0 || value > 255) throw new Error(`${label}_outside_u8`);
  return Buffer.from([value]);
}
function u64Vector(values: readonly bigint[], expectedLength: number, label: string): Buffer {
  if (!Array.isArray(values) || values.length !== expectedLength) throw new Error(`${label}_asset_count_mismatch`);
  return Buffer.concat([u32(values.length, `${label}_length`), ...values.map((value, index) => u64(value, `${label}_${index}`))]);
}
function idlInstruction(context: VerifiedEtfManifest, name: string): { discriminator: number[] } {
  assertVerifiedEtfManifest(context);
  const instructions = context.idl.instructions as { name: string; discriminator: number[] }[];
  const instruction = instructions.find((item) => item.name === name);
  if (!instruction) throw new Error(`verified_idl_instruction_missing_${name}`);
  return instruction;
}
function account(pubkey: string | PublicKey, isSigner = false, isWritable = false): AccountMeta {
  return { pubkey: typeof pubkey === "string" ? new PublicKey(pubkey) : pubkey, isSigner, isWritable };
}
function optionalFeedKeys(context: VerifiedEtfManifest): AccountMeta[] {
  return [0, 1, 2].map((index) => {
    const asset = context.config.assets[index];
    return asset === undefined ? account(context.programId) : account(asset.oracleAccount);
  });
}
function instruction(context: VerifiedEtfManifest, name: string, keys: AccountMeta[], args: Buffer): TransactionInstruction {
  const discriminator = Buffer.from(idlInstruction(context, name).discriminator);
  if (discriminator.length !== 8) throw new Error("idl_instruction_discriminator_invalid");
  return new TransactionInstruction({ programId: context.programId, keys, data: Buffer.concat([discriminator, args]) });
}
function keyVector(context: VerifiedEtfManifest, wallets: readonly AssetWalletAccounts[], label: string): PublicKey[] {
  if (wallets.length !== context.config.assets.length) throw new Error(`${label}_asset_count_mismatch`);
  return wallets.map((entry, index) => {
    const asset = context.config.assets[index]!;
    if (!new PublicKey(entry.mint).equals(asset.mint)) throw new Error(`${label}_${index}_mint_order_mismatch`);
    return new PublicKey(entry.tokenAccount);
  });
}
function verifiedWalletAccount(snapshot: VerifiedEtfSnapshot, wallet: PublicKey, address: PublicKey, mint: PublicKey): bigint {
  if (!snapshot.wallet || snapshot.wallet.address !== wallet.toBase58()) throw new Error("wallet_token_readback_required");
  const row = snapshot.wallet.tokenAccounts.find((item) => item.address === address.toBase58() && item.mint === mint.toBase58());
  if (!row || row.frozen) throw new Error("wallet_token_account_not_in_verified_readback");
  return BigInt(row.amount);
}
function verifySnapshot(context: VerifiedEtfManifest, snapshot: VerifiedEtfSnapshot, wallet?: PublicKey): void {
  assertVerifiedEtfSnapshot(snapshot, context);
  if (wallet && (!snapshot.wallet || snapshot.wallet.address !== wallet.toBase58())) throw new Error("wallet_snapshot_mismatch");
}
function requireInputsWithinCap(context: VerifiedEtfManifest, snapshot: VerifiedEtfSnapshot, assetIndex: number, amount: bigint): void {
  const reserve = BigInt(snapshot.assets[assetIndex]!.custodyAmount);
  const cap = (reserve * BigInt(context.manifest.feePolicy.maximumInputBps)) / 10_000n;
  if (amount > cap) throw new Error("gross_input_exceeds_accepted_pool_size_cap");
}

/** Builds the standard idempotent ATA instruction for an admitted ETF asset or share mint. */
export function buildCreateEtfTokenAccountInstruction(context: VerifiedEtfManifest, payer: PublicKey, owner: PublicKey, mint: PublicKey): TransactionInstruction {
  assertVerifiedEtfManifest(context);
  const admittedMint = context.addresses.shareMint.equals(mint) || context.config.assets.some((asset) => asset.mint.equals(mint));
  if (!admittedMint) throw new Error("token_account_mint_not_in_manifest");
  const [associatedAccount] = PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM);
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM,
    keys: [account(payer, true, true), account(associatedAccount, false, true), account(owner), account(mint), account(SYSTEM_PROGRAM), account(TOKEN_PROGRAM)],
    data: Buffer.from([1]),
  });
}

export function buildInitializePoolInstruction(context: VerifiedEtfManifest, payer: PublicKey): BuildOperation {
  const remaining: AccountMeta[] = [];
  for (let index = 0; index < context.config.assets.length; index += 1) {
    const asset = context.config.assets[index]!;
    const addresses = context.addresses.assets[index]!;
    remaining.push(account(asset.mint, false, true), account(addresses.custody, false, true), account(addresses.assetState, false, true));
  }
  const keys = [account(payer, true, true), account(context.addresses.pool, false, true), account(context.addresses.poolState, false, true), account(context.addresses.shareMint, false, true), account(context.addresses.authority), account(TOKEN_PROGRAM), account(SYSTEM_PROGRAM), ...remaining];
  const data = Buffer.concat([Buffer.from(context.configHash), u32(context.configBytes.length, "config_bytes_length"), context.configBytes]);
  return { instruction: instruction(context, "initialize_pool", keys, data), action: "initialize", riskIncreasing: false };
}

export function buildSeedPoolInstruction(context: VerifiedEtfManifest, snapshot: VerifiedEtfSnapshot, seed: PublicKey, inputs: readonly bigint[], minSharesOut: bigint, seedShareTokenAccount: PublicKey, assetWallets: readonly AssetWalletAccounts[]): BuildOperation {
  verifySnapshot(context, snapshot, seed);
  assertRiskOracleReady(snapshot);
  if (snapshot.state.lifecycle !== "unseeded" || snapshot.state.riskPaused) throw new Error("pool_not_seed_ready");
  if (minSharesOut === 0n) throw new Error("min_shares_out_zero");
  const wallets = keyVector(context, assetWallets, "seed_wallets");
  const shareAccount = snapshot.wallet?.shareAccounts.find((row) => row.address === seedShareTokenAccount.toBase58());
  if (!shareAccount || shareAccount.frozen || BigInt(shareAccount.amount) !== 0n) throw new Error("seed_share_account_not_in_verified_readback");
  wallets.forEach((address, index) => {
    if (inputs[index]! > verifiedWalletAccount(snapshot, seed, address, context.config.assets[index]!.mint)) throw new Error(`seed_wallet_balance_insufficient_${index}`);
    if (snapshot.assets[index]!.custodyFrozen) throw new Error(`custody_token_account_frozen_${index}`);
  });
  const remaining: AccountMeta[] = [account(seedShareTokenAccount, false, true)];
  context.config.assets.forEach((asset, index) => {
    const addresses = context.addresses.assets[index]!;
    remaining.push(account(asset.mint), account(addresses.custody, false, true), account(wallets[index]!, false, true), account(addresses.assetState));
  });
  const keys = [account(seed, true), account(context.addresses.pool, false, true), account(context.addresses.poolState, false, true), account(context.addresses.shareMint, false, true), account(context.addresses.authority), account(TOKEN_PROGRAM), ...optionalFeedKeys(context), ...remaining];
  const args = Buffer.concat([u64Vector(inputs, context.config.assets.length, "seed_amounts"), u64(minSharesOut, "min_shares_out")]);
  return { instruction: instruction(context, "seed_pool", keys, args), action: "seed", riskIncreasing: true };
}

export function buildProportionalDepositInstruction(context: VerifiedEtfManifest, snapshot: VerifiedEtfSnapshot, user: PublicKey, maxInputs: readonly bigint[], minSharesOut: bigint, userShareAccount: PublicKey, assetWallets: readonly AssetWalletAccounts[]): BuildOperation {
  verifySnapshot(context, snapshot, user);
  if (snapshot.state.lifecycle !== "active" || snapshot.state.riskPaused) throw new Error("pool_not_deposit_ready");
  if (minSharesOut === 0n) throw new Error("min_shares_out_zero");
  const quote = quoteProportionalDeposit(maxInputs, snapshot.assets.map((asset) => BigInt(asset.custodyAmount)), BigInt(snapshot.shares.supply));
  if (minSharesOut > quote.sharesOut) throw new Error("min_shares_out_exceeds_current_quote");
  const shareAccount = snapshot.wallet?.shareAccounts.find((row) => row.address === userShareAccount.toBase58());
  if (!shareAccount || shareAccount.frozen) throw new Error("user_share_account_not_in_verified_readback");
  const wallets = keyVector(context, assetWallets, "deposit_wallets");
  wallets.forEach((address, index) => {
    if (quote.consumed[index]! > verifiedWalletAccount(snapshot, user, address, context.config.assets[index]!.mint)) throw new Error(`deposit_wallet_balance_insufficient_${index}`);
    if (snapshot.assets[index]!.custodyFrozen) throw new Error(`custody_token_account_frozen_${index}`);
  });
  const remaining: AccountMeta[] = [account(userShareAccount, false, true)];
  context.config.assets.forEach((asset, index) => {
    const addresses = context.addresses.assets[index]!;
    remaining.push(account(asset.mint), account(addresses.custody, false, true), account(wallets[index]!, false, true), account(addresses.assetState));
  });
  const keys = [account(user, true, true), account(context.addresses.pool, false, true), account(context.addresses.poolState, false, true), account(context.addresses.shareMint, false, true), account(context.addresses.authority), account(TOKEN_PROGRAM), ...remaining];
  const args = Buffer.concat([u64Vector(maxInputs, context.config.assets.length, "deposit_max_inputs"), u64(minSharesOut, "min_shares_out")]);
  return { instruction: instruction(context, "deposit_proportional", keys, args), action: "deposit", riskIncreasing: true };
}

export function buildInKindRedeemInstruction(context: VerifiedEtfManifest, snapshot: VerifiedEtfSnapshot, user: PublicKey, sharesToBurn: bigint, minAmountsOut: readonly bigint[], userShareAccount: PublicKey, assetWallets: readonly AssetWalletAccounts[]): BuildOperation {
  verifySnapshot(context, snapshot, user);
  if (snapshot.state.lifecycle !== "active") throw new Error("pool_not_redeemable");
  if (sharesToBurn === 0n) throw new Error("shares_to_burn_zero");
  const quote = quoteProportionalRedeem(sharesToBurn, BigInt(snapshot.shares.supply), snapshot.assets.map((asset) => BigInt(asset.custodyAmount)));
  if (minAmountsOut.some((minimum, index) => minimum > quote.amountsOut[index]!)) throw new Error("min_redeem_amount_exceeds_current_quote");
  const wallets = keyVector(context, assetWallets, "redeem_wallets");
  wallets.forEach((address, index) => verifiedWalletAccount(snapshot, user, address, context.config.assets[index]!.mint));
  if (snapshot.assets.some((asset) => asset.custodyFrozen)) throw new Error("custody_token_account_frozen");
  const shareRow = snapshot.wallet?.shareAccounts.find((row) => row.address === userShareAccount.toBase58());
  if (!shareRow || shareRow.frozen || BigInt(shareRow.amount) < sharesToBurn) throw new Error("wallet_share_balance_insufficient_or_unverified");
  const remaining: AccountMeta[] = [account(userShareAccount, false, true)];
  context.config.assets.forEach((asset, index) => {
    const addresses = context.addresses.assets[index]!;
    remaining.push(account(asset.mint), account(addresses.custody, false, true), account(wallets[index]!, false, true), account(addresses.assetState));
  });
  const keys = [account(user, true, true), account(context.addresses.pool, false, true), account(context.addresses.poolState, false, true), account(context.addresses.shareMint, false, true), account(context.addresses.authority), account(TOKEN_PROGRAM), ...remaining];
  const args = Buffer.concat([u64(sharesToBurn, "shares_to_burn"), u64Vector(minAmountsOut, context.config.assets.length, "redeem_min_amounts")]);
  return { instruction: instruction(context, "redeem_in_kind", keys, args), action: "redeem", riskIncreasing: false };
}

export function buildTraderFundedSwapInstruction(context: VerifiedEtfManifest, snapshot: VerifiedEtfSnapshot, trader: PublicKey, assetIn: number, assetOut: number, amountIn: bigint, minAmountOut: bigint, traderWallets: readonly AssetWalletAccounts[]): BuildOperation {
  verifySnapshot(context, snapshot, trader);
  assertRiskOracleReady(snapshot);
  if (snapshot.state.lifecycle !== "active" || snapshot.state.riskPaused) throw new Error("pool_not_swap_ready");
  if (assetIn === assetOut || assetIn < 0 || assetOut < 0 || assetIn >= context.config.assets.length || assetOut >= context.config.assets.length) throw new Error("swap_asset_indices_invalid");
  if (amountIn === 0n || minAmountOut === 0n) throw new Error("swap_amount_zero");
  requireInputsWithinCap(context, snapshot, assetIn, amountIn);
  const wallets = keyVector(context, traderWallets, "swap_wallets");
  wallets.forEach((address, index) => {
    const balance = verifiedWalletAccount(snapshot, trader, address, context.config.assets[index]!.mint);
    if (index === assetIn && amountIn > balance) throw new Error("swap_wallet_input_balance_insufficient");
    if (snapshot.assets[index]!.custodyFrozen) throw new Error(`custody_token_account_frozen_${index}`);
  });
  const remaining: AccountMeta[] = [];
  context.config.assets.forEach((asset, index) => {
    const addresses = context.addresses.assets[index]!;
    remaining.push(account(asset.mint), account(addresses.custody, false, true), account(wallets[index]!, false, true), account(addresses.assetState, false, true));
  });
  const keys = [account(trader, true), account(context.addresses.pool), account(context.addresses.poolState, false, true), account(context.addresses.authority), account(TOKEN_PROGRAM), ...optionalFeedKeys(context), ...remaining];
  const args = Buffer.concat([u8(assetIn, "asset_in"), u8(assetOut, "asset_out"), u64(amountIn, "amount_in"), u64(minAmountOut, "min_amount_out")]);
  return { instruction: instruction(context, "swap_exact_in", keys, args), action: "swap", riskIncreasing: true };
}

export function buildPauseRiskInstruction(context: VerifiedEtfManifest, snapshot: VerifiedEtfSnapshot, guardian: PublicKey): BuildOperation {
  verifySnapshot(context, snapshot, guardian);
  if (snapshot.state.currentGuardian !== guardian.toBase58()) throw new Error("guardian_not_authorized_by_rpc_state");
  const keys = [account(guardian, true), account(context.addresses.pool), account(context.addresses.poolState, false, true), account(context.addresses.shareMint), account(context.addresses.authority)];
  return { instruction: instruction(context, "pause_risk", keys, Buffer.alloc(0)), action: "pause", riskIncreasing: false };
}

export function buildEligibilityPokeInstruction(context: VerifiedEtfManifest, snapshot: VerifiedEtfSnapshot, caller: PublicKey): BuildOperation {
  verifySnapshot(context, snapshot, caller);
  assertRiskOracleReady(snapshot);
  if (snapshot.state.lifecycle === "closed") throw new Error("pool_closed");
  // This surface intentionally contains no token program, custody, share mint, or counterparty account.
  const keys = [account(caller, true), account(context.addresses.pool), account(context.addresses.poolState, false, true), ...optionalFeedKeys(context)];
  return { instruction: instruction(context, "poke", keys, Buffer.alloc(0)), action: "poke", riskIncreasing: false };
}

function assertGovernanceSnapshot(context: VerifiedEtfManifest, snapshot: VerifiedEtfSnapshot, expectedSequence: bigint): void {
  verifySnapshot(context, snapshot);
  if (snapshot.identity.pool !== context.addresses.pool.toBase58() || snapshot.identity.poolState !== context.addresses.poolState.toBase58() || snapshot.state.pool !== snapshot.identity.pool) throw new Error("resume_pool_snapshot_identity_mismatch");
  if (snapshot.identity.currentGovernance !== snapshot.state.currentGovernance) throw new Error("resume_governance_snapshot_identity_mismatch");
  if (context.config.governanceDelaySeconds !== 86_400n) throw new Error("resume_delay_config_mismatch");
  u64(expectedSequence, "expected_sequence");
  if (BigInt(snapshot.state.sequence) !== expectedSequence) throw new Error("resume_pool_state_sequence_stale");
}

function governanceAccounts(signer: PublicKey, pool: PublicKey, poolState: PublicKey): AccountMeta[] {
  return [account(signer, true), account(pool), account(poolState, false, true)];
}

/** Builds only the current governance authority's proposal; the pool remains paused during the delay. */
export function buildProposeResumeInstruction(context: VerifiedEtfManifest, snapshot: VerifiedEtfSnapshot, governance: PublicKey, expectedSequence: bigint): BuildOperation {
  assertGovernanceSnapshot(context, snapshot, expectedSequence);
  if (!governance.equals(new PublicKey(snapshot.state.currentGovernance))) throw new Error("resume_governance_signer_not_authorized_by_rpc_state");
  if (snapshot.state.lifecycle === "closed") throw new Error("pool_closed");
  if (!snapshot.state.riskPaused) throw new Error("pool_not_paused_for_resume");
  if (snapshot.state.pendingResume !== null) throw new Error("resume_proposal_already_pending");
  if (expectedSequence === U64_MAX) throw new Error("resume_proposal_sequence_exhausted");
  return { instruction: instruction(context, "propose_resume", governanceAccounts(governance, context.addresses.pool, context.addresses.poolState), Buffer.alloc(0)), action: "resume_propose", riskIncreasing: false };
}

function pendingResume(snapshot: VerifiedEtfSnapshot, proposalNonce: bigint): Readonly<{ proposer: string; executeAfter: bigint }> {
  u64(proposalNonce, "proposal_nonce");
  if (proposalNonce === 0n) throw new Error("resume_proposal_nonce_invalid");
  const proposal = snapshot.state.pendingResume;
  if (proposal === null) throw new Error("resume_proposal_not_pending");
  if (BigInt(proposal.nonce) !== proposalNonce) throw new Error("resume_proposal_nonce_stale");
  if (BigInt(snapshot.state.sequence) < proposalNonce) throw new Error("resume_proposal_sequence_invalid");
  return { proposer: proposal.proposer, executeAfter: BigInt(proposal.executeAfter) };
}

/** Builds permissionless delayed execution only from a verified RPC snapshot at or past the on-chain deadline. */
export function buildResumeRiskAfterDelayInstruction(context: VerifiedEtfManifest, snapshot: VerifiedEtfSnapshot, executor: PublicKey, proposalNonce: bigint, expectedSequence: bigint): BuildOperation {
  assertGovernanceSnapshot(context, snapshot, expectedSequence);
  const proposal = pendingResume(snapshot, proposalNonce);
  if (proposal.proposer !== snapshot.state.currentGovernance) throw new Error("resume_proposal_governance_mismatch");
  if (snapshot.state.lifecycle === "closed") throw new Error("pool_closed");
  if (!snapshot.state.riskPaused) throw new Error("pool_not_paused_for_resume");
  if (snapshot.network.blockTime === null) throw new Error("resume_rpc_block_time_unavailable");
  if (BigInt(snapshot.network.blockTime) < proposal.executeAfter) throw new Error("resume_delay_not_elapsed_in_rpc_snapshot");
  return { instruction: instruction(context, "resume_risk_after_delay", governanceAccounts(executor, context.addresses.pool, context.addresses.poolState), u64(proposalNonce, "proposal_nonce")), action: "resume_execute", riskIncreasing: true };
}

/** Builds governance cancellation while the proposal is still pending; no pool assets or token accounts are involved. */
export function buildCancelResumeProposalInstruction(context: VerifiedEtfManifest, snapshot: VerifiedEtfSnapshot, governance: PublicKey, proposalNonce: bigint, expectedSequence: bigint): BuildOperation {
  assertGovernanceSnapshot(context, snapshot, expectedSequence);
  if (!governance.equals(new PublicKey(snapshot.state.currentGovernance))) throw new Error("resume_governance_signer_not_authorized_by_rpc_state");
  pendingResume(snapshot, proposalNonce);
  return { instruction: instruction(context, "cancel_resume_proposal", governanceAccounts(governance, context.addresses.pool, context.addresses.poolState), u64(proposalNonce, "proposal_nonce")), action: "resume_cancel", riskIncreasing: false };
}

export function assertClassicTokenProgram(context: VerifiedEtfManifest): void {
  assertVerifiedEtfManifest(context);
  if (ETF_CLASSIC_TOKEN_PROGRAM !== TOKEN_PROGRAM.toBase58() || context.config.assets.some((asset) => !asset.tokenProgram.equals(TOKEN_PROGRAM))) throw new Error("classic_token_program_mismatch");
}
