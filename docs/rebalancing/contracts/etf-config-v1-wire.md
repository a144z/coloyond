# ETF v1 canonical config wire schema

**Status:** S5A schema baseline; synthetic vector only. This specifies the outer config encoding and identity domain. It does not freeze asset admissions, authority keys, feed selection, fee/risk values, or the inner fee/risk policy formats. Do not use the fixture as a deployment manifest.

## Encoding rules

`EtfPoolConfigV1` is Borsh-encoded with fields in exactly this order:

| Field | Wire type | Encoding |
|---|---|---|
| `protocol_version` | `u8` | Must be `1`. |
| `assets` | `Vec<EtfAssetConfigV1>` | `u32` little-endian count followed by ordered entries; current contract admits two or three assets. |
| `math_version` | `u16` | Little-endian. |
| `fee_policy_id` | `[u8; 32]` | Raw bytes, not base58 or hex text. |
| `fee_policy_params` | `Vec<u8>` | `u32` little-endian byte length followed by opaque bytes. Inner schema and bounds must be frozen by the reviewed S5D2 amendment before S5E. |
| `risk_policy_id` | `[u8; 32]` | Raw bytes, not base58 or hex text. |
| `risk_policy_params` | `Vec<u8>` | `u32` little-endian byte length followed by opaque bytes. Inner schema and bounds must be frozen by the reviewed S5C/S5A amendment before S5E. |
| `governance_delay_seconds` | `u64` | Little-endian. |

Each `EtfAssetConfigV1` is encoded in the following order:

| Field | Wire type | Encoding |
|---|---|---|
| `mint` | `[u8; 32]` | Decoded address bytes. |
| `token_program` | `[u8; 32]` | Decoded address bytes. |
| `decimals` | `u8` | Integer token precision. |
| `oracle_mode` | Borsh enum | `0 = PushFeed`, `1 = ReceiverFull`; never reorder or reuse tags. |
| `oracle_program` | `[u8; 32]` | Decoded program address bytes. |
| `oracle_account` | `[u8; 32]` | Decoded feed/update account address bytes. |
| `feed_id` | `[u8; 32]` | Raw Pyth feed ID bytes, not hexadecimal text. |
| `target_weight_bps` | `u16` | Little-endian basis points. |

Struct fields concatenate without names, alignment, padding, or terminators. No strings, maps, floats, booleans, options, base58 address text, or duplicated asset count are serialized. The identity baseline enforces v1, two or three assets, unique mints, and a 10,000-bps weight sum. It deliberately imposes no per-asset minimum weight; the separate S5B math candidate's 100-bps floor remains subject to review. Decoders must reject unsupported versions, invalid asset count/weight constraints, malformed enum tags, truncation, and trailing bytes. The Rust decoder requires each caller to supply an explicit input-size ceiling; S5A has not selected the production account/config size limit. Authority keys are pool-state governance fields and are intentionally outside the economic config hash.

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

The domain prefix is raw UTF-8 bytes with no Borsh string length, separator, or NUL terminator. A Solana PDA address also depends on the program ID and bump, so no PDA address is asserted until the ETF program ID is pinned. The fixture records only seed inputs.

## Fixture and implementation boundary

[`etf-config-v1-identity-fixture.json`](etf-config-v1-identity-fixture.json) is a deterministic synthetic two-asset vector with deliberately patterned keys/feed IDs and opaque policy bytes. Rust and Python independently encode it and compare the complete bytes, hash, strategy ID, and pool seed inputs. It proves wire agreement only. Production fee/risk payloads require strict typed schemas and validation before a program can consume them.

The modular encoder lives in [`crates/etf-identity`](../../../crates/etf-identity/). It owns only config identity; math, oracle parsing, custody, Anchor instructions, wallet clients, and scheduler logic remain separate packages.
