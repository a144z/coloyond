import struct
import unittest

from returned_tasks import parse_run_task_return, validate_compiled_requeue


def u32(value):
    return struct.pack("<I", value)


def u64(value):
    return struct.pack("<Q", value)


def vector(data):
    return u32(len(data)) + data


def items(values):
    return u32(len(values)) + b"".join(values)


def borsh_string(value):
    return vector(value if isinstance(value, bytes) else value.encode("utf-8"))


def compiled_transaction(*, rich=False):
    if not rich:
        return b"\0\0\0" + items([]) + items([]) + items([])
    instruction = b"\0" + vector(b"\0") + vector(b"\x01\x02")
    signer = items([vector(b"seed"), vector(b"bump")])
    return (
        bytes((1, 2, 3))
        + items([b"a" * 32])
        + items([instruction])
        + items([signer])
    )


def task(
    *,
    trigger=b"\0",
    source=None,
    reward=None,
    free_tasks=0,
    description="ETF",
    rich=False,
):
    if source is None:
        source = b"\0" + compiled_transaction(rich=rich)
    option = b"\0" if reward is None else b"\1" + u64(reward)
    return trigger + source + option + bytes((free_tasks,)) + borsh_string(description)


def returned(*tasks, task_accounts=()):
    return items(tasks) + items(task_accounts)


class ReturnedTaskWireTests(unittest.TestCase):
    def test_parses_compiled_task_with_timestamp_instructions_and_signer_seeds(self):
        payload = returned(
            task(
                trigger=b"\1" + struct.pack("<q", 1_800_000_000),
                reward=7,
                free_tasks=1,
                rich=True,
            )
        )
        parsed = parse_run_task_return(payload)
        self.assertEqual(len(parsed.tasks), 1)
        child = parsed.tasks[0]
        self.assertEqual((child.trigger, child.timestamp), ("timestamp", 1_800_000_000))
        self.assertEqual(child.transaction_kind, "compiled")
        self.assertEqual(child.crank_reward, 7)
        self.assertEqual(child.signer_counts, (1, 2, 3))
        self.assertEqual(child.accounts, (b"a" * 32,))
        self.assertEqual(child.instructions[0].account_indexes, b"\0")
        self.assertEqual(child.instructions[0].data, b"\x01\x02")
        self.assertEqual(child.signer_seeds, ((b"seed", b"bump"),))

    def test_empty_direct_return_is_a_valid_zero_child_result(self):
        self.assertEqual(parse_run_task_return(returned()).tasks, ())

    def test_remote_task_is_decoded_but_excluded_by_candidate_policy(self):
        remote = b"\1" + borsh_string("https://signer.invalid") + b"s" * 32
        parsed = parse_run_task_return(returned(task(source=remote)))
        self.assertEqual(parsed.tasks[0].transaction_kind, "remote")
        with self.assertRaisesRegex(ValueError, "RemoteV0"):
            validate_compiled_requeue(
                parsed,
                parent_free_tasks=1,
                queue_capacity=8,
                min_crank_reward=5,
                free_task_ids=[1],
            )

    def test_rejects_truncated_trailing_and_over_limit_data(self):
        valid = returned(task())
        for payload in (valid[:-1], valid + b"\0", b"\0" * 1_001):
            with self.subTest(length=len(payload)):
                with self.assertRaises(ValueError):
                    parse_run_task_return(payload)

    def test_rejects_unknown_trigger_source_and_option_tags(self):
        compiled = compiled_transaction()
        malformed = (
            b"\1" + b"\2",
            b"\1\0\2",
            b"\1\0\0" + compiled + b"\2",
        )
        for payload in malformed:
            with self.subTest(payload=payload):
                with self.assertRaises(ValueError):
                    parse_run_task_return(payload)

    def test_rejects_invalid_utf8_and_unreasonable_vector_counts(self):
        bad_string = task(description=b"\xff")
        with self.assertRaisesRegex(ValueError, "UTF-8"):
            parse_run_task_return(returned(bad_string))
        huge_count = u32(0xFFFF_FFFF)
        with self.assertRaisesRegex(ValueError, "vector count"):
            parse_run_task_return(huge_count + vector(b""))

    def test_task_account_path_is_parsed_but_not_misrepresented_as_supported(self):
        parsed = parse_run_task_return(returned(task_accounts=(b"a" * 32,)))
        with self.assertRaisesRegex(ValueError, "tasks_accounts"):
            validate_compiled_requeue(
                parsed,
                parent_free_tasks=1,
                queue_capacity=8,
                min_crank_reward=5,
                free_task_ids=[1],
            )


class ReturnedTaskConstraintTests(unittest.TestCase):
    def validate(self, payload, **overrides):
        context = {
            "parent_free_tasks": 2,
            "queue_capacity": 8,
            "min_crank_reward": 5,
            "free_task_ids": [1, 2],
        }
        context.update(overrides)
        return validate_compiled_requeue(parse_run_task_return(payload), **context)

    def test_none_or_exact_minimum_reward_and_valid_capacity_are_accepted(self):
        self.assertTrue(self.validate(returned(task(free_tasks=1))))
        self.assertTrue(self.validate(returned(task(reward=5, free_tasks=1))))

    def test_rejects_reward_mismatch_and_child_capacity_overflow(self):
        with self.assertRaisesRegex(ValueError, "queue minimum"):
            self.validate(returned(task(reward=6)))
        with self.assertRaisesRegex(ValueError, "free_tasks plus itself"):
            self.validate(returned(task(free_tasks=8)))

    def test_rejects_too_many_children_or_insufficient_parent_declaration(self):
        with self.assertRaisesRegex(ValueError, "supplied free task IDs"):
            self.validate(returned(task(), task()), free_task_ids=[1])
        with self.assertRaisesRegex(ValueError, "parent task declaration"):
            self.validate(returned(task()), parent_free_tasks=0)

    def test_rejects_duplicate_out_of_range_and_occupied_task_ids(self):
        for ids, occupied in (([1, 1], ()), ([8], ()), ([1], (1,))):
            with self.subTest(ids=ids, occupied=occupied):
                with self.assertRaises(ValueError):
                    self.validate(returned(task()), free_task_ids=ids, occupied_task_ids=occupied)

    def test_rejects_overlong_utf8_description(self):
        with self.assertRaisesRegex(ValueError, "40 UTF-8 bytes"):
            self.validate(returned(task(description="界" * 14)))


if __name__ == "__main__":
    unittest.main()
