"""Read live ETF custody and Pyth prices; report rebalance eligibility.

The legacy rebalance instruction has no token-moving execution. Sending it is
intentionally refused instead of reporting a timestamp update as a trade.
"""
from argparse import ArgumentParser
import base64
from datetime import datetime, timezone
import hashlib
import json
import struct
import time
import urllib.request

from weights_logic import Asset, DEVIATION_TRIGGER_BPS, current_weights_bps, should_rebalance, total_usd_value

DEFAULT_RPC = "https://api.devnet.solana.com"
PROGRAM = "DVvBu6GDonibiR5aPqW27tt5RLcA5c4foVKojicxNm6q"
TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
RECEIVER = "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ"
DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def b58encode(raw):
    value = int.from_bytes(raw, "big")
    encoded = ""
    while value:
        value, digit = divmod(value, 58)
        encoded = ALPHABET[digit] + encoded
    return "1" * (len(raw) - len(raw.lstrip(b"\0"))) + encoded


def discriminator(name):
    return hashlib.sha256(name.encode()).digest()[:8]


class Reader:
    def __init__(self, data):
        self.data, self.offset = data, 0

    def take(self, length):
        end = self.offset + length
        if end > len(self.data):
            raise ValueError("truncated account")
        out = self.data[self.offset:end]
        self.offset = end
        return out

    def number(self, fmt):
        return struct.unpack(fmt, self.take(struct.calcsize(fmt)))[0]

    def weights(self):
        length = self.number("<I")
        if not 2 <= length <= 4:
            raise ValueError("unsupported basket length")
        weights = [self.number("<Q") for _ in range(length)]
        if sum(weights) != 10_000 or any(w > 10_000 for w in weights):
            raise ValueError("invalid target weights")
        return weights

    def option(self, read):
        tag = self.number("<B")
        if tag > 1:
            raise ValueError("invalid option tag")
        return read() if tag else None


def decode_weights(data, expected_pool):
    r = Reader(data)
    if r.take(8) != discriminator("account:EtfWeightsV1") or b58encode(r.take(32)) != expected_pool:
        raise ValueError("weights identity mismatch")
    r.take(1)
    targets = r.weights()
    proposed = r.option(r.weights)
    r.option(lambda: r.take(32))
    r.option(lambda: r.number("<q"))
    interval, last = r.number("<Q"), r.number("<q")
    if interval < 5 or interval >= 2**63 or last < 0:
        raise ValueError("invalid cooldown")
    if proposed is not None and len(proposed) != len(targets):
        raise ValueError("proposal basket mismatch")
    return targets, interval, last


def decode_pool(data):
    r = Reader(data)
    if r.take(8) != discriminator("account:EtfPoolV1") or r.number("<B") != 1:
        raise ValueError("pool discriminator/version mismatch")
    r.take(1)
    committed = r.take(32)
    length = r.number("<I")
    if length > 1155:
        raise ValueError("pool config too large")
    config = r.take(length)
    if hashlib.sha256(b"coloyond:etf:config:v1" + config).digest() != committed:
        raise ValueError("pool config hash mismatch")
    # Config is a normal Borsh Vec; share mint follows its actual length.
    share_mint = b58encode(r.take(32))
    c = Reader(config)
    if c.number("<B") != 1:
        raise ValueError("unsupported config version")
    count = c.number("<I")
    if not 2 <= count <= 4:
        raise ValueError("unsupported asset count")
    assets = []
    for _ in range(count):
        mint, token_program = b58encode(c.take(32)), b58encode(c.take(32))
        decimals, mode = c.number("<B"), c.number("<B")
        oracle_program, oracle_account = b58encode(c.take(32)), b58encode(c.take(32))
        feed_id, weight = c.take(32), c.number("<H")
        if token_program != TOKEN_PROGRAM or oracle_program != RECEIVER or mode != 0 or decimals > 9:
            raise ValueError("unsupported asset/oracle config")
        assets.append(dict(mint=mint, decimals=decimals, oracleAccount=oracle_account, feedId=feed_id, target=weight))
    if len({a["mint"] for a in assets}) != count:
        raise ValueError("duplicate basket mint")
    return share_mint, assets


def decode_price(data, owner, feed_id, now, maximum_age=60, maximum_confidence_bps=100):
    r = Reader(data)
    if owner != RECEIVER or len(data) not in (133, 134) or r.take(8) != discriminator("account:PriceUpdateV2"):
        raise ValueError("Pyth owner/layout mismatch")
    r.take(32)
    if r.number("<B") != 1:  # SDK VerificationLevel::Full
        raise ValueError("Pyth update is not fully verified")
    if r.take(32) != feed_id:
        raise ValueError("Pyth feed ID mismatch")
    price, confidence, exponent, published = r.number("<q"), r.number("<Q"), r.number("<i"), r.number("<q")
    if price <= confidence or not -17 <= exponent <= 0:
        raise ValueError("invalid Pyth price/confidence/exponent")
    if published < 0 or not 0 <= now - published <= maximum_age:
        raise ValueError("Pyth price stale or future dated")
    if confidence * 10_000 > price * maximum_confidence_bps:
        raise ValueError("Pyth confidence too wide")
    return price, exponent


def rpc(url, method, params):
    request = urllib.request.Request(url, data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=15) as response:
        body = json.load(response)
    if not isinstance(body, dict) or body.get("id") != 1 or body.get("jsonrpc") != "2.0" or "error" in body or "result" not in body:
        raise RuntimeError(f"{method}: invalid or rejected RPC response")
    return body["result"]


def unpack(account, owner):
    if not isinstance(account, dict) or account.get("owner") != owner or account.get("executable"):
        raise ValueError("account owner/executable mismatch")
    data = account.get("data")
    if not isinstance(data, list) or len(data) != 2 or data[1] != "base64":
        raise ValueError("invalid account encoding")
    return base64.b64decode(data[0], validate=True)


def fetch_account(url, pubkey):
    value = rpc(url, "getAccountInfo", [pubkey, {"encoding": "base64", "commitment": "confirmed"}])["value"]
    if value is None:
        raise ValueError(f"account absent: {pubkey}")
    return value["owner"], base64.b64decode(value["data"][0], validate=True)


def observe(url, pool, program, trigger):
    pool_account = rpc(url, "getAccountInfo", [pool, {"encoding": "base64", "commitment": "confirmed"}])["value"]
    share_mint, config = decode_pool(unpack(pool_account, program))
    weight_accounts = rpc(url, "getProgramAccounts", [program, {"encoding": "base64", "commitment": "confirmed", "filters": [{"dataSize": 200}, {"memcmp": {"offset": 8, "bytes": pool}}]}])
    if len(weight_accounts) != 1:
        raise ValueError("expected one pool-bound weights account")
    targets, interval, last = decode_weights(unpack(weight_accounts[0]["account"], program), pool)
    if len(targets) != len(config):
        raise ValueError("weights/custody basket mismatch")
    mint = rpc(url, "getAccountInfo", [share_mint, {"encoding": "base64", "commitment": "confirmed"}])["value"]
    mint_data = unpack(mint, TOKEN_PROGRAM)
    if len(mint_data) != 82 or mint_data[:4] != b"\1\0\0\0":
        raise ValueError("invalid share mint authority")
    authority = b58encode(mint_data[4:36])
    tokens = rpc(url, "getTokenAccountsByOwner", [authority, {"programId": TOKEN_PROGRAM}, {"encoding": "base64", "commitment": "confirmed"}])["value"]
    token_by_mint = {}
    for token in tokens:
        data = unpack(token["account"], TOKEN_PROGRAM)
        if len(data) != 165 or data[108] != 1 or b58encode(data[32:64]) != authority:
            raise ValueError("invalid/frozen custody account")
        key = b58encode(data[:32])
        if key in token_by_mint:
            raise ValueError("ambiguous custody for mint")
        token_by_mint[key] = token["pubkey"]
    keys = [token_by_mint[a["mint"]] for a in config] + [a["oracleAccount"] for a in config]
    batch = rpc(url, "getMultipleAccounts", [keys, {"encoding": "base64", "commitment": "confirmed"}])
    now = rpc(url, "getBlockTime", [batch["context"]["slot"]])
    if not isinstance(now, int) or isinstance(now, bool):
        raise ValueError("chain block time unavailable")
    assets = []
    for i, cfg in enumerate(config):
        token = unpack(batch["value"][i], TOKEN_PROGRAM)
        if len(token) != 165 or b58encode(token[:32]) != cfg["mint"] or b58encode(token[32:64]) != authority or token[108] != 1:
            raise ValueError("custody identity changed")
        price_account = batch["value"][i + len(config)]
        price, exponent = decode_price(unpack(price_account, RECEIVER), RECEIVER, cfg["feedId"], now)
        assets.append(Asset(cfg["mint"], cfg["decimals"], cfg["oracleAccount"], struct.unpack_from("<Q", token, 64)[0], price, exponent, targets[i]))
    return {"pool": pool, "slot": batch["context"]["slot"], "tavUsdMicros": total_usd_value(assets), "currentWeightsBps": current_weights_bps(assets), "targetWeightsBps": targets, "eligible": should_rebalance(assets, last, now, interval, trigger), "execution": "blocked: no verified token-moving router", "oracle": "validated"}


def main(argv=None):
    parser = ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--rpc", default=DEFAULT_RPC)
    parser.add_argument("--pool", required=True)
    parser.add_argument("--program", default=PROGRAM)
    parser.add_argument("--poll-seconds", type=int, default=15)
    parser.add_argument("--trigger-bps", type=int, default=DEVIATION_TRIGGER_BPS)
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--send", action="store_true")
    args = parser.parse_args(argv)
    if args.send:
        parser.error("Sending is disabled: the legacy rebalance instruction does not execute a swap.")
    if args.poll_seconds < 5 or not 1 <= args.trigger_bps <= 10_000:
        parser.error("poll interval must be >=5s and trigger must be 1..10000 bps")
    if rpc(args.rpc, "getGenesisHash", []) != DEVNET_GENESIS:
        parser.error("RPC is not Solana devnet")
    try:
        while True:
            try:
                report = observe(args.rpc, args.pool, args.program, args.trigger_bps)
                print(json.dumps(report), flush=True)
            except (ValueError, RuntimeError, OSError, KeyError, TypeError) as error:
                print(json.dumps({"pool": args.pool, "status": "blocked", "reason": str(error), "time": datetime.now(timezone.utc).isoformat()}), flush=True)
                if args.once:
                    return 1
            if args.once:
                return 0
            time.sleep(args.poll_seconds)
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
