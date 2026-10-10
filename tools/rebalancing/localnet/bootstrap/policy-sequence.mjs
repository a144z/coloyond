import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import {
  decodeAnchorAccount,
  deriveGovernedPolicyPdas,
  executeAuctionPolicyInstruction,
  LOCALNET_POLICY_CONFIG,
  proposeAuctionPolicyInstruction,
  resumeRiskInstruction,
} from "./governed-policy.mjs";

async function waitForConfirmedSlot(connection, targetSlot, delaySlots) {
  const timeoutMs = Math.max(120_000, Number(delaySlots) * 750 + 60_000);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const currentSlot = BigInt(await connection.getSlot("confirmed"));
    if (currentSlot >= targetSlot) return currentSlot;
    await sleep(200);
  }
  throw new Error(`Localnet did not reach governance activation slot ${targetSlot}`);
}

/** Submit and reconcile the complete bootstrap → governed policy → resume SBF sequence. */
export async function exerciseGovernedPolicySequence({
  connection,
  programId,
  accounts,
  seeder,
  governanceAuthority,
  emergencyAuthority,
  delaySlots,
  submitTransaction,
  expectFailedTransaction,
  tokenAmount,
}) {
  const { auctionPolicy, pendingPolicy } = deriveGovernedPolicyPdas(programId, accounts.vault);
  const policyAccounts = {
    vault: accounts.vault,
    governance: accounts.governance,
    pending_policy: pendingPolicy,
    auction_policy: auctionPolicy,
    governance_authority: governanceAuthority.publicKey,
    executor: seeder.publicKey,
    custody_a: accounts.custodyA,
    custody_b: accounts.custodyB,
    mint_a: accounts.mintA,
    mint_b: accounts.mintB,
  };
  const readVault = async () => {
    const info = await connection.getAccountInfo(accounts.vault);
    assert(info?.owner.equals(programId), "vault is missing or has the wrong owner during policy lifecycle");
    return decodeAnchorAccount("Vault", info.data);
  };
  const readGovernance = async () => {
    const info = await connection.getAccountInfo(accounts.governance);
    assert(info?.owner.equals(programId), "governance is missing or has the wrong owner during policy lifecycle");
    return decodeAnchorAccount("GovernanceAccount", info.data);
  };
  const assertPaused = async (label) => {
    const [vault, governance] = await Promise.all([readVault(), readGovernance()]);
    assert.equal(vault.status, 2, `${label}: vault is not paused`);
    assert.equal(governance.risk_paused, true, `${label}: governance is not risk-paused`);
    return { vault, governance };
  };

  assert.equal(await connection.getAccountInfo(auctionPolicy), null, "auction policy exists before governed creation");
  assert.equal(await connection.getAccountInfo(pendingPolicy), null, "pending auction policy exists before proposal");
  const initial = await assertPaused("before policy proposal");
  const initialCustody = [await tokenAmount(accounts.custodyA), await tokenAmount(accounts.custodyB)];
  const initialShares = await tokenAmount(accounts.seederShares);

  const earlyResume = await expectFailedTransaction(
    resumeRiskInstruction(programId, policyAccounts),
    [governanceAuthority],
    "resume rejected before an auction policy exists",
  );
  await assertPaused("after pre-policy resume rejection");
  assert.equal(await connection.getAccountInfo(pendingPolicy), null, "pre-policy resume created a pending policy");

  const unauthorizedProposalAccounts = {
    ...policyAccounts,
    governance_authority: emergencyAuthority.publicKey,
  };
  const unauthorizedProposal = await expectFailedTransaction(
    proposeAuctionPolicyInstruction(programId, unauthorizedProposalAccounts),
    [seeder, emergencyAuthority],
    "non-governance policy proposal rejected",
    "ConstraintAddress",
  );
  assert(
    !unauthorizedProposal.logs.some((line) => /insufficient (lamports|funds)/i.test(line)),
    "unauthorized proposal failed because of fixture funding rather than the governance account constraint",
  );
  assert.equal(await connection.getAccountInfo(pendingPolicy), null, "unauthorized proposal left a pending account");

  const invalidConfig = {
    ...LOCALNET_POLICY_CONFIG,
    reserve_floor: [20_000_001n, 1n],
  };
  const invalidProposal = await expectFailedTransaction(
    proposeAuctionPolicyInstruction(programId, policyAccounts, invalidConfig),
    [governanceAuthority],
    "policy proposal with reserve above the seed reserve rejected",
    "Fee or reserve policy is invalid",
  );
  assert.equal(await connection.getAccountInfo(pendingPolicy), null, "invalid proposal left a pending account");

  const proposalSignature = await submitTransaction([
    proposeAuctionPolicyInstruction(programId, policyAccounts),
  ], [governanceAuthority]);
  const pendingInfo = await connection.getAccountInfo(pendingPolicy);
  assert(pendingInfo?.owner.equals(programId), "governed proposal account was not created by the program");
  const pending = decodeAnchorAccount("PendingAuctionPolicy", pendingInfo.data);
  assert.equal(pending.version, 1);
  assert.equal(pending.vault, accounts.vault.toBase58());
  assert.equal(pending.governance_authority, governanceAuthority.publicKey.toBase58());
  assert.equal(pending.configuration_revision, initial.vault.configuration_revision);
  assert.equal(pending.vault_sequence, initial.vault.sequence);
  assert.equal(pending.activate_after_slot, pending.proposed_at_slot + delaySlots);
  assert.deepEqual(pending.config, LOCALNET_POLICY_CONFIG);
  assert.equal(await connection.getAccountInfo(auctionPolicy), null, "proposal created an executable policy before delay");

  const earlyExecution = await expectFailedTransaction(
    executeAuctionPolicyInstruction(programId, policyAccounts),
    [seeder],
    "policy execution rejected before governance delay",
    "Policy proposal has not reached its governance delay",
  );
  assert.equal(await connection.getAccountInfo(auctionPolicy), null, "early execution created an auction policy");
  const pendingAfterRejection = await connection.getAccountInfo(pendingPolicy);
  assert(pendingAfterRejection?.owner.equals(programId), "early execution did not preserve the pending proposal");
  assert.equal(decodeAnchorAccount("PendingAuctionPolicy", pendingAfterRejection.data).activate_after_slot, pending.activate_after_slot);
  await assertPaused("after early policy execution rejection");

  const activationSlotObserved = await waitForConfirmedSlot(connection, pending.activate_after_slot, delaySlots);
  const executionSignature = await submitTransaction([
    executeAuctionPolicyInstruction(programId, policyAccounts),
  ], [seeder]);
  const executionTransaction = await connection.getTransaction(executionSignature, {
    commitment: "confirmed", maxSupportedTransactionVersion: 0,
  });
  assert(executionTransaction && executionTransaction.meta?.err === null, "permissionless policy execution transaction is missing or failed");
  assert.equal(await connection.getAccountInfo(pendingPolicy), null, "successful execution did not close the pending proposal");
  const policyInfo = await connection.getAccountInfo(auctionPolicy);
  assert(policyInfo?.owner.equals(programId), "auction policy is missing or has the wrong owner after execution");
  const policy = decodeAnchorAccount("AuctionPolicy", policyInfo.data);
  const currentEpoch = BigInt((await connection.getEpochInfo("confirmed")).epoch);
  assert.equal(policy.version, 2);
  assert.equal(policy.vault, accounts.vault.toBase58());
  assert.equal(policy.configuration_revision, initial.vault.configuration_revision);
  assert.equal(policy.bounty_epoch, currentEpoch);
  assert.deepEqual(policy.reserve_floor, LOCALNET_POLICY_CONFIG.reserve_floor);
  assert.deepEqual(policy.epoch_bounty_budget, LOCALNET_POLICY_CONFIG.epoch_bounty_budget);
  assert.deepEqual(policy.asset_feed_indices, LOCALNET_POLICY_CONFIG.asset_feed_indices);
  for (const [field, expected] of Object.entries(LOCALNET_POLICY_CONFIG)) {
    assert.deepEqual(policy[field], expected, `AuctionPolicy.${field} differs from the proposed config`);
  }
  await assertPaused("after delayed policy execution");

  const wrongRoleResumeAccounts = {
    ...policyAccounts,
    governance_authority: emergencyAuthority.publicKey,
  };
  const wrongRoleResume = await expectFailedTransaction(
    resumeRiskInstruction(programId, wrongRoleResumeAccounts),
    [seeder, emergencyAuthority],
    "emergency role cannot resume risk",
    "Only governance may propose or resume policy",
  );
  const pausedBeforeResume = await assertPaused("after wrong-role resume rejection");

  const resumeSignature = await submitTransaction([
    resumeRiskInstruction(programId, policyAccounts),
  ], [governanceAuthority]);
  const resumeTransaction = await connection.getTransaction(resumeSignature, {
    commitment: "confirmed", maxSupportedTransactionVersion: 0,
  });
  assert(resumeTransaction && resumeTransaction.meta?.err === null, "governance resume transaction is missing or failed");
  const resumedVault = await readVault();
  const resumedGovernance = await readGovernance();
  assert.equal(resumedVault.status, 1, "governance resume did not activate the vault");
  assert.equal(resumedGovernance.risk_paused, false, "governance resume did not clear the risk pause");
  assert.equal(resumedVault.sequence, pausedBeforeResume.vault.sequence + 1n, "resume did not advance vault sequence exactly once");
  assert.equal((await connection.getAccountInfo(auctionPolicy))?.owner.equals(programId), true, "resume changed the policy account");

  const duplicateResume = await expectFailedTransaction(
    resumeRiskInstruction(programId, policyAccounts),
    [governanceAuthority],
    "duplicate resume rejected without another sequence increment",
    "Risk is already resumed",
  );
  const afterDuplicateResume = await readVault();
  const afterDuplicateGovernance = await readGovernance();
  assert.equal(afterDuplicateResume.sequence, resumedVault.sequence, "duplicate resume changed the vault sequence");
  assert.equal(afterDuplicateGovernance.risk_paused, false, "duplicate resume changed the governance pause state");
  assert.deepEqual(
    [await tokenAmount(accounts.custodyA), await tokenAmount(accounts.custodyB)],
    initialCustody,
    "governed policy lifecycle changed custody token balances",
  );
  assert.equal(await tokenAmount(accounts.seederShares), initialShares, "governed policy lifecycle changed seeder shares");

  return {
    delaySlots: delaySlots.toString(),
    proposal: { signature: proposalSignature, slot: pending.proposed_at_slot.toString(), activateAfterSlot: pending.activate_after_slot.toString() },
    earlyResume,
    unauthorizedProposal,
    invalidProposal,
    earlyExecution,
    activationSlotObserved: activationSlotObserved.toString(),
    execution: { signature: executionSignature, slot: executionTransaction.slot, epoch: policy.bounty_epoch.toString() },
    wrongRoleResume,
    resume: { signature: resumeSignature, slot: resumeTransaction.slot, sequence: resumedVault.sequence.toString() },
    duplicateResume,
    pausedBeforeResume: pausedBeforeResume.vault.status === 2 && pausedBeforeResume.governance.risk_paused,
    resumed: resumedVault.status === 1 && !resumedGovernance.risk_paused,
    policyAddress: auctionPolicy.toBase58(),
    pendingPolicyClosed: true,
    tokenBalancesUnchanged: true,
    policyConfig: Object.fromEntries(Object.entries(policy).filter(([name]) => Object.hasOwn(LOCALNET_POLICY_CONFIG, name)).map(([name, value]) => [
      name,
      Array.isArray(value) ? value.map(String) : String(value),
    ])),
  };
}

