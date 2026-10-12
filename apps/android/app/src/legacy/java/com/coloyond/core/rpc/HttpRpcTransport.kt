package com.coloyond.core.rpc

import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** HttpURLConnection-backed transport; no extra dependency (10, 23). */
class HttpRpcTransport(
    private val connectTimeoutMs: Int,
    private val readTimeoutMs: Int,
) : RpcTransport {

    override suspend fun postJson(url: String, body: String): String = withContext(Dispatchers.IO) {
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = connectTimeoutMs
            connection.readTimeout = readTimeoutMs
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use { it.write(body.toByteArray()) }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
                ?: throw RpcException("HTTP $status from RPC")
            val text = stream.reader().use { it.readText() }
            if (status !in 200..299) throw RpcException("HTTP $status from RPC")
            text
        } finally {
            connection.disconnect()
        }
    }
}
