# Round 3 review: Issue #38 mobile portfolio spec and plan

## Verdict: APPROVE

This approves the documents as **coherent, gated documentation** and nothing more. It does not attest that any of the following work:

- **F1:** program-funded tick → commit → authenticated L1 action, and the owner's ER sign-only transport.
- **F2:** independently fresh Pyth data on Devnet.
- **F3:** a real L1 swap and convergence within the admitted policy.

These remain open feasibility gates. The documents already handle a failure of any of them truthfully.

All four convergence conditions from round 2 are met. No High finding remains, and the architecture choices you named are applied consistently across both documents:

- ER setup signed only by the owner and gated by V0/F1.
- A stable generation across weight edits.
- Scoped owner sequence and operation-ID receipts.
- A 75 s scheduled interval over a 60 s on-chain floor.
- 27 hosted cycles by 03:45.

Three Medium findings follow. Each is a one-to-two-sentence edit that tightens evidence validity and reconciliation; none reopens the design. I recommend applying them in place before implementation of the affected slice starts. They do not need another review round.

---

## Status of round-2 findings

| # | Finding | Status | Notes |
|---|---|---|---|
| N1 | No terminal rule for Unknown; exits could be blocked | **Resolved** | Scoped `expected_owner_op_seq`, an operation-ID receipt, terminal Not submitted and Expired rules, a bounded withdrawal block, and no auto-resend. Small refinements in L2 and L3. |
| N2 | ER setup signer and transport unspecified | **Resolved (option b)** | The owner is signer and fee payer for ER setup, using an ER-RPC blockhash and MWA sign-only. V0 tests it on both wallet candidates, and it sits in the F1 23:00 gate. Fallback wording is in L5. |
| N3 | Every weight edit re-registers scheduling | **Resolved** | Weight-only edits keep the generation and budget and add a 120 s cooldown. Only pause, resume, cadence change, close and revocation bump the generation. |
| N3a | Paused or stale ticks burn budget | **Resolved** | Cancellation is requested after the confirmed L1 pause, the burn is disclosed in Review, and the ER advisory check is advisory only. |
| N4 | Direction of the safety inequality | **Resolved** | Flows are now explicit, and custody is distinguished from counterparty inventory. |
| N5 | Cadence under scheduler jitter | **Resolved** | Cadence counts from the last accepted evaluation. Early calls change no state. 75 s interval over a 60 s floor. |
| N6 | No branch for wallet failure | **Resolved** | Phantom is named as the second candidate. Both-fail leads to read-only. The L1-only branch is in the plan; spec wording is in L1. |
| N7 | Commit-26 and long-run proof not placed | **Resolved** | Required row in the spec. The 27-cycle run starts by 03:00 and finishes by 03:45. Arithmetic: 27 × 75 s ≈ 33.75 min. |
| N8 | Manual vs automated evidence | **Resolved** | Trigger source is recorded, only Magic Action trades count, and the risk of manual timing is disclosed. |
| Low items | Test USD price, fee label, candidate set, same-owner wording, "shape B" | **All resolved** | — |

**Sanity re-check of the economics.** With each leg capped at 100 bps of NAV, getting from D = 500 to D ≤ 50 needs at least 5 trading cycles, so ten cycles leaves margin. The curve gap stays positive across the to-target candidate, and its average over a leg starting from D = 60 is about 120 bps. That exceeds the 60 bps of fee margin plus spread whenever confidence per feed is under about 30 bps. F3 still has to show this with recorded confidence per cycle, as the spec already states.

---

## Medium findings

### M1. The program and manifest are not frozen before the evidence windows open
**Where:** Plan time boxes (03:30–05:00 "Native recovery and safe closure") and the Build/demo row.

**Problem:**
- The convergence and 27-cycle evidence starts by 03:00.
- The plan still allows closure, recovery and cleanup work afterwards, which may touch the program, and only freezes the APK at 06:00.
- An upgrade to the program or manifest after 03:00 means the Required long-run and convergence evidence describes a different binary from the one demonstrated.

**Action:**
- Add a **program/IDL/manifest freeze, with recorded hashes, no later than the 03:00 evidence start**.
- Any later on-chain change invalidates those rows and requires a rerun. If no rerun fits, the delivery is partial.
- Work after 03:00 is limited to the native client, unless a rerun is scheduled.

### M2. The observation windows and shared reserve allowances are not isolated or budgeted
**Where:** Spec reserve-notional and owner-wide allowance rules; plan 01:30–03:45 and 06:00–08:00 rehearsal.

**Problem:** Several things draw down the same fixed allowances, which no one can top up without an admin signature:

- F3 swaps
- manual `rebalance_once` diagnostics
- the convergence run
- the 27-cycle run
- the second-vault work
- the morning rehearsal

All of these draw on one demonstration owner's owner-wide allowance, plus the global allowance and reserve inventory. The demo could therefore show **Liquidity unavailable**.

Separately, any pause or cadence edit on the observed vault during 01:30–03:30 changes its generation and breaks the continuous 27-cycle run.

**Action:**
1. Size the global, owner and per-vault allowances and inventory at reserve funding to cover all rehearsal plus the live demo with margin. Alternatively, admit **separate test and demo owners**. Record the sizing.
2. Run the long-run and convergence observation on a dedicated vault. That vault receives **no owner operations** during the window.
3. Do edit, pause and generation testing on other vaults.
4. State that the phone app is not used to drive the observed vault during the window.
5. If Phantom replaces Solflare, re-admitting its owner account requires the reserve admin's signature. Add this to pre-funding.

### M3. Deposit and withdrawal amounts race concurrent automation
**Where:** Spec Withdraw and close, deposits "use the current basket proportions", and the expected-effects reconciliation in the wallet-state rules.

**Problem:**
- Scheduling deliberately does not consume owner sequences, so an automated leg can land between Review and the owner's transaction.
- A single leg can shift custody proportions by up to about 1% of NAV.
- Deposits computed off-chain from the reviewed proportions can then fail or mint the wrong units.
- Exact expected-effects matching on partial withdrawals would misclassify a correct operation as Failed or Unknown.

**Action:**
- Specify deposits as **target units with a per-token maximum input**.
- Specify withdrawals as **units burned with a per-token minimum output**.
- Reconcile by operation ID and sequence, units, and in-bound amounts, not exact pre-computed token deltas.
- Review shows these bounds.

---

## Low findings

- **L1. The spec does not mention the L1-pass / ER-fail branch.**
  - The spec says "If neither candidate passes, the native delivery is read-only."
  - The plan allows L1 custody, edit and withdraw with automation Unavailable when a wallet passes L1 but fails ER signing.
  - Align the spec: define "pass" separately per capability, and state the L1-only outcome.
- **L2. Not submitted should have an on-chain backstop.**
  - "Terminal Not submitted" depends on the wallet behaving as sign-only.
  - Because the operation ID is in the app-built message, a later read that finds that ID in a receipt should reclassify the operation as Confirmed.
  - The sequence already makes a fresh attempt safe, so the only effect of a misbehaving wallet is a false-failure label. Add one sentence.
- **L3. Retention and outcome wording for receipts.**
  - A reverted transaction cannot write a program "outcome". State that Failed comes from finalized transaction metadata, not program state.
  - State whether receipts keep only the latest operation or a short history per sequence. If only the latest, say that reconciliation after the sequence advances relies on finalized signature and history lookup.
- **L4. Stale-generation calls.**
  - State that calls from an old-generation escrow return Stale task without writing the latest-attempt record, emitting at most an event.
  - Otherwise an uncancelled old crank can overwrite the current generation's status after pause or resume.
- **L5. Fallback if the ER rejects an undelegated owner fee payer.**
  - Because F1 is a gate, name the prohibited workaround: never delegate the owner's system account.
  - Name the acceptable alternative: an L1-funded, program-owned ephemeral balance account, if the provider supports one.
  - Either way, no hidden setup signer.
- **L6. Supported cadence values.** "Supported cadence" is not enumerated. State the allowed set, minimum 75 s, and that the on-chain floor remains 60 s for every choice.

---

## Approval scope

**APPROVE** means the following:

- The spec and plan are mutually consistent.
- The round-2 blockers are closed.
- The remaining items above are bounded edits that do not reopen the design.

It does not certify F1, F2 or F3, wallet compatibility, provider fee behaviour at commits 26 and 27, or the clock feasibility of the overnight ladder. These stay evidence-gated, and the documents correctly route each failure to an explicitly partial delivery.
