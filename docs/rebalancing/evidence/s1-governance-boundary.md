# S1 governance boundary: implementation evidence

**Status:** local, unfunded transition logic only. This package does not create
an account, expose a callable program instruction, or enforce a production
policy. Do not enable funded use from this artifact.

## Policy boundary implemented

`GovernanceState` is a versioned policy record initialized from the existing
S1A `Vault` plus explicit vault address, governance authority, emergency
authority and nonzero delay in slots. Initialization rejects a wrong vault
version, zero address/roles, role overlap, invalid two-asset weights, duplicate
assets and an asset equal to the share mint. The future instruction context
must prove the supplied address is the actual vault PDA and persist this record
in a program-owned PDA.

The only mutable policy in this minimal boundary is the pair of target weights.
A governance signer proposes positive basis points totaling 10,000 against the
current configuration revision. One proposal may be pending; its monotonic
nonce and expected revision are recorded, and its activation slot is computed
with checked addition from the explicitly configured delay. After that slot,
any caller may activate it if the vault is not paused and the revision/nonce
still match. Activation increments the configuration revision exactly once.
Stale, early, concurrent, replayed and invalid proposals fail.

The following values are immutable in this module after initialization:

- vault address and share mint;
- the exact two underlying mint addresses and their order;
- governance/emergency role keys and the configured delay.

The allowlist accepts only those two mints; it rejects the share mint and any
other mint. There is no transition for changing assets, custody addresses,
token programs, roles, vault identity, share supply, or token balances. The
module cannot transfer custody. It does not permit modifying a live auction's
price, size, fee, bounty or other bounds. A future asset migration or other
identity change requires a separately reviewed contract/version and migration
plan; it cannot be smuggled through a target-weight proposal. Proposal state
is policy-only and does not assert that any new target is economically safe.

The emergency authority can pause risk-increasing actions only. It cannot
propose policy or resume the vault. Resumption is governance-only. Risk-bearing
instruction contexts must call `require_risk_allowed`; in-kind redemption must
not call it. This crate currently has no redemption instruction, and the exit
helper is a testable marker of the required invariant rather than an exit
implementation.

## Required S1F integration

S1F must coordinate the concrete account/IDL layout and then:

1. Add a governance PDA with a versioned discriminator/layout and derive its
   address from the vault under a documented seed and bump. Verify its owner,
   vault linkage, stored version and exact allowlisted mints on every relevant
   instruction.
2. On initialization, require the governance and emergency signers to be
   distinct and match the explicit, reviewed configuration. Do not add default
   production keys or delay values in this module.
3. Add propose/activate/pause/resume instruction contexts and events. Proposal
   and activation must update this policy and `Vault.configuration_revision`
   atomically, reject overflow/replay, and preserve the immutable vault/mint
   identities. Any mismatch between the policy revision and Vault revision
   must fail closed.
4. Gate deposits, conditional observation/activation and auction opening/fills
   while paused. Keep `redeem_in_kind` independent of pause, oracle, keeper and
   auction state. Preserve Solana transaction rollback if token movement fails.
5. Keep asset keys and all live auction bounds outside the policy mutation
   surface. If later requirements need more mutable parameters, add separately
   reviewed bounds and tests; do not generalize this transition to arbitrary
   serialized configuration.
6. Regenerate the IDL only in its assigned serial integration package and add
   byte-level client fixtures after the layout is frozen. Until that work lands,
   this Rust module is not callable and does not constrain the rest of the
   program.

## Program upgrade authority is a separate trust boundary

Anchor instruction checks and this in-program delay cannot constrain someone
who can upgrade the deployed executable. On Solana's upgradeable loader, the
program account points to a `ProgramData` account that records the upgrade
authority. That authority can publish new program code and therefore replace
these checks. A program-level governance timelock does not protect against it.

Before any public custody, the release evidence must identify the exact
cluster, program ID, executable and ProgramData address, then independently
read the ProgramData owner/state and upgrade-authority key on-chain. The
authority must be controlled by a separately verified multisig/timelock with
an externally enforced delay and documented signer threshold, or be revoked
only after the reviewed immutable build is deployed and verified. Record the
actual multisig members/threshold, timelock delay and executable signing path;
verify the deployed bytecode against the reviewed source/build artifact; and
exercise the upgrade/governance and emergency-exit procedures. A source
repository setting, deployment script, explorer label, intended signer list or
successful local build is not proof of the deployed authority. Revocation is
irreversible through the upgradeable-loader authority path, so it must be an
explicit release decision rather than an assumption in S1.

Primary references: [Solana program deployment and upgrade authority](https://solana.com/docs/programs/deploying),
[Upgradeable BPF Loader interface](https://docs.rs/solana-bpf-loader-program/latest/solana_bpf_loader_program/),
and [Solana verified builds](https://solana.com/docs/programs/verified-builds).

## Focused validation

`tests/governance/boundary.rs` covers explicit constructor inputs and role
separation; exact mint allowlisting; proposal delay, stale revision, monotonic
nonce and replay rejection; invalid targets; emergency pause/governance resume;
risk gating; and in-kind exit availability while paused. These unit tests
validate only the pure transition module. They do not prove Anchor account
constraints, instruction wiring, ProgramData authority, or deployed behavior.
