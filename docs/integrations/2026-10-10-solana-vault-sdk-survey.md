# Solana vault / auto-rebalancing SDK survey

Research notes collected on 10 October 2026 while choosing a vault-and-rebalancing
SDK for coloyond. Preserved in English for reference; the original scratch file
(`all-known.txt`) is not committed.

## Summary

The goal is a **multi-asset on-chain vault with automatic rebalancing** and a
**permissionless keeper** that executes rebalances and earns a bounty, so the
holder never signs or pays gas per rebalance. On Solana this is technically
feasible and several protocols already prove each module.

- **`@symmetry-hq/sdk` (Symmetry Protocol)** is the best fit and our chosen
  dependency. It supports `mainnet` and `devnet`, up to 100 tokens per vault,
  Pyth/Raydium aggregated oracle pricing, and exposes `rebalanceVaultTx`
  (keeper-initiated), `updateWeightsTx`, `addBountyTx` and `editAutomationTx`
  through an open-source TypeScript SDK.
- Alternatives considered: Kamino MetaVault SDK (rebalance via
  `startRebalanceIx` / `stopRebalanceIx`, but its tests target a **local
  validator**, not public devnet), Solana Vault Standard / SVS-8 (oracle-weighted
  multi-asset baskets on devnet), Folio Protocol (exponential-decay Dutch auction
  rebalance), and the YieldBasis "arbitrage fee reflow" idea (no off-the-shelf SDK;
  needs custom work).
- Devnet support of the surveyed SDKs was confirmed for `@symmetry-hq/sdk`,
  `@saros-finance/dlmm-sdk`, `@p2p-protocol/sdk`, `@n1xyz/nord-ts` and SVS;
  Jupiter Trigger API and Manifest devnet support was unclear.

## Architecture the system needs

The design combines **limit-order triggering**, **automatic rebalancing** and
**arbitrage fee reflow** into one self-running on-chain vault.

### 1. On-chain vault program (SPL / Anchor)

The base layer. An Anchor program whose core accounts are:

- **Vault PDA** — holds all deposited SPL tokens, controlled by the program.
- **Config account** — stores target weights, drift threshold, limit-order
  parameters, keeper allow-list, and so on.
- **Share token (SPL Token)** — minted on deposit; represents proportional
  ownership and is freely transferable or redeemable.

### 2. Keeper network (off-chain trigger)

Solana has no timers, so any action not started by the user must be submitted by
an off-chain keeper. Options:

- **Self-hosted keeper** — a bot that polls on-chain state (price deviation,
  limit-order trigger conditions) and submits a transaction when conditions are
  met.
- **An existing keeper network** — Jupiter's Trigger API uses its own keeper
  service to trigger limit and TP/SL orders; Symmetry lets **anyone** run a keeper
  to rebalance vaults and earn the bounty.

### 3. Limit-order trigger layer

A limit order can be modelled as an on-chain escrow: when the user submits an
order the assets are locked in a program-controlled account; the keeper watches
the oracle price and, once the trigger condition is met, submits the swap.
Jupiter's Trigger API follows exactly this pattern — creation, fill and
cancellation are all on-chain, and a keeper does the triggering.

### 4. Automatic rebalancing strategy

The vault rebalances toward preset weights when drift passes a threshold.
Reference models:

- **Symmetry** — up to 100 token weights per vault, rebalanced by keepers
  competing through **intents and a Dutch auction**, priced by aggregated
  Pyth/Raydium oracles.
- **Folio Protocol** — rebalances through a **Dutch auction on an exponential
  decay curve**, pre-approved by a `REBALANCE_MANAGER` and opened by an
  `AUCTION_LAUNCHER`.

### 5. Arbitrage and fee reflow (YieldBasis model)

The distinctive part. YieldBasis's core mechanism: the **AMM does not actively
rebalance; instead it adjusts quotes so the path an arbitrageur finds profitable
is exactly the path that restores balance**. Each arbitrage trade leaves its fee
inside the AMM, raising the x0 invariant and improving the pool state.

Applied here:

- When the vault's weights drift with the market, the program opens a
  **rebalance window** (for example, lowering the swap fee for that pair).
- Arbitrageurs spot the spread and trade, helping the vault return to target.
- Part (or all) of the swap fee stays inside the vault as a **rebalancing
  reserve** that subsidises future rebalance gas.

YieldBasis documents that the Curve pool keeps 50% of trade fees as an **internal
rebalance reserve**, with the other 50% going to LPs. A similar split could be
designed: for example 70% of fees back to the vault as rebalancing capital, 30%
to share holders.

## Reusable existing options

| Protocol | Capability to borrow | Key details |
|---|---|---|
| **Symmetry** | Multi-token vault + intent rebalancing + permissionless keeper | Up to 100 tokens, Pyth/Raydium oracles, open-source SDK |
| **Folio Protocol** | Dutch-auction rebalancing + governance approval | Exponential-decay pricing, MEV protection |
| **Kamino** | Concentrated-liquidity auto-rebalancing | Manages Orca/Raydium/Meteora CLMM positions, auto-compounds fees |
| **Meteora** | Idle-fund allocation + compounding | Auto-allocates to lending protocols such as Kamino/MarginFi/Solend |
| **DFM Finance** | On-chain ETF management | Smart-contract non-custodial vault, on-chain NAV, automatic fee accrual |

## Suggested implementation path

**Phase 1 — minimal viable vault**
1. Write a simple Anchor vault: users deposit SOL/USDC, receive share tokens.
2. Configure two token weights (for example 50/50) and write a keeper script that
   calls Jupiter's swap API to rebalance when drift exceeds 5%.

**Phase 2 — add limit-order triggering**
3. Add a limit-order account structure to the vault program so users can submit
   conditional orders.
4. Have the keeper watch both limit-order triggers and rebalance conditions, and
   submit when either is met.

**Phase 3 — introduce arbitrage fee reflow**
5. Implement a simplified AMM or quote mechanism inside the vault that opens an
   arbitrage window when weights drift.
6. Lock part of the swap fee in the vault's **rebalancing reserve account**, for
   that purpose only.

**Phase 4 — decentralise the keeper network**
7. Open a keeper allow-list so anyone can submit rebalance transactions and earn
   a bounty (following Symmetry's permissionless keeper model).

## Key considerations

- **Oracle safety** — rebalancing depends on accurate prices; aggregate Pyth with
  several DEX TWAP sources to avoid a single point of failure.
- **MEV protection** — rebalance transactions can be front-run; Folio uses a
  Dutch auction plus block delay to prevent flash-loan attacks.
- **Keeper incentives** — without enough bounty, keepers may stay inactive and
  rebalancing is delayed. Consider a dynamic bounty scaled to the drift size.
- **Legal / compliance** — a public vault managing other people's assets may
  touch securities law; seek legal advice early.

## Off-the-shelf SDKs (skip the execution-layer work)

Several SDKs let you skip building the execution layer. Devnet support for each is
noted.

### Limit-order / auto-trigger SDKs

- **Jupiter Trigger API (V2)** — the most mature. Supports limit orders,
  take-profit/stop-loss (OCO), conditional chains (OTOCO) and recurring DCA.
  Orders are stored off-chain and triggered by Jupiter's keeper network; you just
  create the order via the API. A **Python SDK** is available, with a devnet test
  endpoint.
- **`@p2p-protocol/sdk`** — a fully on-chain P2P limit order-book DEX, **live on
  Solana devnet**. Supports creating markets, placing limit orders, taking and
  cancelling orders. Program id
  `HazZUxenwxgxDumK5rt89mhXfffnVpA7Nyvx87kMts18`; connect to
  `https://api.devnet.solana.com`.
- **`@n1xyz/nord-ts`** — a TypeScript SDK that **explicitly supports devnet**,
  using `https://api-devnet.n1.xyz` as the API endpoint. Supports limit orders
  (`FillMode.Limit`), session keys and WebSocket subscriptions.
- **Saros DLMM SDK** — provides **DLMM Range Orders** (concentrated-liquidity
  limit orders) and **Auto-Compound** examples for automated yield optimisation
  and position management.
- **Manifest SDK** — a high-performance CLOB order book supporting several order
  types (Limit, PostOnly, ImmediateOrCancel, and so on), with a dedicated
  **Solana Agent Kit** integration; can be deployed on a local validator for
  testing.

### Auto-rebalancing / vault-management SDKs

- **Symmetry Protocol SDK (`@symmetry-hq/sdk`)** — **the core module we need**.
  On-chain multi-token vault infrastructure with automatic rebalancing by a
  **permissionless keeper**. Keepers compete to rebalance through a **Dutch
  auction**, priced by aggregated Pyth/Raydium oracles. **Explicitly supports
  both `mainnet` and `devnet`**, up to 100 tokens per vault. Core operations
  include `createVaultTx`, `updateWeightsTx` and `rebalanceVaultTx`
  (keeper-initiated).
- **Kamino MetaVault SDK (`@kamino-finance/metavault-sdk`)** — a TypeScript SDK
  providing instruction builders and account decoding for multi-token vaults,
  with **rebalancing**, fee management and Scope oracle integration. Rebalancing
  is controlled by `startRebalanceIx` and `stopRebalanceIx`, with a settable
  duration.
- **Solana Vault Standard (SVS)** — an Anchor-built tokenised-vault standard with
  a TypeScript SDK/CLI. **SVS-8 (multi-asset basket) supports oracle weighting
  and weight rebalancing** and is deployed to **devnet**. Also includes variants
  such as SVS-9 (allocator vault, CPI-calls sub-vaults).

### How to combine them

A layered architecture can stitch the SDKs together:

- **Execution layer** — use the **Jupiter Trigger API** for user limit orders
  (buy/sell triggers); you do not write a keeper yourself.
- **Strategy layer** — use the **Symmetry SDK** or **Kamino MetaVault SDK** to
  manage the vault's weight configuration and rebalancing logic.
- **Trigger layer** — your app only watches on-chain vault state (through the
  SDK's query functions); when drift passes the threshold, call the SDK's
  rebalance instruction, or rely on Symmetry's permissionless keeper network to
  do it automatically.

The earlier **arbitrage fee reflow** idea has no off-the-shelf SDK implementing
the YieldBasis pattern directly. You could use **SVS-8** as the vault base, open
an arbitrage window during rebalancing, and move part of the swap fee into the
vault's reserve account manually.

### Summary

| Need | Recommended SDK | Devnet support |
|---|---|---|
| Limit-order auto-trigger | Jupiter Trigger API / @p2p-protocol/sdk | Yes |
| Automatic rebalancing | Symmetry SDK / Kamino MetaVault SDK | Yes |
| Tokenised vault | Solana Vault Standard (SVS-8) | Yes |
| On-chain order book | @n1xyz/nord-ts / Manifest SDK | Yes |

You can avoid writing the execution layer entirely and run the full flow on devnet
using these SDKs' existing instruction builders.

## Devnet support verification (checked SDK by SDK)

**Confirmed devnet support**

- `@symmetry-hq/sdk` (Symmetry): explicit. Both the official docs and the npm
  package state its networks are mainnet and devnet.
- `@saros-finance/dlmm-sdk` (Saros): explicit. Initialised via `MODE.DEVNET`; the
  official tutorials and sample scripts target devnet.
- `@p2p-protocol/sdk` (P2P Protocol): explicit. The npm page states "Live on
  Solana Devnet" and gives the devnet program id
  `HazZUxenwxgxDumK5rt89mhXfffnVpA7Nyvx87kMts18`.
- `@n1xyz/nord-ts` (01 Exchange): explicit. The official quick-start connects to
  devnet and gives the devnet API endpoint `https://api-devnet.n1.xyz`.
- Solana Vault Standard (SVS): explicit. Its GitHub docs list SVS-1 and SVS-2
  devnet program ids and a devnet deployment workflow.

**Unclear, or local-validator only**

- Jupiter Trigger API: available material does not clearly state testnet or
  devnet support; the official docs are mostly mainnet-oriented.
- `@cks-systems/manifest-sdk` (Manifest): no clear information on devnet support
  was found.
- `@kamino-finance/metavault-sdk` (Kamino): special case. Its tests run against a
  **local validator**, not the public devnet, so you can test locally but cannot
  interact with a deployed program on public devnet.

**Conclusion**

`@symmetry-hq/sdk`, `@saros-finance/dlmm-sdk`, `@p2p-protocol/sdk`,
`@n1xyz/nord-ts` and SVS are confirmed usable directly on Solana devnet. Of these,
the Symmetry SDK covers the original "vault auto-rebalancing" need and was chosen
as the core testnet building block for this project.
