package com.coloyond.core.rpc

import java.util.concurrent.atomic.AtomicLong
import org.json.JSONArray
import org.json.JSONObject

/** One signature's state: its commitment level, and the error if the transaction failed on-chain. */
data class SignatureStatus(val confirmationStatus: String, val err: String?)

/**
 * Read-only RPC surface for exactly what the demo path verifies: a balance
 * after connecting, a recent blockhash to build a transaction, and signature
 * statuses to confirm transactions against on-chain events (21). Every call
 * runs under timeouts plus retries (17). Kept in-repo instead of rpc-core to
 * avoid a version mismatch with the clientlib line (10, 34, 40).
 */
class SolanaRpc(
    private val transport: RpcTransport,
    private val endpoint: String,
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

    /** Base58 blockhash for a new transaction's recentBlockhash field. */
    suspend fun getLatestBlockhash(): String = withRetry(retry, "getLatestBlockhash") {
        val result = post(
            method = "getLatestBlockhash",
            params = JSONArray().put(JSONObject().put("commitment", "confirmed")),
        )
        result.getJSONObject("result").getJSONObject("value").getString("blockhash")
    }

    /**
     * One entry per signature, or null when the node has not seen it yet. A
     * transaction that failed on-chain still has a confirmation status, so
     * callers must check [SignatureStatus.err]. A request error is an RpcException.
     */
    suspend fun signatureStatuses(signatures: List<String>): List<SignatureStatus?> = withRetry(retry, "getSignatureStatuses") {
        val values = post("getSignatureStatuses", JSONArray().put(JSONArray(signatures)))
            .getJSONObject("result")
            .getJSONArray("value")
        (0 until values.length()).map { index ->
            if (values.isNull(index)) {
                null
            } else {
                val status = values.getJSONObject(index)
                SignatureStatus(
                    confirmationStatus = status.optString("confirmationStatus", "processed"),
                    err = if (status.isNull("err")) null else status.get("err").toString(),
                )
            }
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
}
