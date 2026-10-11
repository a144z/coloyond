# S5A provisional ETF account sizing evidence

**Status:** provisional arithmetic evidence only. It does not freeze an account
layout, configuration ceiling, policy schema, deployment maximum, or rent budget.

## Scope and current draft

The current [ETF config wire draft](../contracts/etf-config-v1-wire.md) defines
an exact Borsh outer shape, including two or three ordered assets and opaque
`Vec<u8>` fee/risk policy payloads. The [ETF contract draft](../contracts/etf-v1.md)
lists the stored `EtfPool` and `EtfAsset` responsibilities but explicitly says
their byte layouts are not accepted. Inner fee/risk schemas and their maximum
serialized lengths are also unfrozen.

This evidence therefore computes only the fully described config wire length,
then provides a generic account wrapper formula whose structural field widths
must be supplied by the caller. It intentionally does not encode a proposed
`EtfPool` or `EtfAsset` layout, so it cannot preempt the parallel S5A contract
and sizing work.

## Formula

The outer config has 151 bytes of fixed fields and vector prefixes, each asset
record has 164 bytes, and each opaque policy payload contributes its byte length:

```text
config_bytes = 151 + 164 × asset_count + fee_policy_bytes + risk_policy_bytes
```

For a pool account that stores the serialized config as a Borsh byte vector, the
generic estimate is:

```text
account_bytes = discriminator_bytes
              + caller_supplied_fixed_field_widths
              + 4-byte config Vec prefix
              + config_bytes
```

The tool uses an 8-byte discriminator by default as an Anchor convention; the
final program's generated account layout must confirm it. Every other structural
width is explicit caller input, not an assumed ETF field type. The formula does
not include rent-exemption padding or any runtime allocation policy.

## Cross-checks

The standard-library Python calculator and tests are in
[`tools/rebalancing/etf-account-sizing`](../../tools/rebalancing/etf-account-sizing/README.md).
The synthetic identity fixture has two assets, a 3-byte opaque fee payload and
a 4-byte opaque risk payload. This calculator returns 486 bytes, matching the
exact expected serialized config fixture. With the same payload lengths, a
three-asset config is 650 bytes. These are vector-derived lengths, not maximums.
Boundary coverage checks zero lengths, the Borsh `u32` length boundary,
unsupported asset counts, wrong integer types, malformed structural-width
inputs, and additive payload/asset changes.

## Decision boundary

No rent/deployment maximum can be claimed until the inner policy schemas and
their maximum serialized lengths are frozen, the pool and per-asset account
layouts are specified exactly, and the chosen config/account ceilings are
accepted. Any size ceiling passed to this calculator is a hypothetical caller
input for sensitivity analysis only. This evidence does not unblock S5E;
program implementation remains gated on the final S5A contract/policy freeze
and the existing S5B/S5C/S5D2 decisions.
