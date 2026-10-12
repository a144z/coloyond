package com.coloyond.protocols.coloyond.transactions.reader

import com.coloyond.protocols.coloyond.transactions.ColoyondAddresses
import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class PythPriceUpdateV2DecoderTest {
    @Test
    fun decodesFullLayoutAndPreservesSignedAndUnsigned64BitValues() {
        val decoded = PythPriceUpdateV2Decoder.decode(fullAccount(), ColoyondAddresses.PYTH_RECEIVER_PROGRAM_ID, SOL_FEED_ID)

        assertEquals(PythPriceUpdateV2Decoder.VerificationLevel.Full, decoded.verificationLevel)
        assertEquals(SOL_FEED_ID, decoded.feedIdHex)
        assertEquals(Long.MIN_VALUE.toString(), decoded.price)
        assertEquals(ULong.MAX_VALUE.toString(), decoded.confidence)
        assertEquals(-8, decoded.exponent)
        assertEquals(Long.MIN_VALUE.toString(), decoded.publishTime)
        assertEquals((Long.MIN_VALUE + 1).toString(), decoded.previousPublishTime)
        assertEquals(Long.MAX_VALUE.toString(), decoded.emaPrice)
        assertEquals((1uL shl 63).toString(), decoded.emaConfidence)
        assertEquals(ULong.MAX_VALUE.toString(), decoded.postedSlot)
    }

    @Test
    fun decodesPartialVariantAndFullAccountAllocationPaddingSeparately() {
        val partial = PythPriceUpdateV2Decoder.decode(
            partialAccount(guardianSignatures = 7), ColoyondAddresses.PYTH_RECEIVER_PROGRAM_ID, SOL_FEED_ID,
        )
        val paddedFull = PythPriceUpdateV2Decoder.decode(
            fullAccount(allocationPadding = true), ColoyondAddresses.PYTH_RECEIVER_PROGRAM_ID, SOL_FEED_ID,
        )

        assertEquals(PythPriceUpdateV2Decoder.VerificationLevel.Partial(7), partial.verificationLevel)
        assertEquals(PythPriceUpdateV2Decoder.VerificationLevel.Full, paddedFull.verificationLevel)
        assertEquals("18446744073709551615", partial.postedSlot)
    }

    @Test
    fun rejectsWrongOwnerFeedVerificationTagAndMalformedLengthsOrPadding() {
        val full = fullAccount()
        assertThrows(PythPriceUpdateV2Decoder.DecodeException::class.java) {
            PythPriceUpdateV2Decoder.decode(full, "11111111111111111111111111111111", SOL_FEED_ID)
        }
        assertThrows(PythPriceUpdateV2Decoder.DecodeException::class.java) {
            PythPriceUpdateV2Decoder.decode(full, ColoyondAddresses.PYTH_RECEIVER_PROGRAM_ID, USDC_FEED_ID)
        }
        assertThrows(PythPriceUpdateV2Decoder.DecodeException::class.java) {
            PythPriceUpdateV2Decoder.decode(full.copyOf().also { it[40] = 2 }, ColoyondAddresses.PYTH_RECEIVER_PROGRAM_ID, SOL_FEED_ID)
        }
        assertThrows(PythPriceUpdateV2Decoder.DecodeException::class.java) {
            PythPriceUpdateV2Decoder.decode(full.copyOf().also { it[0] = 0 }, ColoyondAddresses.PYTH_RECEIVER_PROGRAM_ID, SOL_FEED_ID)
        }
        assertThrows(PythPriceUpdateV2Decoder.DecodeException::class.java) {
            PythPriceUpdateV2Decoder.decode(fullAccount(allocationPadding = false), ColoyondAddresses.PYTH_RECEIVER_PROGRAM_ID, SOL_FEED_ID)
        }
        assertThrows(PythPriceUpdateV2Decoder.DecodeException::class.java) {
            PythPriceUpdateV2Decoder.decode(full.copyOf() + byteArrayOf(0, 0), ColoyondAddresses.PYTH_RECEIVER_PROGRAM_ID, SOL_FEED_ID)
        }
        assertThrows(PythPriceUpdateV2Decoder.DecodeException::class.java) {
            PythPriceUpdateV2Decoder.decode(
                fullAccount(allocationPadding = true).also { it[it.lastIndex] = 1 },
                ColoyondAddresses.PYTH_RECEIVER_PROGRAM_ID,
                SOL_FEED_ID,
            )
        }
        assertThrows(PythPriceUpdateV2Decoder.DecodeException::class.java) {
            PythPriceUpdateV2Decoder.decode(partialAccount(7).copyOf(FULL_SIZE), ColoyondAddresses.PYTH_RECEIVER_PROGRAM_ID, SOL_FEED_ID)
        }
    }

    private fun fullAccount(allocationPadding: Boolean = true): ByteArray = account(
        verificationTag = 1,
        partialSignatures = null,
        allocationPadding = allocationPadding,
    )

    private fun partialAccount(guardianSignatures: Int): ByteArray = account(
        verificationTag = 0,
        partialSignatures = guardianSignatures,
        allocationPadding = false,
    )

    private fun account(verificationTag: Int, partialSignatures: Int?, allocationPadding: Boolean): ByteArray {
        val encodedSize = if (verificationTag == 0) PARTIAL_SIZE else FULL_SIZE
        val buffer = ByteBuffer.allocate(encodedSize).order(ByteOrder.LITTLE_ENDIAN)
        buffer.put(DISCRIMINATOR)
        buffer.put(ByteArray(32) { 0x11 }) // write_authority
        buffer.put(verificationTag.toByte())
        if (partialSignatures != null) buffer.put(partialSignatures.toByte())
        buffer.put(SOL_FEED_ID.removePrefix("0x").chunked(2).map { it.toInt(16).toByte() }.toByteArray())
        buffer.putLong(Long.MIN_VALUE) // price: i64
        buffer.putLong(-1L) // confidence: u64::MAX
        buffer.putInt(-8) // exponent: i32
        buffer.putLong(Long.MIN_VALUE) // publish_time: i64
        buffer.putLong(Long.MIN_VALUE + 1) // prev_publish_time: i64
        buffer.putLong(Long.MAX_VALUE) // ema_price: i64
        buffer.putLong(Long.MIN_VALUE) // ema_conf: 2^63 as u64
        buffer.putLong(-1L) // posted_slot: u64::MAX
        val serialized = buffer.array()
        return if (allocationPadding) serialized + byteArrayOf(0) else serialized
    }

    private companion object {
        const val FULL_SIZE = 133
        const val PARTIAL_SIZE = 134
        const val SOL_FEED_ID = "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d"
        const val USDC_FEED_ID = "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a"
        val DISCRIMINATOR = byteArrayOf(0x22, 0xf1.toByte(), 0x23, 0x63, 0x9d.toByte(), 0x7e, 0xf4.toByte(), 0xcd.toByte())
    }
}
