package com.coloyond.protocols.coloyond.transactions.reader

import com.coloyond.protocols.coloyond.transactions.ColoyondAddresses
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Decoder for the repo-pinned pyth-solana-receiver-sdk 1.2.0 PriceUpdateV2 layout. */
object PythPriceUpdateV2Decoder {
    const val ACCOUNT_ALLOCATION_SIZE = 134
    private val discriminator = byteArrayOf(0x22, 0xf1.toByte(), 0x23, 0x63, 0x9d.toByte(), 0x7e, 0xf4.toByte(), 0xcd.toByte())

    sealed interface VerificationLevel {
        data object Full : VerificationLevel
        data class Partial(val numSignatures: Int) : VerificationLevel
    }

    data class PriceUpdateV2(
        val verificationLevel: VerificationLevel,
        val feedIdHex: String,
        val price: String,
        val confidence: String,
        val exponent: Int,
        val publishTime: String,
        val previousPublishTime: String,
        val emaPrice: String,
        val emaConfidence: String,
        val postedSlot: String,
    )

    class DecodeException(message: String) : IllegalArgumentException(message)

    fun decode(data: ByteArray, ownerProgramId: String, expectedFeedIdHex: String): PriceUpdateV2 {
        if (ownerProgramId != ColoyondAddresses.PYTH_RECEIVER_PROGRAM_ID) {
            throw DecodeException("PriceUpdateV2 account owner is not the pinned Pyth Receiver program")
        }
        if (data.size != ACCOUNT_ALLOCATION_SIZE) {
            throw DecodeException("PriceUpdateV2 account must contain exactly $ACCOUNT_ALLOCATION_SIZE allocated bytes")
        }
        val expectedFeedId = parseFeedId(expectedFeedIdHex)
        val input = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN)
        val actualDiscriminator = ByteArray(discriminator.size).also { input.get(it) }
        if (!actualDiscriminator.contentEquals(discriminator)) {
            throw DecodeException("PriceUpdateV2 discriminator is invalid")
        }
        input.position(input.position() + 32) // write_authority
        val verificationLevel = when (input.get().toUByte().toInt()) {
            0 -> VerificationLevel.Partial(input.get().toUByte().toInt())
            1 -> VerificationLevel.Full
            else -> throw DecodeException("PriceUpdateV2 verification-level tag is unsupported")
        }
        val feedId = ByteArray(32).also { input.get(it) }
        if (!feedId.contentEquals(expectedFeedId)) throw DecodeException("PriceUpdateV2 feed ID does not match the expected feed")

        val price = input.long.toString()
        val confidence = input.long.toULong().toString()
        val exponent = input.int
        val publishTime = input.long.toString()
        val previousPublishTime = input.long.toString()
        val emaPrice = input.long.toString()
        val emaConfidence = input.long.toULong().toString()
        val postedSlot = input.long.toULong().toString()
        if (input.hasRemaining()) {
            if (verificationLevel !is VerificationLevel.Full || input.remaining() != 1 || input.get() != 0.toByte()) {
                throw DecodeException("PriceUpdateV2 has invalid or nonzero account-allocation padding")
            }
        }

        return PriceUpdateV2(
            verificationLevel = verificationLevel,
            feedIdHex = "0x" + feedId.toHex(),
            price = price,
            confidence = confidence,
            exponent = exponent,
            publishTime = publishTime,
            previousPublishTime = previousPublishTime,
            emaPrice = emaPrice,
            emaConfidence = emaConfidence,
            postedSlot = postedSlot,
        )
    }

    private fun parseFeedId(value: String): ByteArray {
        val hex = value.removePrefix("0x").removePrefix("0X")
        if (hex.length != 64 || hex.any { it.digitToIntOrNull(16) == null }) {
            throw DecodeException("Expected Pyth feed ID must be exactly 32 hexadecimal bytes")
        }
        return ByteArray(32) { index -> hex.substring(index * 2, index * 2 + 2).toInt(16).toByte() }
    }

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it.toInt() and 0xff) }
}
