# Historical proposal — on-chain rebalancing via Symmetry (devnet)

**Status:** This is the colleague's proposal accompanying the fetched Symmetry comparison work. It is not the controlling product amendment and does not supersede the current [portfolio-rebalancing plan](onchain-portfolio-rebalancing-plan.md) or [sprint checklist](onchain-portfolio-rebalancing-sprint-checklist.md). The approved core remains the custom Coloyond Anchor/SPL/Pyth auction. Symmetry is a separate Devnet comparison; its current UI is read-only. The proposed signed actions, “no new contract/keeper” scope and keeper/gas claims are not implementation evidence.

Originally drafted to amend the coloyond product specification and the on-chain
portfolio-rebalancing plan/checklist, both dated 9–10 October 2026. Conflicts are
resolved by the current plan and checklist named above.

## Context

The specification held that the browser prototype would not buy or sell anything,
would not sign on-chain, and would keep every rebalancing figure simulated. The
Portfolio tab originally demonstrated rebalancing with in-browser arithmetic over
sample values (the "rebalance desk").

We are now integrating a real, self-running vault so the holder gets automatic
rebalancing without paying gas each time it fires. This amendment records what is
now permitted, and the constraints that still hold.

## Clauses the proposal would replace

1. **"The app does not buy or sell anything."** Replaced for the Portfolio tab's
   live section only: the app may submit **real devnet transactions** the user
   signs — funding a vault's automation reserve (`addBountyTx`) and nudging the
   keeper (`rebalanceVaultTx`). Deposits/withdrawals are still out of scope for
   this pass.

2. **"Rebalancing is simulated."** Replaced: the Portfolio tab now reads **real
   on-chain state** for live Symmetry vaults (composition, oracle-priced values,
   drift, automation settings, reserve balance, last keeper execution timestamp)
   through `@symmetry-hq/sdk` and the Symmetry V3 program. Rebalances are executed
   by **Symmetry's existing, permissionless keeper network**, not by coloyond.

3. **"No new contracts, no own keeper, no shared secrets."** Upheld and extended:
   coloyond deploys **no** contracts of its own, runs **no** keeper of its own,
   and holds **no** keys or secrets. It only *calls* the third-party Symmetry
   program. The keeper is paid from a vault bounty reserve, so the holder is not
   charged gas per rebalance.

4. **"No backend."** Upheld: reads and writes go straight from the browser to a
   Solana RPC; there is no coloyond server.

## Constraints that still hold

- Devnet only, test funds only. The original branch exposed a Mainnet toggle; the
  integrated comparison now removes it and is read-only. Mainnet is outside this
  sprint.
- The holder signs with their own wallet (injected Phantom). coloyond never sees a
  key.
- Keep the labels honest: live on-chain values are marked live; the earlier
  sample/simulated desk remains clearly labelled as simulated. No sample figure is
  presented as real.
- No audited financial advice; prototype code.

## Reference points

- Program: Symmetry V3, `BASKT7aKd8n7ibpUbwLP3Wiyxyi3yoiXsxBk4Hpumate` (same id
  on devnet and mainnet).
- SDK: `@symmetry-hq/sdk` (pinned `1.0.23`).
- Devnet mints used for display: WSOL
  `So11111111111111111111111111111111111111112`, USDC
  `USDCoctVLVnvTXBEuP9s8hntucdJokbo17RwHuNXemT`.
- Keep the swap-description guardrails in
  `docs/product/coloyond-swap-description.md`; the anti-custody and
  no-financial-advice rules there are unchanged.
