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

Struct fields concatenate without names, alignment, padding, or terminators. No strings, maps, floats, booleans, options, base58 address text, or duplicated asset count are serialized. The identity baseline enforces v1, two or three assets, unique mints, a 10,000-bps weight sum, and two nonzero, distinct initial authority keys. It deliberately imposes no per-asset minimum weight; the separate S5B math candidate's 100-bps floor remains subject to review. Parameterized S5B core-math review may proceed before final S5A policy freeze; it does not choose the production weight floor or other config values.

### Bounded lengths and account allocations (S5A structural candidate)

ETF v1 admits exactly two or three ordered assets. To make all account allocations calculable before S5E, each opaque `fee_policy_params` and `risk_policy_params` vector is capped at 256 bytes. These are serialization ceilings, not approved policy payloads or a decision about their inner schemas. S5A must replace them with strict typed payload schemas and retain or deliberately amend the ceilings after S5C/S5D2 review. An encoder rejects a payload over 256 bytes before allocation; a decoder rejects a length prefix over 256, a config over 1,155 bytes, a count outside 2–3, truncation, invalid enum encodings, invalid weights/authorities, and any trailing bytes in the canonical config. The maximum config length is checked with checked arithmetic:

```text
config_bytes(n, fee_len, risk_len)
  = 151 + 164*n + fee_len + risk_len
  where 2 <= n <= 3 and 0 <= fee_len, risk_len <= 256
max_config_bytes = 151 + 164*3 + 256 + 256 = 1,155
```

The canonical config bytes themselves remain variable length. `EtfPoolV1` allocates fixed maximum space and stores a Borsh `Vec<u8>` with its actual u32 length prefix; unused account allocation is zero-filled, not part of the canonical vector and not hashed. Its Anchor account allocation includes the eight-byte Anchor discriminator. The layout below is the proposed S5A v1 account boundary; exact discriminator bytes are the default Anchor `sha256("account:<RustTypeName>")[0..8]` and must be checked against the generated IDL before S5E. All other fields use Borsh little-endian integers, one-byte Borsh enum tags, canonical 0/1 booleans, and raw 32-byte public keys.

| Account | Serialized fields after discriminator, in order | Encoding / bound | Account allocation |
|---|---|---|---:|
| `EtfPoolV1` (immutable identity PDA) | `version:u8`, `bump:u8`, `config_hash:[u8;32]`, `config_bytes:Vec<u8>`, `share_mint:Pubkey`, `initializer:Pubkey` | Config vector length <= 1,155; exact bytes must hash to `config_hash` and decode canonically. Initial authorities remain in config bytes. | `8 + 1 + 1 + 32 + 4 + 1,155 + 32 + 32 = 1,265` bytes |
| `EtfPoolStateV1` (mutable maintenance PDA) | `version:u8`, `bump:u8`, `pool:Pubkey`, `current_governance:Pubkey`, `current_guardian:Pubkey`, `lifecycle:PoolLifecycleV1`, `risk_paused:bool`, `sequence:u64`, `last_observation:Option<ObservationSummaryV1>`, `pending_resume:Option<PendingResumeV1>`, `pending_handoff:Option<PendingHandoffV1>`, `scheduler_enabled:bool`, `scheduler_generation:u64` | Each `Option` has a one-byte Borsh tag and fixed maximum payload. Observation payload: `observed_at:i64`, `slot:u64`, `deviation_bps:u16`, `eligible:bool`, `publish_times:[i64;3]` (43 bytes). Resume payload: `proposer:Pubkey`, `nonce:u64`, `execute_after:i64` (48 bytes). Handoff payload: same plus `role:u8`, `new_authority:Pubkey` (81 bytes). | `8 + 1 + 1 + 32 + 32 + 32 + 1 + 1 + 8 + 44 + 49 + 82 + 1 + 8 = 300` bytes |
| `EtfAssetStateV1` (one mutable fee-counter PDA per config asset) | `version:u8`, `bump:u8`, `pool:Pubkey`, `asset_index:u8`, `cumulative_fee_base_units:u128` | Fixed width; checked addition; counter is informational and is not a separate backing claim. Mint/oracle/weight identity is read from the immutable pool config, avoiding a second mutable copy. | `8 + 1 + 1 + 32 + 1 + 16 = 59` bytes |
| Classic SPL share mint | Canonical SPL `Mint` fields | Fixed 82-byte classic SPL layout; six-decimal mint, pool authority; Token-2022 extensions are outside v1. | 82 bytes |
| Classic SPL custody token account (one per asset) | Canonical SPL `Account` fields | Fixed 165-byte classic SPL layout; exact mint, token program and pool authority must match config/derived address. | 165 bytes each |

The three Anchor account layouts above are fixed allocation sizes, not estimates of rent. The pool state PDA uses `[b"etf_pool_state_v1", pool_pda_bytes]`; the per-asset state PDA uses the existing `[b"etf_asset_v1", pool_pda_bytes, asset_index_u8]` seeds. Allocate the full listed size at initialization; v1 performs no account reallocations. Their field order and individual widths are recorded in the machine-readable [account-layout fixture](etf-account-layout-v1-fixture.json) and independently checked by [`check_etf_account_layout.py`](../../../tools/rebalancing/etf-account-layout/check_etf_account_layout.py), which also re-encodes and decodes the canonical identity fixture and exercises oversize, truncation, invalid-count, bad-tag and trailing-byte rejection. No program or IDL is generated by this candidate check.

Borsh `Option<T>` uses a one-byte tag (`0 = None`, `1 = Some`) and writes the payload only for `Some`; therefore the serialized `EtfPoolStateV1` prefix ranges from 128 bytes when all three options are `None` to its full 300-byte maximum when all payloads are present, while its allocation remains 300 bytes. Anchor/Borsh deserialization can ignore bytes after the serialized prefix. When a state transition changes an option from `Some` to `None`, a normal shorter serialization can leave the previous payload in the allocation tail. The S5E implementation must use a canonical account writer that zeroes the allocated data before writing the current discriminator and fields, then validate that unused tail bytes are zero; test every `Some -> None` transition and readback. Do not assume ordinary `Account<T>` serialization clears stale tail bytes. `EtfPoolV1` also has unused allocation tail because its immutable config vector is generally below its maximum; account creation must zero-fill this tail and no update path may rewrite the identity account.

The candidate enum tags are fixture-recorded and append-only: `PoolLifecycleV1` uses `Unseeded = 0`, `Active = 1`, `Closed = 2`; `AuthorityRoleV1` uses `Governance = 0`, `EmergencyGuardian = 1`; and the already-defined `OracleModeV1` uses `PushFeed = 0`, `ReceiverFull = 1`. The pending-handoff `role` is this one-byte role tag; unknown tags reject. These names/tags are structural candidates until matched against the generated Anchor IDL.

`EtfPoolV1` contains only immutable identity and bootstrap commitments. `EtfPoolStateV1` contains current roles, lifecycle/pause/observation/proposal state, and scheduler maintenance state. `scheduler_generation` is monotonically increased with checked addition whenever scheduling is disabled or re-enabled. The instruction must receive the pool-state PDA as writable; Solana's transaction account lock gives that transaction exclusive writable access, so disabling/re-enabling and the generation increment occur atomically within one instruction/transaction. A stale-generation or disabled `scheduled_poke(expected_generation)` is proposed as a successful no-op with no observation or sequence mutation. A matching-generation call may record observation/eligibility, but the exact general-sequence advance rule is still open. The generation authority, whether pause/close also disables scheduling and increments generation, and re-enable conditions remain policy/interface freeze items. A generation overflow fails closed and requires a reviewed migration; it must never wrap. The schedule registration/task itself belongs to the external scheduler program and is not pool identity or a custody authority. `EtfAssetStateV1` contains only its mutable counter; its index and all token/oracle identity come from the immutable config.

These fixed account layouts and vector ceilings close only the structural allocation question. The inline proposal `Option` fields are a sizing candidate; S5A must explicitly accept inline storage or choose separate proposal PDAs and revise the account/instruction graph before S5E. Likewise, fixed allocation/no-reallocation is the current candidate; a cap or schema change after deployment requires a versioned account/layout migration, not silent growth. The fee/risk payload meaning and values, oracle mode and risk thresholds, exact price/quote/weight bounds, generation authority, pause/close invalidation behavior, sequence-advance rules, authority keys, executor behavior, deployment program identity, and economic admission remain open as stated elsewhere. Any change to a named field, order, tag, cap, or maximum requires a reviewed versioned schema/layout amendment before S5E.

## Content identity

```text
config_hash = SHA-256(UTF8("coloyond:etf:config:v1") || Borsh(EtfPoolConfigV1))
strategy_id = "etf1:" || lowercase_hex(config_hash)
pool seeds  = [UTF8("etf_pool_v1"), config_hash]
asset seeds = [UTF8("etf_asset_v1"), pool_pda_bytes, [asset_index_u8]]
state seeds = [UTF8("etf_pool_state_v1"), pool_pda_bytes]
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
