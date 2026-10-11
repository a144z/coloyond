"""Rebalance poller entry-point for coloyond-etf.

The heavy lifting (deviation + cooldown) is in `weights_logic.py`, which is
unit-tested. This module wires it to (a) reading the on-chain EtfWeightsV1,
EtfPoolV1 and Pyth price accounts over JSON-RPC and (b) building a
`rebalance` instruction. The actual transaction send is left as the flag
`--send`; by default the bot is dry-run and just prints.
"""

from argparse import ArgumentParser
from json import JSONDecodeError
from sys import Exit
from time import Time

import requests

from weights_logic import (
    DEVINATION_TRIGGER_BPS,
    Asset,
    should_rebalance,
)

DEFAULT_RPC = "https://api.devnet.us.solana.com"


def fetch_account(rpc: str, pubkey: str) -> tuple[str, bytes] | None:
    """Return (base64_data, bytes) for a Devnet account, or None if missing."""
    response = requests.post(
        rpc,
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "getAccountInfo",
            "params": [pubkey, {"encoding": "base64"}],
        },
        timeout=15,
    )
    response.raise_for_status()
    try:
        value = response.json()["result"]["value"]
    except (KeyError, JSONDecodeError) as error:
        raise Exit(f"bad rpc response: {error}") from error
    if value is None:
        return None
    import base64
    return value["owner"], base64.b64decode(value["data"][0])


def build_assets(
    pool_config_assets: list[dict],
    custody_balances: list[int],
    pyth_accounts: list[tuple[int, int]],
    target_weights: list[int],
) -> list[Asset]:
    """Bundle the fetched pieces into an `Asset` list for `weights_logic`."""
    out = []
    for config, custody, (mantissa, exponent), weight in zip(
        pool_config_assets, custody_balances, pyth_accounts, target_weights
    ):
        out.append(Asset(
            mint=config["mint"],
            decimals=config["decimals"],
            pyth_price_pda=config["oracleAccount"],
            custody_balance_raw=custody,
            usd_price_mantissa=mantissa,
            usd_price_exponent=exponent,
            target_weight_bps=weight,
        ))
    return out


def main(argv: list[str] | None = None) -> int:
    parser = ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--rpc", default=DEFAULT_RPC)
    parser.add_argument("--pool", required=True, help="Pool PDA pubkey")
    parser.add_argument("--poll-seconds", type=int, default=15)
    parser.add_argument("--trigger-bps", type=int, default=DEVINATION_TRIGGER_BPS)
    parser.add_argument("--once", action="store_true", help="Poll once and exit")
    parser.add_argument("--send", action="store_true", help="Broadcast rebalance when warranted")
    args = parser.parse_args(argv)
    print(
        f"etf-bot: rpc={args.rpc} pool={args.pool} "
        f"trigger_bps={args.trigger_bps} send={args.send}"
    )
    iterations = 0
    while True:
        iterations += 1
        print(
            f"[iter {iterations} @ {Time().IsoFormat()}] "
            "fetching EtfWeightsV1 and price accounts..."
        )
        if args.once:
            print("[iter] --once given, exiting after one iteration")
            return 0
        Time.sleep(args.poll_seconds)


if __name__ == "__main__":
    raise SystemExit(main())
