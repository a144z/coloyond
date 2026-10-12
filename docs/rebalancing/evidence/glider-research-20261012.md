# Glider research — 12 October 2026

Research from Glider's public app and docs. Nobody signed in or made a transaction. Also posted on #22 and #23.

## #22 — Demo assets and handoff

**Solana assets with a public Glider page:**

| Asset | Mint | What we saw |
|---|---|---|
| [SOL](https://glider.fi/asset/1399811149/So11111111111111111111111111111111111111112) | `So11111111111111111111111111111111111111112` (wrapped SOL) | Asset page, Buy panel, "Glider Verified" badge |
| [JUP](https://glider.fi/asset/1399811149/JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN) | `JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN` | Asset page, Buy panel, "Glider Verified" badge |
| [KMNO](https://glider.fi/asset/1399811149/KMNo3nJsBXfcpJTVhZcXLW7RmTwTt4GVFE7suUBo9sS) | `KMNo3nJsBXfcpJTVhZcXLW7RmTwTt4GVFE7suUBo9sS` | Asset page and Buy panel, no verified badge |

A public page does not prove that Glider can run an allocation of that asset.

**How the handoff works:**
- Browsing works without signing in. "Build your portfolio" opens a login screen (email, social account or wallet).
- We found no documented URL that prefills assets and weights. The app opens `https://glider.fi` with nothing in the URL, and the user enters the weights by hand. This is what the app's card handoff does.
- #42 adds SOL and JUP labels to the handoff review screen, so the user can search Glider by symbol.

**Narrowed scope for #22:**
1. Build the demo cards from SOL and JUP only.
2. On a real phone, sign in to Glider and check that both assets appear in the allocation editor.
3. Enter the card's weights, approve in the wallet, fund the portfolio and confirm one rebalance.
4. Record each step with screenshots. Nobody has checked this signed-in run yet.

## #23 — Glider API

The integration path is documented. It has three prerequisites:

1. **A B2B API key** with the required scopes. See the [quickstart](https://docs.glider.fi/quickstart).
2. **The `svm_b2b_api` entitlement** on our tenant. Without it, Solana enrollment returns 403. See the [v2 overview](https://docs.glider.fi/api-reference/v2-overview).
3. **A backend for the key.** Glider's docs say not to put the key in a client, so it cannot go in the APK.

**Enrollment for a Solana wallet** ([two-stage enrollment guide](https://docs.glider.fi/guides/two-stage-enrollment)):
- The API returns a serialized transaction. The user signs it on the phone through MWA.
- Our backend sends the signed transaction to Glider. Glider adds its agent signature and submits it. Glider's paymaster pays the transaction fee.
- Each portfolio gets a Swig sub-account deposit address. The user funds it with a separate transfer.

**Asset checks:** the [strategy validation endpoint](https://docs.glider.fi/api-reference/endpoints/v2-validate-strategy) says whether each asset is recognized or blocked, and whether the weights total 100%. It needs API access.

**Staging:** Glider has a staging API, and you request a staging key from `developers@glider.fi`. The docs do not say that staging uses Devnet. Confirm the network and the enabled assets before you connect any test wallet.

**First step:** send the draft email in `docs/HANDOFF.md`. It now also asks which network staging uses and about the validation endpoint (#41).
