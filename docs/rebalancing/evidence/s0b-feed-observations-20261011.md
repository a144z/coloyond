# S0B — finalized Pyth feed observations (11 October 2026)

**Status:** read-only finalized account observations decoded with the pinned SDK. These captures establish point-in-time account identity and parser behavior. They do not select the risk policy, prove ongoing publisher liveness, or pass S0B admission.

## Capture method

The replayable probe checked cluster genesis, fetched all three manifest-pinned shard-zero `PriceUpdateV2` accounts with `commitment: finalized`, read the block time for the exact account-context slot, and passed the raw bytes through the repository-pinned Pyth Receiver SDK. Exact RPC requests and responses are preserved in:

- Mainnet-beta: [finalized slot 455474123 capture](../../../tools/rebalancing/etf-oracle-probe/snapshots/mainnet-beta-finalized-455474123-20261011T014510.391740Z.json), captured at `2026-10-11T01:45:10.391740Z`; account-context slot `455474123`, cluster time `1791683102` (`2026-10-11 01:45:02 UTC`), genesis `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d`.
- Devnet: [finalized slot 509739413 capture](../../../tools/rebalancing/etf-oracle-probe/snapshots/devnet-finalized-509739413-20261011T014109.588897Z.json), captured at `2026-10-11T01:41:09.588897Z`; account-context slot `509739413`, cluster time `1791682867` (`2026-10-11 01:41:07 UTC`), genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`.

Every account decoded as owned by Pyth Receiver `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`, with a 134-byte allocation, the expected embedded feed ID and `Full` verification.

## Mainnet-beta observation

| Feed | Account | Price ± confidence × 10^exponent | Publish age | Confidence | Pinned adapter at diagnostic limits | Data SHA-256 |
|---|---|---:|---:|---:|---|---|
| SOL/USD | `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE` | `11001708465 ± 3838003`, exponent `-8` | 10 s | 4 bps | pass | `50da9416860364abc1e586bdcb62c4ba85030289dbe7812d8cacd9e4f4992833` |
| BTC/USD | `4cSM2e6rvbGQUFiJbqytoVMi5GgghSMr8LwVrT9VPSPo` | `8293827706759 ± 6083793241`, exponent `-8` | 10 s | 8 bps | pass | `d70390b1cdeaf8d3c70723923ced9f8a7f8559a628f78a168c2ea721c77a6799` |
| USDC/USD | `Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX` | `99988708 ± 90542`, exponent `-8` | 10 s | 10 bps | pass | `a8234eb8801f74aa48fbc0d6da9593dbd76df30b8bffef3cf4187fd839836622` |

All three passed only the diagnostic 60-second age check and permissive `u16::MAX` confidence ceiling. This is one observation, not an approved confidence limit or freshness guarantee.

## Devnet observation

| Feed | Account | Price ± confidence × 10^exponent | Publish age | Confidence | Pinned adapter at diagnostic limits | Data SHA-256 |
|---|---|---:|---:|---:|---|---|
| SOL/USD | `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE` | `11014709783 ± 2418419`, exponent `-8` | 140 s | 3 bps | fail: stale | `36d34d80ff3b0fe866416d06f25d1de7ef7ebb5bcfca9bb9fea5fa8240a0788a` |
| BTC/USD | `4cSM2e6rvbGQUFiJbqytoVMi5GgghSMr8LwVrT9VPSPo` | `8299385000000 ± 7365117666`, exponent `-8` | 140 s | 9 bps | fail: stale | `76ec2b53b51bb88e78e4e54c2ad8fe4e37796ce9af30e178a8fbe7ff407f8c69` |
| USDC/USD | `Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX` | `99988470 ± 91529`, exponent `-8` | 476 s | 10 bps | fail: stale | `1246e962ba86a2fba047c9f62b6ea033aa0266df9b2aeb37d38850f4ae5281b3` |

The Devnet basket failed the diagnostic 60-second age check on all three feeds. The Mainnet and Devnet observations were taken several minutes apart, so they are not a synchronized cross-cluster price comparison.

## Follow-up finalized observation

A second read was captured at 2026-10-11 01:49 UTC to check whether the prior Mainnet freshness result repeated and whether Devnet recovered. Replayable captures: [Mainnet-beta slot 455475245](../../../tools/rebalancing/etf-oracle-probe/snapshots/mainnet-beta-finalized-455475245-20261011T014914.291764Z.json), read at slot time `1791683346` (`2026-10-11 01:49:06 UTC`), and [Devnet slot 509741455](../../../tools/rebalancing/etf-oracle-probe/snapshots/devnet-finalized-509741455-20261011T014915.779001Z.json), read at slot time `1791683354` (`2026-10-11 01:49:14 UTC`). Both were finalized and decoded through the same pinned SDK.

| Cluster | Feed | Price ± confidence × 10^exponent | Publish age | Confidence | Diagnostic age check | Data SHA-256 |
|---|---|---:|---:|---:|---|---|
| Mainnet-beta | SOL/USD | `11003125948 ± 3361120`, exponent `-8` | 42 s | 4 bps | pass | `8e7388721d5dbc4ca619b24b7012ffcb869b2bc94f3fd2dce98dd7f221142d0f` |
| Mainnet-beta | BTC/USD | `8294930625149 ± 6819522542`, exponent `-8` | 42 s | 9 bps | pass | `ba03b4b09a88eadc7177c8b9de1a761bbf6c46989d3609918a6c9ccba687e038` |
| Mainnet-beta | USDC/USD | `99986057 ± 97342`, exponent `-8` | 42 s | 10 bps | pass | `67d670544078514c92c80da5453f115d0635d783d5f3fa4a24662a9ddc7202bd` |
| Devnet | SOL/USD | `11000939454 ± 4555046`, exponent `-8` | 310 s | 5 bps | fail: stale | `73fe2200084043ed39c346cb19c793dd9f0a15b3ab4d34415fcb61708762f824` |
| Devnet | BTC/USD | `8293832013480 ± 7228138354`, exponent `-8` | 310 s | 9 bps | fail: stale | `edcc67e3713785b7a83bd41fba10d804819038556a22f9c8702161c2993d6e64` |
| Devnet | USDC/USD | `99987522 ± 87478`, exponent `-8` | 310 s | 9 bps | fail: stale | `c6e76e0d33703776afeb49a188c6a14a16373d527aab8145b4be7fa2ecec3e7c` |

This second sample again found the entire Mainnet basket within the diagnostic age ceiling and the entire Devnet basket stale. Two point observations on Mainnet and repeated stale Devnet observations still do not establish a freshness service-level guarantee, an approved risk ceiling, or feed-publisher/operator independence.

## Third finalized observation — 11 October 2026

A third read checked the two clusters about thirteen minutes after the previous sample. The replayable captures are [Devnet slot 509744939](../../../tools/rebalancing/etf-oracle-probe/snapshots/devnet-finalized-509744939-20261011T020306.828728Z.json), with block time `1791684185` (`2026-10-11 02:03:05 UTC`), and [Mainnet-beta slot 455479127](../../../tools/rebalancing/etf-oracle-probe/snapshots/mainnet-beta-finalized-455479127-20261011T020316.444005Z.json), with block time `1791684188` (`2026-10-11 02:03:08 UTC`). Both snapshots passed the pinned Rust SDK decoder and retained the expected Receiver owner, account allocation, feed IDs and `Full` verification.

| Cluster | Feed | Price ± confidence × 10^exponent | Publish age | Confidence | Diagnostic age check | Data SHA-256 |
|---|---|---:|---:|---:|---|---|
| Devnet | SOL/USD | `10993213228 ± 3590186`, exponent `-8` | 166 s | 4 bps | fail: stale | `dcb33d68d5806e56a4e9e382a18f41a53320a86dee591640d4bdaec4734de02d` |
| Devnet | BTC/USD | `8293827000000 ± 7152644753`, exponent `-8` | 166 s | 9 bps | fail: stale | `83bc1348cab5f250c6f964a8ab76937142d66c9309f375a5f16985ef3da15761` |
| Devnet | USDC/USD | `99987680 ± 87320`, exponent `-8` | 166 s | 9 bps | fail: stale | `602f0a36beb6fb53c06c2dd0e2605c52086d42ef03b9bd9b38ec0299175952a0` |
| Mainnet-beta | SOL/USD | `10992300789 ± 3586124`, exponent `-8` | 33 s | 4 bps | pass | `70c2cb1618f2b9a3929a15e226d3c7483ede201ba41ae81ad4e2322631416531` |
| Mainnet-beta | BTC/USD | `8293861032860 ± 7285306075`, exponent `-8` | 33 s | 9 bps | pass | `4e48a4f0fc4ceb15ec48789d4b7cd307ffa53eafbf408a3df84c3e4cabd102d5` |
| Mainnet-beta | USDC/USD | `99986821 ± 92929`, exponent `-8` | 33 s | 10 bps | pass | `81fe37a789833a388b084de5a66a3755bea81d36d2616281f406aeee848a528b` |

Mainnet again passed only the diagnostic 60-second age ceiling; Devnet again had all three feeds stale. The RPC block times were three seconds apart, but the feed publish times differed by 136 seconds, so these are not a synchronized price comparison. Repeated stale Devnet reads do not prove why updates were delayed, who operated a publisher, or what service-level freshness a future runtime can deliver.

## Limits and remaining admission work

These snapshots show that the pinned account addresses exist and decode correctly at finalized commitment on both clusters. They do not establish continued feed delivery, two independent pusher operators, accepted confidence/exponent/freshness limits, USDC redemption/backing, a live ETF consumer transaction, or safe executable liquidity. The Devnet test-BTC and test-USD labels remain synthetic/unbacked. S0B remains held until the risk limits and repeated observations are reviewed, the updater path is demonstrated, the exact SBF integration rejects unsafe cases, and the required issuer/freeze/depeg disclosure is present. No transaction was sent.
