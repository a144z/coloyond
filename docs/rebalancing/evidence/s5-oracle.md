# S5 Pyth account-mode research

**Status:** primary-source inventory and repeated direct Devnet fixed-feed/parser observations complete; S5C acceptance and S0B admission remain open. The observed accounts were live at their recorded slots, but feed freshness is transient and no ETF consumer transaction has run.

## Account model decision

Pyth's current Solana guide distinguishes fixed, shard-selected price-feed accounts from ephemeral `PriceUpdateV2` Receiver update accounts. The fixed path is the first ETF candidate because it avoids posting a Pyth update in every seed/swap transaction and Pyth lists its shard-0 SOL/BTC/USDC feeds as sponsored on Devnet. The account owner and data parser still must be established against the exact account and SDK used by the program.

`PriceUpdateV2` is a Receiver account type. Its `get_price_no_older_than` method checks Full verification, feed ID and maximum age; the integration still has to check positive price, confidence, exponent, nonfuture publish time and policy limits. Official Push Oracle source shows the fixed PDA is CPI-posted through Receiver `post_update`, then deserialized as this same account type; its TypeScript SDK also decodes fixed PDAs with the Receiver account coder. Fixed and ephemeral feeds therefore differ in address derivation, lifecycle and updater path, while the serialized parser appears shared. Direct Devnet snapshots below resolved the prior owner/layout/feed-ID/verification uncertainty for the observed accounts; refresh those facts before deployment because account state and freshness can change. Report `Full` only when it appears in the decoded account. If the fixed path later fails compatibility or admission, the fallback is a client-posted Receiver update with Full verification and an explicit multi-transaction update flow. Partial verification is not accepted.

## Candidate identifiers

| Asset price | Stable Pyth Core feed ID | Candidate shard-0 account | Source status |
|---|---|---|---|
| SOL/USD | `0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d` | `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE` | Direct Devnet account fetched and decoded by the pinned Rust SDK; see observation below. |
| BTC/USD | `0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43` | `4cSM2e6rvbGQUFiJbqytoVMi5GgghSMr8LwVrT9VPSPo` | Direct Devnet account fetched and decoded by the pinned Rust SDK; see observation below. |
| USDC/USD | `0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a` | `Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX` | Direct Devnet account fetched and decoded by the pinned Rust SDK; see observation below. |

| Program | Solana Devnet address | Role |
|---|---|---|
| Pyth Receiver / Pull Oracle | `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ` | Direct Devnet read: executable under upgradeable BPF loader. |
| Pyth Price Feed / Push Oracle | `pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT` | Direct Devnet read: executable under upgradeable BPF loader. |

Pyth documents a nominal 55-second heartbeat and 0.5% deviation for the default sponsored Solana feeds. These are updater criteria, not an update SLA; stale feeds must block new risk. A price feed does not prove that the corresponding Devnet SPL mint is backed by that real-world asset. Use labeled synthetic BTC/USD and USD test mints if no backed Devnet mint is separately established.

## S5C account/parser proof required

The isolated adapter depends on the repository-pinned `anchor-lang = 0.32.1` and `pyth-solana-receiver-sdk = 1.2.0`. It checks the manifest PDA, Receiver owner and SDK-defined account length before SDK deserialization; Full serialization is 133 bytes and the SDK's maximum allocated `PriceUpdateV2::LEN` is 134 bytes. It then validates the pinned feed ID, Full verification, caller-supplied age/confidence/exponent limits, positive/nonfuture price and exact 18-decimal fixed-point conversion. Eleven offline unit tests cover the independent literal address/feed-ID mappings for all three feeds, accepted lengths including a nonzero 134th allocation byte, truncated/oversized and malformed-discriminator rejection, wrong account key/owner/feed, Partial verification, inclusive age/confidence/exponent bounds, invalid policy and arithmetic/precision failures. The `[-17, 0]` exponent range in tests/example is a local math-candidate value, not an approved production policy. A reusable live probe fetches account bytes and invokes that same SDK-backed adapter; the observations below establish point-in-time account/parser matches.

- Refresh and retain direct Devnet observations before deployment; the present sample is not a freshness SLA.
- Record account owner, data length, type/layout, embedded feed ID, shard, raw price/confidence/exponent, publish time, read slot and mode-specific verification evidence.
- Compile the selected parser against the repo's exact Anchor and Pyth SDK lockfile; use fetched account data to prove successful decoding and reject wrong owner, wrong feed identity, malformed length/discriminator, nonpositive price, caller-out-of-range exponent, excessive confidence, stale and nonfuture-time cases at the adapter boundary. The pinned SDK declares `PriceUpdateV2::LEN = 134`; the adapter accepts exactly the 133-byte Full Borsh serialization or the 134-byte maximum allocation and makes no assertion about a trailing allocation byte's value. See the [pinned SDK account type](https://github.com/pyth-network/pyth-crosschain/blob/main/target_chains/solana/pyth_solana_receiver_sdk/src/price_update.rs).
- If using Receiver updates, prove `Full` verification and the exact client posting flow. If using fixed Push Feed accounts, document the trusted Pyth program's verification/update semantics and do not report a Receiver verification field.
- S5C does not require an ETF-program transaction because S5E has not deployed that program yet. The real Devnet consumer transaction, on-chain rejection without token movement, and stale-feed recovery are S5H/CP5 proof obligations after S5E.

## Direct Devnet observation — 10 October 2026

The read-only tool at [`tools/rebalancing/etf-oracle-probe`](../../tools/rebalancing/etf-oracle-probe/README.md) queried `https://api.devnet.solana.com` at confirmed commitment. At slot `509627905`, block time `1791656201` (2026-10-10 18:16:41 UTC), Devnet genesis was `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`. All three fixed feed accounts had owner `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`, 134 bytes of data, and decoded through the pinned SDK with the expected embedded feed ID and `Full` verification. The adapter accepted each at this observation using a 60-second age ceiling and a deliberately permissive `u16::MAX` confidence ceiling (not an approved policy).

| Feed | Price ± confidence × 10^exponent | Publish age | Confidence | Data SHA-256 |
|---|---:|---:|---:|---|
| SOL/USD | `10989570949 ± 3366894`, exponent `-8` | 32 seconds | 4 bps | `a7bf8cf4272fc7032857621ee978768b46546bd519237b642b0fe529297c86f5` |
| BTC/USD | `8299695083557 ± 5978366443`, exponent `-8` | 32 seconds | 8 bps | `f72cf1a2ca50815700527de5b66077c7b5a262c67b56a37e012e07ea5768248e` |
| USDC/USD | `99987886 ± 97114`, exponent `-8` | 32 seconds | 10 bps | `8096144b43dfb21b9ca165bef052123ce163d01ddd6d158b813225eaec937c76` |

Both Pyth program IDs in the table above were executable under `BPFLoaderUpgradeab1e11111111111111111111111` at confirmed slot `509627995`. A prior probe minutes earlier observed BTC/USD and USDC/USD at 326 seconds old and correctly rejected them under the 60-second check; a later snapshot had all three feeds at 32 seconds old. This confirms fail-closed staleness behavior and changing availability, not a guaranteed update cadence. The raw price for a Pyth feed does not prove that any corresponding Devnet SPL test mint is backed by the labeled asset.

## Refreshed read-only Devnet observation — 10 October 2026

The same probe was rerun at confirmed slot `509631945`, block time `1791657172` (2026-10-10 18:32:52 UTC), with the same Devnet genesis. All three accounts retained the expected Receiver owner, 134-byte layout, embedded feed IDs and `Full` verification. Under the explicitly diagnostic 60-second age ceiling, SOL/USD and BTC/USD were **stale** at 327 seconds and rejected by the SDK-backed adapter; USDC/USD was fresh at 11 seconds and passed with 10 bps confidence. This later result supersedes the earlier snapshot as the latest observation and demonstrates why a single successful sample cannot establish the runtime availability needed for a multi-asset basket.

| Feed | Price ± confidence × 10^exponent | Publish age | Confidence | Adapter at 60 seconds | Data SHA-256 |
|---|---:|---:|---:|---|---|
| SOL/USD | `10987310976 ± 3992922`, exponent `-8` | 327 seconds | 4 bps | rejected: stale | `dad515455759d58ab032469330fd994c59bb6e1f455ea9a29fbf48f52006aa98` |
| BTC/USD | `8291976399801 ± 7267606752`, exponent `-8` | 327 seconds | 9 bps | rejected: stale | `2442e5c00507670f04996e14830f9030b5bb1516ea34f9fd10792c8665726c14` |
| USDC/USD | `99988241 ± 96759`, exponent `-8` | 11 seconds | 10 bps | accepted under diagnostic ceilings | `a169c21b17c03fc80e96d87aac1d7a1e3ff5789d88405fbd0628d4fee574c3ac` |

The confidence ceiling was `u16::MAX` and is not an approved risk policy. No transaction was sent. The basket still requires every configured feed to meet policy in the same transaction; this observation would fail that multi-asset prerequisite.

## Latest read-only Devnet observation — 10 October 2026

The probe ran again at confirmed slot `509637269`, block time `1791658448` (2026-10-10 18:54:08 UTC), against Devnet genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`. All three accounts still had the expected Receiver owner, 134-byte layout, pinned embedded feed ID and `Full` verification. All three failed the diagnostic 60-second freshness requirement: SOL/USD and BTC/USD were 183 seconds old; USDC/USD was 204 seconds old. The SDK-backed adapter rejected all three. Observed confidence ratios were 4, 8 and 10 bps respectively, but the confidence ceiling remains deliberately permissive and unapproved.

| Feed | Price ± confidence × 10^exponent | Publish age | Confidence | Adapter at 60 seconds | Data SHA-256 |
|---|---:|---:|---:|---|---|
| SOL/USD | `11023143967 ± 4193303`, exponent `-8` | 183 seconds | 4 bps | rejected: stale | `d809520cc5abaded2da400c0110d13fe963c3e04131f7df5a3293367bf12b23f` |
| BTC/USD | `8296261614735 ± 6137785265`, exponent `-8` | 183 seconds | 8 bps | rejected: stale | `8e8aa103015b1b37785f2ec0e9c4892cafde9759b2461680f61b531b97283cfb` |
| USDC/USD | `99988132 ± 91867`, exponent `-8` | 204 seconds | 10 bps | rejected: stale | `b37a844c58926899a0b94c063b1e88c1c3b0dbea054d67066921c7995f1e217d` |

No transaction was sent. Repeated snapshots show transient recovery and staleness, while this latest sample has no feed fresh enough for the candidate three-asset pool. This supports fail-closed behavior; it does not establish a production freshness policy or a feed-liveness SLA.

## Refreshed read-only Devnet observation — 10 October 2026

The repository probe ran at confirmed slot `509642309`, block time `1791659662` (2026-10-10 19:14:22 UTC), against the same Devnet genesis. All accounts retained the expected Receiver owner, 134-byte layout, embedded feed IDs and `Full` verification. The SOL and BTC observations passed the diagnostic 60-second age check at 22 seconds; USDC was 338 seconds old and rejected. This is a partial recovery, not a usable three-asset snapshot.

| Feed | Price ± confidence × 10^exponent | Publish age | Confidence | Adapter at 60 seconds | Data SHA-256 |
|---|---:|---:|---:|---|---|
| SOL/USD | `11020148771 ± 3097187`, exponent `-8` | 22 seconds | 3 bps | accepted under diagnostic limits | `34dc11149a77e33366a82db0ca1308ea0b0c4c16fca9f89b29f43b2b35f71e33` |
| BTC/USD | `8295307892802 ± 2652107198`, exponent `-8` | 22 seconds | 4 bps | accepted under diagnostic limits | `c21f80d7ef81b8541fbf24ac95f0300f5108dfb8f9e9866d5d1092916951d13a` |
| USDC/USD | `99988576 ± 91423`, exponent `-8` | 338 seconds | 10 bps | rejected: stale | `94250ce4c085afd7f4d93dee4b0240768837f4c5bc63430ae221427908363b19` |

The probe used a 60-second maximum age and `u16::MAX` confidence ceiling for diagnosis only. No transaction was sent. The adapter accepts two feeds and rejects the third, so the basket-wide all-feeds prerequisite still fails. This observation establishes neither approved risk limits nor a freshness SLA.

## Confidence and exponent policy status

Pyth's current best-practices guidance describes confidence as an aggregate uncertainty interval, explains that the feed's publisher intervals are intended to provide 95% coverage, and recommends using the adverse side of that interval for executable prices. For wide confidence, it recommends widening spreads or capping trade size; it does not prescribe one universal confidence-ratio threshold for all protocols. The Solana guide also warns about oracle latency/adversarial selection and calls for strict freshness checks in executable-price flows. See [Pyth confidence intervals and executable-price risks](https://docs.pyth.network/price-feeds/core/best-practices) and [Pyth's Solana integration guide](https://docs.pyth.network/price-feeds/core/use-real-time-data/pull-integration/solana).


The S5C adapter now exposes the exact fixed-point interval `[price - conf, price, price + conf]` through `ValidatedPrice::confidence_interval`, rejecting a nonpositive lower endpoint, overflow and any endpoint conversion that loses precision. It also rejects exponents outside a caller-supplied inclusive range; it does not choose that range. This is a reusable data primitive only; no S5E valuation or swap path consumes the interval yet. The adapter does not choose a maximum confidence ratio, freshness age, production exponent allowlist, size cap or fee response. The live diagnostic observations of 3–10 bps confidence are too few and too narrow to set a production threshold. S5C still requires an explicit risk decision and tests at the selected thresholds; keep these limits unapproved until that work is reviewed.

The adapter now validates the complete fixed-point confidence interval before returning `ValidatedPrice`, so a caller cannot receive an accepted positive midpoint whose uncertainty lower bound is zero or negative, or whose endpoints cannot be represented exactly. Configurable-policy tests also pin the boundary semantics: age exactly at the supplied ceiling and confidence exactly at the supplied bps ceiling pass; one second older and a ratio that rounds up to the next bps fail. Test values (60 seconds and 100 bps) are local fixtures only; they do not select or approve production limits. These tests strengthen the adapter input contract but do not prove an S5E on-chain consumer.

## 11 October 2026 compatibility finding

The current repository pins `pyth-solana-receiver-sdk = 1.2.0`, whose Rust `PriceUpdateV2` parser and `get_price_no_older_than` method enforce the Receiver account discriminator, feed ID, maximum age and Full verification when used through Anchor `Account<PriceUpdateV2>`. A fixed sponsored feed is a different lifecycle (long-lived shard/feed PDA) from a user-posted ephemeral update, but Pyth's current official Push Oracle program source shows `update_price_feed` CPI-calls the Receiver's `post_update` using that PDA as the `price_update_account`, then deserializes it with `PriceUpdateV2::try_deserialize` and verifies the embedded feed ID. The direct observation above confirms all three candidate accounts use the Receiver owner and decode with the pinned SDK as Full-verified `PriceUpdateV2` data. Thus the current Rust parser is a viable account-mode match for this sample; no custom raw-byte parser is justified from the evidence found so far.

The public TypeScript SDK's `buildUpdatePriceFeedInstructions` targets the separate PythPushOracle program and derives the fixed PDA from shard ID and feed ID. Its `fetchPriceFeedAccount` then decodes that PDA using the Receiver `priceUpdateV2` account coder. The fixed/ephemeral distinction therefore concerns address derivation, lifecycle and updater path; it does not by itself imply a different serialized Rust type. The direct observation asserts Full verification in the actual decoded account. The Pyth guide currently documents Receiver SDK compatibility up to Anchor 0.31.1 while this repository pins Anchor 0.32.1; native tests and the live account probe compile with the pinned versions, but an ETF SBF consumer transaction remains for S5H after S5E.

No S5A oracle decision change is proposed: fixed sponsored shard-0 feeds remain primary because they match the always-current read model and official SDK update path. S5C has directly confirmed account owner, SDK layout, Full verification, embedded feed ID, positive prices, confidence, and both fresh and stale fail-closed behavior across several point-in-time Devnet reads. The refreshed slot `509642309` had SOL/BTC fresh at 22 seconds and USDC stale at 338 seconds under the diagnostic 60-second age ceiling. Before acceptance, freeze confidence/exponent limits, rerun the probe at the chosen policy, and consume the data in the reviewed ETF SBF build. If a candidate fails a future policy or parser check, return a reviewed S5A amendment; do not hand-parse production account bytes or fall back to Partial verification.


## Probe response integrity — offline checks

The read-only RPC probe now validates JSON-RPC 2.0 response version, matching request ID, and an exclusive `result` or `error` field before using a result. It also rejects malformed context, short or long account arrays, missing account values, invalid base64, and any mismatch between decoded account bytes and the RPC `space` field. Ten standard-library tests cover valid envelopes, signed 64-bit `getBlockTime` values, batch decoding and malformed response failure cases. This prevents malformed timestamps, envelopes and incomplete account batches from being silently accepted; it is offline parser evidence only and records no new Devnet observation.

## Primary sources

- [Pyth Solana account modes and integration](https://docs.pyth.network/price-feeds/core/use-real-time-data/pull-integration/solana)
- [Pyth sponsored Solana Push Feeds](https://docs.pyth.network/price-feeds/core/push-feeds/solana)
- [Pyth Solana program addresses](https://docs.pyth.network/price-feeds/core/contract-addresses/solana)
- [Pyth Receiver `PriceUpdateV2` checks](https://github.com/pyth-network/pyth-crosschain/blob/main/target_chains/solana/pyth_solana_receiver_sdk/src/price_update.rs)
- [Pyth Solana Receiver SDK README](https://github.com/pyth-network/pyth-crosschain/tree/main/target_chains/solana/pyth_solana_receiver_sdk)
- [Pyth Solana Receiver TypeScript SDK fixed-feed builder](https://github.com/pyth-network/pyth-crosschain/blob/main/target_chains/solana/sdk/js/pyth_solana_receiver/src/PythSolanaReceiver.ts)
- [Pyth Push Oracle program implementation](https://github.com/pyth-network/pyth-crosschain/blob/main/target_chains/solana/programs/pyth-push-oracle/src/lib.rs)
- [Pyth Push Oracle IDL](https://github.com/pyth-network/pyth-crosschain/blob/main/target_chains/solana/sdk/js/pyth_solana_receiver/src/idl/pyth_push_oracle.ts)
- [Pyth Core upgrade guide](https://docs.pyth.network/price-feeds/core/upgrade)
- [Pyth Solana Rust account parser source](https://github.com/pyth-network/pyth-sdk-rs/blob/main/pyth-sdk-solana/src/state.rs)
- [Pyth price safety guidance](https://docs.pyth.network/price-feeds/core/best-practices)
- [Pyth confidence intervals and executable-price mitigations](https://docs.pyth.network/price-feeds/core/best-practices#confidence-intervals)
