# TukTuk Devnet account probe

Run `python3 tools/rebalancing/etf-scheduler-probe/probe.py` to read the current Devnet genesis and candidate TukTuk program account. This standard-library probe is read-only. It confirms only the program account's existence, executable flag and loader owner; it does not create a task queue or establish an available crank-turner.

Queue registration and automated invocation require a separately reviewed wallet-signed Devnet flow. Do not interpret this program-account probe as proof that a queue is funded, a task is valid, or any third party will execute it.
