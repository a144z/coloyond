# S4A — fee loop and solver economics evidence

**Status: NO-GO for parameter selection.** This package supplies a reproducible screening model and synthetic sensitivity fixtures. No current WSOL/USDC market depth, route spread, realized fill fee, solver/keeper arrival rate, or landed transaction cost was available to calibrate production parameters. Do not initialize an executable policy or treat the example values as recommendations.

**Research cut:** 10 October 2026. **Implementation base:** `74792ba5a0a1dd4606a456db8fc0a3b5fec51436`.

## Decision

S4A does not recommend or freeze a protocol fee, reserve split, bounty, auction curve, or minimum fill. Keep the S0/S2 market-evidence gate and S4 policy-configuration gate closed. A plausible percentage split cannot compensate for unknown bid depth and solver costs. The earlier YieldBasis 50/50 or 70/30 examples remain hypotheses and are not inputs to an approved policy.

The model is purposefully a **screen**, not an optimizer. An all-positive run still returns `SCREEN_POSITIVE_REVIEW_REQUIRED`; observed market data, exact transaction simulation, program accounting tests, and explicit S4C policy review remain required. The checked-in scenarios are marked `illustrative_assumption`, therefore the current bundle returns `NO_GO`.

## Existing evidence reviewed

| Evidence | What it establishes | What it does not establish |
|---|---|---|
| [S0D venue economics](venues-economics.md) and [S2 solver probe](s2-solver-probe.md) | No current pool state, WSOL/USDC size-ladder quote, composed fill simulation, CU/account/byte result, landing fee, funded taker, or net return was captured. Public RPC name resolution failed in the prior read-only attempts. | It does not prove that liquidity or RPC access is absent now. Re-run the capture from a working RPC. |
| [S0B asset/oracle evidence](assets-oracle.md) | Fixed Pyth feed identities/update model are described; the dated environment did not resolve RPC to verify live account state or freshness. | It is not a measured oracle uncertainty distribution or a guaranteed feed update interval. |
| [S2B auction math](s2b-auction-math.md), [S2D state machine](s2d-auction-state-machine.md), and `programs/coloyond-vault/src/auction_math.rs` | Current fill arithmetic checks `(gross input − fee) / outgoing value >= curve rate`; fee and bounty caps must be supplied. Bounty is a liability, not immediate payout. | No numeric policy is approved. S4C will change fee/reserve accounting and must validate it against this model and real account deltas. |
| [Solana fee structure](https://solana.com/docs/core/fees/fee-structure) and [compute budget](https://solana.com/docs/core/fees/compute-budget) | Current documented base fee is 5,000 lamports per signature; legacy/v0 priority fee is the ceiling of requested CU limit × micro-lamports/CU ÷ 1,000,000; failed transactions are still charged. CU limits should be based on full-message simulation plus 10% headroom and are capped at 1.4M. These are published protocol facts, not a measured composed-fill cost. | They do not provide a priority price that will land this vault transaction, its CU use, signature count, rent/account setup, or failure frequency. |
| [Solana `getRecentPrioritizationFees`](https://solana.com/docs/rpc/http/getrecentprioritizationfees) | RPC can return recent (up to 150-block cache) fee samples and account-lock-localized estimates when given writable accounts. The sample is not a landing guarantee or a universal clearing price. | No sample for the actual vault/fill writable accounts was obtained here. |
| [Meteora DLMM account and fee model](https://github.com/MeteoraAg/docs/blob/main/developer-guides/dlmm/program/accounts.mdx) and [SDK quote fields](https://github.com/MeteoraAg/docs/blob/main/developer-guides/dlmm/typescript-sdk/reference.mdx) | Pool fee parameters include base and dynamic components, while runtime volatility state affects quoting; SDK quotes expose consumed input, output, fee, protocol fee and price impact. | No actual candidate pool, active bins, fee state or executable depth was captured. Do not model a venue-wide constant fee as a live observation. |
| [Orca Whirlpools implementation](https://github.com/orca-so/whirlpools) and repo [venue review](venues-economics.md) | Concentrated-liquidity depth depends on the active price range and the actual pool state. | No identified WSOL/USDC pool/range quote was measured here. |

The numerical fee values in `scenarios.json` are explicitly scenario assumptions. The 5,000 lamports/signature value is copied from the current Solana fee documentation for a calculation test; no RPC `getFeeForMessage`, writable-account priority sample, full-message CU simulation, or landed fill receipt was obtained for this model. The CLI rejects legacy/v0 compute limits above the documented 1,400,000 CU maximum. A `measured_capture` label is incomplete without a stable capture ID, cluster, UTC capture time, and source references.

## Model and equations

Run from the repository root:

```sh
python3 -m tools.rebalancing.economics --input tools/rebalancing/economics/scenarios.json
python3 -m unittest discover -s tools/rebalancing/economics/tests -v
```

Inputs and outputs are JSON; calculations use Python `Decimal` so repeated runs are deterministic. Each candidate scenario records market regime, direction/bounty asset, planned and minimum fill, maximum executable depth, non-overlapping spread/venue-fee/price-impact bps, oracle-uncertainty and adverse-move haircuts, curve rate, protocol fee, fee-to-reserve split, reserve/liability, per-fill and epoch bounty limits, modeled transaction fees/failures, and own/competitor arrival rates.

- **Depth gate:** `modeled fill = min(planned size, observed/assumed executable depth)`. If this is below the minimum candidate fill, the model reports no executable fill, a 100% empty auction, and `null` for per-fill solver edge. A depth-limited partial fill needs its own full transaction simulation and is marked for that follow-up.
- **Venue realization:** the solver receives the vault's outgoing token and is assumed to unwind it to the paid token. `unwind proceeds = fill × (1 − (spread + venue fee + price impact)/10,000)`. The three cost components must be mutually exclusive and reconcile against the size-specific quote; use actual net quote outputs whenever available rather than a guessed decomposition.
- **Existing curve semantics:** because the on-chain math checks `(gross input − fee) × 10,000 >= outgoing value × curve rate`, candidate gross input value is `fill × curve rate / (10,000 − fee bps)`. This is not an assertion that a solver chooses the exact minimum; it is the most favorable permitted quote for this coarse solver screen. S4C must keep the model synchronized with the final fee contract.
- **Solver edge:** `unwind proceeds + funded bounty − gross input − transaction cost − oracle uncertainty haircut − adverse movement haircut`. The break-even bounty is the nonnegative amount needed to cover the modeled negative edge. A bounty counts only if it is backed by the reserve in the **same incoming token**; USD marks do not make SOL and USDC reserves interchangeable.
- **Transaction cost:** base signature fee plus ceiling priority fee from requested CU limit and CU price, converted from SOL at the scenario SOL/USD mark; add expected failed attempts because Solana charges them too, plus any separately observed rent/relay/inventory costs. Current Solana v1 transaction fee configuration differs; the package's formula is explicitly for legacy/v0 and must be replaced with the transaction message's fee quote for v1.
- **Fee / reserve / holder accounting:** fee is calculated on gross incoming value. The model allocates that fee between holder fee and a hypothetical reserve share; this split is an S4C candidate input, not current IDL behavior. It reports separately the vault's gross price surplus (`gross input − outgoing value`) and the net modeled value capture after bounty. Do not add the fee allocation a second time to NAV: it partitions already received vault value. Expected reserve/bounty values are sensitivities only; S4C must reconcile exact token units, liabilities, claims, and share backing.
- **Competition and empty auctions:** conditionally on positive modeled solver edge and sufficient depth, arrivals use independent homogeneous Poisson rates. `P(any fill) = 1 − exp(−(our rate + competitor rate) × auction duration)`. Under the simplifying assumption of equal economics, `P(our solver first) = our rate/(total rate) × P(any fill)`. If edge is negative or depth insufficient, all solvers are assumed to abstain and the auction is empty. This is a sensitivity model, not measured keeper liveness or a fitted distribution.

The oracle and adverse-movement haircuts are separate inputs; calibrators must prevent overlap. Measure confidence/age and slot-skew risk separately from post-quote movement and transaction landing delay. A Pyth update heartbeat/deviation setting is not a guarantee of a fresh value during every auction.

## Illustrative run

`tools/rebalancing/economics/scenarios.json` contains three deliberately synthetic cases. Running the model on this bundle gives:

| Scenario | Modeled fill | Solver edge after assumed funded bounty | Break-even bounty at those assumptions | Empty-auction probability | Result |
|---|---:|---:|---:|---:|---|
| Quiet, SOL out / USDC bounty | $10,000 | −$38.07 | $46.07 | 100% | NO-GO: assumptions only; representative edge negative |
| Trending, USDC out / WSOL bounty | $4,000 (depth-limited from $10,000) | −$71.05 | $83.05 | 100% | NO-GO: assumptions only; negative edge and partial size unvalidated |
| Volatile, SOL out / USDC bounty | none (assumed depth $250 < $500 minimum) | not estimated | not estimated | 100% | NO-GO: no executable candidate fill |

These outputs prove only that the implementation exercises the formulas and fail-closed gates. They are not observed outcomes, inferred market rates, probability forecasts, or claims about a live venue. Keep their `illustrative_assumption` labels if copied for demos.

## Required evidence before policy selection

Produce a timestamped, reproducible capture for both directions and each predeclared quiet/trending/volatile window. Preserve raw source records and record the cluster genesis, mint/program, vault candidate, exact pool IDs and read slots. At minimum capture:

1. Size-ladder quotes from direct eligible Orca/Meteora/Raydium pool state and any optional router, including consumed size, net output, fee components, impact, bin/tick accounts, and insufficient-depth/no-route results. Do not substitute aggregate TVL or an API quote for executable size-specific state.
2. Pyth account bytes/decoded feed identity, publish time, confidence, update age and slot skew alongside the quote; estimate uncertainty and adverse movement without double-counting.
3. The exact compiled vault + venue + token transaction in simulation: requested and consumed CUs, account count, serialized message bytes/format, writable accounts, logs, min-out, token deltas, and RPC `getFeeForMessage`. Capture `getRecentPrioritizationFees` for the actual writable set over the relevant periods, then retain landed/failed transaction fees and latency from repeated trials.
4. Solver/keeper event data: eligible auctions, opening times, bids/fills, submit/landing times, no-bid/expiry, duplicate races, and whether the executor was eligible for a bounty. Report denominators and sampling window; a keeper's local log alone does not establish the competitor population.
5. Candidate reserve balance and outstanding liability for each incoming asset; epoch demand and maximum fills; seed contribution; exact fee/bounty accounting and share NAV reconciliation. Any proposed fee-funded reserve top-up must be tested as an explicit S4C transition rather than assumed available to fund its own fill.

Then run a sensitivity grid over the measured ranges, both directions, min/median/max executable sizes, worse-than-observed confidence/latency and fee tails, no-bid periods, failed transaction attempts, and depleted reserve. Recommend bounded parameters only when solver edge remains nonnegative at the approved conservative boundary, holder NAV/exit claims conserve exactly, the finite bounty budget is funded in the correct asset, and S4C/Localnet tests validate the final state transitions. Otherwise preserve `NO_GO`, report the missing evidence, and keep funded entry disabled.
