# MagicBlock smoke test — 12 October 2026

**Result: stopped. MagicBlock is not the execution layer for the hackathon release.**

The test asked one question: can a MagicBlock Ephemeral Rollup (ER) crank run a program instruction on a schedule, with no wallet or bot of ours online, and make a token transfer on Solana L1?

- **S1 (crank on the ER): PASS.** The crank ran `increment` 5 times with no client running.
- **S2 (crank → commit → L1 action): FAIL.** The crank ran `tick`, but every run reverted. No commit and no token transfer reached L1.

The team then decided to stop the spike, to keep the original plan (allocation cards with a manual Glider handoff), and to put Glider back on the roadmap as the execution partner.

## Setup

| Item | Value |
|---|---|
| Code | [`spikes/magicblock-smoke/`](../../../spikes/magicblock-smoke/) (standalone Cargo workspace, not in the root workspace) |
| Toolchain | Agave 3.1.9 (platform-tools v1.52), Anchor 1.0.2, `ephemeral-rollups-sdk` 0.17.3 (features `anchor`, `crank`) |
| Program (Devnet) | `A9mTMCnEVm8PfoDBipSVnGeUwqWXQfs3XhXPQHi5CEEN` |
| Test wallet | `HhH44u44Fhcg6o8K1DFhRbGFaznM9ZSqEV339gCFk37a` (throwaway, Devnet only) |
| ER endpoint | `https://devnet-as.magicblock.app`, validator `MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57` |
| Auth PDA (`[b"auth"]`) | `BTuGqSJv7mJ8FKjUXUckBgRR2DUQJu1694EhoJfs4yze` |
| Action escrow (from auth) | `3MNDpsTxp1k7eHtQxnuXy1k6RKxg8xxz1FoycRqtdSxf`, topped up with 0.05 SOL |
| Magic fee vault | `5SRuhQybZ3FqmymaxoipqnieGZ5bNnrQqYwUZSRoCCZQ` |
| Test mint / source / destination | `8CaRUBf8ZrdFrfTgSgtuen4LqBgVJrpTXiqKpUvzGHPN` / `3EboUtcdADkR7JEKi2BuCev8wUzcNA2oaVxcZ2WsHsnt` (100 units, owned by the vault PDA) / `9uM5ZVot3o2JLEsfVtmzVUDBVmVCENu2mPHEZUPxLCN` |

Client: `node smoke.mjs <setup|s1|s2|observe>`. State goes to `runs/state.json` (gitignored).

## Transactions

| Step (UTC) | Signature |
|---|---|
| Tokens, 02:34:07 | `3CpD1qAyVNWMA1n6Pp1gh36M6B7sVbhpziwcoECHnnFQmrdLCichs3xRvMRLTXCykKJEiGUh4mR7txtwo63zRxBv` |
| Initialize, 02:34:09 | `95qHfP4SoUvAcGFyZrU54pshGfPpwoM6iaEGqt1q8NyguoWmsTGZ7yB24TjkeVSqPAMbW1ydkRmRCe8MQKGuHCy` |
| Delegate counter + auth, 02:34:10 | `2DnGdHxDipRBDvXTPFM3YKzJf7QTycBn8pqHFaYeA73HpUMu1pc1P6J3BwUSKBjdaHQPihhBD5588rEUawgDF5Yc` |
| S1 schedule (ER), 02:34:21 | `2APgVh1B4FnChW5YP9m72TM75WdPgtUyGqdfDQXirH273JKL899Mzd3KzWFJyZxjRNKjVQvM8refgPSg2Pjfj4Fy` |
| S2 schedule, task 4 (ER), 02:40:16 | `3ibZW3rt8SEnckJhEjsaKBrG5TGMsn7pbAghs6xGos6uSHcvDEikYaGLmPm1DwJ4pfGSGcfdiwGgmkGYUvV2rKLs` |
| S2 crank tick (ER, failed) | `32YCtC5KHVeuzDgpkwkL7bjfydyHLcb35JggFTQR5X31YctdKPTGvHprc7prsZxz2EEGwKUnAquyvfcij8h7buB6` |

S1: the ER counter went from 0 to 5 in about 9 s (02:34:21 → 02:34:30).

## Why S2 failed

Each crank `tick` ran our code. It logged `S2 tick count 6` and `Scheduled commit with ID: 1404885`. Then the transaction failed with:

```
{"InsufficientFundsForRent":{"account_index":4}}
```

Account 4 is the auth PDA. It pays the commit fee through the magic fee vault. On the ER it held 690,880 lamports, and setup added nothing beyond the account's creation rent. Paying the fee would leave it below the rent minimum, so the runtime rejected the transaction, and the counter change and the commit were rolled back. The L1 receipt, the escrow and the token accounts show no activity after setup.

The docs say that commits 1–25 are free when a fee payer is set. In this test, a delegated PDA paying the fee still had to hold more than its rent.

**Fix we did not ship:** fund the auth PDA (for example with 0.05 SOL) before you delegate it. Lamports added on L1 after delegation do not reach the ER, so this needs new PDA seeds and a new setup. We stopped before we tested it.

## Other problems found on the way

1. A delegated payer requires the magic fee vault account (`magic-program`, `intent_bundles/schedule/mod.rs`, `try_get_fee_vault`). Without it, scheduling fails.
2. A program upgrade needed `solana program extend` by at least 10,240 bytes.
3. After an upgrade, the ER keeps the old program in its cache for a while. A task scheduled too early (task 3) was stored with the old account layout.
4. Scheduled instructions cannot have signers, so every account that pays or moves funds must be a PDA.
5. If the L1 action fails, the ER commit reverts too, which makes failures hard to locate.
6. A later program upgrade failed with `Max retries exceeded` and left a deploy buffer holding 1.62 SOL. We closed the buffer and recovered the SOL.

## Assessment

ERs are built for apps that make many fast state changes on the rollup (games, order books) and write results to L1 now and then. Our use runs a Solana token transfer from every crank tick. That path has the most limits: no signers, PDA fee payers that need a funded balance on the ER, all-or-nothing reverts, and upgrade cache delays. Swap liquidity is on L1, so the trade cannot move to the ER.

If the team wants on-chain automation later, two simpler options are:

- A permissionless `rebalance` instruction. The program checks every rule (drift band, cost limit, cooldown, slippage), so anyone can trigger it safely.
- A Solana-native scheduler such as Helium TukTuk (see [`helium-tuktuk-source-pin-20261011.yaml`](helium-tuktuk-source-pin-20261011.yaml)). Its Devnet status is not checked.

Rebalancing should run only when a trade is worth its cost: past the drift band, under a cost limit, above a minimum size, and back to the band edge.

## Funds left on Devnet

- Wallet: 2.26 SOL after closing the buffer.
- About 1.67 SOL is in the program data account. `solana program close A9mTMCnEVm8PfoDBipSVnGeUwqWXQfs3XhXPQHi5CEEN` recovers it, but the program cannot be redeployed at that ID afterwards.
- 0.05 SOL is in the action escrow, and rent is in the delegated counter and auth PDAs. Recovering these needs undelegation, which we did not do.
