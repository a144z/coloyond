# Sprint 0E — client and operations evidence

**Base:** `c142f14b768cf02707d33a96e30d00d2bf020e2b`
**Status:** implementation inventory and primary-source protocol review complete; no actual wallet/device/operator capability has been demonstrated.
**Decision:** funded Android flow stays disabled until the precise signer, identity, recovery and operator gates below pass.

## Current Android client

- App runtime is Kotlin/Jetpack Compose, Android app ID `com.coloyond`; current gateway uses Mobile Wallet Adapter Kotlin client library `2.2.0` and `Solana.Devnet`.
- `MwaWalletGateway` connects and signs a message, then its only transaction method builds one legacy Memo transaction and calls `signAndSendTransactions`. It does not create or review a Coloyond instruction, query wallet capabilities, sign a transaction for app-side broadcast, decode a returned signed message, or support v0/ALT or v1.
- `AppConfig.rpcUrl` is the public Solana Foundation Devnet endpoint, not an app-operated or production-selected RPC. `identityUri` is `https://yourdapp.com`, `iconUri` is the relative `favicon.ico`; both are explicitly placeholders. No verified Coloyond origin/icon or Digital Asset Links evidence exists.
- The pending store writes kind/note/time before MWA, then stores a returned signature. This is useful probe plumbing, but it is not the plan's typed financial intent: it does not bind exact program/vault, policy revision, reviewed transaction bytes/digest, amounts, account deltas or expected token effects. No financial action is built or recovered.
- Existing JVM coverage tests memo serialization and RPC parsing, not wallet version support, sign-only bytes, transaction mutation, origin attestation, or actual wallet send/confirmation.
- The dated Android 15 emulator evidence covers card rendering/export/intents only and reports no wallet installed. No physical-wallet signing result exists. `adb devices -l` could not run in this environment because `adb` is absent.

No `programs/coloyond-vault`, `packages/keeper`, or `ops/rebalancing` implementation/configuration exists on the pinned base. No two operator RPCs, signer keys, Hermes API credentials, or price-pusher deployment have been evidenced. This is absence of repository evidence; it is not proof that the user has no such external resources.

## MWA and transaction-format constraints

The [MWA 2.0 protocol specification](https://solana-mobile.github.io/mobile-wallet-adapter/spec/spec.html) distinguishes wallet capabilities and methods:

- `get_capabilities` can report supported transaction versions and request limits; the answer is wallet-endpoint-specific, so test the actual installed wallet and record its version and returned capabilities.
- `sign_and_send_transactions` is optional. The protocol lets the wallet choose the RPC used to submit and return signatures; the dapp must independently check confirmation. It does not return the signed transaction bytes for our app to compare after signing.
- `sign_transactions` is an optional backward-compatibility method marked deprecated in MWA 2.0. The prior plan's hard preference for this sign-only path is therefore not evidence that the current Kotlin client or target wallet supports it. A real probe must establish API availability and capability for a nonbroadcast transaction. If this method is unavailable, S0F must approve an alternate flow only if it can still verify exact wallet-reviewed bytes and durable on-chain reconciliation; otherwise funded actions remain unavailable.
- `sign_messages` is for arbitrary messages, not transaction signing.

Solana's current [transaction-format documentation](https://solana.com/docs/core/transactions/versioned-transactions) says legacy, v0 and v1 are live formats; v0 supports ALTs, while v1 permits larger messages without ALTs and has different resource configuration. A chain/RPC supporting v1 does not prove the pinned Kotlin client or a wallet supports it. S0E must choose the smallest compatible format based on actual instruction account size and observed wallet `supported_transaction_versions`; test v0 with and without ALTs and v1 only when both builder and wallet path support it. Any read/receipt parser must explicitly opt in to versions it can decode.

Solana Mobile's [Android integration guide](https://github.com/solana-mobile/mobile-wallet-adapter/blob/main/android/docs/integration_guide.md) also recommends a verified identity URI for wallet-side dapp authenticity checks. Project identity placeholders must be replaced with owned HTTPS metadata before funded review. The app must show exact program/vault/mints/amount bounds/fees/revision before wallet handoff, persist a typed pending intent first, and reconcile the returned signature and actual on-chain effects after resume/restart. A signature response or wallet acceptance is not confirmation.

## Operators and price-updater availability

The checklist's intended runtime is two independently operated, replaceable keeper clients with distinct RPC providers and signing keys, plus a permissionless third-party caller. Keepers submit only eligible public instructions and can pay fees/receive earned bounded bounties; they must not hold portfolio custody, alter policy, or supply authoritative prices. The planned Pyth pusher path and any Hermes credentials are operational dependencies only. A failure of both operators must leave instructions permissionless and visible as “eligible, awaiting executor,” not silently fall back to a trusted server.

There is no evidence yet for two actual operators, separate RPC health/limits, signing-key custody/rotation, Hermes API-key access, restart reconciliation, or a pusher runbook. These must be proven by independent configurations and later failure drills; source documentation or a proposed keeper package does not pass the operations gate. Do not put credentials in Git, Android assets or a client APK.

## Smallest safe probe

1. On a physical Android device with the actual candidate wallet, record app/wallet versions, verified origin result, MWA methods and `get_capabilities` (including accepted versions and payload limits).
2. Construct a deliberately nonbroadcast instruction/message and compare exactly the bytes presented/returned by a sign-only flow; reject any mutation. If only sign-and-send works, document what exact message, program IDs, accounts and amount bounds the wallet displays, how the dapp confirms effects, and whether the UI still meets the approved review contract. Do not send a funded vault transaction as a probe.
3. Check legacy/v0 and candidate v1 message build/parse/size on local deterministic fixtures; do not infer wallet support from RPC format activation.
4. Demonstrate pending-action persistence across wallet switch, activity recreation, process death, rejected signing, delayed signature status and duplicate resume without any automatic resend.
5. Configure two distinct keeper deployments/RPCs and the pusher only after the on-chain instruction/IDL exists. Prove either executor can be removed while a third caller still completes an eligible transition; record health/latency, key rotation and credential separation.
6. Until all required evidence exists, retain creative/draft and read-only browsing behavior and keep funded entry disabled.

### S0E gate

**Not passed.** Reasons: no verified app origin, no real wallet capability/version evidence, current gateway is sign-and-send-only, no funded intent state, no connected physical device/tooling in this environment, and no two-operator/pusher setup or evidence. The codebase's probe path does not establish any of these. S0F may freeze interfaces and continue unfunded card work; it cannot mark funded Android readiness as proven.

### Primary sources

- [MWA 2.0 protocol](https://solana-mobile.github.io/mobile-wallet-adapter/spec/spec.html) — capabilities, supported versions, sign-only deprecation and sign-and-send semantics.
- [Solana Mobile Android integration guide](https://github.com/solana-mobile/mobile-wallet-adapter/blob/main/android/docs/integration_guide.md) — dapp responsibilities, authorization and identity.
- [Solana versioned transactions](https://solana.com/docs/core/transactions/versioned-transactions) — active format differences and parser requirements.
- Repository evidence: [Android README](../../../apps/android/README.md), [AppConfig](../../../apps/android/app/src/main/java/com/coloyond/config/AppConfig.kt), [MWA gateway](../../../apps/android/app/src/main/java/com/coloyond/wallet/MwaWalletGateway.kt), [wallet pending store](../../../apps/android/app/src/main/java/com/coloyond/core/storage/PendingIntentStore.kt), and [device probe report](../../integrations/2026-10-09-symmetry-jupiter-probe.md).
