---
shaping: true
issue: 38
status: proposed-design
date: 2026-10-11
---

# Issue #38: mobile portfolio vault prototype

## Source and purpose

> End goal is to setup a fulling working prototype that user can connect to the dapp and setup those own portfolio and magicblocks will do the auto rebalance without user furthur action:
>
> 1. User can manage portfolio you want on the client (that will trigger magicblocks to create that for that, in which magicblocks will auto balance
> 2. User can create more / destroy vault if they want, or edit manage the vault everything base on the architectur

> create spec and design for 38, btw you may need to prune a LOT of code to get there, so determine what is the best way

> we have until monday morning, based on what what do you recommend

> this is for solana mobile hackathon

Tracking: [#38](https://github.com/a144z/coloyond/issues/38). This spec defines the requested prototype; the [design](../../design/issue-38-mobile-portfolio-design.md) defines the recommended mechanisms and code cuts. The [delivery plan](../plans/2026-10-11-issue-38-mobile-portfolio-plan.md) separates the Monday demo from completing all of #38. The [mobile preview](../../design/issue-38-mobile-portfolio.html) contains illustrative data only.

The old card/Glider release, auction protocol, and ETF v1 maintenance-only contract describe different products. They remain historical references. For new issue #38 work, this document proposes a separate personal-vault v2 contract; it does not reinterpret existing accounts or authorize a deployment or wallet signature. These documents are specifications, not evidence that the prototype works.

## Recommendation and deadline scope

**Ship one native Kotlin/Compose portfolio journey through the existing Android app and Mobile Wallet Adapter (MWA).** Keep the TypeScript client/console as developer tooling. Do not build a WebView wrapper, replace the Android project, upgrade its toolchain, or maintain two new product interfaces overnight.

Monday's minimum honest demo uses two admitted Devnet assets and two isolated vaults belonging to the same owner. It must show real mobile wallet setup, an externally scheduled real swap while the app is stopped, weight editing, and safe withdrawal/closure. A simulated rebalance, manually submitted swap, or maintenance-only task cannot satisfy the automation demo.

The complete #38 prototype supports two or three admitted assets. A third asset, dynamic fees, asset-set migration UI, and a polished web interface are later work. A two-asset Monday demo does not close #38's full multi-token scope. BTC/USDC tickers in the original blueprint are examples; any substitute mint must be labeled synthetic/unbacked and cannot be presented as backed BTC or USDC.

## Requirements

| ID | Requirement | Status |
|---|---|---|
| R0 | A user completes the portfolio journey in the native Android app using a real MWA wallet on Solana Devnet. | Core goal |
| R1 | The same owner can create and fund multiple isolated vaults with custom valid weights over two or three admitted assets. | Must-have; Monday uses two assets |
| R2 | MagicBlock causes real portfolio token exchanges after setup without another owner signature, an open app, or a project-operated off-chain process during the funded automation window. | Must-have |
| R3 | The owner can edit weights and cadence, pause/resume automation, deposit, withdraw in kind, and close a vault safely. | Must-have |
| R4 | Every swap uses real funded counterparty assets, checked weighted AMM math, validated Pyth prices, a curve-fee margin, and bounded execution loss. | Must-have |
| R5 | Wrong authority/accounts, stale prices, insufficient inventory/funding, replay, and uncertain transactions cannot produce false success or unintended transfers. | Must-have |
| R6 | The product shows confirmed holdings, allocation drift, automation health, costs, and transaction evidence accurately. | Must-have |
| R7 | The implementation removes competing runtime paths while retaining reusable verified foundations and reproducible evidence. | Must-have |

### Explicit scope choices

- Each v2 vault has one owner and an internal ownership-unit ledger. There are no publicly transferable LP shares or other depositors in this prototype. This cuts public-pool governance and third-party shareholder closure/mutability problems. Shared ETFs remain a separate product; never migrate v1 shareholders into this model implicitly.
- Mints and token programs are immutable for a funded vault. Same-basket weight edits are supported. Changing the asset set requires withdrawing and creating a fresh vault; Monday's UI explains this and does not offer an in-place token replacement.
- The owner funds setup, deposits, and an explicitly separate SOL automation budget. Automation can continue only while its budget, counterparty inventory, and valid oracle service are available. No recurring owner signatures are required during the funded operating period; replenishment after exhaustion is an explicit owner action.
- A prefunded, program-controlled **Devnet execution reserve** acts as the swap counterparty. Its tokens are test liquidity, separate from user custody and automation SOL. It needs no continuously running project bot. It is finite and is not evidence of production market liquidity. Custody is isolated per vault; reserve liquidity is shared, so one admitted vault's trades can reduce another's available execution capacity.
- Use fixed fees for the first demo: a 30-bps curve-input fee margin in the weighted-curve output bound, plus an explicit 30-bps oracle-quote spread that compensates the reserve. The reserve must receive at least its conservative input value plus that spread; it never subsidizes a vault's retained fee. Dynamic fee tiers are deferred. Neither fee retention nor the weighted invariant guarantees profit or prevents all LVR/MEV.

## User journey

### Connect and discover

Open directly to Portfolio. Show Devnet and Connect wallet. MWA authorization must return the actual account used for signing; a reauthorization/account change refreshes ownership and invalidates outstanding reviews. A connection is not a transaction approval.

Monday's selected target is a physical Android device with **Solflare configured for Devnet**, with Phantom as a second candidate in the same V0 window, subject to an observed V0 compatibility check rather than an assumed wallet feature. The prototype requires MWA sign-only for financial transactions. If that wallet/version cannot sign the reviewed bytes, those actions are Unsupported and V0 fails; do not silently substitute sign-and-send. Owner setup uses one reviewed transaction per MWA handoff, in confirmed order; it may re-use an authorized association session only when supported. V0 must test both L1-blockhash signing and ER-blockhash sign-only registration/cancellation on the selected wallet. Capabilities pass separately: a candidate passing L1 but failing ER signing permits a partial custody/edit/withdraw demo with automation Unavailable. If neither passes L1, the native delivery is read-only and partial. Full automation requires both capabilities on the selected wallet.

Load the owner's on-chain vault registry and reconcile unresolved submissions before enabling a conflicting wallet action. The sequenced recovery rules below prevent ambiguous operations from blocking exit indefinitely on a functioning chain/RPC. Local labels and drafts may be cached, but balance, lifecycle, and automation status come from verified chain reads. Disconnecting changes the client session; it does not stop an existing vault's automation.

### Create and fund

Choose a local name, admitted assets, target weights, deposit amounts for every asset, and a supported cadence. Weights are integer basis points totaling exactly 10,000; each included asset has at least 100 bps. The first demo can use one slider plus exact percentage inputs for a two-asset basket.

Review exact mints, synthetic-asset disclosures, deposit quantities, target allocation, the curve-fee margin and reserve spread, loss limits, refundable rent, estimated network fees, and separate automation funding. Show program upgrade authority, synthetic mint/freeze authorities, reserve administrator, shared-liquidity dependence, and post-edit cooldown. An upgrade authority can change custody logic; the no-process claim does not imply that this Devnet system has no trusted administrators. Prepare missing token accounts/WSOL explicitly. Do not drain the wallet's SOL needed for fees and exits.

Create, fund, and activate scheduling are separately confirmed steps when they cannot fit in one transaction. A failed scheduling step leaves a funded, withdrawable vault with automation Off; it never labels that vault Active. An interrupted setup resumes from confirmed state and the durable operation journal. Newly created but unfunded vaults can also be closed.

### View and manage

The list shows each vault independently. Details show target versus actual value weights, raw token holdings, last confirmed rebalance/check, cadence, automation budget, and the next expected check as an estimate. Missing/stale prices suppress live USD valuation and value-weight drift; raw token balances and withdrawal remain available.

Changing weights edits a draft first. Save prompts for an owner signature, increments the configuration revision, records the new curve epoch, resets hysteresis and starts a 120-second trade cooldown. Weight-only edits preserve controller/task/escrow generation and remaining budget; the UI shows Cooling down, then resumes the existing schedule. Actions carry no target or expected configuration revision: they read live L1 targets/revision and record the revision actually executed. Cadence changes, pause/resume, close or explicit revocation change generation and require confirmed replacement registration; show Restarting and old-budget refund pending where applicable. Matching current weights or using Undo only modifies the draft. Saving a target does not claim an immediate trade or replenish any execution/loss allowance.

Pause is confirmed on the base layer before reporting Paused. The client then requests ER crank cancellation using the same reviewed ER signing path; cancellation failure leaves explicit pending cleanup. Old ticks can still incur provider fees until cancellation or finite budget exhaustion, though L1 rejects their trades. Review shows measured per-tick charges and the maximum remaining burn budget; an optional ER advisory read may suppress commits, never authorize trades. Resume requires a new valid schedule generation and adequate budget. The owner can top up automation separately from token deposits. Initial funding uses exact reviewed token inputs and the manifest-pinned initial-unit rule. Subsequent proportional deposits specify target ownership units and per-token maximum inputs; the program computes amounts from live custody. Single-token funding is deferred. A stopped phone and disconnected wallet do not revoke the authority already bounded by the vault program.

### Withdraw and close

Partial withdrawal specifies units to burn and per-token minimum outputs; the program computes pro-rata amounts from live custody. Review shows these bounds. Automation can change proportions after Review, so reconcile operation ID/sequence, units and actual in-bound amounts rather than exact predicted deltas. An exceeded deposit maximum or unmet withdrawal minimum fails atomically. Full withdrawal returns every base unit, disables automation, invalidates scheduled work, and leaves the vault empty/closing. Both work without a price feed, swap liquidity, or a working MagicBlock network.

Close is a sequence: disable/invalidate automation on Solana in the same atomic transaction as full withdrawal, or in a confirmed transaction before it; return the owner's remaining tokens; cancel tasks and reconcile controller/fee-payer cleanup; close eligible custody/state accounts and return rent. Derive each vault from `owner + monotonically increasing registry nonce`; the registry counter and closed-ID tombstone (including closing operation ID/sequence) persist, so closing cannot make an old identity reinitializable. If scheduler cleanup is unavailable, show **Assets returned · automation cleanup pending**. Do not hold user tokens hostage to scheduler cleanup or claim all rent was refunded.

Withdrawals return WSOL as an SPL token; automatic native-SOL unwrapping is deferred and must not be promised. V2 has no owner-key recovery/admin custody override. If the owner loses their key, funds cannot be recovered by the project and enabled automation continues under the last configuration until disabled by policy or its finite funding/inventory is exhausted.

## Execution contract

### Venue and runtime authority

**All swaps execute as Solana base-layer instructions. Custody token accounts, ownership/targets, the registry, and authoritative vault state are never delegated.** Only a vault/generation-specific controller and supported program-owned automation fee-payer accounts use the Ephemeral Rollup (ER). A native MagicBlock ER crank calls `tick`; `tick` requests a controller commit plus a post-commit Magic Action invoking `execute_scheduled_rebalance` on Solana. Base-layer swap signatures and custody deltas are evidence; an ER tick or controller commit alone is not.

Owner-signed create/fund/configure/activate/pause/withdraw instructions use L1 RPC blockhashes. Initial ER registration, task cancellation and provider refund requests use separately reviewed ER-RPC blockhashes, the owner as setup transaction signer/fee payer, and MWA sign-only. The client validates the exact ER endpoint/validator mapping, journal transport and message, persists returned bytes, then submits to that ER RPC. Owner SOL funds the separate program-PDA runtime payer through the pinned supported funding path. This setup owner signature is not reused for runtime ticks. Wallet compatibility, supported owner/ER fee funding, registration/cancellation/refund transport and exact adapter instructions are hard V0/F1 observations, not assumed SDK support. Never delegate the owner's system account to make setup fees work. An L1-funded program-owned ephemeral balance account is acceptable only through an observed provider-supported path; if neither setup fee path works, F1 fails. No hidden locally generated setup signer is permitted.

The instruction requires the MagicBlock Delegation Program-derived action escrow signer, exact escrow authority bound to this vault/generation's program-owned fee authority, pinned escrow index, and exact controller binding. `#[action]` or a matching PDA address alone is insufficient. The committed controller can be read under its admitted delegation owner; it cannot override L1 targets. The action also self-validates live enabled state, generation, current L1 revision/targets, increasing run nonce, 60-second on-chain cadence, cooldown, oracle set, direction, notional/loss caps, reserve admission, and both sides' exact custody. The vault records the consumed nonce on L1; valid replay/stale tasks cannot trade twice. Owner-only manual `rebalance_once` is a separate diagnostic entrypoint over the same economic guards and consumes the same cadence/allowances.

The runtime payer must be able to sign the commit/action path through the pinned supported program-PDA CPI mechanism; no original wallet signature may remain required. **This composition is unproven and is F1's hard feasibility condition.** If the provider cannot deliver this L1 action from the scheduled controller with program-controlled funding, R2 is not deliverable through this shape. A proven independently operated MagicBlock Hydra base-layer path is an alternative; running our own cranker is not.

Keep token transfers and authoritative receipt state atomic within the L1 handler. Controller/ER/provider success is tracked separately: a failed follow-on handler cannot be represented as a completed trade. Recompute from current L1 state on every invocation; a newer owner edit or withdrawal invalidates stale work without relying on cross-layer atomicity. Pause/exit never requires provider availability.

### Counterparty and price

Rebalance means confirmed two-way transfers with the funded execution reserve. For an overweight SOL vault, the reserve supplies underweight token `i` into the vault and receives SOL `j` out of the vault. Price **actual output from validated oracle intervals**, bounded by the conservative weighted-curve maximum; do not take all of the curve's arbitrage discount after a weight edit.

```text
gross_input_i = reserve tokens transferred into vault
curve_bound_j = quote_exact_in(vault_reserves, targets, i, j, gross_input_i, 30_bps).amount_out
oracle_output_j = ceil(value(gross_input_i, price_i_upper) * 1.003 / price_j_lower)
accept only if 0 < oracle_output_j <= curve_bound_j
```

The executable integer conversion normalizes token decimals/exponents with checked wide arithmetic. Revalue final rounded amounts and require `value(amount_j received by reserve, price_j_lower) >= value(amount_i paid by reserve, price_i_upper) * 10,030 / 10,000`. Here output means vault output received by the counterparty; custody balances mean vault holdings, not counterparty inventory. Gross input remains in vault custody; its 30-bps curve fee counter is informational and counts no extra asset. The oracle spread is the reserve's compensation paid through the output leg; there is no reserve-paid vault subsidy. Both components appear separately in review/receipts. A failed bound means No safe trade, not an unbounded quote.

This preserves the supplied weighted AMM and retained-fee intent as a maximum-output/invariant constraint while making the automated execution oracle-anchored. It is an explicit v2 quote amendment, not reuse of the v1 curve-output instruction unchanged. The invariant protects reserve geometry; the point-mark loss cap separately protects value. A signed weight edit changes the invariant epoch but cannot bypass that cap.

The reserve administrator is manifest-pinned and may fund, pause, admit test owners, or withdraw only reserve-owned inventory. It cannot move vault custody or change vault weights. Monday's reserve admits only the designated demonstration owner(s); a copied vault or new unauthorized owner cannot spend it. Enforce a market-wide remaining notional allowance, owner-wide allowance across all that owner's vaults, per-vault allowance, and per-cycle size cap. Splitting into new vaults, weight edits, and close/reopen cannot reset the owner-wide allowance. All allowances are fixed USD integers approved at reserve funding; exhaustion produces Liquidity unavailable. Dynamic top-up without an authorized admin signature is prohibited.

Each accepted leg reduces the total-variation allocation deviation computed from one validated price set:

```text
V_i = checked_normalize(base_units_i, mint_decimals_i, price_i, exponent_i)
D_bps = ceil(5,000 * sum_i abs(V_i / sum(V) - target_i / 10,000))
```

The actual integer implementation must reuse the verified existing math definition and rounding; the expression above states the metric, not a floating-point implementation. A curve epoch's weighted invariant cannot decrease on a swap. Deposits/withdrawals alter its reserve baseline proportionally; a signed weight change starts a new epoch, so invariants from different weights are not compared.

A scheduled cycle executes at most one bounded swap in Monday's build. Use the largest shortfall/overage pair; define `input_k = floor(min(all_input_caps, to_target_input) / 2^k)` for `k = 0..3`, discard zero/duplicate candidates, derive rounded output and reject target crossing, and never cross either asset's target under the same point-mark price set after integer rounding. The accepted candidate maximizes safe deviation reduction. Additional cycles may be needed to reach the stop tolerance; if the bounded candidate set has no safe trade, report that rather than promise convergence outside the admitted demonstration domain.

Outcomes distinguish Rebalanced, Within tolerance, Price unavailable, No safe trade, Liquidity unavailable, Paused, and Stale task. Receipts/events record trigger source (Magic Action or owner manual) and the executed L1 revision. Only Magic Action trades count toward unattended/convergence evidence. Manual timing against an up-to-60-second price is an admitted Devnet reserve adverse-selection risk bounded by owner/global caps. Valid expected no-ops succeed and record a latest-attempt outcome/slot plus an event; they never update last-trade time. The L1 vault stores the latest attempt and latest trade summary, and transaction logs provide history. Malformed accounts, forged action/owner authority, failed CPIs, and invariant/mandatory safety-check violations abort atomically. Cadence is measured from the last accepted evaluation. Early cadence/cooldown calls make no state or nonce/timer changes; a repeated early call cannot starve the next evaluation. Safe eligible economic no-ops consume their authenticated run nonce/cadence; a repeated stale nonce is an idempotent no-transfer result and cannot overwrite a newer receipt. Old-generation authenticated calls return Stale task with no latest-attempt/state write, emitting at most an event; they cannot overwrite current automation health.

### Monday policy and oracle admission

| Field | Proposed Devnet v2 value / gate |
|---|---|
| Tokens | Classic SPL Token only; WSOL plus one explicitly synthetic Test USD mint priced by the admitted USDC/USD Pyth observation, not a fixed $1. This quote convention does not imply backing/redeemability; both observations participate in freshness/skew checks. Reject Token-2022, transfer fees/hooks, unknown token programs, and substituted accounts. |
| Feed model | Fixed sponsored shard-0 PushFeed PDA; expected Receiver owner, `PriceUpdateV2` data, exact embedded feed ID, Full verification. No cloned ER price or one-time client-pushed update. |
| Feed identities | Exact mint/feed/program/account/decimals must be frozen in the v2 deployment manifest by F2 before any funding/signing control is enabled. No legacy blueprint account or placeholder is admitted by this spec. |
| Price validity | Positive price; approved exponent `[-17, 0]`; maximum age 60 s, no future publish time; maximum confidence/price 100 bps; maximum inter-feed publish-time skew 30 s. |
| Price intervals | `price_lower = price - confidence > 0`; `price_upper = price + confidence`, checked normalization. Same validated observations for all pre/post calculations and quote bounds. |
| Trigger / stop | Start at `D >= 200 bps`; stop at `D <= 50 bps`; L1 stores rebalance-active hysteresis between bands. Pause/edit invalidates prior hysteresis state. |
| Cadence / edit cooldown | Minimum accepted-evaluation interval 60 s; supported scheduled intervals are 75 s and 3,600 s; the 60 s floor applies to both (75 s gives a 15 s jitter margin); first post-edit trade no earlier than 120 s after the signed edit. Early attempts do not reset the timer. Faster caller traffic cannot bypass either. |
| Per-cycle size | At most one leg; gross input value <= 100 bps of pre-trade NAV and <= 1,000 bps of input custody; output <= 1,000 bps of output custody; floor/halve to remain below targets. |
| Fees | Curve-input fee margin 30 bps; conservative oracle-output reserve spread 30 bps. No variable tiers. |
| Vault loss | Positive same-point-mark NAV loss <= 25 bps of pre-trade NAV per accepted leg; cumulative positive loss <= owner-approved fixed allowance, initially 100 bps of seed NAV. No automatic reset on edits or ticks. |
| Reserve notional | Exact fixed USD per-owner/per-vault/global allowances and available inventory recorded at funding; per-vault cumulative input notional initially <= seed NAV, subject to the smaller remaining owner/global cap. |
| Convergence evidence | F3 must demonstrate a controlled `D = 200–500 bps` two-token case reaching `D <= 50 bps` within ten cycles, otherwise the Monday automation gate fails for this policy. Broader edits may require more cycles or be blocked by budget/safe-quote bounds. |

These are proposed test-only values, subject to F1–F3 validation and one versioned manifest. If a value cannot pass, a documented amendment and rerun are required; silently widening it is prohibited. Fixed-fee curve bounds and confidence intervals may prevent the candidate trade near the stop band, so F3 must prove actual compatibility rather than rely on symbolic intent.

Oracle freshness is a runtime dependency, not solved by scheduling. Use independently updated admitted fixed Pyth accounts. F2 requires at least 15 minutes of repeated reads and fresh observations at every risk action while the phone/project processes are stopped; no assumed freshness SLA. A project-run price pusher or one-time frontend upload cannot meet R2. If independently fresh Devnet data cannot be demonstrated, record the blocker and disable the automation claim. Pyth's actual asset feed identity is not proof that a synthetic mint has dollar backing.

The per-vault/generation automation budget lives in supported MagicBlock fee-payer/escrow accounts funded separately by the owner. The owner can request cancellation and refund to their own wallet; completing that refund may depend on provider availability, unlike token withdrawal. Report charges, remaining balances, and pending refunds separately. F1 pins exact fee-account derivations/signing/refund semantics before setup is enabled.

## Interface and evidence rules

- Primary actions: Create portfolio, Add funds, Edit allocation, Pause/Resume, Withdraw, Close vault. Secondary technical details expand into addresses/signatures/feed/budget facts.
- Use the existing paper/ink/blue visual language. Color distinguishes assets; written labels carry status. At 360–430 dp use a single column, 48 dp touch targets, readable numeric fields, TalkBack labels, and a bottom action area that does not cover content.
- Clearly distinguish drafts, design fixtures, native previews, Localnet, and live Devnet. No random yield, NAV, signatures, health score, quests, or artificial progress animation appears as live evidence.
- Wallet actions move through Preparing → Review → Wallet requested → Submitted → Confirmed/Failed/Unknown, with terminal Not submitted or Expired outcomes. Journal transport/intent/network/revision/effects/blockhash/lastValidBlockHeight and expected operation sequence before handoff; verify returned signed bytes/account, then persist bytes/signature before app broadcast. Show success only after metadata and expected effects reconcile. Sign-and-send-only wallets are Unsupported, not silently downgraded. The following recovery contract is mandatory.
- The app requires no shared private API key, no embedded signer, and no background Android service for rebalancing. The phone only initiates owner actions and displays chain state.

### Sequenced owner operations and terminal recovery

Every owner-mutating L1 instruction carries `expected_owner_op_seq`; its scope is the owner registry for create and the individual vault for other operations. On success the program increments that scope's sequence atomically and stores a caller-supplied unique operation ID/type plus outcome. Scheduling does not consume owner sequences. The journal stores the sequence scope/value, operation ID and expected effects before wallet handoff. Conflicting operations on the same scope serialize; independent vaults are not globally blocked. Duplicate signed/rebuilt instructions using the same expected sequence cannot both apply. ER setup/cancel operations require provider task-ID/idempotency and readback, separately journaled; they cannot block L1 token exit.

For a validated sign-only wallet, interruption before signed bytes reach the durable app journal, with no app broadcast attempted, is terminal **Not submitted**: that wallet must not broadcast independently. V0 tests this contract. A later matching operation-ID receipt overrides Not submitted to Confirmed and flags a wallet contract violation; sequence guards still prevent duplication. Once app broadcast is possible, known signature status, finalized operation ID/sequence and custody resolve the result; a sequence increment alone does not identify success unless its operation ID/effects match. At finalized block height beyond `lastValidBlockHeight`, an unchanged expected L1 sequence and absent operation receipt, corroborated by finalized signature/history checks when the signature is known, are terminal **Expired**; an executed matching operation is Confirmed; Failed comes from finalized transaction metadata, since reverted transactions cannot write a program outcome. State keeps only the latest operation ID/sequence/summary; if another operation has advanced it, reconcile through known finalized signature/history and expected effects. Closed tombstones retain the closing ID/sequence. Without sufficient history, retain an unresolved historical label, while the consumed sequence still prevents replay and permits a fresh reviewed exit. Expiry alone is insufficient. A different operation consuming that sequence makes the old transaction permanently invalid and requires refreshed review.

After terminal resolution, a user may explicitly review a fresh operation with the current sequence. Never auto-resend/rebuild Unknown. On a progressing chain with available finalized RPC, a pending L1 operation blocks a conflicting withdrawal for at most the remaining blockhash lifetime plus finalization/readback. After expiration the owner can review withdrawal at the current sequence; it is independent of ER cancellation/refund ambiguity. Chain halt/RPC unavailability can delay any confirmed transaction and is shown as Network unavailable, not a provider-dependent exit lock. Full withdrawal disables automation atomically.

## Acceptance evidence

| Test | Required result | Monday classification |
|---|---|---|
| Mobile setup | Physical Android/MWA wallet creates and funds a custom-weight vault; signature and token effects retrievable. | Required |
| Isolation | Second vault has distinct custody, registry identity, task/controller, revision and budget. | Required; two-token case |
| Unattended execution | Phone/project processes stopped; two MagicBlock cycles with at least one actual improving L1 swap and custody evidence. | Required for automation claim |
| Long-run funded scheduling | At least 27 hosted cycles (including commits 26/27) with program funding, provider costs and underfunding behavior recorded; phone/project services stopped. | Required for continuing-automation claim |
| Convergence | Action-sourced controlled `D = 200–500 bps` case reaches `D <= 50 bps` within ten cycles; fees/dust measured. | Required for admitted demo policy |
| Edit and replay | Weight edit preserves scheduler/budget; cadence edit replaces generation with cancellation/refund disclosure; cooldown works; old-generation/replayed work cannot trade twice. | Required |
| Exit | Partial/full paused/stale-feed withdrawal; assets returned and cleanup/rent status accurate; closed identity not reusable. | Required; provider-outage refund completion may remain explicitly pending |
| Failure | Wrong owner/mint/feed/escrow, replay, low inventory/funding, unsafe quote and late CPI failure rejected/no-op with no partial transfer. | Required core cases; expanded adversarial corpus is #38-only |
| Recovery | Rejection, account switch, process death after submission and RPC timeout remain correctly confirmed/failed/unknown without resend; terminal Not submitted/Expired and sequenced withdrawal recovery proven. | Required; exhaustive wallet/device matrix is #38-only |
| Build/demo | Program/IDL/manifest hashes frozen before evidence begins; later on-chain changes require rerun or partial delivery. Android tests/lint/APK, target-wallet device flow and exact manifest/program/IDL/signature record. | Required |
| Three-asset completion | Entire create/edit/automation/exit lifecycle with three admitted assets and cross-vault isolation. | #38-only |

Reserve funding must record exact owner/global/per-vault allowances and inventory sized for diagnostics, convergence, 27-cycle observation, second-vault work and rehearsal with at least 50% headroom over the calculated aggregate input/output needs. Respect the existing per-vault seed-NAV cap; if it is too small, use separate admitted test vaults/owners, never silently reset it. Pre-admit actual selected wallet public keys with the reserve administrator's signature, including a replacement wallet account if different.

Collect hosted long-run/convergence evidence on a dedicated vault with no owner operations throughout the window; edit/pause/generation tests use other vaults before or after the stopped-app observation. No phone/app drives the observed vault. Freeze the program/IDL/manifest with hashes before the window; any later on-chain or manifest change invalidates affected evidence and requires rerun.

Monday's classifications define the full demo gates. If the clock-based cut ladder cannot meet them, ship an explicitly partial, accurate mobile custody demo and list omitted capabilities; do not claim the full Monday milestone or close #38. Completing #38 additionally requires the three-asset evidence and remaining dependencies. Mainnet deployment, public LPs, guaranteed returns, external DEX routing, and publishing are outside this specification.
