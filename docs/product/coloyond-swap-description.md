# coloyond — Cross-Chain Atomic Swap Aggregator

> Product specification. This document was translated from the original Chinese
> `swap_description.txt` so the repository contains no non-English source content.

## 1. Product positioning

coloyond is the first cross-chain aggregator that encapsulates Swap → Bridge → Swap into a
single atomic transaction. A user only needs to express "I want to swap token X on chain A for
token Y on chain C", and the system automatically completes multi-hop route discovery, bridge
selection, destination-chain swap execution, and failure rollback.

Core differentiators:

- **Atomicity guarantee.** If any step fails, the entire transaction rolls back, so the user is
  never left stuck in an intermediate state.
- **Meta-aggregation.** Queries multiple aggregators and bridges simultaneously — CrossCurve,
  Rango, LI.FI, deBridge, THORChain, 1inch Fusion+, and others — and compares full paths.
- **Route visualization.** Shows the complete path graph in real time, including the estimated
  duration, cost, and atomicity level of every step.

## 2. Confirmed bridge and aggregator matrix

According to the Curve bridge page (<https://www.curve.finance/bridge/arbitrum>), Curve's own
bridging capability is centered on crvUSD FastBridge, which supports bridging crvUSD back to
Ethereum mainnet from Arbitrum, Optimism, and Fraxtal — bypassing the 7-day challenge period for
settlement in about 15 minutes. The page explicitly recommends using the native bridge or a bridge
aggregator to move funds between other networks.

coloyond needs to integrate the following complete bridge and aggregator matrix:

| Protocol         | Type                              | Integration                     | Key capability                                       |
| ---------------- | --------------------------------- | ------------------------------- | ---------------------------------------------------- |
| CrossCurve/EYWA  | Meta-aggregation + consensus bridge | TypeScript SDK + REST API     | Aggregates many aggregators and bridges, 30+ chains  |
| deBridge DLN     | Cross-chain order network         | REST API + TS/Python SDK        | EVM + Solana, 19+ chains                             |
| Rango Exchange   | Bridge + DEX aggregator           | TS/Python/Rust SDK + REST API   | Full-path route discovery                            |
| LI.FI            | Bridge + DEX aggregator           | TypeScript SDK + REST API       | Any-to-Any cross-chain swap                          |
| SwapKit          | Cross-chain swap aggregator       | REST API + Widget               | 30+ chains, multiple providers                       |
| THORChain        | Native cross-chain swap           | REST API + MCP Server           | Native assets such as BTC/ETH                        |
| 1inch Fusion+    | Intent-based cross-chain swap     | REST API + Fusion SDK           | Competitive resolver execution                       |
| Curve FastBridge | crvUSD L2→mainnet fast bridge     | Direct on-chain contract calls  | crvUSD settlement in about 15 minutes                |

## 3. UI design

### 3.1 Main interface — Swap input area

```text
┌─────────────────────────────────────────────────────────┐
│  coloyond                              [Connect]    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─ FROM ─────────────────────────────────────────────┐ │
│  │  Chain: [Arbitrum ▼]                              │ │
│  │  Token: [ETH ▼]         Balance: 2.45 ETH        │ │
│  │  Amount: [1.0        ]                            │ │
│  └────────────────────────────────────────────────────┘ │
│                          ⇅                              │
│  ┌─ TO ───────────────────────────────────────────────┐ │
│  │  Chain: [Optimism ▼]                              │ │
│  │  Token: [USDC ▼]                                  │ │
│  │  You receive: ~1,842.30 USDC                      │ │
│  └────────────────────────────────────────────────────┘ │
│                                                         │
│  ⚡ Atomic Execution: ON    Gas: ~$4.20                  │
│  ┌────────────────────────────────────────────────────┐ │
│  │           [ Find Best Route → ]                    │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### 3.2 Route discovery and comparison view

After the user clicks "Find Best Route", the system queries all aggregators in parallel and
presents a multi-route comparison:

```text
┌─────────────────────────────────────────────────────────┐
│  ← Back to Swap          Best Routes Found (4)         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─ Route A ─ BEST PRICE ────────────────────────────┐ │
│  │  🟢 CrossCurve MetaRoute                           │ │
│  │  ETH (Arbitrum) → [Curve Pool Swap] → crvUSD      │ │
│  │  → [FastBridge] → crvUSD (Ethereum)               │ │
│  │  → [Curve Pool Swap] → USDC (Optimism)           │ │
│  │  Output: 1,847.20 USDC   Time: ~4 min             │ │
│  │  Fee: $2.10   Atomic: ✅ Full                    │ │
│  │  [ Select Route ]                                 │ │
│  └────────────────────────────────────────────────────┘ │
│                                                         │
│  ┌─ Route B ─ FASTEST ───────────────────────────────┐ │
│  │  🟡 deBridge DLN + Rango                          │ │
│  │  ETH (Arbitrum) → [deBridge DLN] → USDC (Optimism)│ │
│  │  Output: 1,839.50 USDC   Time: ~1.5 min           │ │
│  │  Fee: $3.40   Atomic: ⚠️ Partial                  │ │
│  │  [ Select Route ]                                 │ │
│  └────────────────────────────────────────────────────┘ │
│                                                         │
│  ┌─ Route C ─ MOST ATOMIC ───────────────────────────┐ │
│  │  🔵 CrossCurve + THORChain                        │ │
│  │  ETH (Arbitrum) → [THORChain Swap] → BTC          │ │
│  │  → [CrossCurve Bridge] → USDC (Optimism)          │ │
│  │  Output: 1,830.10 USDC   Time: ~6 min             │ │
│  │  Fee: $1.80   Atomic: ✅ Full                     │ │
│  │  [ Select Route ]                                 │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### 3.3 Atomic execution and live tracking

After the user confirms a route, the execution tracking view appears:

```text
┌─────────────────────────────────────────────────────────┐
│  Executing Route A                    Status: Step 2/3 │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Step 1  ✅  Swap on Arbitrum                          │
│  ─────────────────────────────────────                  │
│  ETH → crvUSD via Curve Pool                           │
│  TX: 0x3f2a...  Confirmed (12/12 blocks)              │
│                                                         │
│  Step 2  🔄  Bridge via FastBridge                     │
│  ─────────────────────────────────────                  │
│  crvUSD (Arbitrum) → crvUSD (Ethereum)                 │
│  LayerZero message sent, awaiting confirmation...       │
│  ⏱ Estimated: 2 min remaining                          │
│                                                         │
│  Step 3  ⏳  Swap on Optimism                          │
│  ─────────────────────────────────────                  │
│  crvUSD → USDC via Curve Pool                          │
│  Awaiting bridge confirmation                           │
│                                                         │
│  ┌────────────────────────────────────────────────────┐ │
│  │  🔒 Atomic Lock: All steps locked until completion │ │
│  │  Failure → full rollback to source wallet          │ │
│  └────────────────────────────────────────────────────┘ │
│                                                         │
│  [ Cancel Execution ]        [ View on Explorer ]      │
└─────────────────────────────────────────────────────────┘
```

### 3.4 Atomicity lock mechanism

The atomic execution layer guarantees the user experience in the UI in the following ways:

- **Source-chain asset locking.** After the user signs, source-chain assets enter the coloyond
  execution contract and are not sent directly to the bridge.
- **Multi-protocol consensus verification.** The bridging layer uses CrossCurve's multi-protocol
  consensus (the 2FA model of Axelar + Chainlink CCIP + LayerZero + Wormhole) to ensure messages
  are trustworthy.
- **Conditional destination-chain swap execution.** After the bridge is confirmed, the
  destination-chain swap executes automatically within the same block.
- **Failure rollback.** If any step fails, the execution contract returns assets to the user's
  source-chain wallet, and the ChainSigner adapter handles recovery automatically.

## 4. SDK and API integration architecture

### 4.1 Core integration: CrossCurve MetaLayer API

CrossCurve's MetaLayer API is the foundation of the coloyond routing layer. It is a unified
interface that, following the principle of "abstracting complexity", combines 10+ bridges and 20+
DEX aggregators into a single intelligent routing layer.

Key API endpoints:

| Endpoint                    | Method | Purpose                                          |
| --------------------------- | ------ | ------------------------------------------------ |
| `/networks`                 | GET    | List supported chains and contract addresses     |
| `/tokenlist`                | GET    | Token list (filterable by `can_swap`)            |
| `/routing/scan/stream`      | POST   | Stream route objects (NDJSON)                    |
| `/tx/create`                | POST   | Build transaction data                           |
| `/transaction/{requestId}`  | GET    | Track transaction status                         |

`/routing/scan/stream` returns route objects as an NDJSON stream. Each route includes simulation
results, fees, slippage, and other fields, providing the underlying data for the visual route
execution interface.

Execution flow (five steps): request route → 2. select route and build transaction → 3. user signs
and sends → 4. track status → 5. destination chain completes.

### 4.2 CrossCurve TypeScript SDK

```typescript
import { CrossCurveSDK, ViemAdapter } from 'crosscurve-sdk';

const sdk = new CrossCurveSDK();
await sdk.init();

const quote = await sdk.getQuote({
  fromChain: 42161,  // Arbitrum
  toChain: 10,       // Optimism
  fromToken: '0x...',
  toToken: '0x...',
  amount: '1000000000000000000',
  slippage: 0.5,
  sender: account.address,
  providers: ['cross-curve', 'rubic', 'bungee'],
});

const result = await sdk.executeQuote(quote, {
  signer,
  autoRecover: true,  // automatic recovery on failure
  onStatusChange: (status) => console.log('Status:', status.status),
});
```

Supported bridges include CrossCurve native routing (with recovery support), the Rubic multi-chain
aggregator, and Bungee (the Socket protocol aggregator). Core methods include `sdk.init()`,
`sdk.getQuote()`, `sdk.executeQuote()`, `sdk.trackTransaction()`, and `sdk.recover()`.

CrossCurve routing supports three recovery types: emergency (withdraw source-chain funds when the
destination chain is in an emergency state), retry (automatically retry failed steps), and manual
recovery.

### 4.3 deBridge DLN API

deBridge provides a cross-chain DLN order API supporting 19+ chains across EVM and Solana.

Core endpoint: `GET /v1.0/dln/order/create-tx` — returns the transaction data to create a
cross-chain DLN order.

The response contains an `estimation` object with detailed valuations of the source-chain token
input and destination-chain token output (address, symbol, decimals, amount, chain ID, approximate
operation fee, USD valuation, and so on).

The Python SDK (`debridge-py`) provides methods such as `get_supported_chains()`,
`get_token_list(chain_id)`, and `create_order()`.

The TypeScript SDK (`@debridge-finance/desdk`) supports sending, tracking, and claiming cross-chain
messages, and provides the high-level `evm.Message` type to call the deBridgeGate contract.

### 4.4 Rango Exchange API

Rango provides bridge + DEX aggregation with full-path route discovery.

API flow:

- **Meta endpoint:** retrieve metadata for all supported chains, tokens, and protocols
  (DEX/bridge).
- **Quote endpoint:** retrieve the best route preview.
- **Swap endpoint:** retrieve the transaction data required for actual execution.
- **Check-Status:** track swap status (running/failed/success).

The SDK uses the `rango.meta()`, `rango.quote()`, and `rango.swap()` methods and requires an API
key. Rango's `getAllRoutes` method can "iterate over every possible swapper to find the list of
best routes".

### 4.5 LI.FI SDK

LI.FI provides an Any-to-Any cross-chain swap SDK, supporting every chain, bridge, exchange, and
solver integrated with LI.FI.

```typescript
import { createConfig, getQuote, ChainId } from '@lifi/sdk';

createConfig({ integrator: 'coloyond' });

const quote = await getQuote({
  fromAddress: '0x...',
  fromChain: ChainId.ARB,
  toChain: ChainId.OPT,
  fromToken: '0x0000000000000000000000000000000000000000',
  toToken: '0x0000000000000000000000000000000000000000',
  fromAmount: '1000000000000000000',
});
```

The LI.FI SDK supports the full lifecycle (fetch route/quote → execute transaction), event and hook
tracking, and highly customizable settings (RPC configuration; allowlists/blocklists for chains,
tokens, bridges, and exchanges).

### 4.6 SwapKit API

SwapKit provides a REST API and Widget for cross-chain swaps, supporting 30+ chains and
aggregating providers such as NEAR Intents, THORChain, Chainflip, Garden, Mayan, 1inch, and Maya
Protocol.

v3 API flow:

- `POST /v3/quote` — price discovery; returns available routes with expected amounts, fees, and
  execution time.
- `POST /v3/swap` — transaction execution.
- `GET /providers` — retrieve integrated providers and their supported chains and operational
  status.

All transactions require only a single user signature, and integrators can earn fees on every
transaction.

### 4.7 THORChain Swap API

THORChain provides native cross-chain swaps, supporting native assets such as BTC and ETH without
wrapped assets.

REST API: <https://api.thorchain.org/v1> provides swap quotes and routes and requires an
`x-api-key` header.

Swap Quote endpoint: `GET /thorchain/quote/swap` retrieves swap quotes; assets use the
`CHAIN.SYMBOL` format (for example, `BTC.BTC`, `ETH.ETH`).

MCP Server: THORChain Swap runs a public Model Context Protocol server, so AI agents can natively
read live THORChain data.

Important limitation: THORChain swaps only settle at the end of a block, so they cannot be
composed with App Layer actions into a truly atomic transaction.

### 4.8 1inch Fusion+ API

1inch Fusion+ provides cross-chain swaps with an intent architecture, executed through competition
among the Resolver network.

Core endpoints:

- `POST /v1.2/quote/receive` — retrieve a quote, with fee support.
- `GET /v1.2/order/status/{orderHash}` — query order status
  (pending/executed/expired/cancelled/refunding).
- `GET /v1.2/order/maker/{address}` — query orders by maker address.

Fusion SDK: `@1inch/fusion-sdk` provides the `FusionSDK` class and supports `NetworkEnum` and
methods such as `getActiveOrders`.

### 4.9 Curve FastBridge (direct on-chain calls)

Curve FastBridge is a crvUSD-specific L2→mainnet fast bridge that uses LayerZero messaging plus
native-bridge settlement to shorten the 7-day challenge period to about 15 minutes.

Contract architecture:

- **FastBridgeL2.vy** (deployed on Arbitrum, Optimism, Fraxtal): provides the
  `initiate_fast_bridge(_to, _amount)` function.
- **L2MessengerLZ.vy**: the LayerZero OApp messaging component; it calls `initiate_fast_bridge` to
  send a message that triggers instant crvUSD minting in the mainnet vault.
- **FastBridgeVault.vy**: the mainnet crvUSD vault.

The contract was audited by ChainSecurity. Live monitoring page:
<https://curvefi.github.io/fast-bridge/>.

## 5. Atomic execution layer design

### 5.1 ColoyondExecutor contract architecture

coloyond needs to deploy execution contracts on the source and destination chains to achieve
true atomicity.

Source-chain ColoyondExecutor:

- Receives user assets and locks them until execution completes or rolls back.
- Calls the send function of the selected bridge (CrossCurve / deBridge / LI.FI, and others).
- Listens for bridge confirmation events.
- Automatically returns assets to the user's wallet on failure.

Destination-chain ColoyondExecutor:

- Receives bridge messages (via LayerZero / Axelar / CCIP, and others).
- Verifies the message source (multi-protocol consensus verification).
- Calls the destination-chain DEX to complete the final swap.
- Sends the output tokens to the user's destination address.
- Triggers a cross-chain rollback message on failure.

### 5.2 Atomicity level indicators

| Level          | Meaning                                                                 | Applicable scenarios                    |
| -------------- | ----------------------------------------------------------------------- | --------------------------------------- |
| ✅ Full        | Full-path atomicity; any failing step triggers a full rollback.         | CrossCurve native route + FastBridge    |
| ⚠️ Partial     | The bridging step is atomic, but the destination-chain swap may fail and require manual recovery. | deBridge DLN + Rango         |
| 🔶 Intent-based | Competitive resolver execution; failures are borne by the resolver.     | 1inch Fusion+                           |

### 5.3 Time optimization strategies

- **Parallel quoting.** Query all aggregators simultaneously rather than waiting serially.
- **Pre-sign the destination-chain swap.** Once the source-chain swap is confirmed, the
  destination-chain swap transaction can be pre-signed before the bridge message arrives and
  executed in the same block when it does.
- **FastBridge first.** Prefer FastBridge for crvUSD-related paths (15 minutes vs. 7 days).
- **Skip intermediate bridges.** If Rango/LI.FI find a path that needs no explicit bridge (for
  example, via a native THORChain swap), prefer it.

## 6. Integration priority recommendations

| Phase   | Integration target                    | Rationale                                                                 |
| ------- | ------------------------------------- | ------------------------------------------------------------------------- |
| Phase 1 | CrossCurve MetaLayer API + SDK        | Foundation of the meta-aggregation layer; 30+ chains; Egorov backing.      |
| Phase 2 | deBridge DLN + Rango                  | Expand EVM + Solana coverage; full-path routing.                           |
| Phase 3 | LI.FI SDK + SwapKit API               | Add Any-to-Any capability; quick Widget integration.                       |
| Phase 4 | THORChain + 1inch Fusion+             | Native-asset swaps plus intent-architecture supplement.                    |
| Phase 5 | Curve FastBridge on-chain integration | crvUSD-specific fast bridge; settlement in about 15 minutes.               |

API key acquisition:

- CrossCurve: contact <a.gluhovskij@eywa.fi> or @Eywa_COO.
- Rango: obtain at <https://rango.exchange/>.
- LI.FI: register via `createConfig({ integrator: 'coloyond' })`.
- SwapKit: obtain at <https://api.swapkit.dev>.
