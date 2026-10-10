package com.coloyond.core.rpc

import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertArrayEquals
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
    fun getGenesisHashReadsExactEndpointIdentity() = runBlocking {
        val (transport, rpc) = rpc("""{"jsonrpc":"2.0","id":1,"result":"local-genesis"}""")
        assertEquals("local-genesis", rpc.getGenesisHash())
        assertEquals("https://rpc.test", rpc.endpoint)
        val request = transport.requests.single()
        assertEquals("getGenesisHash", request.getString("method"))
        assertEquals(0, request.getJSONArray("params").length())
    }

    @Test
    fun getMultipleAccountsPreservesContextAndDecodesBase64WithMissingAccounts() = runBlocking {
        val (transport, rpc) = rpc(
            """{"jsonrpc":"2.0","id":1,"result":{"context":{"slot":42},"value":[""" +
                """{"lamports":18446744073709551615,"owner":"TokenProgram","executable":false,"data":["AAEC/w==","base64"]},""" +
                """null]}}""",
        )

        val batch = rpc.getMultipleAccounts(listOf("AccountA", "AccountB"), minContextSlot = 7uL)

        assertEquals(42uL, batch.context.slot)
        assertEquals(2, batch.accounts.size)
        assertEquals("TokenProgram", batch.accounts[0]!!.owner)
        assertEquals(ULong.MAX_VALUE, batch.accounts[0]!!.lamports)
        assertEquals(false, batch.accounts[0]!!.executable)
        assertArrayEquals(byteArrayOf(0, 1, 2, 255.toByte()), batch.accounts[0]!!.data)
        assertNull(batch.accounts[1])

        val request = transport.requests.single()
        assertEquals("getMultipleAccounts", request.getString("method"))
        val params = request.getJSONArray("params")
        assertEquals(listOf("AccountA", "AccountB"), params.getJSONArray(0).let { values ->
            List(values.length()) { index -> values.getString(index) }
        })
        val config = params.getJSONObject(1)
        assertEquals("confirmed", config.getString("commitment"))
        assertEquals("base64", config.getString("encoding"))
        assertEquals("7", config.get("minContextSlot").toString())
    }

    @Test
    fun getMultipleAccountsRejectsMalformedCount() = runBlocking {
        val malformed = """{"jsonrpc":"2.0","id":1,"result":{"context":{"slot":1},"value":[]}}"""
        val (transport, rpc) = rpc(malformed, malformed)
        try {
            rpc.getMultipleAccounts(listOf("AccountA"))
            fail("expected RpcException")
        } catch (expected: RpcException) {
            assertTrue(expected.message!!.contains("getMultipleAccounts"))
        }
        assertEquals(2, transport.requests.size)
    }

    @Test
    fun getMultipleAccountsRejectsUnsupportedEncoding() = runBlocking {
        val malformed = """{"jsonrpc":"2.0","id":1,"result":{"context":{"slot":1},"value":[{"lamports":1,"owner":"TokenProgram","executable":false,"data":["AA==","base58"]}]}}"""
        val (_, rpc) = rpc(malformed, malformed)
        try {
            rpc.getMultipleAccounts(listOf("AccountA"))
            fail("expected RpcException")
        } catch (expected: RpcException) {
            assertTrue(expected.message!!.contains("getMultipleAccounts"))
        }
    }

    @Test
    fun getLatestBlockhashReadsBlockhash() = runBlocking {
        val (_, rpc) = rpc(
            """{"jsonrpc":"2.0","id":1,"result":{"context":{"slot":1},"value":{"blockhash":"EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N","lastValidBlockHeight":3090}}}""",
        )
        assertEquals("EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N", rpc.getLatestBlockhash())
    }

    @Test
    fun latestBlockhashSnapshotIncludesContextAndLastValidHeight() = runBlocking {
        val (_, rpc) = rpc(
            """{"jsonrpc":"2.0","id":1,"result":{"context":{"slot":81},"value":{"blockhash":"EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N","lastValidBlockHeight":3090}}}""",
        )
        assertEquals(
            RpcLatestBlockhash(
                context = RpcContext(81uL),
                blockhash = "EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N",
                lastValidBlockHeight = 3090uL,
            ),
            rpc.getLatestBlockhashWithContext(),
        )
    }

    @Test
    fun getBlockTimeMapsTimestampAndNullWithSlotParameter() = runBlocking {
        val (transport, rpc) = rpc(
            """{"jsonrpc":"2.0","id":1,"result":1791557161}""",
            """{"jsonrpc":"2.0","id":2,"result":null}""",
        )
        assertEquals(1_791_557_161L, rpc.getBlockTime(99uL))
        assertNull(rpc.getBlockTime(100uL))
        assertEquals("getBlockTime", transport.requests[0].getString("method"))
        assertEquals("99", transport.requests[0].getJSONArray("params").get(0).toString())
        assertEquals("100", transport.requests[1].getJSONArray("params").get(0).toString())
    }

    @Test
    fun getBlockTimeSurfacesRpcErrors() = runBlocking {
        val error = """{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"slot unavailable"}}"""
        val (_, rpc) = rpc(error, error)
        try {
            rpc.getBlockTime(99uL)
            fail("expected RpcException")
        } catch (expected: RpcException) {
            assertTrue(expected.message!!.contains("slot unavailable"))
        }
    }

    @Test
    fun signatureStatusesMapsSeenUnseenAndFailed() = runBlocking {
        val (transport, rpc) = rpc(
            """{"jsonrpc":"2.0","id":1,"result":{"context":{"slot":82},"value":[""" +
                """{"slot":72,"confirmations":10,"err":null,"confirmationStatus":"confirmed"},""" +
                """null,""" +
                """{"slot":73,"confirmations":null,"err":{"InstructionError":[0,"InvalidInstructionData"]},"confirmationStatus":"finalized"}""" +
                """]}}""",
        )
        val statuses = rpc.signatureStatusesWithContext(
            listOf("sigA", "sigB", "sigC"),
            searchTransactionHistory = true,
        )
        assertEquals(82uL, statuses.context.slot)
        assertEquals(SignatureStatus("confirmed", null, 72uL), statuses.statuses[0])
        assertNull(statuses.statuses[1])
        assertEquals("finalized", statuses.statuses[2]!!.confirmationStatus)
        assertEquals(73uL, statuses.statuses[2]!!.slot)
        assertTrue(statuses.statuses[2]!!.err!!.contains("InvalidInstructionData"))
        val config = transport.requests.single().getJSONArray("params").getJSONObject(1)
        assertEquals(true, config.getBoolean("searchTransactionHistory"))
    }

    @Test
    fun getTransactionReturnsConfirmedBase64BytesAndRawMeta() = runBlocking {
        val (transport, rpc) = rpc(
            """{"jsonrpc":"2.0","id":1,"result":{"slot":73,"transaction":["AAECAw==","base64"],"meta":{"err":{"InstructionError":[0,"InvalidInstructionData"]},"preTokenBalances":[],"postTokenBalances":[]}}}""",
        )
        val transaction = rpc.getTransaction("signature")!!
        assertEquals(73uL, transaction.slot)
        assertEquals("signature", transaction.requestedSignature)
        assertArrayEquals(byteArrayOf(0, 1, 2, 3), transaction.wireTransaction)
        assertTrue(transaction.error!!.contains("InvalidInstructionData"))
        assertTrue(transaction.rawMetaJson!!.contains("preTokenBalances"))
        val request = transport.requests.single()
        assertEquals("getTransaction", request.getString("method"))
        val config = request.getJSONArray("params").getJSONObject(1)
        assertEquals("confirmed", config.getString("commitment"))
        assertEquals("base64", config.getString("encoding"))
        assertEquals(0, config.getInt("maxSupportedTransactionVersion"))
    }

    @Test
    fun getTransactionReturnsNullWhenSignatureIsUnseen() = runBlocking {
        val (_, rpc) = rpc("""{"jsonrpc":"2.0","id":1,"result":null}""")
        assertNull(rpc.getTransaction("not-yet-seen"))
    }

    @Test
    fun getTransactionRejectsMalformedWireResponse() = runBlocking {
        val malformed = """{"jsonrpc":"2.0","id":1,"result":{"slot":1,"transaction":["AA==","base58"],"meta":null}}"""
        val (_, rpc) = rpc(malformed, malformed)
        try {
            rpc.getTransaction("signature")
            fail("expected RpcException")
        } catch (expected: RpcException) {
            assertTrue(expected.message!!.contains("getTransaction"))
        }
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

    @Test
    fun malformedGenesisResponseBecomesRpcException() = runBlocking {
        val malformed = """{"jsonrpc":"2.0","id":1,"result":123}"""
        val (_, rpc) = rpc(malformed, malformed)
        try {
            rpc.getGenesisHash()
            fail("expected RpcException")
        } catch (expected: RpcException) {
            assertTrue(expected.message!!.contains("getGenesisHash"))
        }
    }
}
