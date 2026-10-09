# Claude Code Opus 5.5 design review

9 October 2026 · Claude Code 2.1.295 · Canonical model `claude-opus-5-5`

The reviewer received the original specification, offline HTML preview, README, and package manifest. Tools and session persistence were disabled. The result below was returned as text; no reviewer-generated tool invocation was executed.

## Revision response

- Finding 1: specified v0/lookup-table composition, account budgets, one aggregate compute budget, a total priority-fee cap, and a single wrapped-SOL lifecycle that preserves pre-existing user accounts. Combined simulation supplies expected outputs; encoded minimum-output constraints remain authoritative.
- Finding 2: selected sign-only wallet support for MVP execution, byte comparison before client broadcasting, and durable review/signature recovery state.
- Finding 3: fixed record shapes, native-SOL representation, network identifier, address validation, no-op rejection, exact hash bytes, policy-version behavior, and three identity vectors.
- Finding 4: bounded imported ceilings and explicit recipient tightening without altering the reusable recipe.
- Finding 5: defined canonical scene/expression hashes, integer scene values, version fallback, and export viewport coordinates.
- Finding 6: selected React Native Android with an Expo development build and moved the thin platform/intent/wallet probe to the first delivery step.
- Finding 7: pinned the initial Messages API contract, made credentials explicit in the success case, kept IDs local, derived caption observations from geometry, and specified candidate deduplication/motif rules with a user-caption exemption.
- Finding 8: assigned distinct illustrative IDs to each allocation, froze the imported parent study, added explicit expression saving, kept remixes visually distinct, and corrected slider/image/decorative accessibility metadata.

Product implementation and live on-device verification remain subsequent work. The original review follows for traceability.

## Original review

### coloyond strategy card spec and offline design preview

## Context
The user asked for a review of `docs/superpowers/specs/2026-10-09-coloyond-strategy-cards-design.md` and `docs/design/coloyond-strategy-cards.html` before running `git add`, commit, and push. This is a review only: no files change and no commands run. Accepted intent, which is not reopened here: a Solana Mobile hackathon app, client-run, no new contracts, generative abstract art with optional captions, strategy identity kept separate from expression identity, local share and remix, and a preview that is clearly labeled as illustrative.

## Verdict
**Suitable to commit as a design draft.** None of the findings below blocks committing. The document is internally coherent. It is careful about provenance, about the line between preview and product, and about truthful execution states. Its own labels mark it as a draft. Findings 1–3 and 5 should be resolved before the matching implementation phase starts. The rest are improvements.

## Findings (prioritized)

### 1. High — implementation blocker for delivery step 4: atomic composition rules are too loose
**Where:** "Atomic execution boundary", paragraphs 1–3; the `policy.maxPriorityFeeLamports` row in "Strategy record".
**Problem:**
- Solana fails a transaction that contains more than one compute-budget instruction of the same type. "Avoid duplicate incompatible compute-budget instructions" should therefore be a hard merge rule.
- `maxPriorityFeeLamports` is a total in lamports. The compute-budget price is micro-lamports per CU, and the spec never says how one converts to the other.
- If two SOL-input swaps each carry their own wSOL create/sync/close, the first branch's close can tear down the second branch's input.
- Two independently quoted routes can share a pool, so the second branch's real output will drift from its quote.
- Combining two routes needs v0 messages and merged lookup tables. The size limit is the likely failure mode, so it should not be left as a late "reject".
- I can't verify the cited Jupiter `/build` endpoint from here.

**Fix:** Write these rules down:
- Strip per-route compute-budget instructions. Emit exactly one CU-limit instruction (summed from simulation plus a margin) and one CU-price instruction, with `price = floor(maxPriorityFeeLamports × 1e6 / cuLimit)`.
- Wrap the total SOL budget once, run both swaps, then close wSOL once.
- Take the minimum outputs and displayed outputs from simulating the combined transaction, not from the individual quotes.
- Use v0 messages with merged ALTs, and constrain route account counts at quote time. Verify the exact parameter name against the current Jupiter docs.
- Pin the Jupiter API version and endpoint name, and re-confirm them when implementation starts.

### 2. High — implementation blocker for step 4: the wallet and mobile runtime boundary is incomplete
**Where:** "Atomic execution boundary", final paragraph; "Reject unreviewed instruction types or changed transaction facts"; "Credentials remain in session memory by default".
**Problem:**
- Through Mobile Wallet Adapter, wallets commonly *sign and send*. Some may also add instructions of their own. The app then cannot guarantee that the bytes that land on chain are the bytes it simulated and reviewed, and it cannot "reject" changes after the wallet has sent.
- Switching to the wallet app can kill the dApp's process on Android. That loses the frozen revision, the built transaction, and any credentials held only in memory.

**Fix:**
- Name the MWA method(s) the app will use.
- If sign-only is available, compare the signed message with the reviewed message before sending.
- If the wallet sends, reconcile by the returned signature. Parse the confirmed transaction against the recipe before writing a receipt.
- Persist in-flight review state (never credentials) across process death.
- Accept that in-memory credentials may need re-entry after the app switch.
- Confirm sign-only support against the specific wallets you will demo with.

### 3. High — implementation blocker for step 1: `StrategyV1` canonicalization is underspecified
**Where:** "Strategy record" (table plus the following two paragraphs).
**Problem:** Two implementations could disagree on the ID because of these gaps:
- The allocation object's field names and shape are not defined (e.g. `{ "mint", "bps" }`).
- The `network` identifier format is not pinned (genesis hash, CAIP-2 string, or cluster name).
- Native SOL has no mint, and the spec doesn't say how it is represented, e.g. as the wSOL mint.
- A single 10000-bps allocation to `inputMint` is a valid no-op recipe.
- Mint validation is limited to "preserving case". It doesn't require that the string decodes as base58 to 32 bytes.
- The byte order of the hash input is only implied.
- What an importer does with a different `adapterPolicyVersion` is unclear. "Reject unsupported" would make newer apps refuse older recipes.

**Fix:**
- Define each field's exact JSON shape.
- Pin `network` to one format.
- State that SOL input means the wSOL mint, and that "retain" emits no instruction.
- Reject recipes that consist only of a retain allocation.
- Require a round-trip base58 → 32 bytes check.
- Write the hash input as `SHA-256("coloyond/Strategy/v1" || 0x00 || JCS(record))`.
- Say which policy versions an importer accepts. For example, it accepts any version it knows and shows recipes from unknown versions as view-only.
- Commit 2–3 hex test vectors.

### 4. Medium-High — imported policy ceilings are untrusted and unbounded
**Where:** "Strategy record" (the `policy.*` rows); "Review and execute"; "Storage and sharing" import validation.
**Problem:** A shared recipe carries the sender's slippage, price-impact, and priority-fee ceilings. Nothing caps them. A stranger's link could set 50% slippage or a very large priority fee, and the recipient would run with those values.
**Fix:**
- Add schema ranges and app-level safety maxima, and reject or flag recipes that exceed them.
- Show the recipe's policy values on the review screen.
- Let the recipient *tighten* the ceilings at execution time without changing the strategy ID. They are ceilings, so a tighter value is still within the recipe.
- Loosening a ceiling remains a remix and gets a new ID.

### 5. Medium — `ExpressionV1` identity, the scene hash, and layout are ambiguous
**Where:** "Expression record"; "Generation lifecycle" step 5 ("Render locally and derive a scene hash"); "Scene contract"; "Exported card" (the 72% figure); import "recompute both IDs".
**Problem:**
- Step 5 suggests the scene hash is taken from rendered output. Pixels are not portable across devices, so an importer could not recompute it.
- The expression domain tag and the list of hashed fields are unspecified. It is unclear whether `strategyId` and the renderer version are in the hash.
- Gradient stops and grain intensity may be floats, which makes canonical JSON fragile.
- An unknown renderer version on import has no defined degradation path.
- Square art at full width would take about 80% of a 1080×1350 card. The spec says 72%, so the art viewport's pixel geometry is undefined.

**Fix:**
- Define the scene hash as SHA-256 of the domain-tagged JCS bytes of `SceneSpecV1`, computed before rendering.
- List the hashed `ExpressionV1` fields explicitly, including `strategyId`, `rendererVersion`, `layoutVersion`, and the caption and its origin. Give the domain tag, e.g. `coloyond/Expression/v1\0`.
- Make all scene numerics integers, with gradient stops on a 0–1000 scale.
- When the renderer version is unknown, fall back to recipe-only display plus any attached PNG, rather than rejecting the import.
- Pin the art viewport rectangle in `layoutVersion` 1, e.g. 960×960 at (60, 60).

### 6. Medium — the target runtime is undecided, yet steps 1–3 depend on it
**Where:** "Storage and sharing" (IndexedDB vs. native); "Atomic execution boundary" ("native Solana Mobile integration"); "Repository integration"; "Delivery order" (packaging comes last).
**Problem:**
- The storage adapter, the share sheet's file and link payloads, inbound link and file intents, inference networking (CORS), and the MWA SDK all differ between a PWA/TWA wrapper of the existing Vite app and a React Native/Expo app.
- Leaving packaging to step 4 means steps 1–3 may be built against the wrong platform.
- "Native" is also stated as a requirement for wallet signing. MWA also has a mobile-web path on Android Chrome, which is worth checking before committing to a full native rewrite.

**Fix:**
- Record the runtime choice, or a dated decision point, in "Repository integration".
- Move a thin packaging spike into step 1: install on a device, then confirm that the share sheet receives a PNG and an inbound link opens the app.

### 7. Medium — the inference contract and caption grounding are not implementable as written
**Where:** "Generative artwork architecture" ("compatible external endpoint"); "Generation lifecycle" steps 3 and 6; "Caption design".
**Problem:**
- "Compatible" does not name a wire protocol, a request/response schema, or a default model, so phase 2 has nothing concrete to build against.
- Visible observations are asserted by the model and never checked against the layers. Captions can therefore be "grounded" in details the scene doesn't contain.
- Sending the frozen strategy ID to the provider adds a linkable public identifier that generation doesn't need.
- Several caption rules are undefined or conflicting:
  - "Notable motif" has no definition.
  - Exact-repeat rejection would also block a user-written caption.
  - The three candidates aren't deduplicated against each other.
- The success case doesn't mention that the remixing person also needs their own credentials. Without them, they only get the "Local preview".

**Fix:**
- Specify one adapter contract (endpoint shape, JSON schema, default model ID, timeout semantics). Keep the local validator authoritative whatever the provider guarantees.
- Require each observation to reference layer indices and palette tokens that the validator confirms. Alternatively, derive observations deterministically from the validated layers.
- Keep request-to-strategy association local.
- Define motif matching as a small lexical stem list, exempt user-written captions from repeat checks, and deduplicate within each batch.
- State the credential requirement in the success case.

### 8. Low — preview artifact bugs (`docs/design/coloyond-strategy-cards.html`)
- **The remix ID contradicts the identity rule.** In `render()`, `remixId` and `remixStatus` show the same `cb1:a18f32…03c47e` for every slider value except 60. Moving from 70% to 80% leaves the ID unchanged while the label says "Changed strategy". **Fix:** look up a distinct illustrative ID for each slider step (10–90) and keep 60 mapped to `cb1:7c4a91…e912b7`.
- **The parent thumbnail isn't immutable.** `parentArt` renders from the live `study` value, so "Generate image" and "Another image" change the remix parent. The spec says the parent stays intact. **Fix:** keep a separate `savedStudy` that changes only on an explicit save, and render `parentArt` and `shareArt` from it.
- **The remix art can repeat the parent.** When `remixVariation` cycles to 0, `(kind + 0) % 3` gives the parent's study rotated 9°. **Fix:** cycle over 1..2 only.
- **Accessibility gaps:**
  - The slider has no `aria-valuetext`. **Fix:** set it in `render()` to something like "70% jupSOL, 30% USDC".
  - The decorative status glyphs `▰ ▰ ▰` aren't `aria-hidden`.
  - Every study shares one `aria-label` ("folded geometry"). **Fix:** use a label per study.

## Not raised
- The preview's authored studies, the preset caption list, and the "Preview share card" stand-in are clearly labeled. I have not treated them as product behavior.
- The relative links in both documents resolve correctly.
- The README still describes coloyond. Updating it is optional and out of scope for this commit.


## Targeted follow-up review

Canonical model `claude-opus-5-5` reviewed the revised spec, preview, identity vectors, and revision response. It again found the draft suitable to commit. Its remaining grain-intensity ambiguity was resolved by specifying a 0–100 cap on a 0–1000 opacity scale. The small follow-up suggestions were also addressed: retain allocations need no swap, the share dialog reads the saved study, and deliberate off-canvas geometry is clipped to the viewport.

**Final targeted review: coloyond strategy cards design draft and offline preview**

**Verdict:** This is suitable to commit as a design draft. The revision resolves the previous review's material issues:

- **Material identity:** exact record shapes, wSOL representation, the network literal, retain-only rejection, the byte-exact hash input, policy-version handling, and consistent vectors. Allocation ordering and JCS key order in the vectors match the stated rules. I could not recompute the digests without tools.
- **Scene generation:** a pre-render scene hash, an integer schema, an explicit expression payload, and an unknown-version fallback.
- **Mobile recovery:** a sign-only MWA path, byte comparison before broadcast, durable state written before the wallet switch and before the first send, and no automatic resubmission.
- **Transaction composition:** one compute-unit limit and one compute-unit price instruction, the micro-lamport conversion with a ceiling check, a single wrapped-SOL lifecycle that protects pre-existing accounts, combined-simulation display, encoded minimum outputs, v0 messages, and merged address lookup tables.
- **Sharing:** origin-gated links, a 256 KiB import limit, both IDs recomputed on import, and truthful success semantics.
- **Preview state:** distinct illustrative IDs per slider step, an immutable parent, remix art that never repeats the parent, an explicit save step, `aria-valuetext` on the slider, decorative status glyphs hidden, and per-study image labels.

One residual contradiction remains. It is a one-line fix and worth making before the commit, but it does not block the commit.

**1. High (spec contradiction, affects expression ID validity): the `grainIntensity` range is stated two ways**

The "Scene contract" first paragraph says gradient positions, opacity, and grain intensity "use 0–1000 units". The next paragraph says `texture` contains only `grainIntensity` (0–100). Two implementations could disagree on whether a scene is valid. A scene that one importer accepts could be rejected by another, which changes whether its `sceneHash` and expression ID are reachable at all.

**Fix:** use one range. 0–1000 is consistent with the other scene numerics. Drop grain from the 0–1000 sentence only if 0–100 is intended.

**Non-blocking notes (no action needed for commit)**

- **"Both swaps" wording:** "For a two-output recipe, both swaps consume preallocated input budgets" reads as though two swaps always occur. A two-output recipe can contain one retain allocation, as in the vectors. Consider "each swap allocation consumes…".
- **Share dialog reads live state:** in the preview, the share dialog renders from live `study.value` rather than `savedExpression.study`. This is currently safe because "Share preview" is disabled whenever the expression is unsaved. Reading from `savedExpression` would make the dialog robust if that guard changes later.
- **Viewport bounds:** "All generated layers remain inside a fixed art viewport" is not fully covered by the listed bounds. For example, an ellipse at `cx` 900 with `rx` 500 passes the schema. Name the bounding-box check explicitly when implementing scene validation.

I found no other remaining blocking contradictions or preview bugs.

## Local verification

The identity vectors were computed locally and verify normalization invariance and changed-allocation identity. Headless Chrome verified parent immutability, explicit saving before sharing, caption omission, distinct IDs across all nine sample allocations, unchanged-recipe identity, slider announcements, distinct remix studies, and unique IDs inside the share dialog. JavaScript syntax and rendered layout were checked. The screenshot was regenerated after the preview changes. The subsequent future-automation note documents the custody and permission boundary discussed with the user; unattended execution remains outside the MVP.
