# Oracle hardening — built, not deployed

`coloyond_execution.so` is a successful SBF v0 build of the reviewed execution source. It is an upgrade candidate for the existing devnet program, not evidence that the new guards are active on-chain. `review-packet.json` records source/Cargo.lock/artifact hashes, tooling, observed authority and required checks. No private key or generated program keypair is included.

The source adds Full Pyth verification, SDK age enforcement (90s), a future-time bound (5s) and a confidence/price bound (1%). Host tests pass and the SBF build passes. Successful historical devnet receipts in the submission proof belong to the currently deployed program; they do not verify this new artifact.

An authorized operator should first recheck the live genesis and upgrade authority, review the artifact and rent/fees, then sign with their own local keys. Do not deploy to a generated random program ID: clients and PDA derivations are pinned to `HT7c9346N1o1TRzttWEHTg6mf7gyB1qNeV6K9VBKdN2d`. No signing or upgrade has been performed by this change.

After an authorized upgrade, retrieve the bytecode and compare it with the exact artifact (loader padding can extend the account), then record fresh-price success, stale/future/wide-confidence rejection and real token/share readbacks. Real-device MWA acceptance remains a separate proof.
