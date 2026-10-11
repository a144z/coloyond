# S0B — WSOL/USDC asset and Pyth oracle evidence

**Checked:** 2026-10-11 (UTC)

**Scope:** evidence for the provisional first WSOL/USDC vault on Solana mainnet and Devnet. No transactions, signatures, or changes to chain state were made.

**Decision status:** conditional admission only; this report does not enable funded entry.

## Decision

Keep classic SPL WSOL/USDC as the provisional first pair. Finalized reads now confirm the candidate mint addresses, classic Token Program ownership, decimals, and current mint/freeze authority keys on both clusters; both USDC candidates have active mint and freeze authorities. Pyth's current Solana sponsored-push-feed list includes both SOL/USD and USDC/USD on mainnet and Devnet; it specifies 55-second heartbeat / 0.5% price-deviation update criteria. Three finalized Mainnet feed snapshots passed the diagnostic 60-second age check (10, 42 and 33 seconds); three recent Devnet finalized snapshots were stale (140, 310 and 166 seconds; latest: 166). These observations do **not** prove issuer control, backing, market depth, freshness guarantees, or safe executable fills. See [finalized mint observations](s0b-mint-observations-20261011.md) and [finalized feed observations](s0b-feed-observations-20261011.md).

**S0B technical admission is not yet passed.** The earlier sandbox DNS failure left accounts unread at that time. Read-only finalized mint captures and finalized feed captures are now recorded for Mainnet and Devnet; see [mint evidence](s0b-mint-observations-20261011.md) and [feed evidence](s0b-feed-observations-20261011.md). Three Mainnet baskets passed the diagnostic age check, while the latest Devnet basket remains stale at 166 seconds. Authority-policy review, repeated oracle observations under approved limits, pusher liveness, the consumer build/proof, and disclosure remain open. Keep funded UI/entry unavailable until every S0B pass criterion below is met.

## Asset identifiers and issuer constraints

| Asset | Network | Exact mint | Expected token program | Source status |
|---|---|---|---|---|
| WSOL | Mainnet and Devnet | `So11111111111111111111111111111111111111112` | Classic SPL Token: `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | Finalized snapshots show owner match, initialized 82-byte mint, 9 decimals, and no mint/freeze authority on both clusters. See [capture details](s0b-mint-observations-20261011.md). |
| Circle-native USDC candidate | Mainnet | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | Classic SPL Token: `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | Finalized snapshot shows 6 decimals, mint authority `BJE5...5ruG`, freeze authority `7dG...RCrar`; review and acceptance remain open. Address identity/source is separate from raw mint metadata. |
| Circle test-USDC candidate | Devnet | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` | Classic SPL Token: `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | Finalized snapshot shows 6 decimals, mint authority `GrNg...jMEz`, freeze authority `CJty...idyCT`; supply is near `u64::MAX`. Review, safe amount bounds, and asset identity remain open. Devnet units have no mainnet redemption value. |

Solana's mint layout has separate optional `mint_authority` and `freeze_authority` fields. The finalized captures now record the exact values (including `None` for WSOL); both observed USDC candidates have both authorities populated. The values and account bytes are in the [replayable mint evidence](s0b-mint-observations-20261011.md). **Authority/control acceptance is still pending** and must match a reviewed risk policy before manifest freeze or funded admission. The Devnet test-USDC observed supply is near the `u64` maximum and needs bounded amount tests before use.

Circle is an external USDC issuer. A freeze authority can freeze token accounts; Solana's token docs state frozen accounts cannot transfer or burn. Therefore in-kind redemption is not guaranteed against an issuer freeze, USDC depeg, or chain/RPC outage. Disclose issuer, redemption, freeze, depeg, and external transfer limitations before deposit. A Pyth USDC/USD price cannot establish Circle redemption availability or prevent a freeze. WSOL avoids the USDC issuer, but wrapping/unwrapping and its native mint behavior still depend on the Solana Token Program.

Sources: [Solana native mint / WSOL](https://solana.com/docs/tokens/basics/sync-native), [Solana mint fields and USDC example](https://solana.com/docs/tokens/basics/create-mint), [Solana token-program IDs and mint validation](https://solana.com/docs/payments/how-payments-work), [Solana Devnet USDC example](https://solana.com/docs/payments/agentic-payments/x402), [Circle Solana USDC addresses and native/bridged distinction](https://www.circle.com/multi-chain-usdc/solana), [Solana freeze semantics](https://solana.com/docs/tokens/basics/freeze-account).

## Pyth feed identity and on-chain consumption

| Feed | Pyth feed ID (32-byte hex) | Sponsored fixed account, shard 0 | Networks listed by Pyth |
|---|---|---|---|
| SOL/USD | `0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d` | `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE` | Mainnet and Devnet |
| USDC/USD | `0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a` | `Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX` | Mainnet and Devnet |

Pyth's sponsored-feed page lists the same feed addresses for Solana mainnet and Devnet and labels the listed addresses as shard 0. The SOL address is also used in Pyth's SDK example; the USDC full address above is derived from the documented Pyth PDA scheme (price-feed program ID + shard 0 + feed ID) and matches the official list's `Dpw1EA...eFbX` abbreviation. In the original 2026-10-10 check, neither account was fetched. Later SDK-backed finalized probes verify both clusters' account owner, embedded feed ID, layout and verification; see [S0B feed evidence](s0b-feed-observations-20261011.md). The latest Devnet read is stale on all three feeds, and repeated observations under reviewed limits remain open.

Pyth's Solana docs distinguish fixed `PriceFeed` accounts from ephemeral `PriceUpdateV2` pull accounts. The program must accept only the pinned account address/program owner and expected feed ID. Pyth's `PriceUpdateV2::get_price_no_older_than` checks `Full` verification, feed ID and maximum publish age; the SDK defines `Full` as at least two-thirds of current Wormhole guardian signatures verified. The method does not by itself impose Coloyond's maximum confidence/price ratio, depeg threshold, cross-feed sanity checks, or policy-specific maximum update age; implement those explicitly. Reject zero/negative or malformed values and fail closed for new risk. An on-chain check cannot fetch HTTP data.

Pyth currently lists sponsored Solana feeds with a **55-second heartbeat or 0.5% price-deviation threshold**. These are update criteria, not a hard freshness guarantee: Pyth warns sponsored updates can be delayed by chain halts, gas estimation and other conditions. Its documentation recommends operators run their own pusher. A keeper/pusher submits transactions; it does not create an on-chain timer or guarantee that the vault instruction is called. As of the Pyth docs observed on this date, Hermes requires an API key and Price Pusher v10.5.0+ with `--hermes-access-token`. Thus the pusher is permissionlessly operable in principle but a particular operator still has an off-chain API credential and RPC/fee dependencies. Keep two independently operated update paths and enforce freshness on-chain; a missed update must stop price-dependent new risk, never authorize use of a stale last-known value.

Sources: [Pyth sponsored Solana feeds and update criteria](https://docs.pyth.network/price-feeds/core/push-feeds/solana), [Pyth Solana account model / address derivation / pusher backup](https://docs.pyth.network/price-feeds/core/use-real-time-data/pull-integration/solana), [Pyth receiver program IDs](https://docs.pyth.network/price-feeds/core/contract-addresses/solana), [Full verification and freshness implementation](https://github.com/pyth-network/pyth-crosschain/blob/main/target_chains/solana/pyth_solana_receiver_sdk/src/price_update.rs), [Pyth executable-price, confidence and staleness guidance](https://docs.pyth.network/price-feeds/core/best-practices), [Price Pusher operation and API key requirement](https://docs.pyth.network/price-feeds/core/schedule-price-updates/using-price-pusher).

## Rust/Anchor compatibility evidence

There is no Anchor workspace or `Cargo.toml` on the pinned repository base, so an actual Coloyond compile cannot yet be run. The Pyth Solana guide's compatibility paragraph names Anchor 0.28.0, 0.29.0, 0.30.1 and 0.31.1 and recommends 0.31.1 otherwise; the current crate release metadata has moved on. Pyth's crate registry metadata reports:

- `pyth-solana-receiver-sdk 1.2.0` depends on `anchor-lang ^0.32.1`; an open Pyth repository issue reports native compilation with Anchor 0.32.1.
- `pyth-solana-receiver-sdk 2.0.0` depends on `anchor-lang ^1.0.2` (latest at lookup).

**Recommended proof pair for the S0 contract spike: `anchor-lang = 0.32.1` with `pyth-solana-receiver-sdk = 1.2.0`, exact-pinned in the eventual lockfile.** This is the latest pair with explicit matching version evidence found in primary project metadata and avoids selecting the unvalidated 1.0.2 Anchor major solely because SDK 2.0.0 is newer. This is a source-level recommendation, not a successful SBF build or final dependency freeze. Compile the minimal receiver account reader and IDL in the actual S1 bootstrap/toolchain; if the chosen Anchor baseline changes, run that exact compatibility check again. Pyth's guide's compatibility text appears stale against its published crate versions, so resolve the version mismatch in source control rather than trusting the prose alone.

Sources: [Pyth Solana integration compatibility note](https://docs.pyth.network/price-feeds/core/use-real-time-data/pull-integration/solana), [Pyth SDK 1.2.0 release metadata](https://docs.rs/crate/pyth-solana-receiver-sdk/1.2.0), [Pyth SDK 2.0.0 release metadata](https://docs.rs/crate/pyth-solana-receiver-sdk/latest), [Pyth issue reporting 1.2.0 + Anchor 0.32.1](https://github.com/pyth-network/pyth-crosschain/issues/3834).

## Checks performed and open evidence

Historical read-only account checks attempted against both public endpoints using finalized `getAccountInfo` with `jsonParsed` on 2026-10-10:

```sh
curl --silent --show-error --max-time 10 https://api.mainnet-beta.solana.com \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"getAccountInfo","params":["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",{"encoding":"jsonParsed","commitment":"finalized"}]}'
# curl: (6) Could not resolve host: api.mainnet-beta.solana.com

curl --silent --show-error --max-time 10 https://api.devnet.solana.com \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"getAccountInfo","params":["4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",{"encoding":"jsonParsed","commitment":"finalized"}]}'
# curl: (6) Could not resolve host: api.devnet.solana.com
```

The mint and feed-account queries were subsequently completed for both target clusters; see the [finalized mint captures](s0b-mint-observations-20261011.md) and [finalized feed captures](s0b-feed-observations-20261011.md). Remaining evidence: repeat snapshots at reviewed freshness/confidence limits, independently compare feed ID and derivation program/PDA to the pinned manifest, inspect Price Pusher build/config, and demonstrate two independent operators can update the shard-0 feeds. Documentation presence alone is not liveness evidence.

## S0B pass/fail criteria

**Pass only when all are evidenced:**

1. Full mint addresses resolve on the named finalized clusters, are owned by the expected classic Token Program, have expected decimals, and observed mint/freeze authorities are reviewed and accepted; the on-chain manifest pins those exact values.
2. Both SOL/USD and USDC/USD account addresses resolve on both clusters, are owned by the expected Pyth program, decode to the exact pinned feed IDs, and show acceptable live freshness/confidence on repeated observations. The exact thresholds come from the approved spec and must be tested with stale/wide-confidence/depeg cases.
3. The actual current pusher/Hermes instructions, operator credentials, RPCs and fees are demonstrated for two independent operators; the app/program truthfully exposes stale or unavailable oracle state.
4. The exact pinned Pyth/Anchor pair compiles in the actual SBF toolchain and the program rejects wrong owner/address/feed, partial verification, stale publish time, excessive confidence, and unsafe USDC depeg conditions.
5. User-facing USDC issuer/freeze/depeg and in-kind redemption limitation disclosure is present before any deposit.

**Fail/hold admission** if any authority or account is unknown, differs from the reviewed manifest, any feed is absent/stale/incorrectly owned or cannot pass Full verification, confidence/depeg thresholds are unproven, pusher liveness has a single operator dependency, compile compatibility fails, or disclosure is absent. A failure keeps WSOL/USDC funded entry disabled; do not substitute a different mint/feed silently. Any replacement asset requires a new manifest revision and its own evidence.
