"""Generate exact integer-reference portfolio deviation and direction vectors."""

import csv
from pathlib import Path
import random


MAX_TOTAL = (1 << 128) - 1
MAX_TOTAL //= 20_002


def partition(total, count, rng):
    cuts = sorted(rng.randrange(total + 1) for _ in range(count - 1))
    points = [0, *cuts, total]
    return [points[index + 1] - points[index] for index in range(count)]


def weights_for(count, rng):
    first = rng.randint(100, 10_000 - 100 * (count - 1))
    remaining = 10_000 - first
    if count == 2:
        return [first, remaining]
    second = rng.randint(100, remaining - 100)
    return [first, second, remaining - second]


def deviation(values, weights):
    total = sum(values)
    error = sum(abs(value * 10_000 - total * weight) for value, weight in zip(values, weights))
    denominator = total * 2
    return (error + denominator - 1) // denominator, error, total


def vectors():
    rng = random.Random(0xD3_71_A710)
    for _ in range(1_024):
        count = rng.choice((2, 3))
        weights = weights_for(count, rng)
        total_pre = rng.choice((1, 10**6, 10**12, 10**24, MAX_TOTAL, rng.randint(1, MAX_TOTAL)))
        total_post = rng.choice((1, 10**6, 10**12, 10**24, MAX_TOTAL, rng.randint(1, MAX_TOTAL)))
        pre = partition(total_pre, count, rng)
        post = partition(total_post, count, rng)
        pre_bps, pre_error, pre_total = deviation(pre, weights)
        post_bps, post_error, post_total = deviation(post, weights)
        improves = post_error * pre_total < pre_error * post_total
        pad = lambda values: values + [0] * (3 - count)
        yield [count, *pad(weights), *pad(pre), *pad(post), pre_bps, post_bps, int(improves)]


def main():
    path = Path(__file__).with_name("deviation_vectors.csv")
    with path.open("w", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(("count", "w0", "w1", "w2", "pre0", "pre1", "pre2", "post0", "post1", "post2", "pre_bps", "post_bps", "improves"))
        rows = list(vectors())
        writer.writerows(rows)
    print(f"wrote {len(rows)} exact deviation vectors to {path.name}")


if __name__ == "__main__":
    main()
