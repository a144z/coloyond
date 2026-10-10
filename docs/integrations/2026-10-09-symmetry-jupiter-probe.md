# Symmetry and Jupiter probe (Task 1, #13)

Status: in progress. Started 10 October 2026. All reads were read-only; no transaction was sent.

## Setup

- Symmetry SDK `@symmetry-hq/sdk` 1.0.23 (BUSL-1.1), pinned in `tools/symmetry-fixtures/`. It runs off-device only.
- Program `BASKT7aKd8n7ibpUbwLP3Wiyxyi3yoiXsxBk4Hpumate` (Symmetry V3, from docs.symmetry.fi/llms.txt).
- RPC: public `https://api.mainnet-beta.solana.com`. `getProgramAccounts` (through `fetchAllVaults`) worked. `getSignaturesForAddress` worked but returned HTTP 429 under a sequential scan of 40 addresses.
- Jupiter: `lite-api.jup.ag` Swap v1 quote, Ultra order and Price v3, keyless. A USDC → SOL quote succeeded as a control.

## Results

### Vault catalog

`fetchAllVaults` returned 40 mainnet vaults. 17 have one or two weighted assets. Most of those hold no funds (supply 0) and keep the default SOL/USDC 50/50 composition. The largest funded 1–2-asset vaults are small; for example, "Mankey" holds about 0.53 SOL and 49.8 USDC against a supply of 99.67 shares. `last_automation_execution_timestamp` is 0 for nearly every vault.

### Gate 4: Jupiter market entry and exit — FAILED

For all 40 share mints, a Jupiter Swap v1 quote from USDC returned `TOKEN_NOT_TRADABLE` (one returned `NO_ROUTES_FOUND`). Jupiter Ultra `/order` for the Mankey share returned "Failed to get quotes". Price v3 returned no price for any share mint. Jupiter's token search does index the mints (name, supply, mint authority), so the tokens are known but have no route.

Symmetry's documentation describes acquisition only through the protocol: `buyVaultTx` → `lockDepositsTx` → oracle price update → three keeper auction windows → `mintTx` → `claimBountyTx`. The flow is not atomic, and each user may have only one active deposit or withdrawal per vault. Withdrawal has a fast path (`sellVaultTx` with every vault mint in `keep_tokens`, then `redeemTokensTx`) that skips auctions. The docs do not describe secondary-market trading; Jupiter appears only inside keeper flash swaps.

Spec V1 allows only secondary-market Jupiter share-token purchase and sale, with no primary deposit or redemption fallback. No Symmetry vault meets that rule, so financial actions stay disabled.

### Gate 3: keeper activity — FAILED for the V1 scope

`scan-automation.mjs` reads each vault's automation settings and `last_automation_execution_timestamp`:

- No funded 1–2-asset vault is configured for automated rebalancing. Mankey, Solana Strategy, FDRY Quant Alpha, Solana Grid Strategy and Corpus Reference have rebalance activation thresholds of 0, and the decoded fixtures for Mankey and Solana Strategy show `allowAutomation = 0`. Meems has thresholds set but has never run automation.
- Recent automation runs exist only on larger vaults: MemeIndex 10 Solana (5 assets, 22 September 2026), Mag 7 (7 assets, zero supply, 18 September 2026) and Cai Shen (6 assets, 21 July 2026).

No vault in the V1 scope has keeper rebalancing to observe, so the "protocol keeps the weights" claim cannot be made for any of them.

### Decision (10 October 2026)

Option 2, buying through Symmetry's own deposit flow, was rejected. A deposit takes several transactions and waits for keeper auctions, and the in-scope vaults have no active keepers to run them. It would also need a new recovery design and a change to the spec's no-primary-deposit rule. The funded in-scope vaults hold about $100 each, so the change would not buy a usable product.

Option 1: keep the V1 spec. Financial actions stay disabled. The app shows Symmetry vaults as labeled read-only facts, including whether automation is on, and the full creative, share and remix flow ships. The Kotlin decoder and device probes continue.

### Device probes (10 October 2026)

Device: Android emulator `Medium_Phone_API_35` (Android 15, x86_64, 1080×2400), software rendering (`swiftshader_indirect`). The probe screen is the "Card probe" tab in the debug build.

| Check | Result |
|---|---|
| On-screen card (Compose `Canvas`) | Pass. Shapes, grain, Arimo caption and footer wrap all draw. |
| PNG export (`CanvasDrawScope` + `ImageBitmap`) | Pass. 1080×1350 RGBA, 97 KB. The image matches the on-screen card. |
| Share PNG and strategy file (`ACTION_SEND_MULTIPLE`) | Failed first, then fixed (see below). The share sheet shows "Sharing 2 files" with the PNG preview. |
| Share PNG only (`ACTION_SEND`) | Pass. "Sharing image". |
| Share strategy file only (`ACTION_SEND`) | Pass. "Sharing 1 file", `card.coloyond.json`. |
| Link `coloyond://import#…`, app running and app stopped | Pass. The payload length is read in both cases. |
| Link with no fragment | Pass. Rejected: "link has no payload". |
| Link of 2118 characters | Pass. Rejected before decoding. |
| Link with another host | Pass. Android does not resolve it to the app; the in-app host check is a second guard. |
| File by `ACTION_VIEW` and `ACTION_SEND` from MediaStore, app running and app stopped | Pass. 33 bytes read, type `application/json`. |
| File of 300 KiB | Pass. Rejected: "file is larger than 256 KiB". |

Bug found: `ClipData.newUri(null, …)` asks a `ContentResolver` for the MIME type, so the multi-file share crashed with a `NullPointerException`. `Sharing.cardAndStrategy` now builds the `ClipData` with the MIME types given directly.

Limits of this run:

- The file imports were sent from `adb shell`, which can already read shared storage. A real sender app (Files, Drive, a chat app) still needs a check on a physical device.
- No share target was completed. The checks stop at the share sheet.
- The emulator has no wallet app, so MWA sign-only support is not checked.

## Still to do

- Configuration projection and keeper classifier.
- MWA sign-only support, on a device with a wallet app.
- Imports from real sender apps, and one completed share to a chat app, on a physical device.
