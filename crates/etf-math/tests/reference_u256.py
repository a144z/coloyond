"""Generate exact full-width multiplication vectors with Python big integers."""

import csv
from pathlib import Path
import random


def vectors():
    mask = (1 << 128) - 1
    edge_values = (0, 1, 2, 1 << 64, (1 << 64) - 1, 1 << 127, mask - 1, mask)
    pairs = {(left, right) for left in edge_values for right in edge_values}
    rng = random.Random(0xC010_BA5E)
    pairs.update((rng.getrandbits(128), rng.getrandbits(128)) for _ in range(256))
    for left, right in sorted(pairs):
        product = left * right
        yield left, right, product >> 128, product & mask


def main():
    path = Path(__file__).with_name("u256_vectors.csv")
    with path.open("w", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(("left", "right", "high", "low"))
        writer.writerows(vectors())
    print(f"wrote {sum(1 for _ in vectors())} exact multiplication vectors to {path.name}")


if __name__ == "__main__":
    main()
