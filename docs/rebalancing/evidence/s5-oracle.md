# S5 Pyth account-mode research

**Status:** current-cluster fixed-feed account identity and parser observations are captured; S5C acceptance and S0B admission remain open. At 2026-10-10 23:08 UTC, both `https://api.devnet.solana.com` and `https://solana-devnet.api.onfinality.io/public` returned the exact pinned genesis hash. The public endpoint also returned finalized slot `509701000`; OnFinality's finalized-slot request returned HTTP 429. Exact response bodies, per-call timestamps and response SHA-256 values are preserved in [the genesis capture](s5-devnet-genesis-capture.json). This matches the upstream Solana SDK Devnet constant; that SDK is not pinned by this repository. The Solana docs `getGenesisHash` sample prints `GH7ome...`, which is a sample-output discrepancy. The latest feed snapshot is at confirmed slot `509731704`: SOL/BTC were 11 seconds old and USDC was 35 seconds old under the diagnostic 60-second check. Earlier snapshots include stale basket observations, demonstrating that freshness varies over time and is not guaranteed. No ETF consumer transaction has run.

## Account model decision

Pyth's current Solana guide distinguishes fixed, shard-selected price-feed accounts from ephemeral `PriceUpdateV2` Receiver update accounts. The fixed path is the first ETF candidate because it avoids posting a Pyth update in every seed/swap transaction and Pyth lists its shard-0 SOL/BTC/USDC feeds as sponsored on Devnet. S5C's direct Devnet observations and pinned-SDK tests establish the candidate accounts' Pull Oracle owner, `PriceUpdateV2` layout, embedded feed IDs and `Full` level. Freshness remains volatile and the ETF consumer transaction remains unproven.

`PriceUpdateV2` is a Receiver account type. Its `get_price_no_older_than` method checks Full verification, feed ID and maximum age; the integration still has to check positive price, confidence, exponent, nonfuture publish time and policy limits. Official Push Oracle source shows the fixed PDA is CPI-posted through Receiver `post_update`, then deserialized as this same account type; its TypeScript SDK also decodes fixed PDAs with the Receiver account coder. Fixed and ephemeral feeds therefore differ in address derivation, lifecycle and updater path, while sharing the serialized parser. Direct Devnet snapshots and the pinned-SDK regression resolved owner/layout/feed-ID/verification compatibility for the observed candidates; refresh those facts before deployment because account state and freshness can change. Report `Full` only when it appears in the decoded account. Partial verification is not accepted.

**S5A reconciliation:** Pyth's current Solana integration distinguishes fixed sponsored price-feed PDAs from ephemeral price-update accounts by derivation, lifetime, and updater path. The fixed PDA is derived under the Push Oracle program ID, while its account data is `PriceUpdateV2` owned by the Pull Oracle; the ephemeral update account uses the same on-chain data type and owner. Both expose a real `verification_level`, and the ETF requires `Full`. The pinned Rust suite now independently derives all three shard-0 candidate addresses from the official SDK's `[u16_le(shard), feed_id]` seeds and Push Oracle program ID; the live captures confirm the expected Pull Oracle owner, layout, feed IDs and `Full` level. This resolves the prior apparent owner/parser conflict. Remaining S5A work is to freeze the explicit fixed-PDA mode tag, updater assumptions and exact program/account tuple; it does not require switching account mode. See the [current Pyth Solana guide](https://docs.pyth.network/price-feeds/core/use-real-time-data/pull-integration/solana), [sponsored feed list](https://docs.pyth.network/price-feeds/core/push-feeds/solana), [Pyth SDK derivation/fetch path](https://github.com/pyth-network/pyth-crosschain/blob/main/target_chains/solana/sdk/js/pyth_solana_receiver/src/PythSolanaReceiver.ts), and [Receiver account schema](https://github.com/pyth-network/pyth-crosschain/blob/main/target_chains/solana/pyth_solana_receiver_sdk/src/price_update.rs).

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

Pyth documents a nominal 55-second heartbeat and 0.5% deviation for the default sponsored Solana feeds. These are updater criteria, not an update SLA; Pyth also says sponsored pushes can be delayed and recommends running a price pusher for reliability ([Solana push-feed list](https://docs.pyth.network/price-feeds/core/push-feeds/solana), [push-feed operations](https://docs.pyth.network/price-feeds/core/push-feeds)). The latest three-feed snapshot exceeds the diagnostic 60-second age on BTC and USDC, consistent with the fact that heartbeat is not a guarantee. A scheduler alone cannot guarantee fresh input; keep failing closed and do not widen age limits only to make observations pass. If freshness requires caller-posted Receiver updates, that changes the wallet/keeper transaction and fee path and must be included in the reviewed S5A interface. A price feed does not prove that the corresponding Devnet SPL mint is backed by that real-world asset. Use labeled synthetic BTC/USD and USD test mints if no backed Devnet mint is separately established.

## S5C account/parser proof required

The isolated adapter depends on the repository-pinned `anchor-lang = 0.32.1` and `pyth-solana-receiver-sdk = 1.2.0`. It checks the manifest PDA, Pull Oracle owner and SDK-defined account length before SDK deserialization; Full serialization is 133 bytes and the SDK's maximum allocated `PriceUpdateV2::LEN` is 134 bytes. It then validates the pinned feed ID, Full verification, caller-supplied age/confidence/exponent limits, positive/nonfuture price and exact 18-decimal fixed-point conversion. Fourteen offline unit tests cover the independent literal address/feed-ID mappings, an implementation of the official Pyth shard-zero PDA derivation for all three feeds, accepted lengths including a nonzero 134th allocation byte, malformed account rejection, wrong key/owner/feed, Partial verification, policy boundaries and arithmetic/precision failures. The latest test-only additions reject all six cross-pinned feed-ID mismatches across the three pinned feeds, reject confidence intervals whose lower bound crosses zero, and reject `i32::MIN`/`i32::MAX` exponent extremes. Run `cargo test -p coloyond-etf-oracle --locked` (14 passed) and `cargo fmt --all -- --check` (passed). These are synthetic/offline unit fixtures only; they do not establish live Devnet behavior, select oracle/risk policy limits, or change the still-open S5C/S5A gates. The `[-17, 0]` exponent range in tests/example is a local math-candidate value, not an approved production policy. A reusable live probe fetches account bytes and invokes that same SDK-backed adapter; the observations below establish point-in-time account/parser matches.

- Refresh and retain direct Devnet observations before deployment; the present sample is not a freshness SLA.
- Record account owner, data length, type/layout, embedded feed ID, shard, raw price/confidence/exponent, publish time, read slot and mode-specific verification evidence.
- Compile the selected parser against the repo's exact Anchor and Pyth SDK lockfile; use fetched account data to prove successful decoding and reject wrong owner, wrong feed identity, malformed length/discriminator, nonpositive price, caller-out-of-range exponent, excessive confidence, stale and nonfuture-time cases at the adapter boundary. The pinned SDK declares `PriceUpdateV2::LEN = 134`; the adapter accepts exactly the 133-byte Full Borsh serialization or the 134-byte maximum allocation and makes no assertion about a trailing allocation byte's value. See the [pinned SDK account type](https://github.com/pyth-network/pyth-crosschain/blob/main/target_chains/solana/pyth_solana_receiver_sdk/src/price_update.rs).
- The former account-mode concern is resolved for the pinned fixed candidates: both fixed and ephemeral modes expose `PriceUpdateV2` verification, and `Full` is required. Preserve separate proof of the fixed PDA derivation and supported updater path; prove wallet posting only if ephemeral mode is selected.
- S5C does not require an ETF-program transaction because S5E has not deployed that program yet. The real Devnet consumer transaction, on-chain rejection without token movement, and stale-feed recovery are S5H/CP5 proof obligations after S5E.

## Historical observations and current cluster identity

The dated captures below identify genesis `EtWTRAB...`. The durable [RPC response capture](s5-devnet-genesis-capture.json) records exact endpoint URLs, UTC timestamps, raw JSON-RPC responses and response hashes; the public RPC's slot request explicitly used `finalized`, while OnFinality rate-limited its slot request. The pin matches the upstream Solana SDK Devnet constant, though this repository does not pin that SDK. The Solana `getGenesisHash` page's `GH7ome...` value is sample output and is recorded only as a documentation discrepancy. All evidence is point-in-time; verify again against the selected deployment endpoint.

## Historical direct Devnet observation — 10 October 2026

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

## Historical latest read-only Devnet observation — 10 October 2026

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

No S5A oracle mode change is proposed: fixed sponsored shard-0 feeds remain primary because they match the always-current read model and official SDK update path. S5C has directly confirmed account owner, SDK layout, Full verification, embedded feed ID, positive prices, confidence, and fresh/stale fail-closed behavior across several point-in-time Devnet reads. The latest confirmed feed slot `509737667` had only SOL within the diagnostic 60-second age ceiling (6 seconds); BTC and USDC were 61 seconds old and rejected. The earlier `509731704` basket was within the diagnostic ceiling, while slots such as `509714460` had all three feeds stale. This variation is not a freshness guarantee. Before acceptance, freeze confidence/exponent limits, rerun the probe at the chosen policy, and consume the data in the reviewed ETF SBF build. If a candidate fails a future policy or parser check, return a reviewed S5A amendment; do not hand-parse production account bytes or fall back to Partial verification.


## Probe response integrity — offline checks

The read-only RPC probe validates JSON-RPC 2.0 response version, matching request ID, and an exclusive `result` or `error` field before using a result. It rejects malformed context, short or long account arrays, missing account values, invalid base64, and any mismatch between decoded account bytes and the RPC `space` field. It checks `getGenesisHash` against the pinned expected value (`EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`) before querying feed accounts or printing a Devnet label; any different hash fails closed. Fourteen standard-library tests cover pinned-manifest parity, valid and rejected genesis values, valid envelopes, JSON-RPC error-object code/message validation, signed 64-bit `getBlockTime` values, batch decoding and malformed response failure cases. This offline validation is separate from live evidence. On 11 October 2026, both the configured RPC and independent OnFinality RPC reported the pinned genesis; see [the reproducible response capture](s5-devnet-genesis-capture.json). The refreshed account read below passed the pinned-genesis check and decoded all three manifest accounts.

## First current-cluster read-only Devnet refresh — 11 October 2026

The probe fetched all three manifest-pinned accounts at confirmed slot `509699169`, cluster time `1791673252` (2026-10-11 07:00:52 +0800), on genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`. Each account had the expected Receiver owner, 134-byte allocation, embedded feed ID and `Full` verification. Under the diagnostic 60-second age ceiling, SOL/USD passed at 16 seconds old; BTC/USD was 104 seconds old and USDC/USD 138 seconds old, so both were rejected stale. Confidence ratios were 4, 9 and 9 bps respectively; the ceiling remains `u16::MAX` and unapproved. This is a partial snapshot, not a usable three-feed basket or freshness guarantee. No transaction was sent.

| Feed | Price × 10^exponent | Confidence × 10^exponent | Publish age | Confidence | Data SHA-256 | Adapter |
|---|---:|---:|---:|---:|---|---|
| SOL/USD | 110.38805180 | 0.04180529 | 16 s | 4 bps | `ca8a5d8baacd899ec43691bcae45cb47b0f56f5f2ced265179e45020aefcbecc` | pass |
| BTC/USD | 83,015.93536435 | 71.72729866 | 104 s | 9 bps | `7117b2f8d1e34fcb908da8548998856dbf9a8492fe5aa050a37998fc6141225d` | fail: stale |
| USDC/USD | 0.99988903 | 0.00081096 | 138 s | 9 bps | `4684d0dd72e08fbb66a08770a7a40f04e6df332960483b73e01d463393b393c6` | fail: stale |

## Second current-cluster feed read — 11 October 2026

A follow-up read at confirmed slot `509700331`, cluster time `1791673530` (2026-10-11 07:05:30 +0800), again decoded all three accounts as Full-verified with the expected owner, allocation and feed ID. SOL/USD was 9 seconds old; BTC/USD and USDC/USD shared publish time `1791673464` and were both 66 seconds old, so both failed the diagnostic 60-second age limit by 6 seconds. Confidence ratios were 4, 7 and 9 bps. This point-in-time read does not justify changing the limit; age policy still needs a reviewed volatility/latency analysis and remains unapproved.

| Feed | Price × 10^exponent | Confidence × 10^exponent | Publish age | Confidence | Data SHA-256 | Adapter |
|---|---:|---:|---:|---:|---|---|
| SOL/USD | 110.39414263 | 0.04015976 | 9 s | 4 bps | `9f2100f76976fb6f0a9b79067180cd8c85e70fa6b6823f16c9a39e50d6c8a4b2` | pass |
| BTC/USD | 83,022.63492250 | 53.39507750 | 66 s | 7 bps | `8ef9f3643ce7e1694a6aca2282c4355211aba17c9c866c7d96fb617d89367dda` | fail: stale |
| USDC/USD | 0.99987043 | 0.00082956 | 66 s | 9 bps | `82556555f24c5da41f99e922aad0e73f10dcfad0f547900449c20fed10764426` | fail: stale |

| Feed | Price ± confidence × 10^exponent | Publish age | Confidence | Adapter at 60 seconds | Data SHA-256 |
|---|---:|---:|---:|---|---|
| SOL/USD | `11019105874 ± 4371049`, exponent `-8` | 11 seconds | 4 bps | accepted | `0f32544ce8c4aa0e8516707b0d25b2b439d44f4bf487842e871227e254e32cd8` |
| BTC/USD | `8300890000000 ± 6641379484`, exponent `-8` | 309 seconds | 9 bps | rejected: stale | `f53a7faad6cbdfc29de9e8212814ade28caedf8c414f2d7d4ea5f431f17eb26b` |
| USDC/USD | `99986315 ± 87184`, exponent `-8` | 309 seconds | 9 bps | rejected: stale | `574454832623d7361bcb554820772c129a288e3c1f53864d33493278a31b1373` |

The confidence ceiling remained `u16::MAX` and is diagnostic only. No transaction was sent. The observation reinforces that a same-transaction basket must fail closed unless every configured feed meets the eventually reviewed policy.

## Current RPC identity capture — 11 October 2026

The capture at 2026-10-10 23:08:12 UTC records `EtWTRAB...` from both configured public Devnet and OnFinality endpoints. The public endpoint returned finalized slot `509701000`; OnFinality returned HTTP 429 for the slot request, so no second finalized slot is claimed. This capture did not reread the Pyth accounts; the latest SDK-backed feed read is at confirmed slot `509731704` below. See the response bodies and hashes in [`s5-devnet-genesis-capture.json`](s5-devnet-genesis-capture.json).

## Third current-cluster feed read — 11 October 2026

The read-only SDK-backed probe fetched all three manifest accounts at confirmed slot `509701847`, cluster time `1791673892` (2026-10-10 23:11:32 UTC / 2026-10-11 07:11:32 +0800), on genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`. All three accounts retained the expected Receiver owner, 134-byte allocation, embedded feed ID and `Full` verification. They shared publish time `1791673783`; each was 109 seconds old and rejected by the diagnostic 60-second age limit. Confidence ratios were 4, 7 and 10 bps. The probe sent no transaction.

| Feed | Price × 10^exponent | Confidence × 10^exponent | Publish age | Confidence | Account-data SHA-256 | Adapter |
|---|---:|---:|---:|---:|---|---|
| SOL/USD | 110.22487814 | 0.03624839 | 109 s | 4 bps | `c7f805af6cbd3589765e6745c51e78c4c7a5fdbdf1a2ce35863b2dbe7bdff6bb` | fail: stale |
| BTC/USD | 82,988.70083434 | 0.5498916566 | 109 s | 7 bps | `54bc2b4fb97a42bc10b7d6199c70ca1ea697fac788bada30348c8b4f170bd97e` | fail: stale |
| USDC/USD | 0.99986771 | 0.00090229 | 109 s | 10 bps | `6c8cfcbd9415fdee941fdbf1e303a98678633790e8802b46ce2448e821999373` | fail: stale |

This is an all-stale observation, not evidence to relax the age limit. Fixed-feed publisher recovery, a fresh account observation and approved risk limits remain open; no S5C/S0B admission or S5E consumer proof follows from account decoding alone.

## Fourth current-cluster feed read — 11 October 2026

The read-only SDK-backed probe fetched the same manifest accounts at confirmed slot `509703572`, block time `1791674304` (2026-10-10 23:18:24 UTC / 2026-10-11 07:18:24 +0800), on the pinned Devnet genesis. All accounts still have the expected Receiver owner, 134-byte allocation, embedded feed IDs and `Full` verification. SOL and BTC share publish time `1791674136` and are 168 seconds old; USDC retains publish time `1791673783` and is 521 seconds old. All fail the diagnostic 60-second freshness check. The probe sent no transaction.

| Feed | Price × 10^exponent | Confidence × 10^exponent | Publish age | Confidence | Account-data SHA-256 | Adapter |
|---|---:|---:|---:|---:|---|---|
| SOL/USD | 110.20920186 | 0.03381392 | 168 s | 4 bps | `c0eb2c2ec820222e5b2f7b5632415d5fe31dd585816e927664bd9e0ad9340033` | fail: stale |
| BTC/USD | 82,980.14225850 | 0.05620474150 | 168 s | 7 bps | `d625e7ed55fcc85b39a747f4b53c748439d6fb72a5435d9fff0a30bdf3e8a078` | fail: stale |
| USDC/USD | 0.99986771 | 0.00090229 | 521 s | 10 bps | `6c8cfcbd9415fdee941fdbf1e303a98678633790e8802b46ce2448e821999373` | fail: stale |

The repeated stale basket is an operational blocker for a transaction requiring all configured prices. Do not widen freshness limits to accommodate this sample; prove updater availability or amend the transaction/oracle interface with reviewed evidence before ETF execution.

## Fifth current-cluster feed read — 11 October 2026

The read-only SDK-backed probe fetched all three manifest accounts at confirmed slot `509714460`, cluster time `1791676904` (2026-10-11 00:01:44 UTC), on the pinned Devnet genesis. Each account retained the expected Receiver owner, 134-byte allocation, embedded feed ID and `Full` verification. All three shared publish time `1791676717` (2026-10-10 23:58:37 UTC), so each was 187 seconds old and rejected under the diagnostic 60-second limit. The probe sent no transaction.

| Feed | Price × 10^exponent | Confidence × 10^exponent | Publish age | Confidence | Account-data SHA-256 | Adapter |
|---|---:|---:|---:|---:|---|---|
| SOL/USD | 109.98524202 | 0.03409287 | 187 s | 4 bps | `9f2d7c994d87d296283285b33ca2478b3ebc02cdbd023e2e5b96cf53d518ffa6` | fail: stale |
| BTC/USD | 82,911.35000000 | 57.17850000 | 187 s | 7 bps | `1150eb3cd3edf58491eeedfde9ee2e119d4fe6bb2bf7944be87aa85fb05e3bff` | fail: stale |
| USDC/USD | 0.99989005 | 0.00085995 | 187 s | 9 bps | `c36220981591775e1837281386ed601cebd9693c742ff37ba3d42d3b5b791f50` | fail: stale |

This is another all-stale point observation, not a freshness SLA or reason to relax the diagnostic limit. A three-asset transaction remains blocked unless every configured feed is acceptable in the same snapshot under a reviewed policy.

## Historical replayable current-cluster feed read — 11 October 2026

The read-only probe captured the complete confirmed-commitment JSON-RPC exchanges in [an immutable replay fixture](../../../tools/rebalancing/etf-oracle-probe/snapshots/devnet-509720001-20261011T002351Z.json) at account-context slot `509720001`, cluster time `1791678229` (2026-10-10 23:03:49 UTC), against the pinned Devnet genesis. It records the exact genesis, `getMultipleAccounts`, and matching `getBlockTime` requests/responses, account owner/space/lamports/base64 bytes, and SHA-256 for each account. Replaying this file offline revalidates the manifest and hashes and passes all three original account byte arrays through the pinned Rust SDK decoder.

All three decoded accounts have the expected Receiver owner, 134-byte allocation, expected feed ID, and `Full` verification. At this observation, SOL/BTC were 129 seconds old and USDC was 250 seconds old; all fail the diagnostic 60-second age ceiling. Confidence was 4/7/9 bps respectively under the probe's permissive diagnostic ceiling. Account-data SHA-256 values are SOL `6265630ab6ddab68eec8a639ab4da089bccb64e77c72b2ca69bcffbf4ed6a20f`, BTC `930c13faf4fa36de8ef17a7f66fe80713f45735647140a65a9d87f0fcaa45e3f`, and USDC `8074a2f32b7246cbebfefcb944b7436abd7e534a939e41115d35d4736564d0f6`. No transaction was sent. This establishes reproducible parser compatibility for those bytes only: the unkeyed hashes are not signed RPC attestations, and historical replay proves neither current liveness, SPL-mint backing, approved oracle policy, nor S5E/Devnet admission.



## Previous replayable current-cluster feed read — 11 October 2026

The read-only probe captured the confirmed-commitment Devnet JSON-RPC exchanges in [the raw replay fixture](../../../tools/rebalancing/etf-oracle-probe/snapshots/devnet-509731704-20261011T011029.173938Z.json). At account-context slot `509731704`, cluster time was `1791681027` (2026-10-11 01:10:27 UTC), against genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`. Offline replay through the pinned Rust SDK reproduced all three account decodes and adapter results. All accounts are owned by the Pyth Receiver `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`, have 134-byte allocations, the expected embedded feed IDs, and `Full` verification.

| Feed | Price ± confidence × 10^exponent | Publish time | Age | Confidence | Adapter at diagnostic limits | Account-data SHA-256 |
|---|---:|---:|---:|---:|---|---|
| SOL/USD | `10982769679 ± 4733821`, exponent `-8` | `1791681016` | 11 s | 5 bps | pass | `c00349368dfe8106fd46503fb781efb2e674171390104feccbe815f122976c7c` |
| BTC/USD | `8290823844082 ± 7428906697`, exponent `-8` | `1791681016` | 11 s | 9 bps | pass | `1c5b029291e93e2d34c6b4203f9c7190369adca0fa3000f7ab116411bc72c54a` |
| USDC/USD | `99987602 ± 92148`, exponent `-8` | `1791680992` | 35 s | 10 bps | pass | `94924fff46f0d4720c25ff724cfae1406d91ca1e5ce5cb3e69c45b2428bf2516` |

The adapter pass used only the diagnostic maximum age of 60 seconds and `u16::MAX` confidence bps. These values do not constitute approved production limits. This single fresh basket does not erase earlier stale observations or establish an updater SLA. Replay validates the captured bytes and pinned parser, not current liveness, SPL-mint backing, approved policy, S5C acceptance, or S5E/Devnet admission. No transaction was sent.

## Latest replayable current-cluster feed read — 11 October 2026

The read-only probe captured confirmed-commitment Devnet JSON-RPC exchanges in [the raw replay fixture](../../../tools/rebalancing/etf-oracle-probe/snapshots/devnet-509737667-20261011T013414.241319Z.json). At account-context slot `509737667`, cluster time was `1791682452` (2026-10-11 01:34:12 UTC), against genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`. Offline replay through the pinned Rust SDK reproduced all three decodes. All accounts remain Receiver-owned, 134 bytes, bound to the expected feed IDs and `Full` verified.

| Feed | Price ± confidence × 10^exponent | Publish time | Age | Confidence | Adapter at diagnostic limits | Account-data SHA-256 |
|---|---:|---:|---:|---:|---|---|
| SOL/USD | `11011735457 ± 3287115`, exponent `-8` | `1791682446` | 6 s | 3 bps | pass | `96e9f3601af1066ca4972c04b825867bc30625a1e355e4c48de0f05c111137b8` |
| BTC/USD | `8296392973700 ± 6737165704`, exponent `-8` | `1791682391` | 61 s | 9 bps | fail: stale | `137c8bf24f7bab7e68ce5c065fcb324902f00879a75c5a9568c6c804fd472274` |
| USDC/USD | `99988470 ± 91529`, exponent `-8` | `1791682391` | 61 s | 10 bps | fail: stale | `1246e962ba86a2fba047c9f62b6ea033aa0266df9b2aeb37d38850f4ae5281b3` |

The adapter uses diagnostic limits only: maximum age 60 seconds and maximum confidence `u16::MAX` bps. SOL passes this diagnostic check, while BTC and USDC are one second too old, so the complete basket does not pass. This single observation is not an approved risk threshold, freshness SLA, publisher liveness guarantee, SPL-mint backing claim, or S5C/S5E admission. No transaction was sent.

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
