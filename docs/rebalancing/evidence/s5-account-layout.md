# S5A bounded account-layout sizing evidence

**Status:** independent structural sizing and serialization check passes. The account names, field order, and caps below are an unaccepted S5A proposal for review; they do not freeze the IDL, select protocol policy, or authorize S5E.

The existing identity vector serializes to 486 config bytes (two assets, 3 fee-policy bytes, and 4 risk-policy bytes) and still matches the shared canonical `configBytesHex`. The proposed schema caps each opaque policy vector at 256 bytes and admits two or three assets. Checked sizing gives a maximum canonical config of 1,155 bytes. The candidate Anchor allocations, including each eight-byte discriminator, are:

| Proposed account | Allocation | Calculation |
|---|---:|---|
| `EtfPoolV1` | 1,265 bytes | `8 + 1 + 1 + 32 + 4 + 1,155 + 32 + 32` |
| `EtfPoolStateV1` | 300 bytes | `8 + 1 + 1 + 32 + 32 + 32 + 1 + 1 + 8 + 44 + 49 + 82 + 1 + 8` |
| `EtfAssetStateV1` | 59 bytes | `8 + 1 + 1 + 32 + 1 + 16` |
| Classic SPL Mint | 82 bytes | Fixed classic SPL layout |
| Classic SPL Token Account | 165 bytes | Fixed classic SPL layout |

The immutable pool record stores the config vector with its actual Borsh u32 length, hash, share-mint key and non-authoritative initializer. The mutable pool-state PDA stores the current authority roles, lifecycle/pause/sequence, optional bounded observation and governance proposals, and `scheduler_enabled` plus monotonic `scheduler_generation`. Every optional payload has a fixed maximum Borsh size. `Option::None` writes only its one-byte tag, so all-`None` state serializes to a 128-byte prefix; all-`Some` reaches 300 bytes. Borsh/Anchor readers may ignore allocation tail bytes, and ordinary shorter serialization does not guarantee stale-tail clearing. S5E must zero-fill the state account before serialization and verify the unused tail is zero, with readback coverage for each `Some -> None` transition. Per-asset mutable state stores only the checked cumulative-fee counter; asset identity is read from config, avoiding a duplicate mutable copy. The candidate design increments generation in the same instruction/transaction that holds exclusive writable access to the pool-state PDA; stale/disabled `scheduled_poke(expected_generation)` is proposed to succeed without modifying observation or sequence, and generation overflow fails closed rather than wrapping. Authority for generation changes, pause/close invalidation, and exact sequence advancement remain open. See the detailed field order and encoding table in [the S5A wire contract](../contracts/etf-config-v1-wire.md#bounded-lengths-and-account-allocations-s5a-structural-candidate).

The checker uses only Python's standard library and independently encodes and decodes the canonical config fixture. It verifies proposed Anchor discriminator derivations and the declared account field order/widths and size sums against the machine-readable [layout fixture](../contracts/etf-account-layout-v1-fixture.json), accepts the exact three-asset/256-byte-per-policy maximum config boundary, and rejects an over-cap payload, truncation, trailing bytes, unsupported asset count, invalid oracle tag, and oversized/truncated length-prefixed config vector. It does not serialize the proposed Anchor account structs or exercise their `Option` or boolean encodings; those remain S5E implementation tests.

## Validation

- `python3 tools/rebalancing/etf-account-layout/check_etf_account_layout.py` — passed; canonical 486-byte fixture matches, 1,155-byte maximum accepted, expected allocations recomputed, malformed and oversized inputs rejected.
- `git diff --check` — passed.

This check is not an Anchor account deserializer, generated-IDL comparison, SBF allocation test, rent calculation, or on-chain transaction. The Anchor type names/discriminators and fixed allocations must be confirmed against the actual generated IDL before S5E. Existing Rust identity and Python read-model tests are run separately as regression checks. The 256-byte parameter caps are structural ceilings only and must be retained or amended when S5A freezes strict inner policy schemas. Oracle freshness/confidence/asset backing, fee/quote/risk bounds, exact authority/deployment values, scheduler execution and external availability, economics, Kotlin agreement, program security and Devnet wallet/RPC/transaction proof remain open.
