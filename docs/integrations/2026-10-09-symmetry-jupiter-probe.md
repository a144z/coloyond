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

### Gate 3: keeper activity — not yet evaluated

Vault-level signatures exist, but most recent activity is from March–July 2026, and the automation timestamp is 0 for nearly all vaults. A settled-instruction classifier is still needed before this is evidence either way.

## Still to do

- Kotlin account decoder and configuration projection, checked against SDK fixtures.
- Device probes: Compose PNG export, `FileProvider` sharing, import intents, MWA sign-only support.
- Launch decision after the product decision on gate 4.
