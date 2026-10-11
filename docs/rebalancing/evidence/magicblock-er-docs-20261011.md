# MagicBlock Ephemeral Rollup — official docs digest for ETF auto-rebalance

Date: 2026-10-11
Fetched: `docs.magicblock.gg` — ER introduction (delegation lifecycle), Cranks
introduction + implementation, Fees/Commits/Refunds (source-checked 2026-08-20).
This is official-documentation evidence; still NOT an on-chain Devnet read — the
validator identities and program deployment below must be read on-chain at the
colleague-deploy gate before spending.

## What the docs settle

1. Cranks are real and are what the blueprint claimed: "automated, time-based
   execution of on-chain instructions", explicitly listed for "rebalancing
   portfolios"; removes off-chain cron jobs. Scheduling is a CPI into MagicBlock's
   scheduling program; the task carries
   `task_id, execution_interval_millis, iterations, instructions[]` — exactly the
   argument shape the colleague's blueprint §3.1 sample used. The blueprint's
   Rust sketch matches the official implementation guide.
2. The missing program ID is found: the **Delegation Program** is
   `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh`; delegating changes the account
   owner to it and names an ER validator, lifetime, and sync frequency. Devnet ER
   validators (validator accounts listed in docs): `devnet-us`
   `MUS3hc9TCw4cGC12vHNoYcCGzJG1txjgQLZWVoeNHNd` (also as/eu/tee variants) and a
   localnet ER (`mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev`). Whether the
   Delegation Program itself is deployed on Devnet remains an on-chain read.
3. Lifecycle (the cost and risk frame): init on base layer → **delegate** (owner
   changes; first ER tx clones the account) → txs run on the ER (direct or via
   Magic Router) → operator **commits** state periodically or on demand →
   **undelegate** commits final state and restores the owner. `iterations` is
   finite and the counter-example uses 3 → the probe's renewal/re-schedule
   requirement stays; an open-ended infinite crank is not documented.
4. Fee economics (plain numbers, checked against source Aug 2026): normal ER
   transactions cost 0 in the current release; a delegation session costs
   0.003 SOL and each commit after the first 0.001 SOL — both settled from a
   refundable Solana deposit at undelegation (deposit floor = rent for a
   delegation record + metadata, funded by the delegation payer). Without a
   delegated fee payer an account stops at 10 commits (11th errors `0xA0000000`);
   with fee payer + `magic_fee_vault` the stop disappears and commits from #26
   cost 0.0001 SOL live. Base Actions (ER→base instructions, priced by compute)
   and a 0.0003-SOL top-up setup charge exist. Protocol keeps ~10%, validator ~90%.

## Consequences for the no-backend ETF blueprint

- "No backend" is earned exactly like this: delegate the pool account(s) to the
  ER, CPI-schedule a crank whose instruction is the ETF entry, let MagicBlock
  execute at the interval, commit back. No keeper process needed on the hot path.
- Delegation is not free of architecture: delegated accounts change owner and
  their live state lives on the ER between commits. Anything reading them via a
  plain base-layer RPC sees committed state only. Our oracle leg is the sharp
  case: PushFeed updates land on the **base** feed account via the Receiver, so
  freshness visible on an ER-delegated copy depends on commit cadence (or on the
  ER-native Pyth Lazer oracle path in the same docs). This must be resolved
  before an ER-delegated pool trusts a 60s bound.
- Which instruction the crank calls needs the same decision the blueprints made:
  our contract's `poke` is eligibility-only (fail-closed), while tokens move only
  on the trader-funded `swap_exact_in` leg. A self-funding crank entry (poke +
  funded swap in one ER transaction) is the thing to build, and the ER is exactly
  where a combined instruction is cheap to try.
- The ETF program must become **delegation-aware** (quickstart: "any Solana
  program can be upgraded with ERs by adding delegation capabilities").
  `idl/coloyond_etf.json` currently has zero delegation references and no
  schedule entry point, so the colleague's build adds: delegation support, a
  `schedule_*`-style instruction mirroring the official pattern, and the Anchor
  caveat from the same guide (use `AccountInfo`, not re-`Account` deserialization,
  for accounts touched across CPIs).

## Budget restated for this repo's MVP (devnet, one pool, one task)

Order of spending: Solana tx fees for delegate/init/seed; then ER session+commit
charges are millis-sol scale per undelegation, plus rent for delegation records —
so the top-up number stands (0.2–0.5 devnet SOL) and the 10-commit cap (or a
funded fee payer) is the budget-controlling fact, not raw SOL scarcity.

## Questions for the colleague / MagicBlock (docs-derivable only, no web needed)

1. Confirm `MAGIC_PROGRAM_ID` used by the crank SDK == the Delegation Program ID
   (the crank guide passes it as one `magic_program` account).
2. Devnet deployment + version of the Delegation Program and which of the
   devnet ER validators we should target for CPI-latency reasons.
3. PushFeed feed freshness semantics while related accounts are delegated:
   base Receiver updates vs ER-clone staleness until commit, and whether the
   ER-native oracle path is required for delegated pools.
4. Whether a crank task can carry our combined poke+swap instruction list
   (`instructions: vec![...]` suggests yes) and who signs the crank's payer per
   execution (fee payer must stay funded).
