# Mobile portfolio desk

The `/app` route uses the supplied HTML reference: warm #EFECE6 paper, #FAF8F5 panels, #D8D4CA hairlines, #141414 primary actions, rounded 12px controls and 16px panels. Allocation colors distinguish the four devnet assets. Typography uses a sans-serif display stack with compact monospaced labels.

Shared components cover portfolios, create, onboarding/import, wallet, system, vault details, asset selection, deposits, redemptions, weight editing, wrapping and transaction reports. Navigation is available before wallet connection. Connected/device wallet header buttons open wallet controls; explicit disconnection remains in the wallet screen. Guest creation shows a connect action and cannot submit funded operations.

Styles are scoped to the mobile app and its sheets. The desktop control-font reset is in the base cascade layer so mobile utility typography works. No contract or transaction protocol changes are part of the redesign.

Validation: `npm run typecheck`, `npm run build`, and `npm run test:mobile`. The last command captures UI and checks navigation, slider locks, opening/closing key sheets, and horizontal page overflow at 320, 360, 430, 768 and 1440 pixels. Data fixtures are only injected into the test browser; they never submit transactions.
