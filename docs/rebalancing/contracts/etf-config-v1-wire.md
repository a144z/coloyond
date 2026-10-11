# ETF v1 canonical config wire schema

**Status:** S5A draft; synthetic vector only. The outer field order commits the shape of the initial governance and guardian authorities, but their literal values, asset admissions, feed selection, fee/risk values, and inner fee/risk policy formats are not approved. Do not use the fixture as a deployment manifest.

## Encoding rules

`EtfPoolConfigV1` is Borsh-encoded with fields in exactly this order:

| Field | Wire type | Encoding |
|---|---|---|
| `protocol_version` | `u8` | Must be `1`. |
| `assets` | `Vec<EtfAssetConfigV1>` | `u32` little-endian count followed by ordered entries; current contract admits two or three assets. |
| `math_version` | `u16` | Little-endian. |
| `fee_policy_id` | `[u8; 32]` | Raw bytes, not base58 or hex text. |
| `fee_policy_params` | `Vec<u8>` | `u32` little-endian byte length followed by opaque bytes. S5D2 supplies reviewed economics evidence and a candidate amendment; S5A freezes the accepted inner schema and bounds before S5E. |
| `risk_policy_id` | `[u8; 32]` | Raw bytes, not base58 or hex text. |
| `risk_policy_params` | `Vec<u8>` | `u32` little-endian byte length followed by opaque bytes. S5C supplies oracle-mode/parser evidence and identifies risk-policy inputs; S5A freezes the accepted inner schema and bounds after reviewing those inputs before S5E. |
| `initial_governance_authority` | `[u8; 32]` | Initial governance pubkey bytes. Must be nonzero and distinct from the guardian. |
| `initial_emergency_guardian` | `[u8; 32]` | Initial guardian pubkey bytes. Must be nonzero and distinct from governance. |
| `governance_delay_seconds` | `u64` | Little-endian. |

Each `EtfAssetConfigV1` is encoded in the following order. In this schema `oracle_account` is a stable key committed to pool identity for either mode. `ReceiverFull` does not represent a per-transaction ephemeral update; supporting ephemeral keys requires a future schema that authenticates the runtime account binding separately.

| Field | Wire type | Encoding |
|---|---|---|
| `mint` | `[u8; 32]` | Decoded address bytes. |
| `token_program` | `[u8; 32]` | Decoded address bytes. |
| `decimals` | `u8` | Integer token precision. |
| `oracle_mode` | Borsh enum | `0 = PushFeed`, `1 = ReceiverFull`; never reorder or reuse tags. |
| `oracle_program` | `[u8; 32]` | Expected owner of the stable, manifest-pinned `PriceUpdateV2` account (Pyth Pull Oracle Receiver). This is not the fixed-feed PDA derivation program. ETF v1 requires a stable account key committed in `oracle_account`; `ReceiverFull` means that stable account must have Full verification. Ephemeral per-transaction update accounts are not admitted by this schema and require a future version that moves the runtime account key outside immutable pool identity. For `PushFeed`, derive the stable account using the separately pinned Pyth Push Oracle program and shard/feed seeds. |
| `oracle_account` | `[u8; 32]` | Decoded feed/update account address bytes. |
| `feed_id` | `[u8; 32]` | Raw Pyth feed ID bytes, not hexadecimal text. |
| `target_weight_bps` | `u16` | Little-endian basis points. |

Struct fields concatenate without names, alignment, padding, or terminators. No strings, maps, floats, booleans, options, base58 address text, or duplicated asset count are serialized. The identity baseline enforces v1, two or three assets, unique mints, a 10,000-bps weight sum, and two nonzero, distinct initial authority keys. It deliberately imposes no per-asset minimum weight; the separate S5B math candidate's 100-bps floor remains subject to review. Parameterized S5B core-math review may proceed before final S5A policy freeze; it does not choose the production weight floor or other config values. Decoders must reject unsupported versions, invalid asset count/weight/authority constraints, malformed enum tags, truncation, and trailing bytes. The Rust decoder requires each caller to supply an explicit input-size ceiling; S5A has not selected the production account/config size limit.

## Content identity

```text
config_hash = SHA-256(UTF8("coloyond:etf:config:v1") || Borsh(EtfPoolConfigV1))
strategy_id = "etf1:" || lowercase_hex(config_hash)
pool seeds  = [UTF8("etf_pool_v1"), config_hash]
asset seeds = [UTF8("etf_asset_v1"), pool_pda_bytes, [asset_index_u8]]
authority   = [UTF8("etf_authority_v1"), pool_pda_bytes]
share mint  = [UTF8("etf_share_v1"), pool_pda_bytes]
custody     = [UTF8("etf_custody_v1"), pool_pda_bytes, [asset_index_u8]]
```

The domain prefix is raw UTF-8 bytes with no Borsh string length, separator, or NUL terminator. Because the initial governance and guardian keys are fields in `EtfPoolConfigV1`, they are committed by the config hash, strategy ID, and pool PDA seed. Different authority tuples therefore produce different pool identities. Current authorities can later rotate only through the delayed handoff instruction; the original config hash remains an immutable record of the initial tuple. A Solana PDA address also depends on the program ID and bump, so no PDA address is asserted until the ETF program ID is pinned. The fixture records only seed inputs.

Pool creation is permissionless and the signer is only the rent payer. The on-chain initializer must accept one typed canonical config, recompute its full hash, validate both authorities, and derive every account from that config; it must not trust a supplied digest or a parallel authority tuple. Any caller may create the exact config-derived pool; a caller cannot initialize that same PDA with substituted authorities or economics. A client must recompute the manifest identity, compare the fetched immutable config and initial-authority commitment, and validate current governance/guardian keys against the accepted authority state before offering seed/deposit actions. It must allow a valid delayed handoff to change current role keys without changing the original config hash or pool PDA. If another caller creates the exact approved pool first, the client reads and verifies that state and continues; a different tuple has a different PDA.

The program implementation must also handle deterministic PDA pre-funding safely: a third party may transfer lamports to a known PDA before initialization. S5E must prove such an account can still be initialized or returns a safe, recoverable result; it must reject non-system-owned or nonempty conflicting accounts without accepting substituted state. Exact initialized-pool retries must return verified existing state or a clean `already initialized` error. This is an implementation gate, not proven by the encoder fixture.

## Fixture and implementation boundary

[`etf-config-v1-identity-fixture.json`](etf-config-v1-identity-fixture.json) is a deterministic synthetic two-asset vector with deliberately patterned keys/feed IDs and opaque policy bytes. Rust, Python, and a test-only TypeScript encoder independently compare the complete bytes, hash, strategy ID, and pool seed inputs. The TypeScript result is recorded in [S5A identity evidence](../evidence/s5-identity.md); no Kotlin adapter vector exists yet. The earlier provisional vector hash `0852ddf87df71fb53c07f235c4afbf11c4593ced710807ac208427b0c10ecf72` omitted authority keys and is superseded; its `etf1:` ID is not canonical or deployable. No ETF program has been deployed, so there is no on-chain migration. The current vector also proves wire agreement only. Production fee/risk payloads require strict typed schemas and validation before a program can consume them.

The modular encoder lives in [`crates/etf-identity`](../../../crates/etf-identity/). It owns only config identity; math, oracle parsing, custody, Anchor instructions, wallet clients, and scheduler logic remain separate packages.
