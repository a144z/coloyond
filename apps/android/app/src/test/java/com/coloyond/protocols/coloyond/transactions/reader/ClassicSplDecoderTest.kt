package com.coloyond.protocols.coloyond.transactions.reader

import com.coloyond.protocols.coloyond.transactions.ColoyondAddresses
import java.math.BigInteger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class ClassicSplDecoderTest {
    @Test
    fun decodesInitializedMintAndPreservesUnsignedSupply() {
        val decoded = ClassicSplDecoder.decodeMint(mintFixture(supply = U64_MAX), ClassicSplDecoder.TOKEN_PROGRAM_ID)

        assertEquals(ColoyondAddresses.PROGRAM_ID, decoded.mintAuthority)
        assertEquals(U64_MAX, decoded.supply)
        assertEquals(9, decoded.decimals)
        assertNull(decoded.freezeAuthority)
        assertEquals(true, decoded.initialized)
    }

    @Test
    fun rejectsMintWrongOwnerLengthMalformedOptionsAndUninitializedState() {
        assertThrows(IllegalArgumentException::class.java) {
            ClassicSplDecoder.decodeMint(mintFixture(), TOKEN_2022_PROGRAM_ID)
        }
        assertThrows(IllegalArgumentException::class.java) {
            ClassicSplDecoder.decodeMint(mintFixture().copyOf(81), ClassicSplDecoder.TOKEN_PROGRAM_ID)
        }
        assertThrows(IllegalArgumentException::class.java) {
            ClassicSplDecoder.decodeMint(mintFixture().copyOf(83), ClassicSplDecoder.TOKEN_PROGRAM_ID)
        }
        assertThrows(IllegalArgumentException::class.java) {
            ClassicSplDecoder.decodeMint(mintFixture().also { it[0] = 2 }, ClassicSplDecoder.TOKEN_PROGRAM_ID)
        }
        assertThrows(IllegalArgumentException::class.java) {
            ClassicSplDecoder.decodeMint(mintFixture().also { it[45] = 0 }, ClassicSplDecoder.TOKEN_PROGRAM_ID)
        }
        assertThrows(IllegalArgumentException::class.java) {
            ClassicSplDecoder.decodeMint(mintFixture().also { it[46] = 2 }, ClassicSplDecoder.TOKEN_PROGRAM_ID)
        }
        assertThrows(IllegalArgumentException::class.java) {
            ClassicSplDecoder.decodeMint(mintFixture().also { it[4] = 1 }, ClassicSplDecoder.TOKEN_PROGRAM_ID)
        }
    }

    @Test
    fun decodesInitializedTokenAccountAndChecksExactMintAndAuthority() {
        val decoded = ClassicSplDecoder.decodeTokenAccount(
            tokenAccountFixture(amount = U64_MAX, delegatedAmount = "9223372036854775809", nativeReserve = "123"),
            ClassicSplDecoder.TOKEN_PROGRAM_ID,
            expectedMint = ColoyondAddresses.WSOL_MINT,
            expectedAuthority = ColoyondAddresses.PROGRAM_ID,
        )

        assertEquals(ColoyondAddresses.WSOL_MINT, decoded.mint)
        assertEquals(ColoyondAddresses.PROGRAM_ID, decoded.authority)
        assertEquals(U64_MAX, decoded.amount)
        assertEquals(ColoyondAddresses.PROGRAM_ID, decoded.delegate)
        assertEquals(ClassicTokenAccount.State.INITIALIZED, decoded.state)
        assertEquals("123", decoded.nativeReserve)
        assertEquals("9223372036854775809", decoded.delegatedAmount)
        assertNull(decoded.closeAuthority)
    }

    @Test
    fun rejectsTokenAccountWrongOwnerLengthMintAuthorityAndInvalidStates() {
        val valid = tokenAccountFixture()
        assertThrows(IllegalArgumentException::class.java) {
            ClassicSplDecoder.decodeTokenAccount(valid, TOKEN_2022_PROGRAM_ID)
        }
        assertThrows(IllegalArgumentException::class.java) {
            ClassicSplDecoder.decodeTokenAccount(valid.copyOf(164), ClassicSplDecoder.TOKEN_PROGRAM_ID)
        }
        assertThrows(IllegalArgumentException::class.java) {
            ClassicSplDecoder.decodeTokenAccount(valid.copyOf(166), ClassicSplDecoder.TOKEN_PROGRAM_ID)
        }
        assertThrows(IllegalArgumentException::class.java) {
            ClassicSplDecoder.decodeTokenAccount(valid, ClassicSplDecoder.TOKEN_PROGRAM_ID, expectedMint = "11111111111111111111111111111111")
        }
        assertThrows(IllegalArgumentException::class.java) {
            ClassicSplDecoder.decodeTokenAccount(valid, ClassicSplDecoder.TOKEN_PROGRAM_ID, expectedAuthority = "11111111111111111111111111111111")
        }
        for (state in listOf(0, 2, 3)) {
            assertThrows(IllegalArgumentException::class.java) {
                ClassicSplDecoder.decodeTokenAccount(valid.copyOf().also { it[108] = state.toByte() }, ClassicSplDecoder.TOKEN_PROGRAM_ID)
            }
        }
    }

    @Test
    fun rejectsMalformedTokenAccountOptionsAndNoncanonicalNonePayload() {
        for (offset in listOf(72, 109, 129)) {
            assertThrows(IllegalArgumentException::class.java) {
                ClassicSplDecoder.decodeTokenAccount(
                    tokenAccountFixture().also { it[offset] = 2 },
                    ClassicSplDecoder.TOKEN_PROGRAM_ID,
                )
            }
        }
        assertThrows(IllegalArgumentException::class.java) {
            ClassicSplDecoder.decodeTokenAccount(
                tokenAccountFixture(delegate = null).also { it[76] = 1 },
                ClassicSplDecoder.TOKEN_PROGRAM_ID,
            )
        }
        assertThrows(IllegalArgumentException::class.java) {
            ClassicSplDecoder.decodeTokenAccount(
                tokenAccountFixture(nativeReserve = null).also { it[113] = 1 },
                ClassicSplDecoder.TOKEN_PROGRAM_ID,
            )
        }
    }

    private fun mintFixture(supply: String = "0"): ByteArray = ByteArray(ClassicSplDecoder.MINT_SIZE).also { data ->
        putCOptionPubkey(data, 0, ColoyondAddresses.PROGRAM_ID)
        putU64(data, 36, supply)
        data[44] = 9
        data[45] = 1
        putCOptionPubkey(data, 46, null)
    }

    private fun tokenAccountFixture(
        amount: String = "42",
        delegatedAmount: String = "7",
        nativeReserve: String? = null,
        delegate: String? = ColoyondAddresses.PROGRAM_ID,
    ): ByteArray = ByteArray(ClassicSplDecoder.TOKEN_ACCOUNT_SIZE).also { data ->
        putPubkey(data, 0, ColoyondAddresses.WSOL_MINT)
        putPubkey(data, 32, ColoyondAddresses.PROGRAM_ID)
        putU64(data, 64, amount)
        putCOptionPubkey(data, 72, delegate)
        data[108] = 1
        putCOptionU64(data, 109, nativeReserve)
        putU64(data, 121, delegatedAmount)
        putCOptionPubkey(data, 129, null)
    }

    private fun putPubkey(data: ByteArray, offset: Int, address: String) {
        ColoyondAddresses.key(address).bytes.copyInto(data, offset)
    }

    private fun putCOptionPubkey(data: ByteArray, offset: Int, address: String?) {
        if (address != null) {
            data[offset] = 1
            putPubkey(data, offset + 4, address)
        }
    }

    private fun putCOptionU64(data: ByteArray, offset: Int, value: String?) {
        if (value != null) {
            data[offset] = 1
            putU64(data, offset + 4, value)
        }
    }

    private fun putU64(data: ByteArray, offset: Int, decimal: String) {
        var value = BigInteger(decimal)
        repeat(8) { index ->
            data[offset + index] = value.and(BigInteger.valueOf(255)).toByte()
            value = value.shiftRight(8)
        }
        require(value == BigInteger.ZERO)
    }

    private companion object {
        const val TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        const val U64_MAX = "18446744073709551615"
    }
}
