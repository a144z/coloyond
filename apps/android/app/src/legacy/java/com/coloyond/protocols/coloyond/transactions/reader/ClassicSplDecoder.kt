package com.coloyond.protocols.coloyond.transactions.reader

import java.math.BigInteger
import com.coloyond.protocols.coloyond.transactions.ColoyondAddresses

data class ClassicMintAccount(
    val mintAuthority: String?,
    val supply: String,
    val decimals: Int,
    val freezeAuthority: String?,
    val initialized: Boolean,
)

data class ClassicTokenAccount(
    val mint: String,
    val authority: String,
    val amount: String,
    val delegate: String?,
    val state: State,
    val nativeReserve: String?,
    val delegatedAmount: String,
    val closeAuthority: String?,
) {
    enum class State { INITIALIZED }
}

/** Strict decoder for the classic SPL Token program's packed Mint and Account layouts. */
object ClassicSplDecoder {
    const val MINT_SIZE = 82
    const val TOKEN_ACCOUNT_SIZE = 165
    const val TOKEN_PROGRAM_ID = ColoyondAddresses.TOKEN_PROGRAM_ID

    fun decodeMint(data: ByteArray, ownerProgramId: String): ClassicMintAccount {
        requireTokenProgram(ownerProgramId)
        require(data.size == MINT_SIZE) { "Classic SPL Mint must contain exactly $MINT_SIZE bytes" }
        val reader = Reader(data)
        val mintAuthority = reader.cOptionPubkey("mint authority")
        val supply = reader.u64("mint supply")
        val decimals = reader.u8("mint decimals")
        val initialized = reader.boolean("mint initialized flag")
        if (!initialized) throw DecodeException("Classic SPL Mint is uninitialized")
        val freezeAuthority = reader.cOptionPubkey("freeze authority")
        reader.finish()
        return ClassicMintAccount(mintAuthority, supply, decimals, freezeAuthority, initialized)
    }

    fun decodeTokenAccount(
        data: ByteArray,
        ownerProgramId: String,
        expectedMint: String? = null,
        expectedAuthority: String? = null,
    ): ClassicTokenAccount {
        requireTokenProgram(ownerProgramId)
        require(data.size == TOKEN_ACCOUNT_SIZE) {
            "Classic SPL Token Account must contain exactly $TOKEN_ACCOUNT_SIZE bytes"
        }
        val reader = Reader(data)
        val mint = reader.pubkey("token mint")
        val authority = reader.pubkey("token authority")
        val amount = reader.u64("token amount")
        val delegate = reader.cOptionPubkey("delegate")
        val state = when (reader.u8("token account state")) {
            1 -> ClassicTokenAccount.State.INITIALIZED
            0 -> throw DecodeException("Classic SPL Token Account is uninitialized")
            2 -> throw DecodeException("Classic SPL Token Account is frozen")
            else -> throw DecodeException("Classic SPL Token Account has an unsupported state")
        }
        val nativeReserve = reader.cOptionU64("native reserve")
        val delegatedAmount = reader.u64("delegated amount")
        val closeAuthority = reader.cOptionPubkey("close authority")
        reader.finish()

        if (expectedMint != null && mint != expectedMint) {
            throw DecodeException("Classic SPL Token Account mint does not match the expected mint")
        }
        if (expectedAuthority != null && authority != expectedAuthority) {
            throw DecodeException("Classic SPL Token Account authority does not match the expected owner")
        }
        return ClassicTokenAccount(
            mint = mint,
            authority = authority,
            amount = amount,
            delegate = delegate,
            state = state,
            nativeReserve = nativeReserve,
            delegatedAmount = delegatedAmount,
            closeAuthority = closeAuthority,
        )
    }

    private fun requireTokenProgram(ownerProgramId: String) {
        if (ownerProgramId != TOKEN_PROGRAM_ID) {
            throw DecodeException("SPL account owner does not match the classic Token program")
        }
    }

    private class Reader(private val data: ByteArray) {
        private var offset = 0

        fun u8(label: String): Int = read(1, label)[0].toInt() and 0xff

        fun boolean(label: String): Boolean = when (u8(label)) {
            0 -> false
            1 -> true
            else -> throw DecodeException("$label is not a canonical boolean")
        }

        fun u64(label: String): String {
            val bigEndian = read(8, label).reversedArray()
            return BigInteger(1, bigEndian).toString()
        }

        fun pubkey(label: String): String = base58(read(32, label))

        fun cOptionPubkey(label: String): String? {
            val some = cOptionTag(label)
            val value = read(32, "$label value")
            if (!some && value.any { it != 0.toByte() }) {
                throw DecodeException("$label has nonzero bytes for a None option")
            }
            return if (some) base58(value) else null
        }

        fun cOptionU64(label: String): String? {
            val some = cOptionTag(label)
            val value = read(8, "$label value")
            if (!some && value.any { it != 0.toByte() }) {
                throw DecodeException("$label has nonzero bytes for a None option")
            }
            return if (some) BigInteger(1, value.reversedArray()).toString() else null
        }

        fun finish() {
            if (offset != data.size) throw DecodeException("Unexpected trailing bytes in classic SPL account")
        }

        private fun cOptionTag(label: String): Boolean {
            val tag = read(4, "$label option tag")
            if (tag[1] != 0.toByte() || tag[2] != 0.toByte() || tag[3] != 0.toByte()) {
                throw DecodeException("$label has an invalid COption tag")
            }
            return when (tag[0].toInt() and 0xff) {
                0 -> false
                1 -> true
                else -> throw DecodeException("$label has an invalid COption tag")
            }
        }

        private fun read(size: Int, label: String): ByteArray {
            if (size < 0 || offset + size > data.size) throw DecodeException("Truncated $label")
            return data.copyOfRange(offset, offset + size).also { offset += size }
        }
    }

    private fun base58(bytes: ByteArray): String {
        val zeroCount = bytes.takeWhile { it == 0.toByte() }.size
        var value = BigInteger(1, bytes)
        val encoded = StringBuilder()
        while (value.signum() > 0) {
            val division = value.divideAndRemainder(BASE58_RADIX)
            encoded.append(BASE58_ALPHABET[division[1].toInt()])
            value = division[0]
        }
        return "1".repeat(zeroCount) + encoded.reverse().toString()
    }

    private class DecodeException(message: String) : IllegalArgumentException(message)

    private val BASE58_RADIX = BigInteger.valueOf(58)
    private const val BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
}
