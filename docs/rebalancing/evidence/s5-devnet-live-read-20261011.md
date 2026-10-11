# S5 live Devnet read-adapter probe — 11 October 2026

**Result:** public Devnet RPC identity and the pinned candidate mint/feed accounts were read at `finalized`; all feed accounts decoded with the expected Receiver owner, `PriceUpdateV2` allocation, embedded feed ID and `Full` verification. This is a point-in-time read only. No wallet was connected, no transaction was created or submitted, and no ETF program or pool is deployed/configured.

## RPC observation

| Field | Observation |
|---|---|
| RPC endpoint | `https://api.devnet.solana.com` |
| Commitment | `finalized` |
| Genesis hash | `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` (matches the pinned Devnet genesis) |
| Account batch context slot | `509792525` |
| Context block time | `1791695536` (`2026-10-11 05:12:16 UTC`) |
| Program / pool | Not configured / not deployed |
| Asset admission | Not admitted; these are exact candidate addresses only |
| Wallet / signature | None / none |

## Exact candidate account reads

| Account | Owner | Data length | Parsed observation | SHA-256 of account data |
|---|---|---:|---|---|
| WSOL mint `So11111111111111111111111111111111111111112` | Classic SPL Token `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | 82 | Initialized, 9 decimals; no mint or freeze authority in this read | `b0f919425a529f4971ef8dabd535aec34947d5c8c4885df80dae91635b98c5f3` |
| Test USD mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` | Classic SPL Token `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | 82 | Initialized, 6 decimals, supply `16286767455804391005` base units; mint authority `GrNg1XM2ctzeE2mXxXCfhcTUbejM8Z4z4wNVTy2FjMEz`; freeze authority `CJtyoKSLrktozQzjERTiK3btQtiTK3nN4QrqGHLidyCT` | `17bccfa325ccf34feae7c26caacf91fbf210b4d7ed065925229d61ab521e6055` |
| SOL/USD `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE` | Pyth Receiver `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ` | 134 | Expected feed ID `0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d`; Full; price `10948041805 × 10^-8`; confidence `3869378`; confidence ceiling 4 bps; publish age 228 seconds; freshness `unconfigured` | `9487215cbcbeb201b472073c1835ef183204c009f961aaab8af0c831bf262f4f` |
| BTC/USD `4cSM2e6rvbGQUFiJbqytoVMi5GgghSMr8LwVrT9VPSPo` | Pyth Receiver `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ` | 134 | Expected feed ID `0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43`; Full; no BTC mint is admitted or paired to this feed; price age 228 seconds; freshness `unconfigured` | `2452a2b5755891795a39079369067fcaa8e24af994ad96bfcab610460f4df5ba` |
| USD/USD `Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX` | Pyth Receiver `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ` | 134 | Expected feed ID `0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a`; Full; price `99987097 × 10^-8`; confidence ceiling 10 bps; publish age 228 seconds; freshness `unconfigured` | `b4af12120c19f1e4509d399d470825c8e9486eac735a91cb40a5a74cd6c8b676` |

The candidate Test USD mint remains **synthetic, unbacked, and not redeemable as USDC**; this feed observation does not establish backing. No BTC mint is admitted, so the BTC feed row is an unpaired candidate observation and is excluded from the proposed two-asset test profile. The WSOL/Test USD profile itself remains a draft and not admitted.

All three fixed-feed observations were 228 seconds old at the same finalized batch context. The 60-second figure remains diagnostic only, not approved policy; this read is stale under that diagnostic. No limit was defaulted by the client and no risk-increasing action is eligible. The live read does not establish continuing freshness, updater independence, successful on-chain consumption, or asset admission. See the [draft profile and blockers](s5-devnet-test-profile.md) and [S5C oracle evidence](s5-oracle.md).

## Reproduction and validation

The probe used the S5F `readDevnetCandidateState` adapter against the public RPC at `finalized`, then made one `getMultipleAccountsInfoAndContext` read for the two mint and three feed addresses. Account hashes above are SHA-256 over the returned account-data bytes. The parser and mutation suite passed with `npm --prefix packages/etf-client test` (31/31) and `npm --prefix packages/etf-client run typecheck`. The ordinary sandbox run of the test command initially failed because `tsx` could not create its temporary IPC pipe; the same local test command passed when rerun with the required execution permission. No transaction or wallet signing test was attempted.
