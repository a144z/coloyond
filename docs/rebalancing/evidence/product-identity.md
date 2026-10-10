# Sprint 0A — product and identity evidence

**Base:** `c142f14b768cf02707d33a96e30d00d2bf020e2b`
**Status:** evidence inventory complete; the new versioned amendment is not yet frozen.
**Scope:** old card/identity compatibility and its boundary to the new Coloyond vault. This is a product contract note, not protocol approval.

## Source-of-truth findings

The reviewed [card specification](../../superpowers/specs/2026-10-09-coloyond-strategy-cards-design.md) and [managed-strategy plan](../../superpowers/plans/2026-10-09-coloyond-managed-strategies.md) already define the creative product in detail:

- A person may select a verified managed strategy or create a desired-weight draft, generate a validated abstract scene and optional caption, save an immutable expression, export a deterministic PNG/record, import it strictly, and remix either the image or weights.
- A saved card is historical content. Target weights and source/network are factual; artwork/caption are interpretation. Current target, actual composition, NAV, market price, and executable quote are distinct observations.
- Draft or imported content does not create a vault, prove ownership, or authorize a transaction. An exact match to a separately verified published vault and fresh financial review are needed for financial use.
- Hashes identify canonical content, not creator, safety, profitability, custody, or execution. Receipts are separate records tied to inspected chain transactions.
- Identity uses RFC 8785 JCS and null-terminated domain-separated SHA-256. Stable strategy identity omits art, caption, actual balances, prices, wallet, amount and quote. Expression identity includes its strategy ID, validated scene/hash, renderer/layout, exact caption, origin and parent.
- Records and validation are pure Kotlin; rendering, storage, wallet and Android intents are platform code. Credentials/holdings/signatures do not enter card exports or model prompts. Import is strict, bounded, recomputes IDs and yields inspect/view-only capability, never executable authority.
- The manual Glider handoff is still part of the older creative journey: show full mint and exact percentages plus the disclaimer, copy only after a tap, open the bare Glider URL, and record no result. It must not be implied to create or fund anything.

## Compatibility boundary

Preserve these old record domains and meanings byte-for-byte:

| Record | Existing identity | Required treatment |
|---|---|---|
| Legacy `StrategyV1` wallet-split recipe | `cb1:` | Historical/view-only; never infer a share mint or execute. |
| `AllocationDraftV1` | `cbd1:`, domain `coloyond/Draft/v1\0` | Desired weights only; never a vault or funded target. |
| `ManagedStrategyV2` | `cb2:`, domain `coloyond/Strategy/v2\0` | Existing Symmetry-bound format. Do not reinterpret its protocol/program/vault fields as Coloyond. |
| `ExpressionV1` | `cbe1:`, domain `coloyond/Expression/v1\0` | Old schema accepts cb1/cbd1/cb2 IDs; keep its validator and historical import behavior. |
| Portable export v2 | `exportVersion: 2` | Keep its exact envelope and legacy view-only handling; do not silently add Coloyond fields. |

The on-chain product needs a separate, versioned Coloyond managed-strategy schema and matching expression/export envelope. The checklist's `cb3:`, `cbe2:`, and export v3 are reasonable *proposals*, not yet frozen tags. S0F must choose exact record names, fields, domain strings, and prefixes. New records must bind network, program, vault, share mint, target weights, policy/configuration revision and its supported projection digest. Do not widen an old schema or make old cards executable. A target/policy change creates a new financial identity; art/caption changes do not. Actual balances, prices, oracle times, fee accrual and execution receipts remain outside the strategy hash.

**Recommended mapping:** a published vault configuration may be represented as a managed strategy; a user-selected but unpublished configuration remains an allocation draft. Creating/remixing/importing a card performs no on-chain action. Deposit is a separate explicit action that names the exact published revision and uses proportional basket inputs, not the allocation weights as a budget split. Any future policy change by governance is a new revision; an old card keeps its prior snapshot and is view-only for deposits until the user accepts a current verified revision.

## Historical fixture integrity check

Recomputed the three `expressionVectors` in `docs/design/coloyond-strategy-identity-vectors.json` with SHA-256 over `coloyond/Expression/v1\0` plus each listed canonical JSON byte string:

| Fixture | Raw object agrees with canonical JSON? | Listed expression ID agrees with canonical digest? |
|---|---:|---:|
| `saved-caption` | No: `strategyId` and `sceneHash` differ | Yes |
| `changed-caption` | No: `strategyId` and `sceneHash` differ | Yes |
| `unicode-and-escaped-caption-exact-storage` | No: `strategyId` and `sceneHash` differ | Yes |

The canonical payloads contain strategy ID `cb2:1ba29cfe…2d9548c4` and scene hash `9af5c984…47c0712c`; each raw expression object instead contains `cb2:17bf082e…f8598589` and `9990f6c4…1fdb86`. This is a fixture-object inconsistency, not evidence that the listed expression digest is wrong. Before importing them as golden tests, reconstruct each raw object from its canonical payload and independently recompute the strategy and scene IDs. Preserve old valid strategy/hash vectors. Do not “fix” the problem by weakening nested-ID validation or changing domain strings.

Reproducible read-only check run from the repo root:

```python
import hashlib, json
v = json.load(open("docs/design/coloyond-strategy-identity-vectors.json"))
for x in v["expressionVectors"]:
    raw, canonical = x["expression"], json.loads(x["canonicalJson"])
    digest = hashlib.sha256(b"coloyond/Expression/v1\0" + x["canonicalJson"].encode()).hexdigest()
    print(x["name"], raw["strategyId"] == canonical["strategyId"],
          raw["sceneHash"] == canonical["sceneHash"], "cbe1:" + digest == x["expressionId"])
```

All three rows produced `False, False, True`.

## Current implementation gap

The repo confirms that this product is not yet implemented end to end. Android has a fixed probe card, PNG export, app-private FileProvider share, bounded import-intent read, a wallet demo, and a Symmetry V3 decoder. It does not yet have the strategy/draft schema and JCS validator, expression persistence, inference adapter, full renderer/storage, strict portable-record parser, user-facing create/share/import/remix flow, or manual Glider screen. The README and HANDOFF identify those gaps. Do not count the probe JSON as a strategy record, the fixed scene as live model generation, or a share-sheet opening as a completed recipient share.

The existing `/reference/` HTML/PNG remain design references. Their example jupSOL/USDC allocation is illustrative, not a Coloyond vault, and must never seed a live asset catalog.

## S0A decision

**Pass with an explicit compatibility blocker for S0F:** the old creative product and custody boundary are sufficiently documented to carry forward. The contradictory three expression fixture objects must be reconciled before they become identity golden tests. S0F must publish the explicit versioned exception to the old no-contract/no-keeper hackathon scope and freeze a wholly separate Coloyond strategy/expression/export version before any downstream financial implementation.

### Evidence reviewed

- [Reviewed card spec](../../superpowers/specs/2026-10-09-coloyond-strategy-cards-design.md), especially “Strategy and expression identity,” “Storage and sharing,” “Remix,” “Follow with Glider,” and client/privacy requirements.
- [Managed-strategy implementation plan](../../superpowers/plans/2026-10-09-coloyond-managed-strategies.md), especially global constraints and Tasks 2, 3, 5–7.
- [Handoff](../../HANDOFF.md), [Android README](../../../apps/android/README.md), [identity vectors](../../design/coloyond-strategy-identity-vectors.json), [design reference](../../design/coloyond-strategy-cards.html), [dated Symmetry/Jupiter probe](../../integrations/2026-10-09-symmetry-jupiter-probe.md), and [reviewed UI plan](../../design/ui-reform-plan.md).
