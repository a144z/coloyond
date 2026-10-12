# Handoff: finishing the hackathon build

> **Direction (12 October):** the hackathon release is the allocation card with the manual Glider handoff, as described below. The issue #38 MagicBlock execution layer is stopped; see the [MagicBlock smoke test](rebalancing/evidence/magicblock-smoke-20261012.md). Automated execution through Glider's API (#23) is the next roadmap item after the hackathon.
>
> **Issue #38 direction (11 October):** new mobile portfolio work follows the [native prototype spec](superpowers/specs/2026-10-11-issue-38-mobile-portfolio-spec.md), [design/code cuts](design/issue-38-mobile-portfolio-design.md), [overnight plan](superpowers/plans/2026-10-11-issue-38-mobile-portfolio-plan.md), and [Claude review record](reviews/2026-10-11-issue-38-claude-opus-5-5-review.md). Those propose a separate owner-vault v2 and MagicBlock execution; they do not claim a deployed or working prototype. The card/Glider instructions below are the historical release path and do not govern issue #38 implementation.

Written 10 October 2026. Start here.

## The product in one paragraph

coloyond is an Android app (Kotlin, Jetpack Compose) in `apps/android`. A user chooses a token allocation, for example SOL 60% and JUP 40%. The app makes an abstract art card for it, with an optional caption. The user shares the card, and other people import and remix it. The app does not buy or sell anything. To hold the allocation, the user sets it up in [Glider](https://glider.fi), a separate service that rebalances a portfolio in the user's own account. coloyond is **not** affiliated with Glider.

- Spec: [`docs/superpowers/specs/2026-10-09-coloyond-strategy-cards-design.md`](superpowers/specs/2026-10-09-coloyond-strategy-cards-design.md). The spec is the rule book. If the code and the spec disagree, the spec wins.
- Plan: [`docs/superpowers/plans/2026-10-09-coloyond-managed-strategies.md`](superpowers/plans/2026-10-09-coloyond-managed-strategies.md). There is one GitHub issue per plan task.

## What is done

| Item | Where |
|---|---|
| Symmetry and Jupiter probe. Both financial gates failed, so in-app buying is deferred. | [Probe report](integrations/2026-10-09-symmetry-jupiter-probe.md), #13 (closed), PR #21 |
| Symmetry V3 account decoder, checked field by field against the SDK | `protocols/symmetry/AccountDecoder.kt`, PR #21 |
| Card drawing, 1080×1350 PNG export, sharing, and link and file imports, checked on an Android 15 emulator | `platform/`, PR #24 |
| Clean build on `main`: APK builds, 16 unit tests pass, no lint errors | [`apps/android/README.md`](../apps/android/README.md#verified-build) |

To build and run, follow [`apps/android/README.md`](../apps/android/README.md). It includes the emulator notes for WSL.

## The work: the hackathon release, with the manual Glider handoff

The hackathon release is the allocation card plus a button: **"Open Glider to set up this allocation"**. The exact behavior is in the spec section [Follow with Glider](superpowers/specs/2026-10-09-coloyond-strategy-cards-design.md#follow-with-glider). In short:

1. Show the target weights as a list: symbol, full mint address, and percentage with exactly two decimals (basis points ÷ 100).
2. Copy the same list to the clipboard when the user taps "Copy".
3. Show this text: "Glider is a separate service. coloyond is not affiliated with it. You set up, fund, and approve the portfolio in Glider. Glider may not support every asset."
4. Open `https://glider.fi` with `Intent.ACTION_VIEW`. Put **nothing** in the URL.

The button never changes the card or its ID, and the app records nothing about what the user does in Glider.

### Order of work

| Step | Issue | Notes |
|---|---|---|
| 1 | #14 Task 2: records, hashes, import validation | Pure Kotlin. Everything else depends on it. Add `kotlinx-serialization-json` and `kotlinx-coroutines-test` to the version catalog here. |
| 2 | #16 Task 4: scene and caption generation | Can run in parallel with step 3. |
| 3 | #17 Task 5: rendering and PNG export | Reuse `CardExport.renderPng`, `CardLayoutV1` and the grain code from the probe. See the comment on #17. |
| 4 | #18 Task 6: share, import, remix, **and Follow with Glider** | The Glider handoff lives here. Reuse `Sharing.kt` and `ImportIntents.kt`. See the comment on #18. |
| 5 | #22 Before the demo: check Glider's Solana assets and rehearse | Build the demo cards **only** from assets Glider supports. Do one rehearsal in the real Glider app. |
| 6 | #20 Task 8: final validation and demo | Includes the real-phone checks that the emulator could not do. |

Optional: #15 Task 3 (read-only Symmetry vault view). The demo works without it, because allocations can be drafts. Skip it if time is short.

Tip: the Glider handoff screen does not need generated art. You can build it early against a sample allocation, then connect it to real records when #14 is done. The plan names the helper `gliderAllocationText(record): String`. Write it as a pure function with unit tests: weights in basis points must give percentages that total exactly 100.00.

## After the hackathon, not now

Do not spend hackathon time on the Glider API. The later goal is one-tap enrollment through Glider's B2B API: #23 has the details and the open decision about where the partner key lives. The one cheap step to take now is to send the access email below, so the reply is waiting when the hackathon ends. While you build `gliderAllocationText`, keep the "record to asset and percentage" logic in one pure function. The API will need the same mapping later.

## Rules for all work

- No shared private API key in the app, and no hidden proxy.
- No own keepers, backend, or smart contracts, unless the spec is changed first.
- Do not imply a partnership with Glider.
- A test with real funds needs separate, explicit approval.
- Each pull request: run `./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug` from `apps/android`. The repo has no CI, so this is the gate.

## Lower priority

#7, #8 and #9 are small fixes outside the hackathon path. #19 (in-app buying) is deferred.

## Draft email to Glider (not sent, optional)

**To:** developers@glider.fi
**Subject:** Staging API access with Solana enrollment for coloyond

Hi Glider team,

I'm [name]. I'm building coloyond, an Android app for Solana. People choose a token allocation, the app turns it into a generated art card, and they share and remix the cards. We're building it for [hackathon name], which ends [date].

Glider is the natural place to run these allocations. For now the app only shows the weights and opens glider.fi, so the user sets up the portfolio by hand. After the hackathon we want a one-tap "Follow with Glider" that creates a strategy from a card's weights and enrolls the user's own Solana wallet.

Could you give us:

1. A staging API key.
2. The `enroll:write` and `strategies:write` scopes.
3. The `svm_b2b_api` entitlement, for Solana-rooted enrollment where the user signs with their wallet through Mobile Wallet Adapter.

Three questions:

- Which network does the staging API use for Solana: Devnet or mainnet-beta? We want to test before we touch real funds.
- Which assets can a Solana strategy hold today? We want our cards to use only assets you support. Is the strategy validation endpoint the right check for this?
- Can a partner create a strategy from its own weights and enroll a user into it? Or does enrollment use only your published strategies?

Following your docs, we will keep the key on a small backend, not in the app. The backend will submit the transaction that the user signs on the phone.

Thanks,
[name]
[email]
