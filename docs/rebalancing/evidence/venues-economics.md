# S0D — WSOL/USDC solver economics and venue feasibility

**Status: NOT PASSED — execution-market evidence is blocked.** Research and safe read-only access checks completed 10 October 2026. No wallet was used, no transaction was signed or sent, and no executable-depth number is claimed. Keep funded entry disabled until the S0 gate below is satisfied.

## Decision

Keep the permissionless, bounded Dutch auction as the settlement authority. Treat a solver's venue route as optional inventory sourcing inside the same atomic transaction; a route cannot authorize a vault transfer or weaken the program's price, size, loss, inventory, or post-fee drift checks. A failed route or fill must revert the whole transaction. Do not make Jupiter, one DEX, a quote API, or an operator-controlled account necessary for vault safety or exit.

Current evidence does **not** show that WSOL/USDC has enough executable depth at the protocol's eventual fill sizes, that solvers can earn positive net returns at the permitted auction curve, or that this route composition fits the final program's transaction budget. S0D therefore does not authorize locking auction parameters, advertising automated execution, or starting a funded vault. This is a measurement blocker, not evidence that the pair has no liquidity.

## What was checked and what happened

| Check | Method and source | Outcome | Evidence class |
|---|---|---|---|
| Direct mainnet RPC reachability | Read-only JSON-RPC `getHealth` POST to `https://api.mainnet-beta.solana.com` from this environment, 10 Oct 2026 | DNS resolution failed (`nodename nor servname provided, or not known`). No account, pool, or slot data were returned. | Observed environment/network blocker |
| Jupiter Swap V2 `/build` reachability | Attempt to open the public build URL through the available web reader, 10 Oct 2026 | Endpoint not accessible through that reader. The reader cannot supply the required custom `x-api-key` header; shell network DNS also fails. No `/build` quote or instruction payload was obtained. | Observed tooling blocker; not a Jupiter service failure |
| Jupiter credentials | Local project/environment inspection was not performed for secrets. No API key was supplied to this task. | No credentialed request attempted. | Scope limitation |
| Existing repository probe | [Symmetry/Jupiter probe, 9 Oct 2026](../../integrations/2026-10-09-symmetry-jupiter-probe.md) | Its read-only Jupiter Swap v1 USDC→SOL control quote succeeded; it did **not** quote the exact WSOL/USDC pair or measure pool depth, price impact by size, build composition, or solver economics. Its Symmetry share-mint routes failed. | Prior measured observation; not evidence for this pair |
| Devnet venue state | Requires Devnet RPC/account reads and exact market discovery | Not queried because RPC access is unavailable. A documented Devnet SDK/program deployment alone would not prove a funded WSOL/USDC market. | Unmeasured |

### Live market measurements

No live mainnet or Devnet measurements could be made from this environment. In particular, **there is no measured spot quote, executable depth, spread, price impact, route count, fee, CU use, account count, landing fee, no-bid frequency, or solver net profit** in this report. Do not substitute TVL, token volume, Jupiter's general route count, a pool's reserves, stale quotes, SDK examples, or simulated theoretical depth for these measurements.

The next experiment must report quote-time and network/slot, both full mint addresses and token programs, exact input sizes in raw units and human units, output and minimum output, price impact, route/venue IDs, pool account state/slot, fee, account metas including vault instructions, serialized transaction bytes, simulated CU and logs, and the result for both trade directions. Sample at several sizes spanning the proposed minimum, median, and maximum fill; record no-route/no-liquidity/partial-consumption results as zero executable depth at that size.

## Documented limits and composability

These are published constraints, not measurements of our prospective transaction:

| Constraint | Documented limit or behavior | Effect on this design |
|---|---|---|
| Solana atomicity | All instructions in a transaction succeed together or all state changes revert; fees can still be charged on failure. | A solver can compose venue sourcing and the auction fill atomically. It still pays network fees for failed attempts. [Solana transactions](https://solana.com/docs/core/transactions) |
| Legacy/v0 transaction bytes | 1,232 bytes. v0 address lookup tables shorten account addresses but do not raise the byte ceiling. | Measure the complete route + vault fill + setup/cleanup + compute/fee instructions after compilation. |
| Solana v1 transaction bytes | 4,096 bytes; 64-account enforced lock limit remains as documented; wallets and tooling must support v1. | It can reduce wire-size pressure, not account-lock/CU pressure. Do not rely on v1 until the selected Android wallet signs it and the exact transaction simulates. [Versioned transactions](https://solana.com/docs/core/transactions/versioned-transactions) |
| Accounts | 64 accounts per transaction currently enforced; 128 only if the feature is activated. Jupiter `/build` documents `maxAccounts` default 64 and accepts 1–64. | The vault accounts consume part of the route budget, so set a lower route budget and test complete compositions; an API quote alone is insufficient. [Solana constants](https://solana.com/docs/core/constants-reference), [Jupiter Router Build](https://developers.jup.ag/docs/swap/build) |
| Compute | 1,400,000 CU maximum per transaction; simulation is the documented way to estimate actual use. | Simulate every full composition, including Pyth checks, vault fill, token transfers, and DEX CPIs. Reject routes over the bound; do not infer CU from the stand-alone swap. [Solana compute budget](https://solana.com/docs/core/fees/compute-budget) |
| Jupiter Router `/build` | Metis Router returns raw instructions, quote data, setup/cleanup, compute-price instruction, optional tip, lookup-table addresses, and blockhash metadata. Caller composes, signs, and submits; `/build` transactions cannot use `/execute`. Router is Metis-only; `/order` uses multiple engines and is a different path. | It is technically suitable for an **optional off-chain solver adapter** to construct a transaction whose swaps execute on-chain. The service's quote/route construction is still an availability and integrity input to the solver, so the vault must validate actual settlement on-chain. Do not use `/order`, `/execute`, Trigger, private RFQ execution, or hosted order custody. [Jupiter Router Build](https://developers.jup.ag/docs/swap/build) |
| Jupiter fees and account budget | `/build` states no Jupiter swap fee by default; `platformFeeBps` adds an integrator fee. Its route `maxAccounts` defaults to 64. | Set no platform fee unless explicitly included in solver net economics and independently bounded. A route that consumes nearly all available accounts is not composable with the vault. |
| Orca Whirlpools | Official program is deployed to mainnet and Devnet; official SDKs provide account/instruction/math layers. Concentrated liquidity is price-range dependent. | Candidate direct venue for read-only pool-state quoting; an SDK capability or audited program is not proof of this pair's active liquidity/depth. [Whirlpools repository](https://github.com/orca-so/whirlpools) |
| Meteora DLMM | Official SDK documents loading a pool, fetching directional bin arrays, quoting, then building a swap; quotes can be partially consumed and can fail for insufficient bin-array liquidity. The published program ID is the same for mainnet and Devnet. | Candidate direct venue. Report consumed input, output, fee, price impact and every bin-array account for each size; partial-fill handling must be reconciled with the auction amount. [DLMM SDK examples](https://github.com/MeteoraAg/docs/blob/main/developer-guides/dlmm/typescript-sdk/examples.mdx), [program IDs and limits](https://github.com/MeteoraAg/docs/blob/main/developer-guides/dlmm/index.mdx) |

Router build is not equivalent to a market maker, standing order book, guaranteed taker, or on-chain trigger. The vault auction and its state remain on-chain; keepers/solvers only observe and submit transactions. An off-chain route service may disappear without making claims inaccessible or allowing invalid fills.

## Solver economics: required model, not measured results

For a candidate fill, calculate the taker's conservative net value in a common numeraire:

```text
net_edge = value_at_independent_fresh_oracle(vault_asset_received)
         - value_at_independent_fresh_oracle(solver_asset_paid)
         - venue_fee_and_price_impact
         - swap/transfer fees
         - transaction base + priority fee + optional relay tip
         - inventory funding / hedging cost
         - adverse selection and expected price movement before landing
         + explicitly claimable bounty (only if this solver is eligible)
```

Compute executable inputs and outputs from venue state at the same context slot, and compare both route quote and bounded on-chain auction price. Do not count keeper bounty as taker profit unless the same actor is entitled to claim it and the bounty is actually funded. Use conservative uncertainty haircuts for feed confidence, quote age, slot skew, reordering, and transaction expiry. Require positive net edge above a measured risk/operations buffer at the **worst allowed fill price** before recommending the auction's starting/ending discounts. Model both directions and small/dust fills, since fixed transaction cost can make tiny fills uneconomic even when large trades are profitable.

For a constant-product pool only, the idealized no-fee exact-input output is `y - k/(x + dx)` for reserves `x,y`; this is not a usable depth result for concentrated-liquidity pools or DLMM bins, and ignores fees, other traders, slippage limits, token transfer rules and account/CU caps. No reserve values were available here, so no numeric curve or profit estimate is presented.

### No-bid and failure cases the prototype must show

- No pool or no route at a fill size: no fill; intent stays pending until bounded expiry/finalization.
- Liquidity exists but safe net edge is nonpositive: rational solver abstains; keeper cannot widen the loss cap to force activity.
- Concentrated range/bin exhausted: route reports partial consumption or insufficient liquidity; either lower the fill amount under the frozen contract or fail atomically.
- Price moves or account state changes after quote: venue minimum-output guard and vault oracle/loss/drift checks reject; the whole transaction reverts.
- Excess account/CU/bytes or stale blockhash: no state change; failed transaction fee may be charged.
- No keeper or bounty depleted: any independent caller may start/finalize eligible state; no-bid status and exit remain observable; in-kind redemption does not depend on venue depth.

## Smallest next safe experiment

Run a separately isolated read-only probe when network access and the required Jupiter API key are available. It must not sign, send, or request user/vault authority.

1. Query mainnet and Devnet RPC for exact canonical WSOL and USDC mint accounts, token program/decimals, current slot, and active Orca Whirlpools, Meteora DLMM, and Raydium pools matching the exact mint pair. Save pool addresses and decoded account/bin/tick state with their read slots. If a public RPC blocks pool scans, use a paid/indexing API only to discover candidate addresses, then verify each candidate and all balances directly against RPC account data.
2. For both directions, produce read-only venue quotes at a fixed size ladder (include the proposed min/median/max fill once S0F parameters are frozen). Quote each direct pool from its current on-chain state; separately request Jupiter Router V2 `/build` for comparison. Record timestamp/slot, raw amounts, consumed amount, output, fee, price impact, minOut, route labels, pool IDs, token accounts, address metas, LUTs, and API errors. Jupiter quote is comparative only.
3. Compose only a **simulated unsigned** transaction: swap instructions plus a local mock vault-fill instruction with the intended account shape. Use `simulateTransaction` with signature verification disabled, inspect logs, `unitsConsumed`, account keys, serialized bytes and account-lock count. No transaction submission. Since the actual program/IDL is not yet present, clearly label a mock simulation and repeat against the frozen IDL/Devnet deployment before passing S0D/S2C.
4. Calculate solver net edge at the auction's maximum allowed discount after all route/chain/inventory costs. Show the no-bid result for safe-negative edge, insufficient direct pool liquidity, failed route, and over-budget composition. A quote path dependent only on Jupiter fails the independent-venue acceptance criterion.

If a real fill is later needed to prove landing and economic realization, perform it only with explicit authorization, a separate funded test vault/solver, fixed low caps, and a reviewed transaction preview; this report does not authorize that experiment.

## S0D / S0 gate

**Result: BLOCKED / NOT PASSED.** The existing spec's auction design remains the preferred authority model, but the required evidence is missing. S0F must record this package as an unresolved technical admission; S2C must not claim a solver proof or change safe bounds based on a Jupiter quote alone.

Pass only when all are true:

- [ ] Direct, on-chain verified WSOL/USDC pool state and executable depth are captured on the target network for both directions and the proposed min/median/max trade sizes.
- [ ] At least one independent non-Jupiter venue path is quoteable and composable, or the specification explicitly keeps that route optional while demonstrating that solver sourcing is available independently.
- [ ] The full fill transaction is simulated against the pinned IDL/program; account count, bytes/version, CU, priority fee, expiry, and token deltas fit with operational headroom.
- [ ] At least one conservative size shows positive taker net edge at the worst permitted auction price after every cost; no-bid conditions safely stall/expire rather than widen loss bounds.
- [ ] The same evidence states what was observed, the context slot/time, and what remains a model or assumption. Devnet faucet liquidity is not treated as mainnet market depth.

## Primary sources

- Solana transaction atomicity and wire/account limits: [Transactions](https://solana.com/docs/core/transactions), [versioned transactions](https://solana.com/docs/core/transactions/versioned-transactions), [constants](https://solana.com/docs/core/constants-reference).
- Solana CU and fee budget: [Compute Budget](https://solana.com/docs/core/fees/compute-budget), [Fees](https://solana.com/docs/core/fees).
- Jupiter current Router: [Swap API V2 — Build](https://developers.jup.ag/docs/swap/build), [Router API reference](https://developers.jup.ag/docs/api-reference/swap/build).
- Direct venue clients: [Orca Whirlpools official repository](https://github.com/orca-so/whirlpools), [Meteora DLMM SDK examples](https://github.com/MeteoraAg/docs/blob/main/developer-guides/dlmm/typescript-sdk/examples.mdx), [Meteora DLMM program/SDK overview](https://github.com/MeteoraAg/docs/blob/main/developer-guides/dlmm/index.mdx).
- Repository-specific observations: [Symmetry/Jupiter probe](../../integrations/2026-10-09-symmetry-jupiter-probe.md), [rebalancing plan](../../product/onchain-portfolio-rebalancing-plan.md), [sprint checklist](../../product/onchain-portfolio-rebalancing-sprint-checklist.md).
