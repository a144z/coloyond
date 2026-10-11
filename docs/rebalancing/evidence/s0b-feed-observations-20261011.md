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

## Limits and remaining admission work

These snapshots show that the pinned account addresses exist and decode correctly at finalized commitment on both clusters. They do not establish continued feed delivery, two independent pusher operators, accepted confidence/exponent/freshness limits, USDC redemption/backing, a live ETF consumer transaction, or safe executable liquidity. The Devnet test-BTC and test-USD labels remain synthetic/unbacked. S0B remains held until the risk limits and repeated observations are reviewed, the updater path is demonstrated, the exact SBF integration rejects unsafe cases, and the required issuer/freeze/depeg disclosure is present. No transaction was sent.
