package com.coloyond.protocols.coloyond

import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Read-only decoder for the generated S1F Anchor Vault account layout. */
object VaultAccountDecoder {
    const val PROGRAM_ID = "FN7uGX34qyijmVX69gqEkMugWjE5Sjso8Pe7gWU6B2N6"
    const val ACCOUNT_SIZE = 353
    private val discriminator = byteArrayOf(211.toByte(), 8, 232.toByte(), 43, 2, 152.toByte(), 117, 119)
    private const val ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

    data class Asset(
        val mint: String,
        val tokenProgram: String,
        val custody: String,
        val decimals: Int,
        val targetBps: Int,
    )

    data class Vault(
        val version: Int,
        val bump: Int,
        val status: String,
        val authority: String,
        val configurationRevision: String,
        val assets: List<Asset>,
        val shareMint: String,
        val totalShares: String,
        val minimumLockedShares: String,
        val accountedAmounts: List<String>,
        val bootstrapReserve: List<String>,
        val bountyLiabilities: List<String>,
        val sequence: String,
    )

    class DecodeException(message: String) : IllegalArgumentException(message)

    fun decode(data: ByteArray, ownerProgramId: String): Vault {
        if (ownerProgramId != PROGRAM_ID) throw DecodeException("Vault account owner does not match the generated Anchor IDL program address")
        if (data.size != ACCOUNT_SIZE) throw DecodeException("Vault account must contain exactly $ACCOUNT_SIZE bytes")
        val input = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN)
        val actualDiscriminator = ByteArray(8).also(input::get)
        if (!actualDiscriminator.contentEquals(discriminator)) throw DecodeException("Vault discriminator does not match the generated Anchor IDL")
        val version = input.get().toUByte().toInt()
        if (version != 1) throw DecodeException("Unsupported Vault account version $version")
        val bump = input.get().toUByte().toInt()
        val status = when (val code = input.get().toUByte().toInt()) {
            0 -> "uninitialized"
            1 -> "active"
            2 -> "paused"
            else -> throw DecodeException("Unsupported Vault status $code")
        }
        val authority = input.pubkey()
        val revision = input.u64String()
        val assets = List(2) {
            Asset(
                mint = input.pubkey(),
                tokenProgram = input.pubkey(),
                custody = input.pubkey(),
                decimals = input.get().toUByte().toInt(),
                targetBps = input.short.toUShort().toInt(),
            )
        }
        val shareMint = input.pubkey()
        val totalShares = input.u64String()
        val minimumLockedShares = input.u64String()
        val accountedAmounts = List(2) { input.u64String() }
        val bootstrapReserve = List(2) { input.u64String() }
        val bountyLiabilities = List(2) { input.u64String() }
        val sequence = input.u64String()
        if (input.hasRemaining()) throw DecodeException("Unexpected trailing Vault account data")
        return Vault(version, bump, status, authority, revision, assets, shareMint, totalShares, minimumLockedShares, accountedAmounts, bootstrapReserve, bountyLiabilities, sequence)
    }

    private fun ByteBuffer.u64String(): String = long.toULong().toString()

    private fun ByteBuffer.pubkey(): String {
        val bytes = ByteArray(32)
        get(bytes)
        return encodeBase58(bytes)
    }

    private fun encodeBase58(input: ByteArray): String {
        var zeros = 0
        while (zeros < input.size && input[zeros] == 0.toByte()) zeros++
        if (zeros == input.size) return "1".repeat(zeros)
        val digits = mutableListOf(0)
        for (index in zeros until input.size) {
            var carry = input[index].toUByte().toInt()
            for (digitIndex in digits.indices) {
                carry += digits[digitIndex] shl 8
                digits[digitIndex] = carry % 58
                carry /= 58
            }
            while (carry > 0) {
                digits.add(carry % 58)
                carry /= 58
            }
        }
        return "1".repeat(zeros) + digits.asReversed().joinToString("") { ALPHABET[it].toString() }
    }
}
