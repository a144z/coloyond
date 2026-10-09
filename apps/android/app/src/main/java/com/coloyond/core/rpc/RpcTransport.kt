package com.coloyond.core.rpc

/** Minimal JSON-RPC seam so the app never touches sockets (16, 17). */
interface RpcTransport {
    suspend fun postJson(url: String, body: String): String
}
