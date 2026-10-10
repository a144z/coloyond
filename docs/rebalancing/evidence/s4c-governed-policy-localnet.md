# S4C governed AuctionPolicy Localnet evidence

**Result: complete bootstrap → delayed policy creation → resume transaction sequence passed.** On 10 October 2026, the repository's v0.3.0 SBF program ran on a fresh Solana Test Validator 2.3.0. The harness submitted real signed transactions, confirmed them over Localnet RPC, decoded the program-owned accounts against the checked-in Anchor IDL, and checked token-account readbacks. The program now rejects a duplicate `resume_risk` call before it can advance the vault sequence a second time.

This is isolated Localnet transaction evidence only. The mint states and Pyth-shaped feed bytes/prices were synthetic genesis fixtures. The policy values were copied from the Rust `policy_initialization` test vector to exercise bounds; they are not approved economics, deployment settings, or defaults. This run does not establish Pyth authenticity, Devnet admission, CP2b browser-wallet acceptance, Android/MWA behavior, or permission to accept funds.

## Reproduce

From the repository root, with the Node dependencies installed and Solana 2.3.0 / SBF platform tools v1.57 available:

```sh
COLOYOND_BOOTSTRAP_POLICY_DELAY_SLOTS=32 node tools/rebalancing/localnet/bootstrap/run.mjs
```

The harness defaults to a 32-slot policy delay to make the early-execution rejection deterministic. Set `COLOYOND_BOOTSTRAP_POLICY_DELAY_SLOTS` between 10 and 1,024 to exercise another test delay. It builds the current SBF artifact, starts a fresh validator with loopback RPC and synthetic fixtures, then removes its temporary bootstrap-authority keypair. It also removes the whole temporary runtime unless `COLOYOND_BOOTSTRAP_HOME` is set. Only use the generated local signers and synthetic balances.

## Confirmed run

- Validator: Solana Test Validator `2.3.0`; SBF tools `v1.57`.
- Cluster/genesis: Localnet, `6ecNitaHBu4Lxr9yLrrqv2wEb9wMsq4nbjtAQesDtAuM` (fresh run after the final IDL-seed, timeout and full-config assertions).
- Program: `FN7uGX34qyijmVX69gqEkMugWjE5Sjso8Pe7gWU6B2N6`.
- Vault / Governance PDAs: `DVZ7tQAgko19RNUXKcMU1RXtcqff2kT415C6JA49NMMQ` / `HVXEcSutFXZQoJSbefeRHWwdwas7HBMWMvZYvzctddiF`.
- Synthetic seed custody: `[1,000,000,000, 100,000,000]` base units; share balance and supply: `200,000,000` six-decimal units.
- Every transaction below was confirmed. Failed cases have a signature and an on-ledger error; the harness verified unchanged program/token state after each relevant rejection.

| Transition | Slot | Signature | Verified result |
|---|---:|---|---|
| `initialize_vault` with wrong ProgramData authority | 10 | `5tXBXsLBD1ZJshsHHoURznexYfWC6vDopom2LS62kSsYBoE1jhAGH5aS1PLkyJTPXZYSyxUg82UPTq39hGkkTfFb` | Rejected as `InvalidBootstrapAuthority`; both PDAs and seed movements rolled back. |
| Initializer's second seed transfer exceeds source balance | 11 | `3wuFiLv28EyqPuPbYjnUQdCfCje4nSk76uardc1zeCMqz8hRgS6GppixQPDzXF5wRDEUUG5EBmCbyu7SYa82Qfbp` | SPL CPI failed; first transfer, account creations, and share mint all rolled back. |
| Successful `initialize_vault` | 12 | `UrtzAQgx685jSFuyNexP91GyuxJbKzQ8dooVPxjyNzTfEQMc9BkDqWcDSjHPwmU1yEbSRJFUQmBB8EKNRBCgQ25` | Vault status `2` and Governance risk pause `true`; seed/reserve/share readbacks matched. |
| `resume_risk` before policy exists | 13 | `EDQhfdyWoaYmvm6RpoUESN363eDSe9g3jXbtWk58deSu3UYK4oqUyzeDq8MRQjd5YzovQxE9UTg3mk6kDbdreha` | Rejected because `AuctionPolicy` is not initialized; pause state unchanged. |
| Proposal signed by emergency authority | 14 | `4K8FvHbgmXqXWoWz14vGMXHJYdbjyRFr7sFFCdrqLMYQGzgEapJoE7BxM2sKLUYBYQF4xg33NJvsJCsDUZduayHa` | `ConstraintAddress`; no pending PDA remained. The signer was funded, so this proves the authority check rather than a rent failure. |
| Proposal with reserve floor above available reserve | 15 | `2SEHSLuRPVZUTybaEVXQ2NEvHQzZgmqsBJAr8a1eP35aq7oPxsZD5bf2Lv4mJuppwWgRD3wz14wR6iyRgv4BAZuH` | Rejected as `InvalidFeePolicy`; proposal PDA creation rolled back. |
| Valid governance proposal | 16 | `4nAmrwSbFX1xT2bt664DzdRxMzL68zC8hSYs4JXNvebwYRNUgyqzfvmbabgyQzJ4sKg1iZ8gson7R5xLwoKqDWV4` | Pending account recorded revision, vault sequence, config, and activation slot `48`. Policy PDA remained absent. |
| Execute before activation slot | 17 | `2P7hPAivP2gT9pkDBDB6rCoYygSmLeiLFekuZUkKqeFVVp6V6pe6mcD31r4iUPeZ8YVgiN1twU18977ZxEbs6Wgy` | Rejected as `PolicyTimelockActive`; pending proposal remained and policy PDA stayed absent. |
| Permissionless execution by the seeder | 49 | `4kkAPBfgpGBrdFMvD4Ld29QSJYTpQ5R63VKFSe6oxSu25yuRY9iaujDedg58c5dwxtBanHxFeuK4XHBTMSw1pHBt` | Created program-owned AuctionPolicy v2 at the pinned revision and closed the pending PDA. Vault and Governance remained paused. |
| Resume signed by emergency authority | 50 | `4vpd8wVuRbRjaoe72KZZAnZ7fzgET2qkfm7jo4a4zXSGLLFjBCvwLeAsFxN4LJyFH1HxoA61Veqe8eFfGgnTq6uD` | Rejected as `UnauthorizedGovernance`; pause and sequence unchanged. |
| Governance `resume_risk` | 51 | `3bX1FtsNTFrYhJxMYNetJcRfNovqy8Kt2BzTz9up9gjhoBuVajiGaxJ9Y8yurfEiUcVdZYob585MMcCkoc6GiNke` | Vault status `1`, Governance risk pause `false`, sequence advanced exactly once. |
| Duplicate `resume_risk` | 52 | `3FvuJVps3SFcgpCygzjLizBN6QGQd6537cwVbhk7YMbHu4F2AjRr88pQZCqdFAdPdP31iraQnju7Uv1z7xsy7r8Y` | Rejected as `RiskNotPaused`; vault sequence and pause state remained unchanged. |

The initial governance proposal's `min_delay_slots` was 32. The actual permissionless execute transaction landed at slot 49, after activation slot 48. The complete decoded policy config matched the proposed config and the test-only Rust vector. The proposal/execution/resume sequence did not change custody balances or share balances.

## Implementation and limits

`tools/rebalancing/localnet/bootstrap/governed-policy.mjs` encodes policy instructions and derives the policy PDAs from the checked-in IDL, then decodes Anchor accounts against their IDL layouts. Its focused Node tests cover instruction account flags/order, Borsh encoding, u64 decoding, discriminator validation, and trailing bytes. `bootstrap/run.mjs` exercises the signed SBF sequence and verifies the full proposed policy config after execution. The instruction layer now requires both a paused governance state and Vault status `2` before resuming risk; duplicate resumes fail without incrementing the sequence.

The checked-in IDL error table currently describes the OracleError variants but does not enumerate GovernanceError or AuctionError; those enums also reuse numeric custom-error ranges. This harness checks the actual Anchor log message for each rejection and does not infer error names from the numeric IDL map. Establish a unique, complete custom-error mapping before a client presents these errors by code.

The isolated Localnet run is a protocol/bootstrap proof. CP2b remains a separate browser-wallet auction walkthrough, and CP4 still requires a real Android MWA wallet review, deposit/redeem receipts, fee/reserve/bounty reconciliation, and recovery tests. S0B admission remains held and S4A economics remain `NO_GO`; no funded Devnet or Mainnet action is enabled.
