# coloyond-beta UI integration (2026-10-13)

Branch: `refactor/integrate-coloyond-beta-ui` (off `main` @ `8ef63fe`)
Scope: **UI only.** The imported `coloyond-beta/` mobile app now serves `/app`, re-skinned
in this platform's design language. No chain/business logic was rewritten; `coloyond-beta/`
was left untouched on disk.

---

## 1. What the task asked for

- `/app` layout comes from `coloyond-beta` (the mobile vault app: onboarding, portfolios,
  create vault, vault detail, wallet, system).
- The UI/UX **style** comes from the existing web app in this repo (not from beta): paper/ink
  palette, Arial type, 1px rules, soft corners, flat surfaces, blue accent.
- The vault-weight editor reuses this repo's slider/lock pattern (`.cr-desk-slider-input`,
  `.cr-desk-lock`) instead of beta's own visuals.
- Everything from beta is incorporated, no duplicated UI, side branch + this document.
- Nothing deleted inside `coloyond-beta/` yet — removals are listed here for a manual pass.

Decisions confirmed with the user: old `/app` prototype moves to `/prototype`; Tailwind v4
stays as the utility system; `apps/android` (native Kotlin Compose card app) is out of scope
for code and only recorded here.

---

## 2. What changed (file by file)

| Change | Files |
| --- | --- |
| Beta app copied in (37 files, `main.tsx` excluded) | `src/ui/app/**` |
| Mount + wallet bridge | `src/ui/app/MobileApp.tsx` (new) |
| Routes: `/app` → mobile app, `/prototype` → old prototype | `src/ui/App.tsx` |
| Tailwind v4 in the root build | `vite.config.ts`, `package.json` (devDeps) |
| Theme/restyle sheet (tokens + scoped base + slider/lock skins) | `src/ui/app/styles/app-theme.css` (was `styles/theme.css`) |
| Restyle hooks in markup | `src/ui/app/components/layout/AppFrame.tsx` (`cw-app`, `cw-rounded`), `.../ui/Sheet.tsx` (`cw-rounded`) |
| Web-style weight lock | `src/ui/app/components/ui/WeightSliders.tsx` |
| Phosphor types shim (NodeNext) | `src/phosphor-icons.d.ts` (new) |
| Browser `createHash` shim + alias | `src/ui/node-crypto-shim.ts` (new), `vite.config.ts` |
| Mobile viewport | `index.html` (`viewport-fit=cover`) |
| Runtime deps added | `zustand`, `@phosphor-icons/react`, `@solana/spl-token`, `@scure/base`, `@scure/bip39`, `@noble/hashes` (1.8.x), `@magicblock-labs/ephemeral-rollups-sdk`, `@capacitor/{core,app,status-bar}`, dev: `tailwindcss`, `@tailwindcss/vite` |

Import style: every relative import in the copied tree was rewritten to the repo's NodeNext
convention (`../lib/store` → `../lib/store.js`). Single quotes and beta's file layout are kept
so future diffs against `coloyond-beta/` stay readable.

### 2.1 Mounting

`src/ui/app/MobileApp.tsx` is beta's `main.tsx` reduced to the parts this repo still needs:

- `WalletStateBridge` (verbatim from beta) pushes the adapter's `{publicKey, signTransaction}`
  into the zustand store.
- A `ConnectionProvider` with beta's devnet `RPC_URL` is nested for the modal/UI; the root
  `SolanaWalletProvider` in `src/ui/main.tsx` already supplies `WalletProvider` +
  `WalletModalProvider` for the whole site, so no second wallet stack was added.
- Beta's own `src/ui/app/lib/solana/connection.ts` uses its own `web3.Connection`, so the
  nested provider only affects adapter-internal sends.

Beta's scheduler (`ensureScheduler`) and `wireAndroid()` still start from its `App` effect;
`wireAndroid` no-ops on web (`Capacitor.isNativePlatform()`).

### 2.2 Tailwind without collateral damage

- `app-theme.css` imports `tailwindcss/theme` + `tailwindcss/utilities` only — **no preflight** —
  so `/`, `/prototype`, `/etf-devnet`, `/rebalancing-lab` are unaffected.
- `@source "../"` pins class discovery to `src/ui/app/**`, so generic names used by the desktop
  views can never receive utilities.
- Only 4 unlayered restyle rules exist outside the app scope (`border-2`/`border-b-2`/`border-t-2`
  width, portal panel radius). No other page uses those class names.

### 2.3 Restyle map (beta token → this platform)

| Beta token | Now resolves to | Platform source |
| --- | --- | --- |
| `pulp` | `var(--paper)` `#f1ecdd` | `src/ui/app.css :root` |
| `pulp-shade` | `var(--canvas)` | " |
| `pulp-deep` | `var(--rule)` | " |
| `ledger` | `var(--field)` | " |
| `ink` / `iron` | `var(--ink)` / `var(--muted)` | " |
| `petrol` (live/links) | `var(--blue)` | " |
| `brass` (secondary accent) | `var(--violet)` | " |
| `danger` | `#8c3925` (kept: no darker red on this platform) | — |
| display font | `Arial, Helvetica, sans-serif` | " |
| mono font | `monospace` | " |
| `shadow-panel/frame/btn` | `none` (flat, like the desks) | — |
| 2px rules | 1px (`.border-2`/`-b-2`/`-t-2`) | " |
| asset/composition colors | prototype four-color palette — blue `#1249ed` (dUSD), yellow `#ffd523` (tBTC), violet `#8d25d9` (tETH), coral `#ff513b` (WSOL) | `COMPOSITION_COLORS` / `POSITIONS` (old `/` UI) |
| corners | panels 14px (like `.cr-composition`), buttons/controls 7px, exact-% field 6px | " |
| field border | `#bbb5a5` soft rule (like `.cr-field`) instead of the hard ink edge | " |
| focus ring | `3px var(--blue)`, offset 3px, on every `.cw-app` control | " |
| hero art | `ReferenceArt` "planes" study (four-color gradients + grain) on Portfolios + Create screens | `src/ui/ReferenceArt.tsx` (reused, not copied) |
| `@fontsource` Space Grotesk / JetBrains Mono | dropped (Arial/monospace instead) | — |

Layout, screen structure, mix bars, sheets, toasts and the 430px app column are beta's,
untouched.

### 2.4 Slider + lock now come from the desk

- `.ledger-range` mirrors `.cr-desk-slider-input`: 1px rule track over `--field`, 22px round
  `--paper` thumb, blue focus ring; a disabled (locked) slider greys its thumb.
- `WeightSliders` now renders the **desk's own pattern** verbatim — `.cr-desk-allocation` rows
  (`.cr-desk-targets`/`.cr-desk-target`) with colour dot, symbol + name, split-track slider
  (`--cr-split-track` gradient), an exact `%` field (desk `TargetField`, `.cr-input-suffix`),
  and the mono uppercase `.cr-desk-lock` (`lock` / `locked`, `aria-pressed`, inverted while
  pressed) instead of beta's 36px Phosphor icon button. Slider and exact-% field sync both ways.
- **No-overlap layout fix**: each asset is a fixed two-line grid — dot · name · exact % · lock on
  the first line, the full-width slider on its own line underneath — so the wide track can never
  cross the readouts at app-column widths (the desk's responsive grid does exactly that at
  ≤720px). A `≤380px` tweak shrinks the `%` box on narrow phones.
- Applies to `CreateVault` and the vault-detail *Edit weights* sheet, both of which render
  `WeightSliders`.

---

## 3. Blocker found and fixed (not UI-styling, but it blocked everything)

`packages/etf-client/src/weights.ts:17` imports `node:crypto` and calls `createHash("sha256")`
at **module top level** (line 40). Vite externalizes `node:crypto` for the browser, so that call
throws during module evaluation and kills the entry graph:

- dev: `Module "node:crypto" has been externalized…` → `#root` empty
- prod build: `TypeError: (0, cm.createHash) is not a function` → `#root` empty

Verified on a clean `main` worktree (`git stash` test) that **all routes are blank there too**,
both dev and build — this was not introduced by this refactor. `/`, `/app`, `/prototype` and the
etf/rebalancing pages were all unreachable in the browser.

Fix, browser-only, no edits to the shared `etf-client` slice:

- `src/ui/node-crypto-shim.ts` implements `createHash("sha256"|"sha512")` with `update()`/`digest()`
  on top of `@noble/hashes` (already a dependency).
- `vite.config.ts` aliases `node:crypto` to it for browser builds.

After the fix the build no longer prints the externalize warning and every route renders with a
clean console.

---

## 4. Verification (this branch, worktree `coloyond-beta-integration`)

- `npx tsc --noEmit` — clean.
- `npm run build` — clean (only the pre-existing >500 kB chunk-size note).
- `vite preview` probes with a real browser:
  - `/app` → `.cw-app` present, live editor renders: 4 colour segments (`rgb(255,81,59)` coral,
    `rgb(18,73,237)` blue, …), slider rows where the track sits on its own line below the
    name/%/lock (no overlap at 1280, 390 and 320 px), slider ⇄ `%` field stay in sync, lock
    pins the slider (`aria-pressed` flips, thumb greys), 0 console errors
  - `/prototype` → `.cr-app` present, h1 “Balance, with room to move.”
  - `/` → landing renders, h1 “Every part has a part to play.”
- Computed styles on `/app`: font `Arial, Helvetica, sans-serif`, panels `border-radius: 14px`,
  buttons `7px`, fields `6px` + soft `#bbb5a5` rule, uniform 3px blue `:focus-visible` ring,
  frame background `rgb(241, 236, 221)` (paper), group shadow `none`.
- Bundle contains `.flex-col` utilities, `--color-pulp`, `.ledger-range`, `.cr-desk-lock`,
  `.band-attention`, the four palette hexes and the `ReferenceArt` planes study — all live.

---

## 5. Redundancy ledger — what may be deleted from `coloyond-beta/` later

Nothing was deleted. Everything below now has a live counterpart outside `coloyond-beta/` and can
be removed by hand (whole folder last). Note `coloyond-beta/` also keeps its own
`package.json`, `vite.config.ts`, `index.html`, `capacitor.config.ts`, `playwright.config.ts`,
`e2e/`, `programs/`, `scripts/`, `Anchor.toml` — the integration consumed **only `src/`**.

### 5.1 Fully incorporated (safe to delete now)

| `coloyond-beta/` path | Counterpart |
| --- | --- |
| `src/App.tsx` | `src/ui/app/App.tsx` |
| `src/main.tsx` | `src/ui/app/MobileApp.tsx` (bridge) + root `SolanaWalletProvider` |
| `src/styles/theme.css` | `src/ui/app/styles/app-theme.css` (restyled) |
| `src/components/**` (brand, layout, ui) | `src/ui/app/components/**` |
| `src/hooks/useNow.ts` | `src/ui/app/hooks/useNow.ts` |
| `src/lib/format.ts`, `automation.ts`, `android.ts`, `store.ts` | `src/ui/app/lib/*` |
| `src/lib/solana/**` | `src/ui/app/lib/solana/**` |
| `src/screens/**` (Onboarding, PortfolioList, CreateVault, VaultDetail, WalletScreen, SystemScreen) | `src/ui/app/screens/**` |

### 5.2 Overlaps resolved (do **not** copy again; these stay this repo's)

| Overlapping piece | Kept | Beta's version |
| --- | --- | --- |
| Wallet provider stack | root `src/ui/wallet/SolanaWalletProvider.tsx` | beta's `main.tsx` provider trio (only the nested `ConnectionProvider` remains) |
| Wallet connect UI | `src/ui/wallet/ConnectButton.tsx` for the desktop surfaces; beta's header button stays inside the app column | — |
| Weight slider + lock | desk pattern `.cr-desk-slider-input` / `.cr-desk-lock` | beta's `ledger-range` geometry + 36px icon lock (replaced) |
| `/app` prototype (`ColoyondApp`, `product.ts`, `ReferenceArt`, `RebalanceDesk`, `PortfolioTokens`, …) | moved to `/prototype` | — |
| Formatting helpers (`fmtUsd` etc.) | beta's module kept, namespaced under `src/ui/app/lib/format.ts`; the desk's `src/ui/portfolio/rebalance.ts` helpers unchanged | beta `lib/format.ts` |
| Icons/fonts | this repo's Arial + generic monospace | `@fontsource/space-grotesk`, `jetbrains-mono` (dropped, not installed) |

`src/ui/app/` has no duplicate of any component that exists outside it; beta's components are the
single implementation of the mobile app's screens.

### 5.3 Deliberately not integrated

- `coloyond-beta/programs/`, `Anchor.toml`, `Cargo.*`, `scripts/`, `e2e/`, `docs/`,
  `design-reference/` — program/back-end and design sources, not UI.
- Beta's `tsconfig.json`, `package.json` scripts (`gen:keys`, `bootstrap:*`, `smoke:*`, …) —
  beta's chain tooling; this repo keeps its own.
- `capacitor.config.ts` / `@capacitor/android` — this repo's `apps/android` is a native Compose
  app, not a Capacitor shell.

---

## 6. Follow-ups (not done here, on purpose)

1. **`apps/android` (Kotlin Compose, cards app)** — untouched. Porting beta's React screens to
   Compose is a separate, much larger task; if the phone app is meant to become this web app,
   the Capacitor route (beta's `capacitor.config.ts`) is the cheaper path and needs a decision.
2. **Chain wiring** — beta's `lib/solana/config.ts` points at its own devnet program
   (`EXECUTION_PROGRAM_ID = HT7c…`) and MagicBlock ER endpoints; this repo has its own program
   and IDL. Unifying them is a back-end task, untouched by this UI pass.
3. **Storage keys** — beta's zustand store persists under its own `localStorage` key; no
   collision with existing pages (they use none), but the names should be aligned in a later pass.
4. **`@noble/hashes` version** — pinned to `^1.8.0` because `packages/etf-client` imports the
   extension-less `@noble/hashes/sha256` subpath that only 1.8.x exports; beta itself used
   `2.4.0`. Do not bump without also fixing those imports.
5. **Bundle size** — single entry, ~2.4 MB; code-splitting `/app` behind `React.lazy` would help.
6. **`danger` tone** — kept beta's `#8c3925`; this platform has no dark red token yet.

---

## 7. How to run

```powershell
npm install
npm run dev      # /  landing, /app mobile app, /prototype old desk prototype
npm run build
npx vite preview # verify the production bundle
```
