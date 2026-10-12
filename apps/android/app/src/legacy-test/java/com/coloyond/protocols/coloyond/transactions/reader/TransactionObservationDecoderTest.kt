package com.coloyond.protocols.coloyond.transactions.reader

import com.coloyond.core.rpc.TransactionObservation
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class TransactionObservationDecoderTest {
    private val mint = "11111111111111111111111111111111"
    private val owner = mint

    @Test
    fun decodesLegacyAndKeepsExactSerializedMessageBytes() {
        val message = legacyMessage()
        val decoded = TransactionObservationDecoder.decode(
            TransactionObservation(
                slot = 45uL,
                wireTransaction = signed(message),
                error = null,
                rawMetaJson = """{"preTokenBalances":[],"postTokenBalances":[],"err":null}""",
            ),
        )

        assertEquals(SolanaMessageVersion.LEGACY, decoded.messageVersion)
        assertArrayEquals(message, decoded.serializedMessage)
        assertEquals(sha256(message), decoded.messageSha256)
        assertEquals("1".repeat(64), decoded.firstSignatureBase58)
        assertEquals(45uL, decoded.slot)
        assertTrue(decoded.metadataAvailable)
        assertTrue(decoded.preTokenBalancesAvailable)
        assertTrue(decoded.postTokenBalancesAvailable)
        assertEquals(null, decoded.transactionErrorJson)
        assertEquals(null, decoded.logMessages)
        assertTrue(decoded.tokenBalanceDeltas.isEmpty())
    }

    @Test
    fun decodesLegacyInstructionProgramAccountsAndExactInstructionData() {
        val decoded = TransactionObservationDecoder.decode(
            TransactionObservation(45uL, signed(legacyMessageWithAccounts()), null, null),
        )

        val instruction = decoded.instructions.single()
        assertEquals(2, instruction.accountIndexes.size)
        assertEquals(listOf(0, 1), instruction.accountIndexes)
        assertEquals(decoded.staticAccountKeys[2], instruction.programId)
        assertEquals(listOf(decoded.staticAccountKeys[0], decoded.staticAccountKeys[1]), instruction.accountAddresses)
        assertEquals("pQ==", instruction.dataBase64)
    }

    @Test
    fun preservesStructuredTransactionErrorAndRawLogMessages() {
        val structuredError = """{"InstructionError":[1,{"Custom":6000}]}"""
        val logs = listOf("Program 11111111111111111111111111111111 invoke [1]", "Program failed: custom program error: 0x1770")
        val rawMeta = """
            {
              "preTokenBalances":[],
              "postTokenBalances":[],
              "err":$structuredError,
              "logMessages":["${logs[0]}","${logs[1]}"]
            }
        """.trimIndent()

        val decoded = TransactionObservationDecoder.decode(
            TransactionObservation(45uL, signed(legacyMessage()), structuredError, rawMeta),
        )

        val errorJson = JSONObject(decoded.transactionErrorJson!!)
        val instructionError = errorJson.getJSONArray("InstructionError")
        assertEquals(1, instructionError.getInt(0))
        assertEquals(6000, instructionError.getJSONObject(1).getInt("Custom"))
        assertEquals(structuredError, decoded.rpcError)
        assertEquals(logs, decoded.logMessages)
    }

    @Test
    fun decodesV0MessageAndAllowsInstructionIndexesFromAddressLookups() {
        val message = v0MessageWithLookup()
        val decoded = TransactionObservationDecoder.decode(
            TransactionObservation(46uL, signed(message), null, null),
        )

        assertEquals(SolanaMessageVersion.V0, decoded.messageVersion)
        assertArrayEquals(message, decoded.serializedMessage)
        assertEquals(sha256(message), decoded.messageSha256)
        assertFalse(decoded.metadataAvailable)
        assertFalse(decoded.preTokenBalancesAvailable)
        assertFalse(decoded.postTokenBalancesAvailable)
        assertTrue(decoded.preTokenBalances.isEmpty())
    }

    @Test
    fun pairsTokenBalancesByAccountAndMintWithExactU64DeltaStrings() {
        val meta = """
            {
              "preTokenBalances":[
                {"accountIndex":2,"mint":"$mint","owner":"$owner","uiTokenAmount":{"amount":"18446744073709551615","decimals":9}}
              ],
              "postTokenBalances":[
                {"accountIndex":2,"mint":"$mint","owner":"$owner","uiTokenAmount":{"amount":"18446744073709551614","decimals":9}},
                {"accountIndex":4,"mint":"$mint","owner":"$owner","uiTokenAmount":{"amount":"17","decimals":9}}
              ]
            }
        """.trimIndent()

        val decoded = TransactionObservationDecoder.decode(
            TransactionObservation(47uL, signed(legacyMessage()), null, meta),
        )

        val existingKey = TokenBalanceKey(2, mint)
        assertEquals("18446744073709551615", decoded.preTokenBalances[existingKey]!!.amount)
        assertEquals("18446744073709551614", decoded.postTokenBalances[existingKey]!!.amount)
        val existingDelta = decoded.tokenBalanceDeltas.single { it.key == existingKey }
        assertEquals("-1", existingDelta.deltaAmount)
        assertEquals(9, existingDelta.decimals)

        val addedDelta = decoded.tokenBalanceDeltas.single { it.key.accountIndex == 4 }
        assertEquals(null, addedDelta.preAmount)
        assertEquals("17", addedDelta.postAmount)
        assertEquals("17", addedDelta.deltaAmount)
    }

    @Test
    fun pairsBalancesEvenWhenOwnerIsMissingOrChangesBetweenSides() {
        val otherOwner = "11111111111111111111111111111112"
        val meta = """
            {
              "preTokenBalances":[
                {"accountIndex":2,"mint":"$mint","owner":"$owner","uiTokenAmount":{"amount":"50","decimals":9}},
                {"accountIndex":3,"mint":"$mint","owner":"$owner","uiTokenAmount":{"amount":"20","decimals":9}}
              ],
              "postTokenBalances":[
                {"accountIndex":2,"mint":"$mint","owner":"$otherOwner","uiTokenAmount":{"amount":"45","decimals":9}},
                {"accountIndex":3,"mint":"$mint","uiTokenAmount":{"amount":"25","decimals":9}}
              ]
            }
        """.trimIndent()

        val decoded = TransactionObservationDecoder.decode(
            TransactionObservation(47uL, signed(legacyMessage()), null, meta),
        )

        assertEquals(2, decoded.tokenBalanceDeltas.size)
        val changedOwner = decoded.tokenBalanceDeltas.single { it.key.accountIndex == 2 }
        assertEquals("-5", changedOwner.deltaAmount)
        assertEquals(owner, changedOwner.preOwner)
        assertEquals(otherOwner, changedOwner.postOwner)
        val missingOwner = decoded.tokenBalanceDeltas.single { it.key.accountIndex == 3 }
        assertEquals("5", missingOwner.deltaAmount)
        assertEquals(owner, missingOwner.preOwner)
        assertEquals(null, missingOwner.postOwner)
    }

    @Test
    fun marksNullTokenBalanceArraysUnavailableWithoutInferringDeltas() {
        val meta = """
            {
              "preTokenBalances":[
                {"accountIndex":2,"mint":"$mint","owner":"$owner","uiTokenAmount":{"amount":"50","decimals":9}}
              ],
              "postTokenBalances":null
            }
        """.trimIndent()

        val decoded = TransactionObservationDecoder.decode(
            TransactionObservation(47uL, signed(legacyMessage()), null, meta),
        )

        assertTrue(decoded.preTokenBalancesAvailable)
        assertFalse(decoded.postTokenBalancesAvailable)
        assertEquals("50", decoded.preTokenBalances.values.single().amount)
        assertTrue(decoded.postTokenBalances.isEmpty())
        assertTrue(decoded.tokenBalanceDeltas.isEmpty())
    }

    @Test
    fun rejectsUnsupportedVersionsTrailingBytesAndNoncanonicalShortvec() {
        val unsupportedV1 = byteArrayOf(0x81.toByte(), 1, 0, 0)
        assertThrows(TransactionObservationDecodeException::class.java) {
            TransactionObservationDecoder.decode(TransactionObservation(1uL, signed(unsupportedV1), null, null))
        }
        assertThrows(TransactionObservationDecodeException::class.java) {
            TransactionObservationDecoder.decode(
                TransactionObservation(1uL, signed(legacyMessage()) + byteArrayOf(0), null, null),
            )
        }
        val overlongSignatureCount = byteArrayOf(0x81.toByte(), 0) + ByteArray(64) + legacyMessage()
        assertThrows(TransactionObservationDecodeException::class.java) {
            TransactionObservationDecoder.decode(
                TransactionObservation(1uL, overlongSignatureCount, null, null),
            )
        }
    }

    @Test
    fun rejectsSignatureHeaderMismatchAndMalformedTokenAmounts() {
        val badHeader = legacyMessage().also { it[0] = 2 }
        assertThrows(TransactionObservationDecodeException::class.java) {
            TransactionObservationDecoder.decode(TransactionObservation(1uL, signed(badHeader), null, null))
        }
        val badMeta = """
            {"preTokenBalances":[],"postTokenBalances":[
              {"accountIndex":0,"mint":"$mint","owner":"$owner","uiTokenAmount":{"amount":"01","decimals":6}}
            ]}
        """.trimIndent()
        assertThrows(TransactionObservationDecodeException::class.java) {
            TransactionObservationDecoder.decode(
                TransactionObservation(1uL, signed(legacyMessage()), null, badMeta),
            )
        }
    }

    @Test
    fun rejectsFetchedTransactionWhoseSignatureDiffersFromTheRequestedSignature() {
        assertThrows(TransactionObservationDecodeException::class.java) {
            TransactionObservationDecoder.decode(
                TransactionObservation(
                    slot = 1uL,
                    wireTransaction = signed(legacyMessage()),
                    error = null,
                    rawMetaJson = null,
                    requestedSignature = "not-the-transaction-signature",
                ),
            )
        }
    }

    private fun legacyMessage(): ByteArray = ByteArrayOutputStream().apply {
        write(1) // required signatures
        write(0) // readonly signed accounts
        write(0) // readonly unsigned accounts
        write(shortVec(1)) // static account keys
        write(ByteArray(32)) // signer / program account
        write(ByteArray(32) { 7 }) // recent blockhash
        write(shortVec(1)) // instructions
        write(0) // program id index
        write(shortVec(0)) // account indexes
        write(shortVec(1)) // instruction data length
        write(0xA5)
    }.toByteArray()

    private fun legacyMessageWithAccounts(): ByteArray = ByteArrayOutputStream().apply {
        write(1) // required signatures
        write(0) // readonly signed accounts
        write(2) // readonly unsigned accounts
        write(shortVec(3)) // static account keys
        write(ByteArray(32)) // fee payer
        write(ByteArray(32) { 1 }) // instruction account
        write(ByteArray(32) { 2 }) // program id
        write(ByteArray(32) { 7 }) // recent blockhash
        write(shortVec(1)) // instructions
        write(2) // program id index
        write(shortVec(2)) // account indexes
        write(0)
        write(1)
        write(shortVec(1)) // instruction data length
        write(0xA5)
    }.toByteArray()

    private fun v0MessageWithLookup(): ByteArray = ByteArrayOutputStream().apply {
        write(0x80) // v0 version prefix
        write(1) // required signatures
        write(0) // readonly signed accounts
        write(0) // readonly unsigned static accounts
        write(shortVec(1)) // static account keys
        write(ByteArray(32)) // program id
        write(ByteArray(32) { 9 }) // recent blockhash
        write(shortVec(1)) // instructions
        write(0) // static program id index
        write(shortVec(1)) // one loaded account index
        write(1) // first writable loaded address
        write(shortVec(0)) // instruction data
        write(shortVec(1)) // address table lookup count
        write(ByteArray(32) { 3 }) // lookup table key
        write(shortVec(1)) // writable index count
        write(0) // writable table index
        write(shortVec(0)) // readonly index count
    }.toByteArray()

    private fun signed(message: ByteArray): ByteArray =
        byteArrayOf(1) + ByteArray(64) + message

    private fun shortVec(value: Int): ByteArray {
        var remaining = value
        val output = mutableListOf<Byte>()
        do {
            var next = remaining and 0x7f
            remaining = remaining ushr 7
            if (remaining != 0) next = next or 0x80
            output += next.toByte()
        } while (remaining != 0)
        return output.toByteArray()
    }

    private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
        .digest(bytes)
        .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
}
