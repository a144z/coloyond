package com.coloyond.core.rpc

import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** Response shapes follow the Solana JSON-RPC docs. */
class SolanaRpcTest {

    private class FakeTransport(private val responses: MutableList<String>) : RpcTransport {
        val requests = mutableListOf<JSONObject>()
        override suspend fun postJson(url: String, body: String): String {
            requests += JSONObject(body)
            return responses.removeAt(0)
        }
    }

    private val noWait = RetryPolicy(maxAttempts = 2, initialDelayMs = 0, maxDelayMs = 0)

    private fun rpc(vararg responses: String) = FakeTransport(responses.toMutableList()).let { transport ->
        transport to SolanaRpc(transport, "https://rpc.test", noWait)
    }

    @Test
    fun getBalanceReadsLamportsFromResultValue() = runBlocking {
        val (transport, rpc) = rpc("""{"jsonrpc":"2.0","id":1,"result":{"context":{"slot":1},"value":1500000000}}""")
        assertEquals(1_500_000_000L, rpc.getBalance("Addr"))
        assertEquals("getBalance", transport.requests.single().getString("method"))
    }

    @Test
    fun getLatestBlockhashReadsBlockhash() = runBlocking {
        val (_, rpc) = rpc(
            """{"jsonrpc":"2.0","id":1,"result":{"context":{"slot":1},"value":{"blockhash":"EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N","lastValidBlockHeight":3090}}}""",
        )
        assertEquals("EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N", rpc.getLatestBlockhash())
    }

    @Test
    fun signatureStatusesMapsSeenAndUnseen() = runBlocking {
        val (_, rpc) = rpc(
            """{"jsonrpc":"2.0","id":1,"result":{"context":{"slot":82},"value":[{"slot":72,"confirmations":10,"err":null,"confirmationStatus":"confirmed"},null]}}""",
        )
        val statuses = rpc.signatureStatuses(listOf("sigA", "sigB"))
        assertEquals("confirmed", statuses[0])
        assertNull(statuses[1])
    }

    @Test
    fun rpcErrorIsRetriedThenSurfaced() = runBlocking {
        val error = """{"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"Invalid param"}}"""
        val (transport, rpc) = rpc(error, error)
        try {
            rpc.getBalance("bad")
            fail("expected RpcException")
        } catch (expected: RpcException) {
            assertTrue(expected.message!!.contains("Invalid param"))
        }
        assertEquals(2, transport.requests.size)
    }

    @Test
    fun retryRecoversAfterOneFailure() = runBlocking {
        val (_, rpc) = rpc(
            """{"jsonrpc":"2.0","id":1,"error":{"code":-32005,"message":"busy"}}""",
            """{"jsonrpc":"2.0","id":2,"result":{"context":{"slot":1},"value":7}}""",
        )
        assertEquals(7L, rpc.getBalance("Addr"))
    }
}
