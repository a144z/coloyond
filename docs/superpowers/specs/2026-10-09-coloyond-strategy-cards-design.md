# coloyond generative strategy cards

Managed-strategy revision · 9 October 2026 · Runtime revision · 10 October 2026 · Hackathon scope revision · 10 October 2026

> **Runtime revision (10 October 2026).** The hackathon app is a native Kotlin + Jetpack Compose Android app in `apps/android`. It replaces the React Native/Expo runtime that earlier revisions named. Product rules, schemas, identity domains, limits and launch gates are unchanged. Sections that named React Native, Expo, shared TypeScript packages, Skia or react-native-share now name the Kotlin equivalents.

> **Hackathon scope revision (10 October 2026).** The Task 1 probe ([evidence](../../integrations/2026-10-09-symmetry-jupiter-probe.md)) found that Jupiter has no route for any of the 40 Symmetry V3 share tokens, and that no funded 1–2-asset vault has keeper automation enabled. Launch gates 3 and 4 fail, so purchase and sale stay disabled for the hackathon. The shareable allocation is now the primary record: a card carries target weights, and a recipient can remix them. Symmetry vaults appear as labeled read-only facts. A manual "Follow with Glider" handoff (see [Follow with Glider](#follow-with-glider)) lets a person set up the allocation in Glider themselves; coloyond sends Glider nothing. One-tap enrollment through Glider's partner API is the planned next step after the hackathon, not part of this release. Schemas, identity domains, limits and gates are unchanged.

coloyond gives a DeFi strategy an abstract visual expression that people can save, share, and remix. Each expression may carry a short caption. The strategy has a stable content hash; the artwork leaves its meaning open to the viewer. This specification covers the mobile card experience, generation, identity, sharing, and the boundary with atomic execution.

The hackathon success case is a person choosing an allocation (their own weights, or an existing vault's target weights shown read-only), generating an expression, and sharing it. Another person opens the card, makes another expression or remixes the weights, then optionally opens Glider to set up that allocation themselves. Buying a managed share token in the app is a later feature that needs a passing financial integration. Each person supplies their own inference credentials for live generation; viewing, importing, and saving drafts work without them. Buying or selling requires a fresh amount, quote, review, and wallet approval.

## Agreed direction

- Preserve the coloyond reference's cream paper, black geometry, saturated color, grain, and generous space.
- Generate abstract compositions from strategy structure. Avoid compulsory characters, archetypes, or strategy names.
- Treat captions as optional language attached to an expression. They invite interpretation and never become the strategy's name.
- Keep financial facts exact, readable, and separate from generative content.
- Run construction, validation, storage, rendering, and signing on the client. Use existing deployed programs; deploy no new contracts.
- Preserve user approval for every financial execution. A generated caption or scene cannot change transaction behavior.

The visual reference is the user-supplied coloyond image. The companion [design preview](../../design/coloyond-strategy-cards.html) is an offline layout prototype. Its compositions, IDs, and financial examples are illustrative; it contains no model inference or transaction execution.

## Product scope

The first release is a client for existing Solana managed vaults whose SPL share tokens represent proportional ownership of underlying assets. A 60% A / 40% B strategy is displayed as one position with a share price. The weights are the protocol's target composition, not an input-budget split and not a promise that actual holdings always equal the targets. Market movements, fees, auctions, and rebalance thresholds can cause drift.

Symmetry is the first integration candidate, because its deployed program exposes weighted vaults, share tokens, valuation, and permissionless keepers. This is a candidate, not a verified launch integration. The launch probe must find a specific existing vault, verify its configuration and operating history, and establish a viable purchase and exit route. No vault address, keeper coverage, SDK compatibility, or Jupiter route has been verified in this documentation change. [Symmetry documentation](https://docs.symmetry.fi/)

Probe result (10 October 2026): the Symmetry decoder and configuration reads work, but no share token has a Jupiter route and no funded 1–2-asset vault has keeper automation enabled. Symmetry is therefore a read-only data source for the hackathon release.

coloyond does not deploy a program, create a synthetic receipt token, custody funds, run a keeper, or implement routing, auction settlement, or automatic rebalancing. The app uses existing protocol SDKs for reads and Jupiter's managed swap service for supported market purchases and sales. Its client integration validates transactions, obtains wallet approval, and records receipts; this is not a new execution service.

V1 selects existing vaults. Creating/configuring a new vault through an existing program is a later product extension with separate configuration authority and keeper-coverage checks. Changing a weight in the app cannot change the selected vault. Desired allocations without a matching supported vault remain nonexecutable local drafts.

The creative experience can ship with honestly labeled samples before a live financial adapter passes its gates. Every financial action then reads "Purchase unavailable" or "Sale unavailable". Cross-chain execution, new Uniswap hooks, shielded Solana swaps, perps, custom autonomous agents, redeemable credits, and NFT minting are outside V1. DefiLlama and further pool adapters are later discovery sources, not settlement dependencies.

### Unattended operation

After a user buys a supported managed share token, the selected protocol's existing keepers perform its supported rebalancing without the phone staying open or the user signing each rebalance. coloyond runs no keepers. This is protocol-managed exposure, not permission to continuously trade arbitrary assets in the user's wallet.

The protocol's keeper design alone does not establish that any particular vault is served. Launch evidence must include recent successful rebalance/intent settlement transactions for the selected vault, their timing, and the current rebalance rules. Display "Managed by [protocol]" with latest observed activity. If evidence is absent or stale, display "Management activity unverified" and disable new purchases under the release policy; permit inspection and separately verified exits. Never promise uptime, a rebalance deadline, or constant exact weights. [Symmetry keeper architecture](https://docs.symmetry.fi/llms.txt)

### Valuation and liquidity

A virtual basket can have a computed value, `sum(quantity_i × price_i)`, but that value does not create an SPL mint or move assets. An existing managed vault provides the real mint and accounting needed for one tradable position. Protocol NAV per share is net underlying value divided by outstanding shares, with protocol accounting and fees applied; target percentages alone cannot determine NAV.

The UI distinguishes **protocol NAV**, **Jupiter market price**, and **executable swap quote**. Each has a source and an observation time/slot; no number is labeled simply "price" when its meaning is ambiguous. Use the protocol SDK's valuation for NAV rather than deriving it from target weights. Missing or invalid supply/oracle inputs mean "NAV unavailable".

Jupiter Price API v3 accepts actual mint addresses and may omit a mint when pricing criteria are unmet. Query it for the selected share mint; if it is omitted, show market price unavailable and keep independently valid NAV visible. A supported price does not prove there is a usable swap route for the user's amount. A route can also exist while Price API omits the mint. Both are probed independently. [Jupiter Price API](https://developers.jup.ag/docs/price/index)

## User flow

### Select

Choose an existing supported vault. Show target weights, actual observed composition separately, protocol, share mint, configuration authority, management fees, current NAV, and market-price availability. Network and full addresses are expandable. Financial facts come from validated protocol reads, never generated text.

"Generate image" freezes the current verified configuration revision. Changes while a request runs invalidate association with the current revision. Late results are discarded or saved against their original revision, never attached to a changed vault/configuration. Browsing and generating require no wallet.

### Choose an expression

Artwork dominates the screen, with an optional caption beneath. "Another image" adds an expression for the same saved strategy revision. "Another caption" changes only the candidate. A caption switch removes it. New artwork clears the previous caption and generates candidates grounded in the new visible scene.

"Save expression" freezes scene, seed, caption, renderer version, and card layout. Sharing uses the saved expression; unsaved changes require saving first. Nothing in a saved card silently changes with live NAV, market prices, or vault balances.

### Share and open

"Share" opens the platform share sheet with a locally rendered PNG and a portable strategy attachment or import link when supported. "Save image" and "Export strategy" remain separate because targets handle payloads differently.

The card contains artwork, optional caption, short revision ID, a restrained wordmark, network, protocol, and a line explicitly labeled "Target weights · saved configuration". It omits wallet addresses, amounts, balances, API credentials, and execution history by default. Draft cards instead say "Allocation draft · desired weights", with no implied protocol, vault, or share mint. Snapshot date is visible in details when recorded; absent source metadata is labeled unavailable. A hash is a content identifier, not a blockhash or proof of execution.

Recipients see the original expression only when its scene or PNG accompanies the strategy. A strategy-only link offers local generation; the hash alone retrieves nothing. Before a purchase, reload and verify the live configuration. If it changed, preserve the historical card and show the differences; require accepting a new revision and a fresh financial review.

### Remix

A visual remix keeps the same strategy revision but creates another expression and can inherit a bounded diagonal, opening, or overlap from the immutable parent. Selecting another existing vault creates a new financial revision and retains optional parent attribution.

Weight exploration saves a separate `AllocationDraftV1`, not a tokenized strategy: exactly `schemaVersion: 1`, `kind: "allocation-draft"`, `network: "solana:mainnet-beta"`, and `targetWeights` (the same positive, distinct-mint, sorted, total-10000 rules below). Its domain is `coloyond/Draft/v1` plus the null byte; its digest prefix is `cbd1:`. No protocol, vault, share mint, or buy action is inferred. A verified catalog match can be explicitly selected to produce a `ManagedStrategyV2`. Only exact mint/weight matches are called matches; approximate suggestions show their differences. An unchanged vault cannot be relabeled as following the draft.

### Buy, hold, and sell

Enter a funding amount and review a fresh Jupiter order to exchange a supported funding mint for the selected share mint. One transaction purchases the token; subsequent underlying management belongs to the existing protocol. Buying is user-approved. Holding requires no recurring coloyond signatures. Selling the share token uses a separately verified reverse Jupiter route.

When no market route exists, V1 does not substitute protocol deposits/redemptions. Those can involve multiple transactions, deposits locked pending keeper processing, and auctions. They are a possible later adapter with an explicit intent lifecycle and exit disclosure, not an atomic fallback. A card can still be saved/shared when purchase is unavailable. [Symmetry deposit/withdraw overview](https://docs.symmetry.fi/llms.txt)

Confirmed purchase and sale receipts are separate from the expression. A signed transaction or an API response alone is not displayed as independently verified on-chain confirmation.

This section stays normative for a later release. In the hackathon release every purchase and sale control reads "Purchase unavailable" or "Sale unavailable", because gates 3 and 4 fail.

### Follow with Glider

[Glider](https://glider.fi) is a separate automated-portfolio service that supports Solana. It rebalances a user's own smart account under the user's authorization. coloyond does not integrate with Glider in this release and must not imply a partnership or endorsement.

Any saved allocation draft or managed revision offers "Open Glider to set up this allocation". The action:

1. Shows the target weights as a list: asset symbol where known, full mint address, and percentage with exactly two decimals (basis points ÷ 100, which Glider's allocation format accepts).
2. Copies the same list as plain text to the clipboard after an explicit tap.
3. Opens `https://glider.fi` with `Intent.ACTION_VIEW`. The URL carries no allocation, address, or identifier, so coloyond sends Glider nothing.

Before opening, show: "Glider is a separate service. coloyond is not affiliated with it. You set up, fund, and approve the portfolio in Glider. Glider may not support every asset." The action never changes the card, the strategy record, or its identity, and it records no outcome, because coloyond cannot observe what the user does in Glider.

Glider's B2B API can create a strategy from CAIP-19 assets and percentages and enroll a Solana wallet with a user-signed payload. It needs a partner API key with Solana entitlement. A key in the app would be a shared private key, which this specification forbids, so API enrollment needs a later decision about where the key lives. [Glider API overview](https://docs.glider.fi/api-reference/v2-overview)

## Visual design

### System

| Element | Decision |
| --- | --- |
| Paper | Warm cream `#F1ECDD`; texture confined to artwork and quiet page backgrounds |
| Ink | Near black `#171715` for body copy and controls |
| Accent palette | Cobalt `#1249ED`, violet `#8D25D9`, yellow `#FFD523`, coral `#FF513B` |
| Typography | Bold system sans for coloyond and UI; restrained regular sans for captions; monospace for IDs |
| Spacing | 8 px base grid; 20 px mobile gutters; at least 44 px touch targets |
| Form | Flat paper surfaces, fine rules, restrained corners; primary actions use solid ink |
| Composition | Large abstract geometry, deliberate negative space, saturated interruptions; vary silhouette and orientation |
| Accessibility | Text meets WCAG AA contrast targets; target and actual composition facts accompany color; decorative texture avoids text; reduced-motion mode |

The prism is a visual anchor, not a mandatory repeated object. Expressions can be folded planes, interrupted rings, beams, offset slabs, or shapes that nearly meet. There is no permanent color-to-token dictionary and no visual ranking of strategies by safety or expected return.

Strategy weights can influence mass and area, asset count can influence intersections, and managed structure can influence layering. These are soft composition inputs, not charts. Exact target percentages are rendered by the application in the factual line; actual observed weights appear separately in details.

### Mobile screens

1. **Select:** coloyond header, artwork area, existing-vault selector, target-weight rows, valuation/management disclosure, and "Generate image". Connect the wallet only for financial features.
2. **Expression:** artwork, caption, short ID, compact allocation line, "Another image", "Another caption", caption switch, and "Save expression". Controls stay outside the exported artwork.
3. **Share:** saved card preview, "Share", "Save image", and "Export strategy". Exact strategy details remain one tap away.
4. **Imported card:** expression or strategy-only state, saved target-weight facts and current configuration comparison, "Remix", and a separate "Review purchase" action when supported.
5. **Execution review:** familiar transaction facts and wallet approval. The generative composition is secondary here.

### Exported card

The default export is a 1080 × 1350 PNG. Layout version 1 places a 960 × 960 art viewport at (60, 60), a caption rectangle at (60, 1050) sized 960 × 110, and a footer rectangle at (60, 1210) sized 960 × 80. The caption uses at most two lines; when hidden, its rectangle returns to whitespace. The footer carries a short ID, the factual allocation line, network, and a small wordmark. Bundle a pinned licensed export font and record its version with renderer/layout assets so caption wrapping is stable across devices; system fonts remain acceptable for controls. Test 80-character/12-word captions in the fixed rectangle. A 1080 × 1080 variant requires a subsequent layout version.

ID display uses a recognizable prefix and two abbreviated ends, such as `cb2:7c4a91…e912b7`. The full ID is available in details and exported data. Never use the abbreviated display for integrity comparison.

Export excludes edit controls, loading states, toast messages, credentials, and unselected captions. Artwork itself contains no generated text; the application places every text element.

## Caption design

Captions respond to something visible while allowing an interpretation greater than the literal description. The initial examples "Still becoming", "Where the light goes", "Between possibilities", "Beyond this moment", "An unfamiliar horizon", and "What might unfold" establish openness, not a preset list.

Variation includes brief fragments, concrete observations, spatial relationships, intimate phrases, and occasional open questions. The default request returns three candidates of 2–8 words, with an absolute limit of 12 whitespace-delimited words and 80 Unicode code points. Count code points of the exact stored text without normalization. A word is a maximal non-whitespace run separated by Unicode White_Space characters. The user can keep one, ask for another, edit it, or leave it blank.

Examples of distinct rhythms include "Held, lightly", "The yellow arrived first", "An opening at the edge", "Almost a circle", and "What might unfold". All are illustrative. The actual generator grounds candidates in scene observations.

Store the last 20 accepted captions locally. For model candidates, reject exact repeats both against that history and within the returned batch after Unicode NFKC normalization, case folding, whitespace normalization, and removal of terminal punctuation. Discourage recently repeated opening words and sentence patterns. A motif is a case-insensitive token beginning with one of `light`, `horizon`, `possib`, `beyond`, `becom`, or `unfold`; reject model candidates containing a motif that appeared in the previous five accepted captions. User-written captions bypass repetition and motif checks but retain the length and text-safety checks. This is a local diversity rule, not a claim of global uniqueness.

Treat "light", "horizon", "possibility", "beyond", "becoming", and "unfold" as occasional vocabulary. Never force a particular poetic register. A candidate that does not add anything can be omitted.

### Generation instruction

> Write three short caption candidates inspired by the visible observations supplied below. Each may suggest more than it explains. Vary sentence structure, rhythm, and emotional distance. Use a specific visible detail when it helps. Avoid strategy names, character archetypes, financial advice, performance claims, calls to action, and explanations of symbolism. Avoid the recent phrases and motifs supplied. Return plain text values inside the required JSON schema. Return an empty candidate array if none fits.

The caption validator uses deterministic best-effort screening, not a guarantee that every financial claim is recognizable: reject `$`, `%`, uppercase ticker tokens for the selected strategy assets using manifest-pinned display symbols; skip ticker matching when no verified symbol is available, and whole-word case-insensitive tokens `return`, `returns`, `yield`, `yields`, `profit`, `profits`, `buy`, `sell`, `guaranteed`, `risk-free`. Apply this screen to model and user captions, alongside length, URL, control-character, and schema checks. Accepted user captions do count in the shared 20-caption history and five-caption motif window even though user text bypasses diversity rejection. Caption values are always rendered as escaped text. A custom caption is identified as user-written in expression metadata. Neither source can modify the strategy.

## Generative artwork architecture

### Selected approach

Use a generative language model to compose a structured scene, then render it locally. The model chooses geometry, placement, palette relationships, and negative space. The renderer handles exact pixels, deterministic texture, export, and safe text placement. Caption inputs are derived from validated layer properties rather than free-form observations asserted by the model. This is genuine runtime scene generation; a fixed set of templates is only a labeled offline fallback.

The initial native inference adapter uses Anthropic's Messages API: `POST https://api.anthropic.com/v1/messages`, `content-type: application/json`, `anthropic-version: 2023-06-01`, and the user's `x-api-key`. It sends abstract composition features and recent caption context, without addresses, holdings, funding amounts, transaction signatures, strategy IDs, or expression IDs. The initial configured model is `claude-opus-5-5`; account access is checked explicitly, and an unsupported model produces a configuration error rather than a silent fallback. Claude Code subscription authentication is not an app API credential. Credentials remain in session memory by default. A native client may later offer operating-system secure storage. A built-in shared private key is prohibited. This is a client-run product with an external inference dependency, not a fully offline model. [Messages API](https://platform.claude.com/docs/en/api/messages/create)

Scene requests contain `model`, `max_tokens: 4096`, `stream: false`, a schema-directed `system` instruction, and one user message containing the composition brief. Caption requests use the same envelope with `max_tokens: 256` and the observations/history payload; their expected response is `{ "candidates": [string] }`. Request low-latency generation without an extended-thinking budget. Concatenate only response `content` blocks of type `text`, parse one JSON object, and apply the local schema regardless of any provider formatting guarantees. Truncated output, tool-call output, non-JSON text, or unexpected content is a generation failure. Never interpret model output as executable instructions. Treat HTTP 401/403 as credential failures, 404 as a configuration failure, and 429/5xx as retryable only within the existing stage deadline. An abortable request includes connection time in its deadline; retries never restart the deadline.

A browser prototype can use only endpoints that permit its origin and their documented browser opt-in headers; Anthropic direct browser calls require `anthropic-dangerous-direct-browser-access: true`. The native MVP does not rely on browser CORS behavior. A native Android client can use its own networking stack. Failure to reach inference does not trigger a hidden proxy or expose a shared key. Fully local inference and full raster image generation are later adapters; they are not prerequisites or claims of this MVP.

### Scene contract

`SceneSpecV1` contains `schemaVersion: 1`, `rendererVersion: 1`, `canvasRatio: "1:1"`, a background palette token, 1–24 allowlisted geometric layers, a seeded texture setting, and an optional inherited feature used as a composition prompt hint, not a geometric guarantee. Layer types are polygon, ellipse, ring, and beam. All point coordinates, gradient endpoints, and ellipse/ring centres are integers in the inclusive range 0–1000. Negative/off-grid centres are forbidden; cropping arises from valid radii or strokes extending beyond the viewport. Polygon/beam vertices must be distinct, their signed shoelace area nonzero, and nonadjacent edges must not intersect (including touching); adjacent edges share only their common vertex. These are the exact invalid-geometry rules; no unspecified aesthetic validator may reject otherwise valid scenes. All scene numerics are integers: gradient positions and opacity use 0–1000 units; grain intensity is capped at 100 on that same scale; widths and coordinates use the fixed grid. Palette references use approved tokens; fills can be solid or bounded gradients. The renderer clips layers to the fixed art viewport, so bounds such as an ellipse near an edge may create a deliberate cropped form. The stored seed is a client-chosen unsigned 32-bit integer, not a model-created strategy attribute.

The exact scene keys are `schemaVersion`, `rendererVersion`, `canvasRatio`, `background`, `seed`, `layers`, `texture`, and `inheritedFeature`. `texture` contains only `grainIntensity` (0–100); `inheritedFeature` is null or one of `diagonal`, `opening`, and `overlap`. Palette tokens are `paper`, `ink`, `cobalt`, `violet`, `yellow`, and `coral`, using the design table's colors. Each layer contains `type`, `fill`, `opacity` (0–1000), and only the geometry keys for its type:

| Type | Geometry |
| --- | --- |
| `polygon` | `points`: 3–12 coordinate pairs |
| `beam` | `points`: 3–4 coordinate pairs |
| `ellipse` | `cx`, `cy`, `rx`, `ry`; radii 1–500 |
| `ring` | `cx`, `cy`, `radius` (1–500), `strokeWidth` (1–125 and smaller than the diameter) |

Solid fill contains exactly `{ "type": "solid", "color": paletteToken }`. Linear fill contains `type: "linear"`, coordinate pairs `from` and `to`, and 2–4 `stops` containing exactly `at` (0–1000) and `color`; positions increase strictly and include 0 and 1000. Reject coincident gradient endpoints, invalid geometry, unknown fields, and scene payloads over 32 KiB, measured as UTF-8 byte length of the JCS encoding (the model draft before seed insertion and the final scene separately). Reject a raw model response over 64 KiB before parsing it. The provider returns `ModelSceneDraftV1`: exactly the `SceneSpecV1` keys and rules above except that `seed` is absent and forbidden. Validate that draft first, then assign a client uint32 seed to create the final `SceneSpecV1` and validate it. Imports validate the complete final scene including seed. Imports with positive unknown renderer versions still validate against these schema-version-1 layer/bound rules, then remain view-only; do not accept opaque geometry. Importers render only known versions; generation in this release always emits renderer version 1.

The model returns JSON data, never arbitrary SVG, HTML, JavaScript, CSS, file paths, or remote asset URLs. Validation bounds layer count, coordinate range, gradient stops, stroke widths, grain intensity, and total payload size. A local observation builder supplies up to four facts about layer type, actual palette tokens, viewport location, and overlap computed from validated geometry. It does not infer chronology, intent, risk, or performance. The caption may take a poetic liberty such as "The yellow arrived first"; this remains interpretive language, not a verified observation or financial fact.

Every saved expression includes the validated scene and seed. If the renderer changes, old expressions keep their versioned renderer or their saved PNG. A scene is reproducible under its saved renderer; a model request is not assumed deterministic even when given the same seed.

### Generation lifecycle

1. Validate the saved managed-strategy revision or allocation draft and calculate its content ID.
2. Derive a minimal composition brief from target weights and asset count, clearly separated from current balances.
3. Request the scene with a local unique request ID associated locally with the frozen strategy ID. Neither identifier is sent to the provider.
4. Validate the scene; retry once on malformed output within a 45-second scene-stage deadline.
5. Calculate the scene hash from canonical scene data, render locally, and derive caption observations from validated geometry.
6. Request caption candidates using the validated visible observations, with a 15-second caption-stage deadline. Caption requests start after a scene exists, so the full generation budget is at most 60 seconds.
7. Apply caption diversity and length checks. One bounded caption retry shares the caption-stage deadline.
8. Save only when the user chooses an expression.

Users can cancel at any stage. "Cancel" stops local work and ignores late responses; it does not imply provider billing was reversed. A new strategy revision supersedes its active generation request. Rapid taps are coalesced into one active request per stage.

If scene generation fails, retain the last saved expression. With no saved art, show a deterministic local composition labeled "Local preview" in the editor and metadata. Failed caption generation leaves the caption blank and offers retry. A local fallback is never represented as generated by a model.

## Strategy and expression identity

### Managed strategy revision

`ManagedStrategyV2` contains exactly these top-level fields:

| Field | Rule |
| --- | --- |
| `schemaVersion` | Integer `2` |
| `kind` | Literal `managed-vault` |
| `network` | Literal `solana:mainnet-beta`; product identifier, not a CAIP claim |
| `protocol` | Literal `symmetry` for the first adapter |
| `programId`, `vaultAddress`, `shareMint` | Case-preserved base58 strings that round-trip to 32 bytes |
| `targetWeights` | 1–2 objects, exactly `mint` and `weightBps`; distinct mints excluding `shareMint`, integer positive weights summing to `10000`, sorted by case-sensitive ASCII mint bytes |
| `configDigest` | 64 lowercase hex digits binding the adapter's configuration-only projection |
| `configProjectionVersion` | New records use integer `1` for the first configuration-only field mapping/canonicalization contract; imports structurally accept positive integer versions, with unknown versions view-only |

Two assets are a presentation/integration limit, not a Symmetry protocol limit. Imported addresses are data, not allowlist authority. Never lowercase addresses. Reject unknown keys, invalid mints, duplicate mints, invalid sums, and other network/kind/schema literals. The live vault account owner must match the pinned program; its reported share mint and configuration must agree with this record before financial use.

The configuration projection includes vault target assets/weights, rebalance thresholds/timing, fees, manager authorities/permission bits, oracle configuration, relevant global fee/rule configuration, and program upgrade authority. Exclude holdings, prices, share supply, accrual balances, operational intent counters, slots, and timestamps so routine market activity does not change identity. Global fee/rule changes do change each affected revision; present one shared configuration change with per-vault differences, not repeated alarms. Upgrade authority is bound, but deployed program code is not part of this content identity. Record the programdata last-deploy slot in observation metadata; a change invalidates the release verification and disables purchases until the adapter is reverified. Canonicalize configuration integers as decimal strings where the SDK exposes values beyond safe JS integers; retain booleans and literal strings. Its exact field mapping to a pinned account layout is a required probe deliverable, `apps/android/app/src/main/java/com/coloyond/protocols/symmetry/ConfigProjection.kt`, versioned with `configProjectionVersion`. No supported mapping means no executable vault. Unknown layout/config fields that cannot be classified cause rejection rather than being silently ignored.

`configDigest = hex(SHA-256(ASCII("coloyond/VaultConfig/v1") || 0x00 || UTF8(JCS(configurationProjection))))`. The digest binds content; it is not proof that imported content was on chain. The app must recompute it from live accounts using the pinned mapping. Persist the complete validated configuration projection locally beside its revision, outside the hashable strategy record. It must reproduce `configDigest`. A saved snapshot's source slot/time is local provenance outside the hashable record. Field-level historic/live differences require this projection; with digest-only imports show "Configuration changed; details unavailable" and still require a fresh revision. Global change grouping may show a field diff only when the old projection is available. If managers alter economic settings, a freshly accepted snapshot has a new revision ID; ordinary rebalancing with unchanged settings does not.

The full strategy ID is `cb2:` plus `hex(SHA-256(ASCII("coloyond/Strategy/v2") || 0x00 || UTF8(JCS(normalizedRecord))))`. Use RFC 8785 JCS, not arbitrary JSON serialization. Stable vault lookup uses `(network, programId, vaultAddress)` separately from the content revision. The [identity vectors](../../design/coloyond-strategy-identity-vectors.json) are structural/hash fixtures with illustrative vault/share addresses and config digests, not verified vaults or evidence of keeper service. [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785)

Funding mint/amount, wallet, quotes, market/NAV prices, actual holdings, timestamps, parent attribution, and artwork are excluded. Changing vault, share mint, targets, config digest, or configuration projection version changes the ID. Caption or image edits do not. Transaction preferences are local review inputs, not the vault's investment policy.

The former `StrategyV1`/`cb1:` wallet split recipes are legacy, view-only records. Their normative validator/domain remains the [prior specification at commit 5496ae8](https://github.com/a144z/coloyond/blob/5496ae88d124a5b28b469bc6ce94c0176d364eba/docs/superpowers/specs/2026-10-09-coloyond-strategy-cards-design.md#strategy-record); do not reuse the V2 rules for them. Preserve their old validator and domain when importing; do not reinterpret them as managed vaults, infer a share mint, or execute them. Keep legacy fixtures for compatibility tests. Unknown configuration projection versions are view-only after structural/integrity checks; importing never authorizes execution.

### Expression record

The scene hash is `SHA-256(ASCII("coloyond/Scene/v1") || 0x00 || UTF8(JCS(SceneSpecV1)))`, calculated from validated scene data before rendering. It never hashes device-dependent pixels.

The exact hashable `ExpressionV1` payload contains `schemaVersion: 1`, `strategyId` (full `cb2:`, `cbd1:`, or legacy `cb1:` ID), `scene`, `sceneHash`, `rendererVersion`, `layoutVersion`, `caption` (string or null), `captionOrigin` (`model`, `user`, or `none`), `generationOrigin` (`model` or `local-preview`), and `parentExpressionId` (full ID or null). This release creates renderer and layout versions 1; import accepts positive integer versions structurally but reconstructs only supported versions. `scene` includes the seed. The top-level renderer version must match the scene's renderer version; null captions require origin `none`. It may have several local PNG exports stored outside this payload.

Hash accepted caption text exactly as stored, including Unicode, quotes, and backslashes; do not normalize caption text for identity. NFKC/case folding are diversity-comparison operations only. Reject unpaired Unicode surrogates. The identity fixtures include Unicode and escape-requiring captions verified with an independent RFC 8785 implementation.

The expression ID is `cbe1:` plus the lowercase hexadecimal digest of `SHA-256(ASCII("coloyond/Expression/v1") || 0x00 || UTF8(JCS(expressionPayload)))`. Exclude volatile created-at timestamps and optional provider diagnostics. Changing a caption, scene, seed, parent expression, or saved layout produces a new expression ID. A raw PNG can have a separate byte digest for file integrity; it is not the strategy ID. An unknown renderer or layout version preserves the validated strategy or draft and an attached PNG as a view-only expression; the client offers local regeneration rather than pretending it reconstructed the original scene.

### Provenance limits

A matching strategy hash verifies content identity, not creator identity, safety, profitability, or an executed transaction. Parent relationships are user-provided attribution; content-addressed links alone do not prove ownership. A saved scene and image do not prove how a model produced them.

A real execution receipt stores the network, transaction signature, confirmation state, strategy ID, and execution time separately. Its attribution to a strategy needs inspection of the actual transaction against the selected share mint and reviewed order. An optional block reference is execution context, not a strategy identifier.

## Storage and sharing

The native client stores records in app-private storage behind a storage interface. The web prototype stores nothing of this product. Store normalized strategies, saved expressions, caption history, parent references, and PNG blobs. Credentials are excluded from exports and persisted card data.

The portable `.coloyond.json` file contains exactly `exportVersion: 2`, `configurationSnapshot` (the configuration projection or null), `strategy` (a managed revision, allocation draft, or legacy view-only `StrategyV1` record), `strategyId`, and `expression` (validated expression or null). Expression `strategyId` must equal the enclosing ID. A non-null `configurationSnapshot` is allowed only for a managed revision with a supported projection version, validates against that pinned mapping, and must recompute its `configDigest`; mismatch rejects the entire import. Draft/legacy/unknown-projection-version exports use null. New exports include a locally available snapshot; a null snapshot remains a valid digest-only import without field-level historical diffs. Legacy export versions have a separate view-only importer. The version-2 envelope also permits a legacy record only through that legacy validator, always view-only. The file contains no PNG bytes by default. The scene permits deterministic reconstruction with the matching renderer. Limit the entire decoded import to 256 KiB, reject unknown schema versions, validate every nested object, and recompute both IDs before acceptance.

A strategy-only URL fragment carries versioned base64url-encoded strategy JSON and its ID. Keep the resulting URL below a 2000-character product limit; otherwise offer file export. The receiver validates length before decoding and validates content before rendering or executing. A fragment keeps the payload out of ordinary HTTP requests to the static host, but recipients and apps that handle the link can read it.

Native V1 imports via a configured custom scheme `coloyond://import#<versioned-base64url-payload>` and Android `ACTION_VIEW`/`ACTION_SEND` file intents. Accept bounded `content://` streams through the platform file reader; do not assume JSON arrives with a particular MIME type. The same 2000-character limit applies to scheme links. Static HTTPS fragment links are a separate option only after an import origin, working receiver, and verified Android App Links (`assetlinks.json`) are configured and tested. Until then offer file or custom-scheme export instead of inventing a live HTTPS share URL. A public static host may serve the client application; it stores no per-user strategy or artwork. The current request does not authorize publishing it.

Share sheets may accept the PNG and a strategy link or attachment together, but success means the operating system accepted the request, not that a recipient received it. Offer separate copy/export actions when a target drops an attachment. Cancellation is neutral.

Art-only screenshots cannot reliably recover an omitted strategy. An optional QR export can encode the strategy-only link once a public origin is configured. Full artwork transport remains the image or validated expression file; the URL fragment is not an art registry.

## Market swap integration and atomic boundary

Use Jupiter Swap API v2's managed order/execute flow, not a custom two-leg transaction builder. The thin client adapter requests `GET https://api.jup.ag/swap/v2/order` with `inputMint`, `outputMint`, integer base-unit `amount`, and the wallet `taker`; signs the returned transaction through Mobile Wallet Adapter; then sends `POST /swap/v2/execute` with `signedTransaction` and `requestId`. Jupiter performs routing and transaction landing. Request version 0 only in V1. Treat null/empty `transaction`, unsupported version/router, missing bounds, or unparseable instructions as unavailable, even if a quote is present. [Jupiter order and execute](https://developers.jup.ag/docs/swap/order-and-execute)

The implementation probe verifies the current API's keyless allowance and rate limits on device. Default to documented keyless access where available; if an endpoint requires a key, accept a user's session credential. Never embed a shared private API key or invent a hidden proxy. API availability is a launch gate.

Default local purchase/sale ceilings are slippage 50 bps, price impact 100 bps, and priority fee 100000 lamports. Hard product maxima are 500 bps, 500 bps, and 1000000 lamports respectively. Show base fees, rent, platform/swap fees, and their fee mint separately. Reject an order whose actual encoded limits or fee instructions exceed the selected ceilings, or whose API-reported price impact is missing, invalid, or over the selected ceiling. Reported price impact is an advisory admission check, not an on-chain constraint; encoded minimum output supplies the enforceable output/slippage bound. Do not claim to encode price impact on chain. Use documented order parameters when supported; if parameters restrict routing or produce `mode: manual`, still use `/execute` only after the probe proves that route's managed landing and validation. No silent fee/slippage loosening, transaction mutation, custom `/build` fallback, or self-broadcast service.

V1 enables only `router: metis` with the probe-verified program layouts, wallet as signature fee payer, and no missing signature slots after wallet signing. Request documented router exclusions where supported and always reject any other returned router or unknown fee-payer signer set. RFQ/JupiterZ and sponsored/extra-signer paths remain unavailable in V1. A separately versioned release manifest holds supported vaults, routers/decoders/program allowlists, keeper thresholds, ceilings, deployment verification, and tested recovery capabilities. Published manifest versions are frozen; replacements do not change strategy IDs. Runtime prices, keeper observations, reverse quotes, and receipts are stored separately, never inside this manifest. Resolve address lookup tables, inspect the full message, and simulate where the signature state permits. Review source/destination mints and token accounts, wallet recipient, exact input, encoded minimum output, fees, signers, instruction types, balances, and expiry. Default native SOL funding uses Jupiter's validated wrap/unwrap behavior; do not compose or change its cleanup instructions. Insufficient fee/rent reserve disables signing. A route requiring an unsupported decoder remains unavailable. Do not treat a successful simulation or reported quote as proof of recipient safety.

Re-read the vault configuration before showing the final review and again immediately before handing its order to the wallet. A changed or unverifiable snapshot requires accepting a fresh revision and a new review. This catches observed changes; it cannot lock manager authority or make a secondary-market swap assert off-chain configuration. Explain in financial details that managers may change settings after review/purchase. Confirmed ownership is of the actual share mint, not an immutable 60/40 promise.

The MWA sign-only probe records results for each supported wallet/version. Display that supported-wallet list, and reject wallets that mutate the reviewed message, lack sign-only support, or cannot preserve required signatures. Before `/execute`, compare returned signed **message bytes** with the reviewed bytes, validate the wallet signature, and require the supported Metis transaction to be fully signed with wallet fee payer. Its first signature supplies the transaction ID before submission. Extra-signer or RFQ orders may acquire a final fee-payer/market-maker signature only during execution; those remain excluded from V1 rather than guessed from wallet history. [Mobile Wallet Adapter](https://github.com/solana-mobile/mobile-wallet-adapter)

A single Solana market swap transaction succeeds or reverts; failed transactions can still charge fees. This guarantee covers buying/selling the share token only. It does not make vault management, auctions, primary deposits, or redemption atomic. Protocol rebalancing remains separate activity.

Persist the frozen revision, reviewed message digest, request ID, router, amounts, expiry (`lastValidBlockHeight` for enabled Metis orders), and state before switching to the wallet. Persist the wallet-signed transaction and available signatures before calling `/execute`, with no signing keys or API credentials. Signed transaction data is local sensitive storage, not an export. Recovery checks request status when the documented API supports it and reconciles any actual final transaction signature with RPC. V1 persists the fully signed transaction ID before execution and uses it for RPC recovery. Extra-signer routes cannot use this recovery contract and are disabled.

An ambiguous execute timeout enters "Checking transaction". No replacement order or automatic retry can create a second financial action. For supported Metis wallet-fee-payer orders, the persisted first signature is the independently verifiable pre-submission transaction ID; API request-status lookup is supplementary, not a required undocumented endpoint. Task 1 verifies this recovery contract. If unavailable, exclude that route from V1 rather than relying on wallet-history guesses. Permit at most one nonterminal financial action per wallet, from `awaiting-wallet` through `checking`; block further buys/sales until its outcome is confirmed, failed, or expired. Expiry alone is not proof of nonexecution: reconcile confirmed transaction/history and expiry using authoritative RPC height/time with a clock-skew margin of 30 seconds where time expiry applies. Only after establishing no execution or a failed original may a fresh user review start another order. Process death before a durable signed result also requires fresh review after reconciling any known submission.

Persist distinct states: `reviewed`, `awaiting-wallet`, `signed`, `submitting`, `checking`, `confirmed`, `failed`, and `expired`. API success is cross-checked against confirmed RPC status and actual recipient token changes before saving a receipt. If verification is unavailable, keep "Checking transaction". Configuration/keeper staleness prevents new purchase but does not by itself prevent a separately validated sale. Exits still depend on liquidity; the app never promises immediate redemption.

## Client data access

Provide `RpcConfig` with a user-supplied HTTPS RPC URL and session credential handling; an explicit optional secure-storage choice may persist it. URLs containing credentials are excluded from diagnostics, model requests, shared cards, and repository assets. A keyless public RPC may be offered as a tested default, not promised to support all methods or reliable throughput. Probe account reads, program-account access if used, transaction history/keeper classification, simulation, signature status, and confirmed transaction lookup on public and user endpoints. With no working endpoint, allow samples and local creative actions only; financial actions are disabled.

The supported-vault catalog comes from the versioned release allowlist, read afresh through `ProtocolAdapter.readVault`. Do not require runtime whole-chain scans. `readKeeperEvidence` classifies confirmed program instructions using a pinned successful-settlement classifier and tests from Task 1; generic address activity does not prove rebalancing. Insufficient/unclassifiable history means management activity unverified.

The native client draws scenes with one Compose drawing function. It runs on screen in a `Canvas` and, for export, through `CanvasDrawScope` onto a 1080 × 1350 `ImageBitmap`, so the screen and the PNG use the same geometry code. Sharing uses a `FileProvider` content URI with `Intent.ACTION_SEND` or `ACTION_SEND_MULTIPLE` and read-permission grants. If multi-file sharing fails on a target, provide independently verified single-file share actions. Register custom-scheme and bounded file intents in the manifest; verify content-URI access, JSON MIME variation, cold/warm starts, and cancellation on-device.

## Integration launch gates

The first implementation task produces a dated evidence report and separately versioned release manifest. It must pass all of these before enabling any financial action:

1. Pin a Symmetry SDK version and network/program/account layout. Identify at least one existing 1–2-asset vault; verify owner, share mint, target weights, authorities, fees, rebalance rules, global configuration, and relevant upgrade authority. Publish the exact configuration projection mapping and fixtures. Symmetry's SDK is TypeScript, so the Kotlin client reads vaults with a read-only, pinned IDL/account decoder over RPC. Run the pinned SDK off-device, as development tooling only, to produce fixtures; the Kotlin decoder must reproduce them exactly. The decoder adds no execution service, and no SDK code ships in the app. If no viable vault meets this scope, keep the creative app available and document the unmet gate.
2. Record valid protocol NAV reads and independently check share-mint market-price availability. Neither source substitutes for the other. All reads used in review must be at most 60 seconds old; NAV additionally requires the protocol's own oracle freshness conditions. Cache data is labeled with time/source and cannot pass fresh review checks.
3. Record successful existing keeper activity for that vault and a source-grounded expected cadence. The published release manifest includes `maxKeeperEvidenceAgeSeconds` as an integer 60–604800 chosen from those rules/history; a missing threshold means unsupported. Use it for the stale-management purchase gate. Activity proves observation, not a future guarantee.
4. Establish read-only Jupiter entry and reverse quote feasibility at documented demo amounts and supported Metis decoding/sign-only compatibility. Recovery evidence initially consists of the API contract plus deterministic timeout fixtures. A separately authorized funded buy and sell for the enabled route is a hard prerequisite before financial actions become available; record the actual on-chain signatures and reconciliation results. A quote is not evidence that a funded smoke test passed. Every order and reverse quote is checked afresh. Before each purchase review, request a reverse quote for its expected share-token output using the actual share mint. Require a route and reported impact within the local ceiling, with the same 60-second freshness limit. This is quote-only indicative exit liquidity, not a signed sale transaction or guarantee. Missing reverse route disables purchase.
5. Run native SDK, wallet, and packaging/intent probes, public/user RPC method probes, no-key/key-required API access checks, and honest offline fallbacks. No backend, new contracts, own keeper, or shared secrets may be introduced to make a failed gate appear to pass.

The gates are implementation work, not completed evidence. Symmetry's SDK docs identify `SymmetryCore`, `fetchAllVaults`, `fetchVault`, `loadVaultPrice`, and `vault.formatted` as starting points. Treat these as documented candidates until the pinned package confirms their exact signatures/units; they are used off-device to produce decoder fixtures. Alternative protocols require a separate explicit adapter/policy; a concentrated-liquidity vault must not be described as maintaining fixed target weights merely because it exposes two assets.

## Repository integration

The existing application is a React/Vite cross-chain routing prototype. `src/ui/App.tsx` owns swap, route, and simulated execution views. `src/types.ts` describes routes rather than reusable strategies. `src/routeService.ts` uses a fixed EVM sender. `src/ui/data.ts` supplies sample balances and synthetic hashes. `src/ui/ExecutionView.tsx` advances through timed simulated steps. These paths cannot establish confirmed Solana execution or cross-chain rollback.

The hackathon runtime is the native Kotlin + Jetpack Compose Android app in `apps/android`, using the Mobile Wallet Adapter Kotlin client library. The Vite app remains a separate browser presentation prototype and shares no code with it. Keep schema, hashing, scene validation, caption rules, protocol decoding and order validation in plain Kotlin packages that import no `android.*` API, so JVM unit tests cover them; keep storage, rendering/export, intents, networking and the wallet in platform packages. Before substantial feature implementation, a thin native probe must open on a device, share a PNG, import a strategy file/link, and confirm the target wallet's sign-only support. MWA also supports mobile-web integrations; this runtime choice is a product decision rather than a claim that native is its only option.

The [implementation plan](../plans/2026-10-09-coloyond-managed-strategies.md) defines the Kotlin package layout, the tests, and the exact integration tasks. Preserve the existing Vite app as a labeled routing presentation prototype. Do not reuse EVM sender defaults, simulated balances/signatures, or timed success states for Solana financial features.

Product code, dependencies, native scaffolding, live vault probes, and deployment are subsequent implementation work; this revision changes documentation and the offline design artifact only.

## Validation and acceptance

| Area | Required evidence |
| --- | --- |
| Identity | Reordered object keys and normalized target-weight order yield the same ID; changed configuration/vault changes it; new art, caption, amount, or quote does not |
| Generation | A live configured model produces distinct validated scenes; changing strategy during generation cannot attach a stale result |
| Captions | Length limits, recent repetition, empty results, user edits, and art-specific grounding work; caption failure never blocks sharing saved art |
| Rendering | Saved scenes reproduce their geometry and grain with their renderer version; text stays readable with caption present or absent |
| Sharing | PNG and strategy file export work without a backend; import recomputes IDs; strategy-only links do not pretend to recover the original art |
| Remix | Parent remains immutable; selecting a different vault changes the ID; draft weights cannot mutate a live vault |
| Client boundary | No bundled shared private key; private wallet data is absent from generation requests and portable files |
| Execution | Every enabled purchase/sale uses a validated Jupiter order and wallet review; unsupported routes stay disabled; no fabricated NAV, keeper evidence, signatures, or confirmations. Hackathon release: all purchase/sale controls disabled |
| Glider handoff | Listed percentages equal the record's basis points ÷ 100 and total 100.00; the opened URL carries no allocation or identifier; the disclaimer appears before Glider opens; the card and its ID are unchanged afterwards |
| Recovery | Cancelled generation, unavailable inference, dropped share attachments, expired quotes, denied signatures, and ambiguous RPC responses have truthful states |
| Mobile | Core controls work at 360–430 px widths; touch targets, screen-reader labels, contrast, and reduced-motion behavior are checked |

Verify strategy hashing, import validation, generation concurrency, and Jupiter transaction validation with meaningful automated checks during implementation. Review visual variation and caption quality manually across at least 12 expressions, including repeated generation of the same strategy and several remixes. Review on two Android devices before describing the native sharing and wallet flow as complete.

## Delivery order

1. Verify the existing protocol/vault, configuration projection, pricing, keeper coverage, Jupiter routes/recovery, and native wallet/intent feasibility. (Done for Symmetry and Jupiter: gates 3 and 4 fail.)
2. Ship shared identity/import contracts and a native client that shows read-only vaults or saves explicit drafts, with local persistence.
3. Add live scene generation, optional diverse captions, deterministic rendering, saved expressions, PNG sharing, immutable remix provenance, and the manual "Follow with Glider" handoff. This is the hackathon release.
4. After the hackathon: decide how to hold a Glider partner key, then add one-tap Glider enrollment, or enable a validated market purchase and sale if a protocol later passes all financial gates.

The hackathon release expresses and shares allocations. Execution through Glider's API, further protocol adapters, and primary deposit/redemption flows follow only after the core experience works end to end.
