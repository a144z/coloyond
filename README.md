# Coloyond vault MVP

A wallet creates and owns a Solana personal portfolio vault. SPL tokens live in vault-PDA associated token accounts. Any inventory-funded cranker can exchange an overweight asset for an underweight asset; the program verifies payment using Pyth and requires the actual custody changes to reduce allocation drift. The owner can change weights, add/remove supported tokens, fund, pause, withdraw, and close.

**This branch replaces the competing prototypes with one runtime.** `main` and its Git history preserve Android cards, Glider/Symmetry adapters, auction/ETF/portfolio-v2 programs, Python, and scheduler experiments. Do not run those against this branch's accounts. This is a new ABI and requires a fresh deployment; the checked-in address is a build/test identity, not evidence of a live deployment.

## Run the client

Node 24 and Rust 1.89.0 are used for host checks.

```sh
npm ci
cp .env.local.example .env.local
npm run dev
```

The browser uses Wallet Standard extensions and Android Mobile Wallet Adapter. Connect a **Devnet** wallet, create a vault, and deposit. WSOL deposits wrap wallet SOL; Test USDC must already be in the wallet. Confirmed holdings and fills refresh from RPC every 10 seconds. Unresolved wallet transactions are journaled before broadcast and block further actions until reconciled.

The immutable MVP asset registry admits **WSOL and Devnet Test USDC only**. Test USDC is synthetic test money, not backed/redeemable USD; its mint/freeze administration is external. A one-token vault is supported but has nothing to rebalance. Adding arbitrary mints with arbitrary feed mappings is deliberately unsupported. This is an owner-funded personal vault, not a public ETF or LP-share issuance product.

## Run the one cranker

```sh
RPC_URL=https://api.devnet.solana.com npm run keeper -- --once
RPC_URL=https://api.devnet.solana.com \
PROGRAM_ID=<fresh-MVP-program-address> \
KEEPER_KEYPAIR=/absolute/path/to/operator-keypair.json \
npm run keeper -- --send
```

Without `--send`, this is a read-only planner. It discovers vaults from chain state, checks the exact network, refreshes basket/revision/custody/oracles together, and logs JSON plans and signatures. `VAULT_OWNER` optionally limits discovery. `KEEPER_STATE` selects the durable journal; use a separate file per network/program/operator. Only one process may hold its journal lock. After a process crash, verify the old process has stopped before removing the `.lock` file; retain the journal and reconcile signatures.

**Liquidity comes from the cranker operator's inventory.** Fund its WSOL and Test USDC ATAs and SOL fees. It supplies the purchased asset before receiving the sold asset in the same atomic instruction. The conservative Pyth confidence spread plus a 10-bps payment cushion favors the vault; there is no guaranteed keeper profit or liquidity. Operators can refill/rehedge their own inventory outside the vault. No operator is appointed by the owner or given withdrawal authority; multiple independent operators can compete, subject to the on-chain cooldown.

Pyth Hermes requires a provider-issued API key following its August 2026 upgrade. Set `PYTH_API_KEY` **only in the operator environment**, never `VITE_*`, Git, or frontend storage. Without it, stale-feed refresh reports the authorization blocker and fills remain disabled. When feeds are missing/stale, sending mode uses the official Pyth Receiver SDK to obtain signed Hermes updates, verify the full Wormhole VAA, and update the pinned shard-0 feed accounts before planning a fill. Operator-paid update transactions are separately journaled; HTTP parsed prices never authorize a trade. `--no-oracle-refresh` disables this and keeps stale feeds blocked. Interruptions may leave operator-owned encoded VAA rent, recovered by the next refresh.

An external scheduler is not required by this MVP. The cranker is an off-chain process; custody enforcement is on-chain. If all crankers stop or inventory/oracles are unavailable, rebalancing stops and owner withdrawals remain available. Do not describe this as guaranteed execution without infrastructure.

## Contract guarantees and limits

- Owner signer, vault PDA, supported mints, exact custody ATAs, token authority, and SPL Token Program are verified.
- Only the owner can deposit, withdraw, edit, pause, and close. No bot delegate, admin withdrawal, arbitrary CPI route, or arbitrary receiving destination exists.
- Fills require current revision, 5–86400-second owner-selected cooldown, 1–5000-bps drift threshold, sell-overweight/buy-underweight direction, at most 10% of the sold token reserve, sufficient conservative oracle payment, and **strictly improved drift after actual SPL CPIs**.
- Pyth: pinned sponsored feed account, Receiver owner, SDK account parser, exact embedded feed ID, Full verification, positive lower bound, exponent -8..0, age <=60 seconds, no future time, confidence <=100 bps. Bad/missing/stale feeds block fills; no fallback prices.
- Removed assets must have zero balance. The UI atomically withdraws removed balances to the owner and closes the removed custody ATA before applying the new basket. Revision changes invalidate old plans. New custody accounts are created in the same wallet transaction.
- Holdings are read from SPL accounts, not cached numeric promises. Failed instructions roll back all CPIs. Closing returns custody rent and vault rent to the owner.
- A deployer's **upgrade authority remains a trust boundary until revoked**. On-chain rules alone do not make an upgradeable program immutable. Use a fresh reviewed deployment and revoke upgrade authority only after verification; see [deployment guide](docs/deployment.md).

## Validate

```sh
npm run check
cargo test --workspace --locked
cargo fmt --all -- --check
npm run build:program
npm run test:sbf
```

`build:program` requires Agave `cargo-build-sbf`; the integration harness uses LiteSVM to execute that compiled SBF program and real SPL Token CPIs in a local bank. It uses **synthetic oracle/mint fixtures**, not live Pyth updates. The harness tests real custody fills, isolated vaults, withdrawal/closure, configuration edits, pause-safe exits, rejected attacks, and post-CPI rollback. It writes transaction evidence to gitignored `scratch/sbf-evidence.json`.

For a local client/cranker, set `VITE_RPC_URL=http://127.0.0.1:8899` and `VITE_ALLOW_LOCALNET=1`, or `RPC_URL=http://127.0.0.1:8899 ALLOW_LOCALNET=1`. Localnet bypasses only the **network** admission check, never on-chain oracle verification. Its synthetic fixture prices must not be presented as live prices.

See [issue disposition](docs/issues.md) for which historical issues are addressed by this branch and which still require live deployment/device/operator evidence.
