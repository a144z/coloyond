# Issue #38: Claude Opus 5.5 review and convergence

Date: 11 October 2026. Requested reviewer: **Claude Opus 5.5**. Outcome: **APPROVE on round 3**, after two REVISE rounds. Approval covers coherent, evidence-gated documentation, not implementation, deployment, wallet compatibility or protocol security certification.

## Scope and method

The reviewer received only the newly authored [spec](../superpowers/specs/2026-10-11-issue-38-mobile-portfolio-spec.md) and [plan](../superpowers/plans/2026-10-11-issue-38-mobile-portfolio-plan.md), with the preceding review on follow-up rounds. The supporting [design](../design/issue-38-mobile-portfolio-design.md), [feasibility spike](../rebalancing/spikes/issue-38-execution-feasibility.md), preview and repository source were not sent to Claude. They were synchronized by the author after each revision.

Claude Code CLI 2.1.296 ran with exact `--model claude-opus-5-5`, high effort, safe mode, tools disabled, empty strict MCP config, slash commands disabled, no session persistence and no settings sources. Each successful JSON response reported canonical model `claude-opus-5-5`, provider `firstParty`, and `is_error: false`. No substitute reviewer model was used.

An initial broader packet containing repository excerpts was rejected by automatic approval review before execution. The permitted alternative exported only the two newly written documents requested for review. The three rounds below are those successful narrow reviews; the rejected request is not counted as a review.

| Round | Verified model / provider | Verdict | Duration |
|---|---|---|---|
| 1 | `claude-opus-5-5` / `firstParty` | REVISE | 155.2 s |
| 2 | `claude-opus-5-5` / `firstParty` | REVISE | 233.3 s |
| 3 | `claude-opus-5-5` / `firstParty` | APPROVE | 143.7 s |


Round 1 input SHA-256: `9cebd21d3a3e1262958f4f4c32904863a1986581a3ca646156d2d10014085471`. Reviewer result SHA-256: `1f2be98fd80837ee9106452c24030c5020e27022f2625d5cfe79fb5b02e24e80`.


Round 2 input SHA-256: `7f75e411504f38c32d8ad91221f05fa8c251e2475eeb897e79b8004392911f35`. Reviewer result SHA-256: `518b06d57b7b20c2c643994afc91ccbd1e1c82f76942c2f3fa018ec46c8ecd8f`.


Round 3 input SHA-256: `b3eff8f6c1df9cb0f4bff456ef541548cb63be3239aeb187bc5a2a547f7b111b`. Reviewer result SHA-256: `d4dee93f2e0070da1052038e2cda7227ea161f2aeb6035f8501e6e1c5525458c`.


## Findings resolved

Round 1 corrected execution venue and authority, weighted-curve pricing after edits, reserve subsidy exposure, journal/wallet assumptions, oracle/parameter admission, no-op outcomes, standalone identifiers, deadline classifications, trust disclosures, and the pruning boundary. The revision places custody on L1, uses an oracle actual quote capped by the weighted curve, compensates the reserve explicitly, and labels all unproven runtime assumptions F1–F3.

Round 2 corrected three High findings: ambiguous submissions could block exits, ER setup signer/transport was undefined, and every weight edit unnecessarily replaced controller/escrow generation. It also corrected cadence jitter, quote-flow terminology, wallet-failure fallback, long-run evidence scheduling, trigger-source attribution, fee labels and Test USD price convention.

The revision adds scoped owner-operation sequence/ID receipts and terminal recovery; tests owner-reviewed ER-blockhash signing as a hard gate; preserves generation/budget for weight-only edits; separates a 75-second task interval from the 60-second evaluation floor; and requires 27 hosted cycles through commits 26/27.

Round 3 closed every convergence condition and returned APPROVE. Its [full final reviewer response](2026-10-11-issue-38-claude-opus-5-5-round-3.md) preserves both the approval and remaining bounded recommendations.

## Refinements applied after approval

Claude explicitly said its remaining edits did not need another review round. They were applied after the reviewed round-3 snapshot:

- M1: freeze program/IDL/manifest hashes before the 03:00 evidence window; later on-chain/manifest changes require a full affected rerun or partial delivery.
- M2: size shared inventory/allowances for testing, observation and rehearsal with 50% calculated headroom; use an untouched observed vault and separately admitted test vaults/owners; pre-admit actual selected wallet public keys.
- M3: subsequent deposits request target units with token input maxima; withdrawals burn units with token output minima; reconcile actual bounds and operation identity, since automation can race Review.
- L1–L6: capability-specific L1-only fallback, Not submitted readback backstop, latest-receipt/history and failed-metadata semantics, no old-generation status overwrite, prohibition on delegating the owner's system account, and explicit 75/3,600-second supported cadence values.

The approved snapshot and final files therefore have different hashes. This report distinguishes them instead of claiming Claude reviewed the later exact bytes. These refinements implement the reviewer's stated recommendations without changing the chosen architecture.

Reviewed round-3 spec SHA-256: `4be1eab521c3283e70f68347e7d8ca1984a5b4ae777c6cd6b28332364b108f01`.

Reviewed round-3 plan SHA-256: `ffe8a5786d49c93efad65bb53e54526479f7864d22395dcb349bdd25e1057a09`.

Final artifact SHA-256 values after the bounded refinements:

- `docs/superpowers/specs/2026-10-11-issue-38-mobile-portfolio-spec.md`: `7b47721885c56edcfe736731ebbe44350f4ebb2e0883489dae9f62c70084f72e`
- `docs/superpowers/plans/2026-10-11-issue-38-mobile-portfolio-plan.md`: `54419b9429e374c46028d4f2cee76f0eed406c40bfe35adadd061c47eda3ec39`
- `docs/design/issue-38-mobile-portfolio-design.md`: `4b9a12ba166c20b5d7671234f3b9b885b954756770d32e3329039682138cc62b`
- `docs/rebalancing/spikes/issue-38-execution-feasibility.md`: `b77500e2ad49e583373c190b5db3f3f07d3afaad13a4a98612a451cad15f2515`
- `docs/design/issue-38-mobile-portfolio.html`: `2be8461ab42a71f12cf0f5fb7c4d963d3062a9d5f14fbc080cd0e9c6d9cdab97`

## Limits and local checks

F1 (program-funded scheduling/action and ER wallet compatibility), F2 (independent fresh Pyth feeds), and F3 (actual bounded settlement/convergence) remain unproven. No native APK, SBF settlement, deployment or live unattended execution was produced by this documentation task. The plan puts these proofs before product polish or source deletion.

The mobile HTML is a local interactive design fixture with no wallet/RPC execution. Six headless-browser checks passed: screen selection, allocation totals, review-dialog opening/closing, blocked-state selection and no horizontal overflow at a 390-pixel viewport. Relative documentation links, inline JavaScript syntax and whitespace checks passed. No application/protocol source was pruned; README/HANDOFF only gained direction links.
