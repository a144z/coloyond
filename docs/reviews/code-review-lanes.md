# Code review lanes — coloyond

Each rule below records a real defect that review found in this repo. Check every diff
against the rules for the code it touches.

## Standing invariants

- **The hackathon submission is the Android app** (`apps/android`). The React/Vite app is
  a prototype. A change to the Android app must pass
  `./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug` before merge.
- **No placeholder data that looks real.** Token mints, wallet addresses, signatures and
  prices must be real values or labelled as samples in the UI. PR #4 shipped invented mint
  addresses for SOL, USDC, JUP and BONK.

## Solana RPC

- **Parse the documented response shape.** Most methods wrap their data in
  `{ context, value }` under `result`. Check each parser against the method's page at
  solana.com/docs/rpc. `getBalance` returns `result.value` as a number, and
  `getSignatureStatuses` returns its array at `result.value`. Both were parsed wrongly here.
- **A confirmed transaction can still have failed.** `getSignatureStatuses` returns a
  `confirmationStatus` and an `err` for each signature. Code that reports success must
  check that `err` is null.
- **Only an explicit `value: null` means "no account".** A missing `result`, an HTTP
  error or a JSON-RPC `error` object is a failed request, not an empty account.
- **Browser code cannot call the Solana Foundation endpoints.** `api.mainnet.solana.com`
  and `api.mainnet-beta.solana.com` return 403 to any request with an `Origin` header.
  Check that a browser RPC endpoint accepts the method from a web page.

## Android wallet flow (Kotlin)

- **Cancellation must propagate.** `runCatching` and `catch (e: Exception)` catch
  `CancellationException`. In suspend code, rethrow it, and restore any
  `Connecting`/`Signing` state first.
- **Read demo mode once per operation.** An operation must not mix the mock and real
  gateways. The UI must block the toggle while an operation runs.
- **Keep the record of a sent transaction until its outcome is known.** Save the signature
  as soon as the wallet returns it. Clear the pending record only after on-chain success or
  on-chain failure, not after a timeout.
- **Drop late results.** A result that arrives after a newer action or session must not
  overwrite newer state or feedback.
- **No app-wide cleartext.** Cleartext traffic is allowed only to `localhost`/`127.0.0.1`,
  through `res/xml/network_security_config.xml`.

## Browser prototype (React)

- **State updaters stay pure.** No `localStorage` writes or other side effects inside a
  `setState` updater. React may run updaters twice. Persist from an effect.
- **Storage is untrusted.** Validate every entry loaded from `localStorage`, and remove
  duplicates by key before rendering.
- **Async results can be stale.** A result that returns after the user has changed the
  input, or after the component unmounts, must be ignored.
