## Design

**Two-tier asset universe**
- **Core (unchanged):** `wsol`, `tusd`, `tbtc`, `teth` with pre-generated demo keys — always present, guaranteed on-chain.
- **Coinbase universe (new, dynamic):** every Coinbase-listed crypto currency (Exchange API `/currencies`, status online, type crypto) that has an active USD pair (`/products`) → ~403 assets. Each becomes a first-class portfolio asset priced via `/products/stats` (one batched call, full-precision `last`). All CORS-verified (`access-control-allow-origin: *`).
- Extended assets join the registry as **synthetic devnet stand-ins** (same disclosed reality as tUSD/tBTC/tETH): decimals 8, mint keypair derived **deterministically** from the reserve secret + asset id (no pre-generated keys needed), created lazily on-chain by the reserve.
- Aliases so the demo stand-ins represent the majors: `SOL→wsol`, `BTC→tbtc`, `ETH→teth`, `USDC/USDT/DAI→tusd` (excluded from the extended list).

## Changes

### New files
- `src/lib/solana/coinbase.ts` — `UniverseAsset {id, symbol, name}`; `fetchCoinbaseUniverse()` (/currencies ∩ /products); `fetchCoinbaseStats()` → `Record<'SYM-USD', usd>`; alias table.
- `src/components/ui/AssetPickerSheet.tsx` — searchable sheet: "Demo reserve assets" (core) + "Coinbase universe" (extended, capped result list).

### Registry (`src/lib/solana/assets.ts`)
- `AssetId` widens to `string`; core ids stay in `ASSET_IDS`/`ASSETS` (+ `core: true` on specs).
- Extended registry `Map<string, AssetSpec>` with deterministic palette-adjacent colors; `registerCoinbaseAssets()`; `knownAsset()` replaces `isAssetId` in filters; `assetSpec()` becomes non-throwing (gray placeholder for unknown — stale-universe crash safety); `mintOf()` derives deterministic extended mints (memoized PublicKeys); `assetList()` = core first, then extended by symbol; `emptyTokens()`/`mintToAssetMap()` registry-driven.

### Pricing (`price.ts`)
- `fetchPriceBook()` tries the batched stats map first for every registered asset, falls back to per-asset v2 spot → Binance → fixed $1 (unchanged for tUSD).

### Reserve (`reserve.ts`)
- `ReserveInventoryError` carries `neededRaw`; `executeReserveSwap` auto-tops-up synthetic out-asset inventory on demand (ensureMint + mintToReserve, real devnet txs) then requotes. WSOL stays finite (real inventory errors preserved).
- `mintKeypair()` falls back to deterministic derivation for non-core ids.

### Plumbing
- `vault.ts`: `knownAsset()` filters; `AssetId→string` types. `wallet.ts`: `Balances.tokens: Record<string, number>`. `config.ts`: `UNIVERSE_POLL_MS = 600_000`.
- `store.ts`: `universe` + `universeError` state (persisted, version 3), `refreshUniverse()` action (fetch → register → set), registry synced from persisted universe at startup; `createVault` flow gains an "ensure devnet mints" step for synthetic ids in the mix (mints must exist before vault ATAs); `automation.ts` polls universe cadence.
- `WeightSliders.tsx`: renders only selected assets (shares > 0) — scales from 4 sliders to N.

### UI
- `CreateVault.tsx`: "Add asset" opens the picker; weights/deposits/review work over the selected set; notice copy covers Coinbase stand-ins.
- `WalletScreen.tsx`: balance/reserve-inventory rows filtered to core ∪ nonzero (no 400-row dumps); desk selects list core first then universe.
- `SystemScreen.tsx`: price + reserve panels filtered likewise, universe count shown in About.
- `VaultDetail.tsx` / `MixBar.tsx`: type widening + minor cleanups; `README.md`: honest limits updated (stand-in mints, on-demand inventory, batched pricing).

## Test plan
- `npm run typecheck` and `npm run build` clean.
- Live endpoint sanity re-check via curl (already verified).
- Manual smoke in dev server: universe loads (N assets), pick e.g. DOGE into a mix, create vault (mint ensured), desk swap into extended asset mints inventory, drift triggers automated buy at target weight.
- Existing 4-asset flows unchanged: price book fixed-$1 tUSD, reserve bootstrap, close/withdraw.