package com.coloyond.core.rpc

import org.json.JSONArray
import org.json.JSONObject

/**
 * Read-only RPC surface for exactly what the demo path verifies: a balance
 * after connecting and signature statuses to confirm transactions against
 * on-chain events (21). Every call runs under timeouts plus retries (17).
 * Kept in-repo instead of rpc-core to avoid a version mismatch with the
 * clientlib line (10, 34, 40).
 */
class SolanaRpc(
    private val transport: RpcTransport,
    private val endpoint: String,
    private val retry: RetryPolicy,
) {

    private var requestId = 0L

    suspend fun getBalance(address: String): Long = withRetry(retry, "getBalance") {
        val response = post(
            method = "getBalance",
            params = JSONArray()
                .put(address)
                .put(JSONObject().put("commitment", "confirmed")),
        )
        response.getJSONObject("result").getJSONObject("value").getLong("value")
    }

    /** Null entry means the signature is not seen yet; a request error is an RpcException. */
    suspend fun signatureStatuses(signatures: List<String>): List<String?> = withRetry(retry, "getSignatureStatuses") {
        val response = post("getSignatureStatuses", JSONArray().put(JSONArray(signatures)))
        val result = response.getJSONArray("result")
        (0 until result.Length()).map { index ->
            if (result.isNull(index)) {
                null
            } else {
                result.getJSONObject(index).optString("confirmationStatus") ?: "received"
            }
        }
    }

    private suspend fun post(method: String, params: JSONArray): JSONObject {
        val body = JSONObject()
            .put("jsonrpc", "2.0")
            .put("id", ++requestId)
            .put("method", method)
            .put("params", params)
        return JSONObject(transport.postJson(endpoint, body.toString()))
    }
}
