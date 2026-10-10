package com.coloyond.core.rpc

import java.math.BigInteger
import java.util.Base64
import java.util.concurrent.atomic.AtomicLong
import org.json.JSONArray
import org.json.JSONObject

/** One signature's state: its commitment level, and the error if the transaction failed on-chain. */
data class SignatureStatus(
    val confirmationStatus: String,
    val err: String?,
    val slot: ULong? = null,
)

data class RpcContext(val slot: ULong)

data class RpcAccountInfo(
    val owner: String,
    val lamports: ULong,
    val executable: Boolean,
    val data: ByteArray,
)

data class RpcAccountBatch(val context: RpcContext, val accounts: List<RpcAccountInfo?>)

data class RpcLatestBlockhash(
    val context: RpcContext,
    val blockhash: String,
    val lastValidBlockHeight: ULong,
)

data class SignatureStatusBatch(
    val context: RpcContext,
    val statuses: List<SignatureStatus?>,
)

data class TransactionObservation(
    val slot: ULong,
    val wireTransaction: ByteArray,
    val error: String?,
    val rawMetaJson: String?,
    val requestedSignature: String? = null,
)

/**
 * Read-only RPC surface for network identity, coherent account snapshots,
 * transaction construction inputs, and confirmation/transaction observation.
 * Every call runs under retries (17). Kept in-repo instead of rpc-core to
 * avoid a version mismatch with the clientlib line (10, 34, 40).
 */
class SolanaRpc(
    private val transport: RpcTransport,
    val endpoint: String,
    private val retry: RetryPolicy,
) {

    private val requestId = AtomicLong(0)

    /** Balance in lamports. */
    suspend fun getBalance(address: String): Long = withRetry(retry, "getBalance") {
        val result = post(
            method = "getBalance",
            params = JSONArray()
                .put(address)
                .put(JSONObject().put("commitment", "confirmed")),
        )
        result.getJSONObject("result").getLong("value")
    }

    /** Genesis identity for this exact RPC endpoint. */
    suspend fun getGenesisHash(): String = withRetry(retry, "getGenesisHash") {
        parseResponse("getGenesisHash") {
            post("getGenesisHash", JSONArray()).get("result").asNonBlankString("result")
        }
    }

    /** All requested accounts are returned with the RPC node's single context slot. */
    suspend fun getMultipleAccounts(
        addresses: List<String>,
        minContextSlot: ULong? = null,
    ): RpcAccountBatch = withRetry(retry, "getMultipleAccounts") {
        require(addresses.isNotEmpty() && addresses.size <= MAX_MULTIPLE_ACCOUNTS) {
            "getMultipleAccounts requires between 1 and $MAX_MULTIPLE_ACCOUNTS addresses"
        }
        require(addresses.all { it.isNotBlank() }) { "Account addresses must not be blank" }

        val config = JSONObject()
            .put("commitment", "confirmed")
            .put("encoding", "base64")
        minContextSlot?.let { config.put("minContextSlot", BigInteger(it.toString())) }

        parseResponse("getMultipleAccounts") {
            val result = post(
                "getMultipleAccounts",
                JSONArray().put(JSONArray(addresses)).put(config),
            ).getJSONObject("result")
            val context = RpcContext(result.getJSONObject("context").requireULong("slot"))
            val values = result.getJSONArray("value")
            require(values.length() == addresses.size) {
                "RPC returned ${values.length()} accounts for ${addresses.size} requests"
            }
            RpcAccountBatch(
                context = context,
                accounts = List(values.length()) { index ->
                    if (values.isNull(index)) null else values.getJSONObject(index).toRpcAccountInfo()
                },
            )
        }
    }

    /** Typed blockhash snapshot while preserving the historical string-returning API below. */
    suspend fun getLatestBlockhashWithContext(): RpcLatestBlockhash =
        withRetry(retry, "getLatestBlockhash") {
            parseResponse("getLatestBlockhash") {
                val result = post(
                    "getLatestBlockhash",
                    JSONArray().put(JSONObject().put("commitment", "confirmed")),
                ).getJSONObject("result")
                val value = result.getJSONObject("value")
                RpcLatestBlockhash(
                    context = RpcContext(result.getJSONObject("context").requireULong("slot")),
                    blockhash = value.getString("blockhash").also {
                        require(it.isNotBlank()) { "RPC returned a blank blockhash" }
                    },
                    lastValidBlockHeight = value.requireULong("lastValidBlockHeight"),
                )
            }
        }

    /** Base58 blockhash for existing callers building a transaction. */
    suspend fun getLatestBlockhash(): String = getLatestBlockhashWithContext().blockhash

    /** Unix time for a confirmed slot, or null when the RPC has no block-time estimate. */
    suspend fun getBlockTime(slot: ULong): Long? = withRetry(retry, "getBlockTime") {
        parseResponse("getBlockTime") {
            val result = post("getBlockTime", JSONArray().put(BigInteger(slot.toString())))
                .get("result")
            if (result === JSONObject.NULL) null else result.asLong("result")
        }
    }

    /**
     * One entry per signature, or null when the node has not seen it yet. A
     * transaction that failed on-chain still has a confirmation status, so
     * callers must check [SignatureStatus.err]. A request error is an RpcException.
     */
    suspend fun signatureStatuses(signatures: List<String>): List<SignatureStatus?> =
        signatureStatusesWithContext(signatures, searchTransactionHistory = false).statuses

    /** Includes the RPC context and each observed signature slot for recovery/read-model callers. */
    suspend fun signatureStatusesWithContext(
        signatures: List<String>,
        searchTransactionHistory: Boolean,
    ): SignatureStatusBatch = withRetry(retry, "getSignatureStatuses") {
        require(signatures.isNotEmpty()) { "At least one signature is required" }
        parseResponse("getSignatureStatuses") {
            val result = post(
                "getSignatureStatuses",
                JSONArray()
                    .put(JSONArray(signatures))
                    .put(JSONObject().put("searchTransactionHistory", searchTransactionHistory)),
            ).getJSONObject("result")
            val context = RpcContext(result.getJSONObject("context").requireULong("slot"))
            val values = result.getJSONArray("value")
            require(values.length() == signatures.size) {
                "RPC returned ${values.length()} statuses for ${signatures.size} signatures"
            }
            SignatureStatusBatch(
                context = context,
                statuses = List(values.length()) { index ->
                    if (values.isNull(index)) null else {
                        val status = values.getJSONObject(index)
                        SignatureStatus(
                            confirmationStatus = status.optString("confirmationStatus", "processed"),
                            err = if (status.isNull("err")) null else status.get("err").toString(),
                            slot = status.requireULong("slot"),
                        )
                    }
                },
            )
        }
    }

    /** Confirmed transaction wire bytes and raw metadata, or null if the RPC has not observed it. */
    suspend fun getTransaction(signature: String): TransactionObservation? =
        withRetry(retry, "getTransaction") {
            require(signature.isNotBlank()) { "Transaction signature must not be blank" }
            parseResponse("getTransaction") {
                val result = post(
                    "getTransaction",
                    JSONArray().put(signature).put(
                        JSONObject()
                            .put("commitment", "confirmed")
                            .put("encoding", "base64")
                            .put("maxSupportedTransactionVersion", 0),
                    ),
                ).get("result")
                if (result === JSONObject.NULL) return@parseResponse null

                val transaction = (result as? JSONObject)?.getJSONArray("transaction")
                    ?: error("RPC transaction result is malformed")
                require(transaction.length() == 2 && transaction.getString(1) == "base64") {
                    "RPC transaction result is not a base64 wire transaction"
                }
                val meta = result.opt("meta")
                val metaObject = if (meta == null || meta === JSONObject.NULL) null else meta as? JSONObject
                    ?: error("RPC transaction metadata is malformed")
                TransactionObservation(
                    slot = result.requireULong("slot"),
                    wireTransaction = Base64.getDecoder().decode(transaction.getString(0)),
                    error = metaObject?.let { item ->
                        val transactionError = item.opt("err")
                        if (transactionError == null || transactionError === JSONObject.NULL) null else transactionError.toString()
                    },
                    rawMetaJson = metaObject?.toString(),
                    requestedSignature = signature,
                )
            }
        }

    private suspend fun post(method: String, params: JSONArray): JSONObject {
        val body = JSONObject()
            .put("jsonrpc", "2.0")
            .put("id", requestId.incrementAndGet())
            .put("method", method)
            .put("params", params)
        val response = JSONObject(transport.postJson(endpoint, body.toString()))
        response.optJSONObject("error")?.let { error ->
            throw RpcException("$method: ${error.optString("message", "RPC error")}")
        }
        return response
    }

    private inline fun <T> parseResponse(method: String, decode: () -> T): T = try {
        decode()
    } catch (error: RpcException) {
        throw error
    } catch (error: Exception) {
        throw RpcException("$method returned a malformed response: ${error.message}", error)
    }

    private fun JSONObject.requireULong(key: String): ULong = get(key).asULong(key)

    private fun Any?.asULong(label: String): ULong {
        val number = this as? Number ?: error("$label must be an unsigned integer")
        val raw = number.toString()
        require(raw.matches(UNSIGNED_INTEGER)) { "$label must be an unsigned integer" }
        return raw.toULongOrNull() ?: error("$label is outside the u64 range")
    }

    private fun Any?.asLong(label: String): Long {
        val number = this as? Number ?: error("$label must be an integer")
        val raw = number.toString()
        require(raw.matches(SIGNED_INTEGER)) { "$label must be an integer" }
        return raw.toLongOrNull() ?: error("$label is outside the i64 range")
    }

    private fun Any?.asNonBlankString(label: String): String = (this as? String)
        ?.takeIf(String::isNotBlank)
        ?: error("$label must be a nonblank string")

    private fun JSONObject.toRpcAccountInfo(): RpcAccountInfo {
        val encodedData = getJSONArray("data")
        require(encodedData.length() == 2 && encodedData.getString(1) == "base64") {
            "Account data is not base64 encoded"
        }
        return RpcAccountInfo(
            owner = getString("owner").also { require(it.isNotBlank()) { "Account owner is blank" } },
            lamports = requireULong("lamports"),
            executable = getBoolean("executable"),
            data = Base64.getDecoder().decode(encodedData.getString(0)),
        )
    }

    private companion object {
        const val MAX_MULTIPLE_ACCOUNTS = 100
        val UNSIGNED_INTEGER = Regex("0|[1-9][0-9]*")
        val SIGNED_INTEGER = Regex("-?(0|[1-9][0-9]*)")
    }
}
