# ETF AMM v1 read model

**Status:** S5A draft. Read-only projection over the ETF program and exact Devnet manifest; it is not a source of protocol authority. Unknown, stale, or unavailable data is represented as unknown, never as zero.

| View | Source of truth | Required fields |
|---|---|---|
| Network and deployment | Solana RPC plus deployment manifest | Cluster, genesis hash, RPC endpoint label, commitment, program ID, executable/loader check, pool address, config hash/revision, observed slot and fetch time. |
| Pool configuration | `EtfPool` and ordered `EtfAsset` accounts | Canonical config hash and `etf1:<config-hash>` strategy ID, seed/pause/closed state, target weights, asset order, mint, token program, decimals, custody address, share mint, fee policy, initializer/governance/guardian identity and delay. |
| Asset balances | Each PDA custody token account | Raw base units and decimals per asset, RPC context slot, account owner/mint checks. A missing or mismatched account is an error state. |
| Oracle observations | Exact feed accounts and manifest-declared account mode | Account key/owner, feed ID, raw price/confidence/exponent, publish time, age at chain observation, RPC context slot, and validation result. Display verification basis conditionally: `PriceUpdateV2` requires Full; fixed Push Feed mode displays the authenticated program owner/layout/update status that S5C proves. Do not show a nonexistent Full field as if it applied to fixed push accounts. |
| Portfolio value | Checked client projection using on-chain observed balances and accepted oracle observations | Estimated NAV, per-asset oracle-marked value, actual value weights, target value weights, deviation, source slots and valuation time. Label as estimate, not executable price or redeem value. |
| Shares | Classic SPL share mint and user token accounts | Mint decimals, total supply, connected wallet share balance, last confirmed mint/burn signature and slot. |
| Swap preview | Deterministic ETF v1 math output plus current account snapshots | Direction, gross input, fee, estimated output, min-out, expected post-swap deviation, oracle bounds, account slots and expiry. A preview is not a fill guarantee. |
| Fee observation | On-chain cumulative per-asset counter plus `SwapExecuted` events | Counter by asset, latest per-swap fee event/signature, custody balance. The fee count is informational and does not create a liability or separate asset balance. |
| Scheduler | TukTuk program/queue/task reads, when a scheduler is admitted | Candidate status, program executable/loader proof, queue authority, balance, capacity/rent, task PDA/ID, exact compiled payload, trigger, crank reward, last crank transaction and crank signer. Unknown executor availability is shown as unverified. |
| Wallet action | Durable client pending record plus signature/confirmed RPC transaction | Intent, serialized message hash, signer, submitted/confirmed/rejected/unknown state, endpoint genesis, signature, confirmation slot, actual token deltas. Unknown never invites an automatic resend. |

All projections keep **target weight**, **actual value weight**, **NAV estimate**, **share-token balance**, **AMM quote**, and **confirmed transaction result** as separate facts. The UI must show full mint/feed identifiers and explicit synthetic/unbacked labels for Devnet test mints. A ticker or image does not select an asset. No UI may infer a successful scheduler run from a cron timestamp or a task registration signature.

## Frozen client boundary for parallel work

S5A freezes this behavior-level port so S5F and S5G can be developed in parallel without either owning the other's implementation:

- **Read:** load a pool snapshot and wallet balances with network genesis, RPC context slot, source freshness and explicit unknown/error states.
- **Preview:** quote a seed, proportional deposit, in-kind redemption, swap or `poke` using a specific snapshot and return the account identities, limits, expiry and oracle evidence needed for wallet review.
- **Build:** produce an unsigned, reviewable transaction message tied to that same snapshot and manifest. It does not submit or sign.
- **Reconcile:** accept the wallet signature and report `submitted`, `confirmed`, `rejected` or `unknown` only after querying the pinned cluster and comparing confirmed token/share deltas.

The TypeScript client and Android Kotlin adapter may implement this port independently from the same read-model and IDL vectors. The Android UI can develop against a contract-conforming fake port for presentation work, but S5H must replace it with the real adapter; fake-port activity never counts as a wallet, RPC or transaction proof.
