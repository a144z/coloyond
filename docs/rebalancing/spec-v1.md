# Coloyond on-chain strategy amendment v1

**Status:** interface and product-scope freeze for unfunded implementation only. The Sprint 0 admission gate is **not passed**. No funded UI, asset admission, deployment, or mainnet operation is authorized by this document.

**Review basis:** Sprint 0 evidence packages A–E, the reviewed card specification and managed-strategy plan, and [the portfolio rebalancing plan](../product/onchain-portfolio-rebalancing-plan.md). This amendment changes only the earlier hackathon restriction on a Coloyond vault/keeper and the Symmetry/Jupiter financial execution path. The old creative experience remains in scope.

## Product and compatibility decision

The product loop remains: choose a published strategy or make a draft → generate a validated scene and optional caption → save an immutable expression → export/share/import → remix. A card, import, caption, image, strategy hash, keeper, SDK, or server never authorizes custody or a financial transition. The only initially contemplated funded product is a separately reviewed, curated, pooled two-asset WSOL/USDC vault with proportional deposits and oracle-independent in-kind exits. The exact asset admission remains conditional; the UI must describe it as unavailable until the evidence gate passes. User-specific vaults, additional assets, and personal escrow orders remain Sprint 8, Sprint 7, and Sprint 9 respectively.

Retain these records byte-for-byte and with their current meanings: `cb1:` legacy view-only, `cbd1:` allocation draft (`coloyond/Draft/v1\0`), `cb2:` Symmetry `ManagedStrategyV2` (`coloyond/Strategy/v2\0`), `cbe1:` `ExpressionV1` (`coloyond/Expression/v1\0`), and portable export v2. Never reinterpret them as Coloyond custody records. The three historical expression vector raw objects disagree with their canonical JSON at `strategyId` and `sceneHash`; do not use them as golden inputs until reconstructed from canonical JSON and independently rehashed.

## New identity envelope

Freeze new, non-overlapping record versions:

| Record | Prefix/version | Domain-separated identity |
|---|---|---|
| Coloyond published strategy snapshot | `cb3:` / `ColoyondManagedStrategyV1` | SHA-256(`coloyond/ColoyondManagedStrategy/v1\0` || RFC 8785 canonical UTF-8 JSON) |
| Coloyond expression | `cbe2:` / `ColoyondExpressionV2` | SHA-256(`coloyond/ColoyondExpression/v2\0` || RFC 8785 canonical UTF-8 JSON) |
| Portable export | `exportVersion: 3` | Envelope carries the exact typed record; it is not an alternate identity domain |

The `cb3:` canonical JSON has exactly these keys and no extras: `schema`, `cluster`, `genesisHash`, `programId`, `vaultAddress`, `shareMint`, `configurationRevision`, `tokens`, `policyDigest`, and `sourceManifestRevision`. `schema` is `coloyond/ColoyondManagedStrategy/v1`; cluster is `mainnet-beta`, `devnet`, or `localnet`; `genesisHash` and `policyDigest` are lowercase 64-character hex; public keys are canonical base58 32-byte keys. `configurationRevision` is a positive canonical decimal u64 string. `sourceManifestRevision` is the string `"1"` for this revision. `tokens` contains exactly two entries with exactly `mint`, `tokenProgram`, `decimals`, and `targetBps`; sort by decoded unsigned raw mint bytes, require distinct mints, decimals 0–18, target bps 1–10,000 totaling exactly 10,000, and exclude the share mint. No ticker-only identity, floating point, omitted default, null, or unknown field is accepted. IDs are lowercase hex with the specified prefix. Strategy identity excludes art, caption, wallet, actual holdings, price, NAV, order size, and execution receipt. A new policy/configuration revision creates a new strategy ID.

The `cbe2:` canonical JSON has exactly the ten v1 expression keys (and no extras): `schemaVersion` (integer `2`), `strategyId` (cb3 only), `scene`, `sceneHash`, `rendererVersion`, `layoutVersion`, `caption`, `captionOrigin`, `generationOrigin`, and `parentExpressionId`. The scene is the existing validated `SceneSpecV1`; its hash and renderer/layout rules remain unchanged. Renderer/layout versions are positive integers and the expression renderer must equal the scene renderer. Caption is null or at most 80 Unicode code points; it is null exactly when `captionOrigin` is `none`. Generation origin is `model` or `local-preview`. Parent is null or a complete valid `cbe1:`/`cbe2:` ID. Domain is `coloyond/ColoyondExpression/v2\0`. Export v3 keeps the exact export-v2 outer key set and validation limits, changes `exportVersion` to 3, permits only cb3 strategy plus matching cbe2 expression (or null), and uses `configurationSnapshot: null` until an exact supported projection and digest validator is implemented. Export v2 imports with a non-null snapshot likewise require the existing exact pinned projection validator; unsupported snapshots are rejected rather than accepted as arbitrary JSON. Old import paths retain their old validators. Import/remix is inspect-only until a separate explicit deposit action selects a currently verified published strategy revision and independently reviews amounts and transaction details.

## Frozen financial invariants

1. The program alone enforces asset/program/feed identity, oracle verification/age/confidence/depeg bounds, configuration revision, trigger predicates, inventory, prices, fill sizes, fees, bounty caps, accounting, pause, and exits. No keeper or backend can satisfy a missing predicate.
2. Entry is proportional to current backing and checks user `maxAmountsIn` and `minSharesOut`; target weights never mean a user budget split. Initialization/first seed is atomic and protects against donation/inflation. Direct donations must be deterministically synchronized or cause deposit/exit to reject.
3. Exit burns shares and transfers proportional unencumbered assets in one transaction without oracle, keeper, auction, or price freshness. Risk pause never disables that path. Transfer failure rolls back the entire instruction.
4. Every price-gated transition uses pinned, fully verified Pyth data and rejects stale, nonpositive, overly uncertain, depegged or divergent inputs. No last-known price is executable. Increasing `publish_time` is required for separate condition observations.
5. Each auction fill is atomic and permissionless, bounded by inventory, remaining size and oracle-relative loss limits, cannot overshoot, and must reduce drift after all fees/bounty. The lifecycle may span multiple fills; there is no claim of whole-rebalance atomicity or guaranteed fills.
6. Reserves are vault-owned accounting with explicit holder backing and outstanding bounty liabilities. Only disclosed incoming-asset fees accrue; only an earned, capped bounty may be paid. No admin sweep exists. Financial fee/bounty numbers remain unapproved until S4 economics and approval.
7. Program upgrade authority is outside Anchor instruction checks. It must be governed by a separately verified multisig/timelock or revoked before public custody. Emergency pause stops new risk but preserves exit.
8. Android must persist a typed pending action before wallet handoff and confirm the actual chain effects before success. Current physical wallet/sign-only/origin capability is unproven, so funded controls remain disabled. Browser is read-only and labels fixtures as fixtures.

## Unresolved evidence and gate

S0B, S0D and S0E are **not passed**: public RPC DNS failure prevented finalized mint/feed account inspection and executable route/depth checks; no real wallet, verified app origin, or two independent keeper/pusher operators were demonstrated. S0C recommends custom Anchor as the provisional design because no alternative is evidenced to satisfy all invariants, not because it is proven safer. No exact program deployment/authority, fee schedule, confidence/age/depeg thresholds, bounty amount, minimum liquidity, or pilot cap is frozen here. Those values must be derived from the named evidence and later sprint gates, never guessed to make a demo pass.

Therefore this revision freezes only the product boundary, record tags and high-level safety contract. S1 may implement unfunded accounting/governance/client primitives with placeholders prohibited from funded execution. S1F must pin the actual IDL before S2. An operator with working RPC access must close account-state, route/depth, authority, and wallet evidence before any funded Devnet path is enabled. Any changed asset or trust boundary requires a new manifest/spec revision and review.

## Decision record

| Decision | Frozen result | Evidence / status |
|---|---|---|
| Core custody | Minimal Coloyond Anchor vault; bounded permissionless auction | S0C conditional architecture choice; implementation/audit risk remains ours |
| Initial assets | Classic SPL WSOL + Circle-native USDC, provisional only | S0B identifiers sourced; authorities/live state/depth unverified; entry disabled |
| Oracle | Pyth SOL/USD + USDC/USD fixed accounts; require Full verification | Feed IDs/accounts source-identified; live state/pusher path not proven |
| Existing SDKs | Symmetry/SVS/Folio are comparators/research; no SDK gets authority | S0C and S0D evidence; no route/deployment assumption |
| Mobile signing | No funded path until real wallet, identity and recovery proof | S0E not passed |
| Mainnet | No deployment, custody, pilot or amount selected | Separate audited release gate and explicit approval required |
