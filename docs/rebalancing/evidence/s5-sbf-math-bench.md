# S5 Q96 isolated SBF compute probe

**Status:** source-level quote compute measured on an isolated local validator. This is not an integrated ETF instruction budget and does not unblock S5B/S5E by itself.

The reproducible probe is [`tools/rebalancing/etf-math-sbf-bench`](../../../tools/rebalancing/etf-math-sbf-bench/README.md). It builds the production `coloyond-etf-math::quote_exact_in` into a small no-state SBF program, submits it to a disposable local validator, then reads confirmed transaction metadata and logs back through RPC.

## Environment

- Solana validator/runtime: 2.3.0
- SBF platform tools: v1.48, rustc 1.84.1
- Math crate: `coloyond-etf-math` at the commit containing this evidence
- Benchmark program: `2R3T6tXfX3NJtY18jfphc4Z8uQwHnSQytk5UCaS74PjN`
- Local validator genesis: `43BDSJCG9RVRtG5ozfQx9BDT1WrZoqhqGphqApdN9yRQ`
- All signatures below are confirmed on this disposable Localnet. No Devnet or Mainnet funds or accounts were used.

## Confirmed measurements

| Case | Inputs | Output from program log | Compute units | Confirmed slot / signature |
|---|---|---:|---:|---|
| Near-`u64`, 99:1 tiny input | Reserves `[u64::MAX - 1,000, u64::MAX]`, weights `[9,900, 100]`, input `1`, fee `0` | 98 | 27,432 | 18 · `3VgRsVJmRCSPzHqWpJMa7rjqZhVPCtzRVMAcgnoTkJrMhoHfPhDR9oKvinq7k9o1Ck4hpRzXyoBTDLQJpk4YPdo9` |
| Three-asset near-`u64` boundary | Reserves `[u64::MAX - 1,000, u64::MAX, 1]`, weights `[9,800, 100, 100]`, input `1,000`, fee `30` bps | 97,705; fee 3 | 27,453 | 19 · `Z6ZzDroyarATZAVsNYBPdH5SFMYM76k1BLGJLK2AwWSQFS3tr3wuaF6kN8FibHPtrGm79U2S686PM7hHr8bZmcb` |
| Balanced fee quote | Reserves `[1,000,000, 1,000,000]`, weights `[5,000, 5,000]`, input `100,000`, fee `30` bps | 90,661; fee 300 | 28,059 | 20 · `2hfk9BJJNvUZo1dFY5422UfNbnBwXPbHJ8t842ZHNXXKZFqU65HiqTo6KnQymQxWxe73MYoARzzSfpWPDx1z472n` |

The isolated quote path used 27,432–28,059 CU across these three inputs. This is a reproducible baseline for the pure quote call only. It omits the ETF program's account validation/serialization, oracle parsing, token transfers, events, PDA derivation and any scheduler CPI. The three-asset case exercises the quote function with a third reserve/weight present; it does not prove preservation of the full three-asset weighted invariant. Measure the integrated ETF instruction after S5E exists and retain the separate whole-invariant proof gate.
