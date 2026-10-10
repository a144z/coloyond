# TukTuk Devnet account probe

Run `python3 tools/rebalancing/etf-scheduler-probe/probe.py` to read the current Devnet genesis, candidate TukTuk program account, config account and task queues. This standard-library probe is read-only. It decodes Anchor-discriminated config/queue accounts, queue bitmap occupancy, minimum crank reward and task-queue account lamports. It validates zero allocation padding, bitmap length and out-of-capacity task bits. Account lamports include rent-exempt allocation; the probe does not call that amount spendable funding. Queue presence, occupancy or balance does not establish task payload correctness, task execution, or an available external crank-turner. It does not create a task queue or submit any transaction.

Run local decoder tests with `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tools/rebalancing/etf-scheduler-probe -p 'test_*.py' -v`.

Queue registration and automated invocation require a separately reviewed wallet-signed Devnet flow. Do not interpret this program-account probe as proof that a queue is funded, a task is valid, or any third party will execute it.
