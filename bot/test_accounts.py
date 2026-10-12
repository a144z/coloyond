import struct
import unittest
from unittest.mock import patch
import bot

POOL = bot.b58encode(bytes([7]) * 32)

def weights_data(tag=0, interval=5):
    return bot.discriminator('account:EtfWeightsV1') + bytes([7])*32 + bytes([255]) + struct.pack('<IQQ', 2, 5000, 5000) + bytes([tag, 0, 0]) + struct.pack('<Qq', interval, 100)

def price_data(price=100_000_000, confidence=10_000, exponent=-8, published=100, verified=1):
    return bot.discriminator('account:PriceUpdateV2') + bytes(32) + bytes([verified]) + bytes([8])*32 + struct.pack('<qQiqqqQQ', price, confidence, exponent, published, 99, price, confidence, 1)

class AccountTests(unittest.TestCase):
    def test_rust_layout_pool_binding_precedes_bump(self):
        self.assertEqual(bot.decode_weights(weights_data(), POOL), ([5000, 5000], 5, 100))
        with self.assertRaises(ValueError):
            bot.decode_weights(weights_data(), bot.b58encode(bytes([9])*32))

    def test_weights_invalid_option_truncation_and_interval(self):
        for data in [weights_data(tag=2), weights_data()[:-1], weights_data(interval=4), bytes(200)]:
            with self.assertRaises(ValueError):
                bot.decode_weights(data, POOL)

    def test_oracle_full_and_freshness_boundary(self):
        self.assertEqual(len(price_data()), 133)
        self.assertEqual(bot.decode_price(price_data(), bot.RECEIVER, bytes([8])*32, 160), (100_000_000, -8))
        for now in [161, 99]:
            with self.assertRaises(ValueError):
                bot.decode_price(price_data(), bot.RECEIVER, bytes([8])*32, now)

    def test_oracle_cannot_substitute_feed_owner_confidence_or_verification(self):
        for data, owner, feed in [(price_data(), 'wrong-owner', bytes([8])*32), (price_data(), bot.RECEIVER, bytes([9])*32), (price_data(confidence=1_000_001), bot.RECEIVER, bytes([8])*32), (price_data(verified=0)+bytes(1), bot.RECEIVER, bytes([8])*32), (price_data(price=0), bot.RECEIVER, bytes([8])*32)]:
            with self.assertRaises(ValueError):
                bot.decode_price(data, owner, feed, 100)

    def test_send_is_rejected_before_network_calls(self):
        with patch.object(bot, 'rpc') as rpc, self.assertRaises(SystemExit) as result:
            bot.main(['--pool', POOL, '--send'])
        self.assertEqual(result.exception.code, 2)
        rpc.assert_not_called()

    def test_short_account_never_decodes(self):
        with self.assertRaises(ValueError):
            bot.decode_pool(bytes(12))
