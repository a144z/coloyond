package com.coloyond.protocols.coloyond.transactions.reader

import com.coloyond.core.rpc.TransactionObservation
import java.math.BigInteger
import java.security.MessageDigest
import org.json.JSONArray
import org.json.JSONObject

data class TokenBalanceKey(
    val accountIndex: Int,
    val mint: String,
)

data class ExactTokenBalance(
    val amount: String,
    val decimals: Int,
    val owner: String?,
)

data class ExactTokenBalanceDelta(
    val key: TokenBalanceKey,
    val preAmount: String?,
    val postAmount: String?,
    val deltaAmount: String,
    val decimals: Int,
    val preOwner: String?,
    val postOwner: String?,
)

enum class SolanaMessageVersion { LEGACY, V0 }

data class DecodedMessageInstruction(
    val programId: String,
    val accountIndexes: List<Int>,
    /** Null when one or more v0 accounts are loaded from an address table. */
    val accountAddresses: List<String>?,
    val dataBase64: String,
)

/** A read-only view of the exact message and balance evidence returned by confirmed RPC. */
data class DecodedTransactionObservation(
    val slot: ULong,
    val requestedSignature: String?,
    val rpcError: String?,
    /** Structured Solana `meta.err` serialized as JSON, or null when it is absent/null. */
    val transactionErrorJson: String?,
    /** Null means unavailable/null in RPC metadata; an empty list means no logs were emitted. */
    val logMessages: List<String>?,
    val firstSignatureBase58: String,
    val messageVersion: SolanaMessageVersion,
    val serializedMessage: ByteArray,
    val messageSha256: String,
    val staticAccountKeys: List<String>,
    val instructions: List<DecodedMessageInstruction>,
    val metadataAvailable: Boolean,
    val preTokenBalancesAvailable: Boolean,
    val postTokenBalancesAvailable: Boolean,
    val preTokenBalances: Map<TokenBalanceKey, ExactTokenBalance>,
    val postTokenBalances: Map<TokenBalanceKey, ExactTokenBalance>,
    val tokenBalanceDeltas: List<ExactTokenBalanceDelta>,
)

class TransactionObservationDecodeException(message: String, cause: Throwable? = null) :
    IllegalArgumentException(message, cause)

/**
 * Strict parser for the signed wire bytes and token-balance evidence returned by read-only RPC.
 * It never signs, broadcasts, or rebuilds a transaction.
 */
object TransactionObservationDecoder {
    private const val SIGNATURE_SIZE = 64
    private const val PUBKEY_SIZE = 32
    private const val MAX_SHORTVEC = 65_535
    private const val MAX_ACCOUNT_KEYS = 256
    private const val U64_MAX = "18446744073709551615"
    private const val BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

    fun decode(observation: TransactionObservation): DecodedTransactionObservation = try {
        val (signature, message) = decodeWire(observation.wireTransaction)
        val parsedMessage = parseMessage(message)
        val signatureBase58 = encodeBase58(signature)
        if (observation.requestedSignature != null && observation.requestedSignature != signatureBase58) {
            fail("Fetched transaction first signature does not match the requested signature")
        }
        val parsedMeta = observation.rawMetaJson?.let(::decodeMeta)
        DecodedTransactionObservation(
            slot = observation.slot,
            requestedSignature = observation.requestedSignature,
            rpcError = observation.error,
            transactionErrorJson = parsedMeta?.transactionErrorJson,
            logMessages = parsedMeta?.logMessages,
            firstSignatureBase58 = signatureBase58,
            messageVersion = parsedMessage.version,
            serializedMessage = message,
            messageSha256 = sha256Hex(message),
            staticAccountKeys = parsedMessage.accountKeys,
            instructions = parsedMessage.instructions,
            metadataAvailable = parsedMeta != null,
            preTokenBalancesAvailable = parsedMeta?.preAvailable == true,
            postTokenBalancesAvailable = parsedMeta?.postAvailable == true,
            preTokenBalances = parsedMeta?.pre.orEmpty(),
            postTokenBalances = parsedMeta?.post.orEmpty(),
            tokenBalanceDeltas = parsedMeta?.deltas.orEmpty(),
        )
    } catch (error: TransactionObservationDecodeException) {
        throw error
    } catch (error: Exception) {
        throw TransactionObservationDecodeException("Malformed transaction observation", error)
    }

    private fun decodeWire(wire: ByteArray): Pair<ByteArray, ByteArray> {
        val cursor = Cursor(wire)
        val signatureCount = cursor.shortVec("signature count")
        if (signatureCount !in 1..127) fail("Transaction must contain 1 to 127 signatures")
        val signatures = List(signatureCount) { cursor.read(SIGNATURE_SIZE, "signature") }
        val messageBytes = cursor.read(wire.size - cursor.position, "serialized message")
        if (messageBytes.isEmpty()) fail("Transaction message is empty")
        val parsedMessage = parseMessage(messageBytes)
        if (signatureCount != parsedMessage.requiredSignatures) fail("Wire signature count does not match the message header")
        return signatures.first() to messageBytes
    }

    private data class RawInstruction(val programIndex: Int, val accountIndexes: List<Int>, val data: ByteArray)

    private data class ParsedMessage(
        val version: SolanaMessageVersion,
        val requiredSignatures: Int,
        val accountKeys: List<String>,
        val instructions: List<DecodedMessageInstruction>,
    )

    private fun parseMessage(message: ByteArray): ParsedMessage {
        val cursor = Cursor(message)
        val first = cursor.u8("message header")
        val version = if (first and 0x80 != 0) {
            val versionNumber = first and 0x7f
            if (versionNumber != 0) fail("Unsupported transaction message version $versionNumber")
            SolanaMessageVersion.V0
        } else {
            SolanaMessageVersion.LEGACY
        }

        val requiredSignatures = if (version == SolanaMessageVersion.LEGACY) first else cursor.u8("required signatures")
        val readonlySigned = cursor.u8("readonly signed account count")
        val readonlyUnsigned = cursor.u8("readonly unsigned account count")
        val staticKeyCount = cursor.shortVec("static account key count")
        if (staticKeyCount !in 1..MAX_ACCOUNT_KEYS) fail("Static account key count is outside Solana limits")
        if (requiredSignatures !in 1..127 || requiredSignatures > staticKeyCount) {
            fail("Message required-signature count is invalid")
        }
        if (readonlySigned > requiredSignatures || readonlyUnsigned > staticKeyCount - requiredSignatures) {
            fail("Message readonly account counts are invalid")
        }
        val accountKeys = List(staticKeyCount) { encodeBase58(cursor.read(PUBKEY_SIZE, "static account key")) }
        cursor.read(PUBKEY_SIZE, "recent blockhash")

        var totalAccountCount = staticKeyCount
        val instructionCount = cursor.shortVec("compiled instruction count")
        val rawInstructions = List(instructionCount) {
            val programIndex = cursor.u8("instruction program index")
            if (programIndex >= staticKeyCount) fail("Instruction program index is not a static account")
            val accountCount = cursor.shortVec("instruction account count")
            val accountIndexes = List(accountCount) {
                cursor.u8("instruction account index").also { index ->
                    if (version == SolanaMessageVersion.LEGACY && index >= totalAccountCount) {
                        fail("Instruction account index is out of range")
                    }
                }
            }
            val dataLength = cursor.shortVec("instruction data length")
            RawInstruction(programIndex, accountIndexes, cursor.read(dataLength, "instruction data"))
        }

        if (version == SolanaMessageVersion.V0) {
            val lookupCount = cursor.shortVec("address table lookup count")
            repeat(lookupCount) {
                cursor.read(PUBKEY_SIZE, "address table key")
                val writableCount = cursor.shortVec("writable lookup index count")
                cursor.read(writableCount, "writable lookup indexes")
                val readonlyCount = cursor.shortVec("readonly lookup index count")
                cursor.read(readonlyCount, "readonly lookup indexes")
                totalAccountCount += writableCount + readonlyCount
                if (totalAccountCount > MAX_ACCOUNT_KEYS) fail("Resolved account count exceeds Solana limits")
            }
            if (rawInstructions.any { instruction -> instruction.accountIndexes.any { it >= totalAccountCount } }) {
                fail("Versioned instruction account index is out of range")
            }
        }

        if (!cursor.isAtEnd()) fail("Transaction message contains trailing bytes")
        return ParsedMessage(
            version = version,
            requiredSignatures = requiredSignatures,
            accountKeys = accountKeys,
            instructions = rawInstructions.map { instruction ->
                DecodedMessageInstruction(
                    programId = accountKeys[instruction.programIndex],
                    accountIndexes = instruction.accountIndexes,
                    accountAddresses = instruction.accountIndexes.mapNotNull(accountKeys::getOrNull)
                        .takeIf { it.size == instruction.accountIndexes.size },
                    dataBase64 = java.util.Base64.getEncoder().encodeToString(instruction.data),
                )
            },
        )
    }

    private data class ParsedMeta(
        val pre: Map<TokenBalanceKey, ExactTokenBalance>,
        val post: Map<TokenBalanceKey, ExactTokenBalance>,
        val preAvailable: Boolean,
        val postAvailable: Boolean,
        val deltas: List<ExactTokenBalanceDelta>,
        val transactionErrorJson: String?,
        val logMessages: List<String>?,
    )

    private fun decodeMeta(raw: String): ParsedMeta {
        val meta = JSONObject(raw)
        val preValue = meta.optionalArray("preTokenBalances")
        val postValue = meta.optionalArray("postTokenBalances")
        val pre = preValue?.let(::decodeTokenBalances).orEmpty()
        val post = postValue?.let(::decodeTokenBalances).orEmpty()
        val keys = (pre.keys + post.keys).toSortedSet(
            compareBy<TokenBalanceKey>({ it.accountIndex }, { it.mint }),
        )
        val deltas = if (preValue == null || postValue == null) emptyList() else keys.map { key ->
            val before = pre[key]
            val after = post[key]
            if (before != null && after != null && before.decimals != after.decimals) {
                fail("Token balance decimals changed for account ${key.accountIndex}")
            }
            val decimals = after?.decimals ?: before!!.decimals
            val beforeAmount = before?.amount ?: "0"
            val afterAmount = after?.amount ?: "0"
            ExactTokenBalanceDelta(
                key = key,
                preAmount = before?.amount,
                postAmount = after?.amount,
                deltaAmount = (BigInteger(afterAmount) - BigInteger(beforeAmount)).toString(),
                decimals = decimals,
                preOwner = before?.owner,
                postOwner = after?.owner,
            )
        }
        val errorValue = meta.opt("err")
        val errorJson = when {
            errorValue == null || errorValue === JSONObject.NULL -> null
            errorValue is JSONObject || errorValue is JSONArray -> errorValue.toString()
            errorValue is String -> JSONObject.quote(errorValue)
            errorValue is Number || errorValue is Boolean -> errorValue.toString()
            else -> fail("Transaction metadata error has an unsupported JSON value")
        }
        val logsValue = meta.opt("logMessages")
        val logs = when {
            logsValue == null || logsValue === JSONObject.NULL -> null
            logsValue is JSONArray -> List(logsValue.length()) { index ->
                logsValue.opt(index) as? String ?: fail("Transaction log message $index is not a string")
            }
            else -> fail("Transaction metadata logMessages must be an array or null")
        }
        return ParsedMeta(pre, post, preValue != null, postValue != null, deltas, errorJson, logs)
    }

    private fun decodeTokenBalances(array: JSONArray): Map<TokenBalanceKey, ExactTokenBalance> {
        val result = linkedMapOf<TokenBalanceKey, ExactTokenBalance>()
        for (index in 0 until array.length()) {
            val balance = array.optJSONObject(index) ?: fail("Token balance entry $index is not an object")
            val accountIndex = balance.requiredInt("accountIndex")
            if (accountIndex !in 0..255) fail("Token balance account index is outside Solana limits")
            val mint = balance.requiredString("mint")
            requirePublicKey(mint, "token balance mint")
            val owner = balance.optionalString("owner")
            if (owner != null) requirePublicKey(owner, "token balance owner")
            val amountInfo = balance.optJSONObject("uiTokenAmount")
                ?: fail("Token balance entry $index is missing uiTokenAmount")
            val amount = amountInfo.requiredString("amount")
            if (!amount.matches(Regex("0|[1-9][0-9]*")) || BigInteger(amount) > BigInteger(U64_MAX)) {
                fail("Token balance amount is not a canonical u64 decimal string")
            }
            val decimals = amountInfo.requiredInt("decimals")
            if (decimals !in 0..255) fail("Token balance decimals are outside u8 range")
            val key = TokenBalanceKey(accountIndex, mint)
            if (result.put(key, ExactTokenBalance(amount, decimals, owner)) != null) {
                fail("Duplicate token balance key for account $accountIndex")
            }
        }
        return result.toMap()
    }

    private fun JSONObject.optionalArray(name: String): JSONArray? {
        val value = opt(name)
        return when {
            value == null || value === JSONObject.NULL -> null
            value is JSONArray -> value
            else -> fail("Transaction metadata $name must be an array or null")
        }
    }

    private fun JSONObject.requiredString(name: String): String =
        opt(name) as? String ?: fail("$name must be a string")

    private fun JSONObject.optionalString(name: String): String? {
        val value = opt(name)
        return when {
            value == null || value === JSONObject.NULL -> null
            value is String && value.isNotEmpty() -> value
            else -> fail("$name must be a nonempty string when present")
        }
    }

    private fun JSONObject.requiredInt(name: String): Int {
        val value = opt(name) as? Number ?: fail("$name must be an integer")
        val long = value.toLong()
        if (long !in Int.MIN_VALUE.toLong()..Int.MAX_VALUE.toLong()) fail("$name is outside integer range")
        if (value.toDouble() != long.toDouble()) fail("$name must be an integer")
        return long.toInt()
    }

    private fun requirePublicKey(value: String, label: String) {
        if (value.length !in 32..44 || value.any { it !in BASE58_ALPHABET }) fail("$label is not base58")
        val leadingZeros = value.takeWhile { it == '1' }.length
        val number = value.fold(BigInteger.ZERO) { current, char ->
            current * BigInteger.valueOf(58) + BigInteger.valueOf(BASE58_ALPHABET.indexOf(char).toLong())
        }
        val magnitudeBytes = if (number == BigInteger.ZERO) {
            ByteArray(0)
        } else {
            number.toByteArray().let { bytes ->
                if (bytes.size > 1 && bytes[0] == 0.toByte()) bytes.copyOfRange(1, bytes.size) else bytes
            }
        }
        if (leadingZeros + magnitudeBytes.size != PUBKEY_SIZE) fail("$label is not a 32-byte public key")
    }

    private fun encodeBase58(bytes: ByteArray): String {
        if (bytes.isEmpty()) return ""
        val leadingZeros = bytes.takeWhile { it == 0.toByte() }.size
        var value = BigInteger(1, bytes)
        val radix = BigInteger.valueOf(58)
        val encoded = StringBuilder()
        while (value > BigInteger.ZERO) {
            val division = value.divideAndRemainder(radix)
            encoded.append(BASE58_ALPHABET[division[1].toInt()])
            value = division[0]
        }
        repeat(leadingZeros) { encoded.append('1') }
        return encoded.reverse().toString()
    }

    private fun sha256Hex(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
        .digest(bytes)
        .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }

    private class Cursor(private val bytes: ByteArray) {
        var position: Int = 0
            private set

        fun u8(label: String): Int = read(1, label)[0].toInt() and 0xff

        fun shortVec(label: String): Int {
            var value = 0
            var shift = 0
            var count = 0
            while (count < 3) {
                val byte = u8(label)
                count++
                value = value or ((byte and 0x7f) shl shift)
                if (byte and 0x80 == 0) {
                    if (count > 1 && value < (1 shl (7 * (count - 1)))) fail("$label uses a noncanonical shortvec")
                    if (value > MAX_SHORTVEC) fail("$label exceeds shortvec limit")
                    return value
                }
                shift += 7
            }
            fail("$label shortvec is too long")
        }

        fun read(count: Int, label: String): ByteArray {
            if (count < 0 || position > bytes.size - count) fail("Truncated $label")
            val result = bytes.copyOfRange(position, position + count)
            position += count
            return result
        }

        fun isAtEnd(): Boolean = position == bytes.size
    }

    private fun fail(message: String): Nothing = throw TransactionObservationDecodeException(message)
}
