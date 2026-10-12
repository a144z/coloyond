# coloyond ✳︎

**Your mix. A vault that keeps moving.**

A private autonomous vault on Solana devnet: create a portfolio, choose its
weights, and let scheduled execution maintain the allocation with real
on-chain transactions. Mobile-first React app (430px lacquerboard column),
built to wrap into an Android app via Capacitor.

Everything shown in the UI comes from the live devnet RPC, the live Coinbase
price feed, and the live Coinbase asset list — there is no sample data
anywhere.

---

## Quick start

```bash
npm install                 # uses .npmrc legacy-peer-deps for web3.js v1 + vite
npm run bootstrap:reserve   # one-time: devnet keypairs + funded tUSD reserve
npm run dev                 # http://localhost:5173
```

`bootstrap:reserve` generates the demo keypairs (written to
`src/lib/solana/demo-keys.json`), airdrops SOL, creates the synthetic Test USD
mint at a fixed address, and funds the reserve's WSOL + tUSD inventory.
The script is idempotent — re-run it any time to top up.

**Faucet note:** the public devnet faucet is rate limited per IP per day. If
the airdrop step is declined, top up the reserve address printed by the script
(e.g. via the [Solana faucet](https://faucet.solana.com)) and re-run, or pass a
smaller target: `npm run bootstrap:reserve -- --wsol 0.5 --usd 5000`.

The app also self-bootstraps a minimum reserve (1 WSOL / 20k tUSD) the first
time a wallet opens, in case the mint doesn't exist yet.

## What the demo does (all real devnet transactions)

| Action | On-chain reality |
| --- | --- |
| Create wallet | BIP-39 mnemonic → SLIP-0010 ed25519 at `m/44'/501'/0'/0'`, stored device-local |
| Wrap SOL → WSOL | ATA create + system transfer + `syncNative`, owner-signed |
| Reserve swap | One atomic transaction, two SPL transfers, co-signed by the funded reserve |
| Create portfolio | One wallet-signed setup tx: vault ATAs + fee budget + both deposits |
| Automated trade | Vault custody keypair signs; vault pays fees from its own SOL budget |
| Withdraw | In-kind fraction of each token returned; owner pays fees |
| Close vault | Assets out → accounts closed (rent recovered) → budget swept |

The automation logic is the product's real decision core: fresh price required
(60s age limit), budget floor (0.002 SOL), drift beyond the owner's threshold
(default ±2%), then a single trade that pulls the mix back onto target. The
smoke test vault went 81.7/18.3 → exactly 60.0/40.0 on its first check.

Blocked states are honest: a stale price or exhausted budget stops trading and
says so — holdings stay withdrawable in kind at full precision.

## Android (Capacitor)

The app is already wired for the Android shell — hardware back walks the
screen stack (exits from tab level), and the status bar is set to the pulp
theme color (`src/lib/android.ts`, no-ops on web).

```bash
npm run build          # typecheck + vite build → dist/
npx cap add android    # first time only
npm run cap:sync       # build + copy into the native project
npm run cap:open       # open Android Studio, run on device/emulator
```

The whole SPA is served from local assets inside the WebView; only devnet RPC
and the price feeds need the network. No camera/location/file permissions are
required.

## Architecture

```
src/
  styles/theme.css          Tailwind v4 @theme tokens — the lacquerboard system
                            (pulp/petrol/brass/ink palette, Space Grotesk +
                            JetBrains Mono, all-sharp radius, 2px ink rules,
                            hard offset shadows, band-attention gradient)
  lib/
    store.ts                Zustand + persist (wallet, vaults, logs), stack
                            navigation, runFlow execution-report state machine
    automation.ts           The scheduler: 3s tick, poll cadences, per-vault
                            checks, MagicBlock delegated-execution stand-in
    solana/
      config.ts             All product constants (curve economics, cadences,
                            freshness limits, poll intervals)
      derivation.ts         SLIP-0010 ed25519 (hand-rolled, browser-clean)
      wallet.ts             Mnemonic lifecycle, balances, wrap, faucet
      connection.ts         Shared Connection, explorer URLs, RPC health
      price.ts              Batched Coinbase stats pricing → per-asset spot
                            → Binance fallback, age → status
      coinbase.ts           The listed-asset universe: discovery + batched mids
      tx.ts                 Blockhash sign/send/confirm, readable tx errors
      reserve.ts            Funded counterparty: inventory, curve quotes,
                            atomic two-transfer swaps, mint/bootstrap
      vault.ts              Provision/fund/withdraw/close transactions,
                            weight math, rebalance planner
      demo-keys.json        Devnet-only reserve + mint keypairs (committed on
                            purpose — they hold no real value; see below)
  components/
    ui/                     Button, LedgerPanel, MixBar, Field, Sheet, Screen,
                            primitives (MicroLabel, StatusSwatch, KeyValue…)
    brand/                  MixMark/Wordmark lockup, StencilArt 0819 silkscreen
    layout/AppFrame.tsx     The 430px column: header, bottom nav, toasts,
                            execution overlay, pulp grain
  screens/                  Onboarding, PortfolioList, CreateVault, VaultDetail,
                            WalletScreen, SystemScreen
scripts/
  generate-demo-keys.mjs    Devnet keypair generation (idempotent)
  bootstrap-reserve.mjs     Faucet → mint → wrap → tUSD inventory
```

### Reserve economics (disclosed in the UI)

```
effective price = market mid × (1 − spread − curve)
spread          = 0.30% flat
curve           = 0.30% × (trade USD value ÷ (10% of reserve depth)), capped at 3.00%
```

The reserve is shared, finite inventory — large trades pay more, and the
System tab always shows exactly how much is left.

### Why an embedded wallet

Android WebViews can't run browser-extension wallets, and Mobile Wallet
Adapter is a Kotlin-side concern for the native build. For this web build the
owner key is a device-local mnemonic (create or import), and every vault gets
its own custody keypair so owner / custody / automation authority are
genuinely separate keys on-chain — the vault keypair signs automated trades
and pays their fees from its own budget.

## Honest limits of this build

- **The scheduler is client-side.** Checks run while the app is open. The
  native design delegates execution to MagicBlock's engine so schedules
  survive a closed app; the decision logic (freshness, budget, drift) is the
  same either way.
- **The reserve keypair ships with the app.** Fine for a devnet demo
  ("a funded test reserve is the counterparty" is the product's own framing),
  meaningless for mainnet — in production the reserve is a backend service
  and the mint authority lives off-device.
- **The price feed is Chainlink OCR2 on-chain oracle (devnet) for major assets (SOL, BTC, ETH, LINK), with Coinbase/Binance spot as fallback** for the rest of the universe. The staleness gate (60s) is enforced before any automated trade.
- **tUSD is synthetic.** Six decimals, fixed address, mint authority = the
  demo reserve. Not backed by dollars, not redeemable as USDC.
- **The asset universe is Coinbase's full list.** The core assets (WSOL,
  tUSD, tBTC, tETH) ship with pre-generated devnet keys; every other
  Coinbase listing with a live USD market joins at runtime as its own
  devnet stand-in — decimals fixed at 8, mint address derived
  deterministically from the reserve secret. Picking Bitcoin trades the
  demo's tBTC rails; USDC/USDT/DAI map to the demo dollar. Prices are real
  Coinbase mids; the tokens are stand-ins, not redeemable.
- **Synthetic reserve inventory is minted on demand.** When a trade wants
  more of a stand-in than the reserve holds, the reserve mints the shortfall
  first (a real devnet transaction, same unlimited-faucet reality as tUSD).
  WSOL inventory is finite and still blocks for real.

## Production migration sketch

1. Replace the embedded reserve with an on-chain program holding inventory
   and quoting the same curve against owner-signed bounds.
2. Move automation to delegated execution (MagicBlock ER) with the vault
   keypair's authority scoped on-chain; keep the client as the owner console.
3. Swap the price source for Pyth/switchboard observations with the same
   age gate.
4. Seed phrases move to platform secure storage (Android Keystore via
   Capacitor plugin); vault custody keys stay device-local or move to a
   hardware enclave.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck (app + node configs) + production build |
| `npm run preview` | Serve the built app |
| `npm run typecheck` | Both tsconfigs, no emit |
| `npm run gen:keys` | Generate devnet demo keypairs only |
| `npm run bootstrap:reserve` | Full devnet infrastructure bootstrap |
| `npm run cap:sync` / `cap:open` | Android project sync / open in Studio |
