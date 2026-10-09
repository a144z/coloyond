# coloyond managed-strategy review

9 October 2026. Independent review requested by the user before committing and merging a PR.

## Scope and method

This revision replaces wallet input-split execution with existing managed strategy tokens, existing protocol rebalancing, and gated Jupiter secondary-market purchase/sale. It also updates the implementation plan, offline preview, identity fixtures, and README. No product adapter or live financial operation is implemented in this PR.

Claude Code CLI reviewed the complete spec, plan, HTML, vectors, and README in three rounds. Each returned `is_error: false` and canonical model `claude-opus-5-5`, provider `firstParty`. The CLI used safe mode, disabled tools/MCP integrations, nonpersistent sessions, and an independent reviewer system prompt. The screenshot was separately rendered and inspected by the author; Opus reviewed the HTML rather than image pixels. Review conclusions do not verify live integration gates.

## Review rounds

| Round | Verdict | Resolution |
| --- | --- | --- |
| 1 | REVISE | Split configuration identity from release policy/evidence; added RPC source, allowlist catalog, keeper classifier, read-only versus funded-test gates, Metis-only scope, model-draft seed contract, mobile SDK/intent probes, legacy envelope support, scene/expression fixtures and durable per-wallet recovery |
| 2 | REVISE (narrow) | Added optional configuration snapshots for real field diffs, quote-only adapter in Task 3, consistent classifier/file ownership and deploy-slot observation, exact geometric/UTF-8 limits, and independent Unicode/escape hash fixtures |
| 3 | APPROVE | Reviewer found no material contradictions or remaining blocking/high findings; minor wording refinements applied as directed |

After round 3, the author applied its nonblocking refinements: unknown projection content explicitly remains view-only; caption limits count exact stored Unicode code points and Unicode-whitespace-delimited words; adjacent polygon edges share only their common vertex; ticker symbols come from verified manifest metadata; draft footers are explicit. The final convergence verdict below is preserved verbatim. Only those directed minor edits and whitespace cleanup followed it.

## Verification performed for this PR

- Recomputed all 12 strategy/draft/legacy/scene/expression canonical encodings and domain-separated SHA-256 digests with independent `rfc8785.py` version 0.1.4, installed only in a temporary environment. The Unicode fixture contains non-ASCII text, quotes, a backslash, and an actual decomposed `e` plus U+0301; text is not normalized for identity.
- Checked normalized target ordering, unchanged revision identity on reordering, changed configuration/vault identity, draft domain separation, and preserved legacy domains.
- Passed 20 headless-Chrome assertions covering immutable parent art, dirty/save/share behavior, caption selection/hiding, dialog IDs, existing-strategy selection, explicit unmatched drafts, truthful saved-target/sample labels, and visual remix variation.
- Checked inline JavaScript syntax with `node --check`, Markdown relative-link resolution, and `git diff --check`.
- Regenerated and visually inspected the 1440 × 1540 PNG from the offline HTML. No external assets or live inference/quotes occur in that preview.

Native build, SDK layout/projection mapping, live vault selection, NAV/RPC behavior, keeper classification/activity, real Jupiter entry/exit liquidity and decoding, supported wallets, funded buy/sell recovery, and two-device sharing remain future implementation gates. No claim in this report treats those as passed. Application build/tests were not run: this PR changes documentation and offline design artifacts; future shared/native commands in the plan do not exist yet.

## Review request integrity

These SHA-256 digests identify the exact assembled documents and instructions submitted to each CLI review, without storing authentication or provider session material.

| Round | Input SHA-256 |
| --- | --- |
| 1 | `5516edd2694e4493cf002b3df58c2729dc2945213e5cf5b6fd396a860681cb4a` |
| 2 | `e26a25699b882f0217bf7fed6b4c87086f86bab16411361d3bd16f0409d42722` |
| 3 | `a4a3d8b6a4aa9cae72909c89826053a5516ecdc668a369a1f7abbf1763da9d8b` |

## Final artifact integrity

These digests include the reviewer-directed minor wording edits. The report itself is excluded to avoid a circular digest.

| Artifact | SHA-256 |
| --- | --- |
| `README.md` | `13d86480dcbdf657024d43d468f9f89e3401380ffd7f30ff131d9cafc365af89` |
| `docs/superpowers/specs/2026-10-09-coloyond-strategy-cards-design.md` | `d933e5bdfe2f8968f7404d2546142dc712b9b82d60b6d98f8a7ec238ea60aa28` |
| `docs/superpowers/plans/2026-10-09-coloyond-managed-strategies.md` | `e3789d4f8521c621513d6c9253bdfa82e4a7148fe2d5a0eb228fb4d62bcf8632` |
| `docs/design/coloyond-strategy-cards.html` | `81e592a605dca0bbf0b2fc63ae0b172980fb4e00060c2ba2f7b076907f8d1a7c` |
| `docs/design/coloyond-strategy-cards.png` | `36b1a21c2493741c223d2a45e55673e40cc207af80ebfc8edfcb65638ba59913` |
| `docs/design/coloyond-strategy-identity-vectors.json` | `d81126996ee7a9a6d7cbf43d5d8352adc2180bb9113946481e4a7be1358a58e4` |

## Final Opus 5.5 response

# coloyond spec and plan review, round 3

## Verdict: APPROVE

H6 and M10–M13 are resolved in the spec, plan and vectors. I found no remaining blocking or high-severity issue and no material architectural contradiction. The design is still client-only:

- no new contracts, keeper, routing service or proxy;
- financial actions stay disabled until gates pass;
- no live vault, keeper, route, wallet or funded-test result is claimed.

I did not recompute the fixture digests or the `rfc8785.py` verification. I also could not see from the text whether the `café` caption really uses a decomposed accent. Task 2's requirement to recompute every committed digest covers this; treat these as claimed, not reviewer-verified.

## Round 2 resolution

- **H6(a) configuration diffs: resolved.**
  - The projection is persisted outside the hash.
  - `exportVersion: 2` has exactly five keys, including `configurationSnapshot` or null.
  - The snapshot is validated by recomputing `configDigest`, and a mismatch rejects the whole import.
  - Draft, legacy and unknown-version exports must use null.
  - Digest-only imports show "Configuration changed; details unavailable" and still require a fresh revision.
  - Global change grouping shows a field diff only when the old projection exists.
  - `ImportedCard` and the Task 2/3 tests match.
- **M10 quote dependency: resolved.**
  - `quotes.ts`/`getMarketQuote` is quote-only, lives in Task 3, and is consumed by Task 7 using the forward order's expected output.
  - Amount-free browsing returns not-ready.
  - The taker-omitted, null-transaction request shape is listed as something to probe, not an assumption.
- **M11 file ownership and observation shape: resolved.**
  - `keeperClassifier.ts` and `rpc.ts` are in the file map.
  - Task 3 now creates `adapter.ts` without conflicting with Task 1.
  - `VaultObservation` includes `configProjection` and `programDeploySlot`, and Task 3 tests that a deploy-slot mismatch disables purchase.
- **M12 scene bounds: resolved.**
  - Coordinates are inclusive 0–1000, with no negative centres; cropping comes only from radii or strokes.
  - Invalid geometry is defined exactly: distinct vertices, nonzero shoelace area, and no intersection or touching between nonadjacent edges.
  - The 32 KiB limit is measured on UTF-8 JCS bytes, separately for draft and final scene, with a 64 KiB raw-response guard.
- **M13 caption hashing: resolved.**
  - Captions are hashed exactly as stored.
  - NFKC is used only for diversity checks.
  - Unpaired surrogates are rejected.
  - A Unicode and escape-character vector exists, with provenance for the independent canonicaliser.
- **Round 2 polish:** the recovery wording, ticker screening, `inspect`/`view-only` definitions and unknown-renderer validation are applied.

## Remaining findings (low, non-blocking; fix in passing)

1. **Unknown projection versions are classified two ways.**
   - The spec and Review focus #5 say unknown `configProjectionVersion` content is view-only after structural and integrity checks.
   - Task 2's third bullet says "Unknown supported-shape projection versions preserve inspectable content". The `ImportedCard` definition maps unsupported versions to `view-only`.
   - **Fix:** in Task 2, change "inspectable" to "view-only". Safety is unaffected because neither path executes.
2. **The caption length unit is ambiguous.**
   - "80 Unicode characters" could mean code points, UTF-16 units or grapheme clusters.
   - "12 words" is undefined for scripts without spaces, such as the CJK vector.
   - Because imports validate captions, clients that count differently could disagree on acceptance.
   - **Fix:** state "80 Unicode code points of the stored text (no normalization); words are maximal runs of non-whitespace separated by Unicode whitespace", and add one boundary test to Task 4.

## Optional polish

- **Adjacent-edge overlap:** add "adjacent edges share only their common vertex" to close the polygon rule completely. Most fold-backs are already caught by the touching rule.
- **Ticker symbol source:** ticker screening needs a symbol for each selected mint. Name the source, for example manifest-pinned symbols, or skip the check when no symbol is known.
- **Draft footer:** the spec's card section should mention the "Allocation draft" footer label that Task 5 uses.
- **Carry-overs:**
  - Preview IDs could reuse the vector IDs.
  - Confirm that `docs/design/coloyond-strategy-cards.png` exists in the PR.

## Convergence

No material fixes are required for this docs-only PR. The live gates remain open as specified: vault and projection mapping, keeper classifier, Metis decoding and recovery, the RN/SDK bundle, RPC, wallets, intents and the authorized funded smoke test.
