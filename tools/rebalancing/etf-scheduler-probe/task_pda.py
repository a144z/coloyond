"""Small standard-library Solana PDA derivation for TukTuk task-account checks."""

import hashlib


BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
BASE58_INDEX = {character: index for index, character in enumerate(BASE58_ALPHABET)}
PDA_MARKER = b"ProgramDerivedAddress"
MAX_SEEDS = 16
MAX_SEED_LENGTH = 32
FIELD_MODULUS = (1 << 255) - 19
EDWARDS_D = (-121665 * pow(121666, FIELD_MODULUS - 2, FIELD_MODULUS)) % FIELD_MODULUS


class _OnCurveAddress(ValueError):
    """The derived address decompresses as an Edwards point."""


def base58_decode(value):
    if not isinstance(value, str) or not value:
        raise ValueError("expected non-empty base58 address")
    number = 0
    for character in value:
        try:
            digit = BASE58_INDEX[character]
        except KeyError as error:
            raise ValueError("invalid base58 address") from error
        number = number * 58 + digit
    encoded = number.to_bytes((number.bit_length() + 7) // 8, "big") if number else b""
    leading_zeroes = len(value) - len(value.lstrip("1"))
    decoded = bytes(leading_zeroes) + encoded
    if base58_encode(decoded) != value:
        raise ValueError("non-canonical base58 address")
    return decoded


def base58_encode(data):
    number = int.from_bytes(data, "big")
    encoded = ""
    while number:
        number, remainder = divmod(number, 58)
        encoded = BASE58_ALPHABET[remainder] + encoded
    leading_zeroes = len(data) - len(data.lstrip(b"\0"))
    return "1" * leading_zeroes + encoded


def _is_edwards_y_decompressible(compressed):
    """Match Solana's curve25519-dalek CompressedEdwardsY::decompress check."""
    y_bytes = bytearray(compressed)
    y_bytes[31] &= 0x7F  # The most significant bit stores the sign of x.
    y = int.from_bytes(y_bytes, "little") % FIELD_MODULUS
    y_squared = y * y % FIELD_MODULUS
    numerator = (y_squared - 1) % FIELD_MODULUS
    denominator = (EDWARDS_D * y_squared + 1) % FIELD_MODULUS
    if denominator == 0:
        return False
    x_squared = numerator * pow(denominator, FIELD_MODULUS - 2, FIELD_MODULUS) % FIELD_MODULUS

    # p = 5 (mod 8): this exponent yields a candidate square root, with sqrt(-1)
    # correcting the nonsquare branch exactly as the Edwards decompression does.
    root = pow(x_squared, (FIELD_MODULUS + 3) // 8, FIELD_MODULUS)
    if root * root % FIELD_MODULUS != x_squared:
        sqrt_minus_one = pow(2, (FIELD_MODULUS - 1) // 4, FIELD_MODULUS)
        root = root * sqrt_minus_one % FIELD_MODULUS
    return root * root % FIELD_MODULUS == x_squared


def create_program_address(seeds, program_id):
    if len(seeds) > MAX_SEEDS:
        raise ValueError("too many PDA seeds")
    if any(len(seed) > MAX_SEED_LENGTH for seed in seeds):
        raise ValueError("PDA seed exceeds 32 bytes")
    if len(program_id) != 32:
        raise ValueError("program ID must be 32 bytes")
    address = hashlib.sha256(b"".join(seeds) + program_id + PDA_MARKER).digest()
    if _is_edwards_y_decompressible(address):
        raise _OnCurveAddress("derived address is on the ed25519 curve")
    return address


def find_program_address(seeds, program_id):
    if len(seeds) >= MAX_SEEDS:
        raise ValueError("base PDA seeds leave no room for the bump")
    if any(len(seed) > MAX_SEED_LENGTH for seed in seeds):
        raise ValueError("PDA seed exceeds 32 bytes")
    for bump in range(255, -1, -1):
        try:
            return create_program_address([*seeds, bytes([bump])], program_id), bump
        except _OnCurveAddress:
            continue
    raise ValueError("no off-curve PDA bump found")


def derive_tuktuk_task_address(task_queue, task_id):
    """Derive TukTuk's TaskV0 PDA from its documented seeds and u16 task ID."""
    if isinstance(task_id, bool) or not isinstance(task_id, int) or not 0 <= task_id <= 0xFFFF:
        raise ValueError("TukTuk task ID must fit in u16")
    queue_key = base58_decode(task_queue)
    program_key = base58_decode("tuktukUrfhXT6ZT77QTU8RQtvgL967uRuVagWF57zVA")
    if len(queue_key) != 32:
        raise ValueError("task queue address must decode to 32 bytes")
    address, _ = find_program_address(
        [b"task", queue_key, task_id.to_bytes(2, "little")], program_key
    )
    return base58_encode(address)
