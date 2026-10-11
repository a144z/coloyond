# coloyond

**Issue #38 mobile prototype:** [spec](docs/superpowers/specs/2026-10-11-issue-38-mobile-portfolio-spec.md) · [design and code cuts](docs/design/issue-38-mobile-portfolio-design.md) · [overnight delivery plan](docs/superpowers/plans/2026-10-11-issue-38-mobile-portfolio-plan.md) · [mobile design preview](docs/design/issue-38-mobile-portfolio.html) · [Claude Opus 5.5 review](docs/reviews/2026-10-11-issue-38-claude-opus-5-5-review.md). These propose a native Android personal-vault/MagicBlock direction for the Solana mobile hackathon. The design is not implementation or deployment evidence; the card/Glider description below records the earlier release scope.

**New to the project? Start with [docs/HANDOFF.md](docs/HANDOFF.md).** It lists what is done, what to build next for the hackathon, and in what order.

coloyond is an Android app for the Solana mobile hackathon. You choose a token allocation, the app makes an abstract card with an optional caption, and you share or remix the card. To hold the allocation, you set it up yourself in Glider: the app copies the weights and opens glider.fi. coloyond is not affiliated with Glider. The app does not buy or sell anything.

- [Reviewed product specification](docs/superpowers/specs/2026-10-09-coloyond-strategy-cards-design.md)
- [Implementation plan and launch gates](docs/superpowers/plans/2026-10-09-coloyond-managed-strategies.md)
- [Offline interactive design preview](docs/design/coloyond-strategy-cards.html)
- [Design image](docs/design/coloyond-strategy-cards.png)

Status on 10 October 2026:

- The Symmetry and Jupiter probe is done. Symmetry share tokens have no Jupiter route, and the small vaults have no keeper automation, so in-app purchase and sale are deferred. The [probe report](docs/integrations/2026-10-09-symmetry-jupiter-probe.md) has the evidence.
- The app decodes Symmetry V3 vault accounts. The decoder matches the SDK field by field.
- The card drawing, PNG export, sharing and import paths work on an Android 15 emulator.
- The strategy records, the card generator, the remix flow and the Glider handoff are not built yet.

The design preview uses illustrative artwork, IDs and financial facts.

## Native Android build

The Kotlin + Jetpack Compose app is in [`apps/android`](apps/android/README.md). It has a card probe screen and a devnet Mobile Wallet Adapter demo. See its README for prerequisites, SDK paths, checks, and device installation.

From the repository root, with JDK 17 and Android SDK Platform 37/Build Tools 36.0.0 configured:

```sh
cd apps/android
./gradlew :app:assembleDebug --console=plain
```

APK: `apps/android/app/build/outputs/apk/debug/app-debug.apk`. Open `apps/android` directly in Android Studio.

The current browser application is the earlier **coloyond** React/Vite routing prototype. LI.FI and deBridge provide quotes; the execution view uses simulated steps. It does not establish real signing, on-chain settlement, or atomic cross-chain rollback. Its sample balances and signatures are presentation data. The Portfolio tab also runs the rebalance desk: drift is live arithmetic over sample values, targets can be edited and normalized to a 100% total, and a simulated run reweighs the basket onto target with a fee share kept in a sample reserve (the YieldBasis reflow idea from [the Solana vault SDK survey](docs/integrations/2026-10-10-solana-vault-sdk-survey.md)). The desk stores only the demo profile in local storage; its values have no authority over the Anchor program.

The Portfolio tab also includes a **sample-only rebalance desk**; its simulated values and actions are not chain state. A live strip above the desk reads the vault registry (every accepted deployment manifest it can serve), verifies each pool snapshot from RPC, and shows on-chain drift, oracle freshness, and stored eligibility per pool plus one wallet-signed, journaled, reconciled eligibility `poke` per card once every gate passes; create, edit, and destroy of pools follow the verified IDL's exposed entries, and until an accepted manifest exists that strip reports the exact reason while the sample desk remains the demo. The Coloyond Anchor auction workbench is available at `/rebalancing-lab`. Its Localnet path uses the actual SBF program and SPL transfers with a dedicated throwaway Localnet wallet; oracle bytes, prices and token mints are synthetic fixtures and do not establish Devnet liquidity or oracle authenticity. See [the Localnet harness guide](tools/rebalancing/localnet/README.md). The separate `/symmetry-devnet` route reads public Symmetry V3 vault state through `@symmetry-hq/sdk`; it is read-only and cannot submit transactions. The program's own Devnet drift tool is a diagnostic prototype, not yet a verified drift reporter. Both Devnet tools read their setup (RPC rotation list, program id, optional vault and signer keypair) from the gitignored `.env.local` at the repository root; `.env.local.example` lists the keys and `tools/rebalancing/env.mjs` folds the file into the environment. The program source includes an upgrade-authority-gated paused bootstrap that values seed assets at Pyth's lower confidence bound and leaves AuctionPolicy creation to S4C's delayed governance path; IDL/client checks pass, while signed Localnet initializer, seed rollback and seed-to-policy proof remain pending. Privileged bootstrap oracle limits and the cluster-specific USDC choice still require S0B manifest review. No Coloyond Devnet deployment, verified live asset/feed state, funded action path, or Mainnet action path is claimed. See [the current plan](docs/product/onchain-portfolio-rebalancing-plan.md) and the [historical AMM blueprint](docs/rebalancing/rebalance-blueprint-v1.md) for the controlling architecture and evidence status. These are implementation and test surfaces, not an audited financial product.

## The ETF program and how the pieces fit (as of 12 October 2026)

- Program: `programs/coloyond-etf` is a separate Cargo package built to SBF with `cargo build-sbf`; the release artifact lands in its gitignored `target/deploy/`. It uses an anchor-lang style entrypoint whose `declare_id!` is part of the compiled bytes, so the program ID, the IDL `address` (also copied to `public/idl/`), and the `Anchor.toml` cluster entry must always be edited together.
- The Devnet candidate program ID is `DVvBu6GDonibiR5aPqW27tt5RLcA5c4foVKojicxNm6q`; the keypairs live in gitignored JSON files, never in the repository. The on-chain deploy, `initialize_pool` and pool seeding are still pending, so the served `public/etf-devnet/deployment-manifest.json` keeps the pending placeholder and the live strip stays fail-closed.
- Devnet deployment model: this cluster's `BPFLoaderUpgradeab1e…` loader is the upgradeable family, which deploys through three accounts (a code buffer with a 37-byte header, the 36-byte Program account at the program address, and a loader-derived ProgramData account with a 45-byte header). Every 475 kb code account parks about 2.416 Devnet SOL of rent. The full instruction formats, account lists and every error hit while discovering them (wrong tags, bricked buffer authorities, missing `realloc`, 1,232 byte packet limits, RPC 429 limits, faucet day caps) are recorded in [the deployment progress evidence](docs/rebalancing/evidence/devnet-deployment-progress-20261012.md) and the [wallet-reviewed runbook](docs/rebalancing/ops/s5-devnet-wallet-reviewed-deployment.md).
- Client boundary: `packages/etf-client` exports the IDL types, the read-only Devnet constants (token program, ATA program, loader id) and planning helpers; the Portfolio tab UI in `src/ui/portfolio` consumes them. The execution layer ladder (MagicBlock, then Helius TukTuk, then a plain manual `poke`, decided in `packages/keeper/src/executionLayer.ts`) still awaits its real proof; because the IDL exposes no schedule instruction, a crank calls `poke` directly.
- Offline gates before any Devnet action: `npm run typecheck`, the portfolio node test batteries, and `npm run build`; the Devnet scripts themselves run from the gitignored `scratch/` folder with tsx.

## Prototype commands

```sh
npm install
npm run dev
npm run dev:cli
npm run typecheck
npm run build
```

The [design spec](docs/superpowers/specs/2026-10-09-coloyond-strategy-cards-design.md) and [implementation plan](docs/superpowers/plans/2026-10-09-coloyond-managed-strategies.md) target this Kotlin app. They supersede the earlier React Native/Expo plan. The Android app does not embed the Vite app.
