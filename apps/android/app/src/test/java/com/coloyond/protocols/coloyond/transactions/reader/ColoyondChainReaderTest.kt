package com.coloyond.protocols.coloyond.transactions.reader

import com.coloyond.core.rpc.RetryPolicy
import com.coloyond.core.rpc.RpcTransport
import com.coloyond.core.rpc.SolanaRpc
import com.coloyond.protocols.coloyond.transactions.ColoyondAddresses
import com.coloyond.protocols.coloyond.transactions.SolanaCluster
import com.coloyond.protocols.coloyond.transactions.SolanaNetwork
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Base64
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class ColoyondChainReaderTest {
    private val idlJson = repositoryFile("idl/coloyond_vault.json").readText()
    private val decoder = AnchorIdlAccountDecoder(idlJson)
    private val localnet = SolanaNetwork(SolanaCluster.LOCALNET, "local-genesis", "http://127.0.0.1:8899")
    private val noWait = RetryPolicy(maxAttempts = 1, initialDelayMs = 0, maxDelayMs = 0)

    @Test
    fun readerRejectsAnRpcDifferentFromTheSelectedImmutableEndpoint() {
        val rpc = rpc("https://other.example")
        val error = assertThrows(ChainReadException::class.java) {
            ColoyondChainReader(rpc, localnet, decoder)
        }
        assertEquals("RPC_ENDPOINT_MISMATCH", error.code)
    }

    @Test
    fun readerRejectsGenesisMismatchBeforeReadingAccounts() = runBlocking {
        val transport = FakeTransport(listOf(response(1, "other-genesis")))
        val reader = ColoyondChainReader(SolanaRpc(transport, localnet.rpcUrl, noWait), localnet, decoder)
        val error = assertThrows(ChainReadException::class.java) { runBlocking { reader.read() } }
        assertEquals("RPC_GENESIS_MISMATCH", error.code)
        assertEquals(1, transport.requests.size)
    }

    @Test
    fun readerDiscardsVaultThatChangesAcrossItsTwoPhaseAccountRead() = runBlocking {
        val initial = vaultData(status = 1)
        val changed = vaultData(status = 2)
        val transport = FakeTransport(
            listOf(
                response(1, "local-genesis"),
                response(2, accountBatch(10, listOf(account(ColoyondAddresses.PROGRAM_ID, initial)))),
            ),
            secondBatchVaultAccount = account(ColoyondAddresses.PROGRAM_ID, changed),
        )
        val reader = ColoyondChainReader(SolanaRpc(transport, localnet.rpcUrl, noWait), localnet, decoder)

        val error = assertThrows(ChainReadException::class.java) { runBlocking { reader.read() } }

        assertEquals("VAULT_CHANGED_DURING_READ", error.code)
        val secondBatch = transport.requests.last()
        assertEquals("getMultipleAccounts", secondBatch.getString("method"))
        assertEquals("10", secondBatch.getJSONArray("params").getJSONObject(1).get("minContextSlot").toString())
    }

    @Test
    fun readerDecodesOneCoherentLinkedSnapshotIncludingOracleAndSplAccounts() = runBlocking {
        val vault = ColoyondAddresses.vault()
        val shareMint = ColoyondAddresses.pda(
            listOf("fixture_share_mint".encodeToByteArray()),
            ColoyondAddresses.key(ColoyondAddresses.PROGRAM_ID),
        )
        val wallet = ColoyondAddresses.SYSTEM_PROGRAM_ID
        val assets = listOf(
            Triple(ColoyondAddresses.WSOL_MINT, 9, 5_000),
            Triple(ColoyondAddresses.DEVNET_USDC_MINT, 6, 5_000),
        )
        val accountedAmounts = listOf(2_000L, 100_000_000L)
        val bootstrapReserve = listOf(1_000L, 1_000L)
        val totalShares = 1_000_001L
        val accounts = mutableMapOf<String, JSONObject>()
        accounts[vault] = account(
            ColoyondAddresses.PROGRAM_ID,
            vaultData(
                status = 1,
                shareMint = shareMint,
                accountedAmounts = accountedAmounts,
                bootstrapReserve = bootstrapReserve,
                totalShares = totalShares,
            ),
        )
        accounts[ColoyondAddresses.PROGRAM_ID] = account(
            ColoyondAddresses.UPGRADEABLE_LOADER_ID,
            programDataAccountData(),
            executable = true,
        )
        accounts[ColoyondAddresses.programData()] = account(
            ColoyondAddresses.UPGRADEABLE_LOADER_ID,
            programDataState(),
        )
        accounts[ColoyondAddresses.governance(vault)] = account(
            ColoyondAddresses.PROGRAM_ID,
            governanceData(vault, shareMint, assets.map { it.first }),
        )
        accounts[ColoyondAddresses.auctionPolicy(vault)] = account(
            ColoyondAddresses.PROGRAM_ID,
            auctionPolicyData(vault),
        )
        assets.forEachIndexed { index, (mint, decimals, _) ->
            val custody = ColoyondAddresses.associatedToken(vault, mint)
            accounts[mint] = account(
                ColoyondAddresses.TOKEN_PROGRAM_ID,
                classicMintData(decimals),
            )
            accounts[custody] = account(
                ColoyondAddresses.TOKEN_PROGRAM_ID,
                classicTokenData(mint, vault, accountedAmounts[index]),
            )
            val walletAta = ColoyondAddresses.associatedToken(wallet, mint)
            accounts[walletAta] = account(
                ColoyondAddresses.TOKEN_PROGRAM_ID,
                classicTokenData(mint, wallet, 25L + index),
            )
        }
        accounts[shareMint] = account(
            ColoyondAddresses.TOKEN_PROGRAM_ID,
            classicMintData(decimals = 6, supply = totalShares, mintAuthority = vault),
        )
        val walletShareAta = ColoyondAddresses.associatedToken(wallet, shareMint)
        accounts[walletShareAta] = account(
            ColoyondAddresses.TOKEN_PROGRAM_ID,
            classicTokenData(shareMint, wallet, 4_200L),
        )
        accounts[ColoyondAddresses.SOL_USD_FEED] = account(
            ColoyondAddresses.PYTH_RECEIVER_PROGRAM_ID,
            pythPriceData(SOL_FEED_ID, price = 15_000_000_000L, confidence = 1_000_000L),
        )
        accounts[ColoyondAddresses.USDC_USD_FEED] = account(
            ColoyondAddresses.PYTH_RECEIVER_PROGRAM_ID,
            pythPriceData(USDC_FEED_ID, price = 100_000_000L, confidence = 1_000L),
        )
        val transport = SnapshotTransport(accounts)
        val reader = ColoyondChainReader(SolanaRpc(transport, localnet.rpcUrl, noWait), localnet, decoder)

        val snapshot = reader.read(wallet)

        assertEquals(105uL, snapshot.contextSlot)
        assertEquals("local-genesis", snapshot.genesisHash)
        assertEquals(1_800_000_100L, snapshot.blockTime)
        assertEquals(2, snapshot.assets.size)
        assertEquals(ColoyondAddresses.WSOL_MINT, snapshot.assets[0].mint)
        assertEquals(9, snapshot.assets[0].mintState.decimals)
        assertEquals("2000", snapshot.assets[0].custodyState.amount)
        assertEquals("1000", snapshot.assets[0].custodyReconciliation.bootstrapReserve)
        assertEquals(CustodyReconciliation.Status.MATCH, snapshot.assets[0].custodyReconciliation.status)
        assertEquals(ColoyondAddresses.DEVNET_USDC_MINT, snapshot.assets[1].mint)
        assertEquals(6, snapshot.assets[1].mintState.decimals)
        assertEquals("100000000", snapshot.assets[1].custodyState.amount)
        assertEquals("1000", snapshot.assets[1].custodyReconciliation.bootstrapReserve)
        assertEquals(CustodyReconciliation.Status.MATCH, snapshot.assets[1].custodyReconciliation.status)
        assertEquals(totalShares.toString(), snapshot.shareMint.supply)
        assertEquals(vault, snapshot.shareMint.mintAuthority)
        assertEquals(2, snapshot.oracles.size)
        assertEquals("15000000000", snapshot.oracles[0].price)
        assertEquals(PythPriceUpdateV2Decoder.VerificationLevel.Full, snapshot.oracles[0].verificationLevel)
        assertEquals(10L, snapshot.oracles[0].ageSeconds)
        assertEquals("100000000", snapshot.oracles[1].price)
        assertEquals("0", snapshot.oracles[1].usdDeviationBps)
        assertTrue(snapshot.walletTokenAccounts.values.all { it is AccountPresence.Present })
        assertEquals(3, snapshot.walletTokenAccounts.size)
        val walletWsol = snapshot.walletTokenAccounts.getValue(ColoyondAddresses.associatedToken(wallet, ColoyondAddresses.WSOL_MINT))
        assertEquals("25", (walletWsol as AccountPresence.Present).value.amount)
        val walletShares = snapshot.walletTokenAccounts.getValue(walletShareAta)
        assertEquals("4200", (walletShares as AccountPresence.Present).value.amount)
        assertEquals("99", snapshot.programDeployment.lastUpgradeSlot)
        assertNull(snapshot.programDeployment.upgradeAuthority)
        assertTrue("Expected the valid pinned fixture to have no risk blockers: ${snapshot.riskBlockers}", snapshot.riskBlockers.isEmpty())

        val multipleAccountRequests = transport.requests.filter { it.getString("method") == "getMultipleAccounts" }
        assertEquals(2, multipleAccountRequests.size)
        val discoveryRequest = multipleAccountRequests[0].getJSONArray("params").getJSONArray(0)
        assertEquals(1, discoveryRequest.length())
        assertEquals(vault, discoveryRequest.getString(0))
        val linkedRequest = multipleAccountRequests[1]
        assertEquals("100", linkedRequest.getJSONArray("params").getJSONObject(1).get("minContextSlot").toString())
        val linkedAddresses = (0 until linkedRequest.getJSONArray("params").getJSONArray(0).length())
            .map { linkedRequest.getJSONArray("params").getJSONArray(0).getString(it) }
            .toSet()
        val expectedLinkedAddresses = buildSet {
            add(vault)
            add(ColoyondAddresses.PROGRAM_ID)
            add(ColoyondAddresses.governance(vault))
            add(ColoyondAddresses.auctionPolicy(vault))
            add(ColoyondAddresses.pendingPolicy(vault))
            add(ColoyondAddresses.conditionState(vault))
            add(ColoyondAddresses.rebalanceIntent(vault))
            add(ColoyondAddresses.programData())
            add(ColoyondAddresses.SOL_USD_FEED)
            add(ColoyondAddresses.USDC_USD_FEED)
            add(shareMint)
            assets.forEach { (mint, _, _) ->
                add(mint)
                add(ColoyondAddresses.associatedToken(vault, mint))
                add(ColoyondAddresses.associatedToken(wallet, mint))
            }
            add(walletShareAta)
        }
        assertEquals(expectedLinkedAddresses, linkedAddresses)
        assertEquals(linkedAddresses.size, linkedRequest.getJSONArray("params").getJSONArray(0).length())
        assertEquals("confirmed", linkedRequest.getJSONArray("params").getJSONObject(1).getString("commitment"))
    }

    private fun rpc(endpoint: String) = SolanaRpc(FakeTransport(emptyList()), endpoint, noWait)

    private fun vaultData(
        status: Int,
        shareMint: String = ColoyondAddresses.ASSOCIATED_TOKEN_PROGRAM_ID,
        accountedAmounts: List<Long> = listOf(0L, 0L),
        bootstrapReserve: List<Long> = listOf(0L, 0L),
        totalShares: Long = 1_000_001L,
    ): ByteArray = ByteArrayOutputStream().apply {
        write(discriminator("Vault"))
        write(byteArrayOf(1, 254.toByte(), status.toByte()))
        write(pubkey(ColoyondAddresses.vault()))
        write(u64(1))
        val assets = listOf(
            Triple(ColoyondAddresses.WSOL_MINT, 9, 5_000),
            Triple(ColoyondAddresses.DEVNET_USDC_MINT, 6, 5_000),
        )
        assets.forEach { (mint, decimals, targetBps) ->
            write(pubkey(mint))
            write(pubkey(ColoyondAddresses.TOKEN_PROGRAM_ID))
            write(pubkey(ColoyondAddresses.associatedToken(ColoyondAddresses.vault(), mint)))
            write(decimals)
            write(u16(targetBps))
        }
        write(pubkey(shareMint))
        write(u64(totalShares))
        write(u64(1)) // minimum locked shares
        accountedAmounts.forEach { write(u64(it)) }
        bootstrapReserve.forEach { write(u64(it)) }
        repeat(2) { write(u64(0)) } // bounty liabilities
        write(u64(0)) // sequence
    }.toByteArray()

    private fun account(owner: String, data: ByteArray, executable: Boolean = false): JSONObject = JSONObject()
        .put("lamports", 1)
        .put("owner", owner)
        .put("executable", executable)
        .put("data", JSONArray().put(Base64.getEncoder().encodeToString(data)).put("base64"))

    private fun governanceData(vault: String, shareMint: String, mints: List<String>): ByteArray = idlAccountData(
        "GovernanceAccount",
        ByteArrayOutputStream().apply {
            write(1)
            write(pubkey(vault))
            write(pubkey(shareMint))
            mints.forEach { write(pubkey(it)) }
            write(pubkey(ColoyondAddresses.PROGRAM_ID)) // governance authority
            write(pubkey(ColoyondAddresses.ASSOCIATED_TOKEN_PROGRAM_ID)) // emergency authority
            write(u64(32))
            write(u64(1)) // configuration revision
            write(u16(5_000))
            write(u16(5_000))
            write(u64(0)) // proposal nonce
            write(0) // no pending proposal
            write(0) // risk_paused
        }.toByteArray(),
    )

    private fun auctionPolicyData(vault: String): ByteArray = idlAccountData(
        "AuctionPolicy",
        ByteArrayOutputStream().apply {
            write(2) // version
            write(pubkey(vault))
            write(u64(1)) // configuration revision
            write(u64(120)) // maximum age seconds
            write(u16(100)) // maximum confidence bps
            write(u16(100)) // maximum USDC deviation bps
            write(u16(50)) // minimum drift bps
            write(u64(1_000_000_000)) // maximum trade value q9
            write(u64(10)) // cooldown slots
            write(0) // no last completed slot
            write(u16(500)) // curve start rate bps
            write(u16(10)) // curve end rate bps
            write(u64(100)) // duration slots
            write(u16(10)) // fee bps
            write(u16(100)) // maximum fee bps
            write(u16(5_000)) // fee reserve share bps
            repeat(2) { write(u64(0)) } // reserve floor
            repeat(2) { write(u64(1_000)) } // epoch bounty budget
            write(u64(1)) // bounty epoch
            repeat(2) { write(u64(0)) } // bounty epoch spent
            write(u64(100)) // maximum bounty per fill
            write(u16(1_000)) // maximum cumulative NAV loss bps
            write(u16(500)) // maximum NAV loss bps
            write(byteArrayOf(0, 1)) // asset feed indices
        }.toByteArray(),
    )

    private fun classicMintData(
        decimals: Int,
        supply: Long = 0,
        mintAuthority: String? = null,
    ): ByteArray = ByteArray(ClassicSplDecoder.MINT_SIZE).also { data ->
        putCOptionPubkey(data, 0, mintAuthority)
        putU64(data, 36, supply)
        data[44] = decimals.toByte()
        data[45] = 1
        putCOptionPubkey(data, 46, null)
    }

    private fun classicTokenData(mint: String, authority: String, amount: Long): ByteArray =
        ByteArray(ClassicSplDecoder.TOKEN_ACCOUNT_SIZE).also { data ->
            pubkey(mint).copyInto(data, 0)
            pubkey(authority).copyInto(data, 32)
            putU64(data, 64, amount)
            putCOptionPubkey(data, 72, null)
            data[108] = 1 // initialized
            putCOptionU64(data, 109, null)
            putU64(data, 121, 0)
            putCOptionPubkey(data, 129, null)
        }

    private fun putCOptionPubkey(data: ByteArray, offset: Int, address: String?) {
        if (address != null) {
            data[offset] = 1
            pubkey(address).copyInto(data, offset + 4)
        }
    }

    private fun putCOptionU64(data: ByteArray, offset: Int, value: Long?) {
        if (value != null) {
            data[offset] = 1
            putU64(data, offset + 4, value)
        }
    }

    private fun putU64(data: ByteArray, offset: Int, value: Long) {
        u64(value).copyInto(data, offset)
    }

    private fun idlAccountData(name: String, body: ByteArray): ByteArray = ByteArray(decoder.expectedAllocationSize(name)).also { data ->
        val discriminator = discriminator(name)
        require(discriminator.size + body.size <= data.size) { "$name fixture exceeds its pinned IDL allocation" }
        discriminator.copyInto(data)
        body.copyInto(data, discriminator.size)
    }

    private fun programDataAccountData(): ByteArray = ByteArrayOutputStream().apply {
        write(u32(2)) // upgradeable-loader Program state
        write(pubkey(ColoyondAddresses.programData()))
    }.toByteArray()

    private fun programDataState(): ByteArray = ByteArrayOutputStream().apply {
        write(u32(3)) // upgradeable-loader ProgramData state
        write(u64(99)) // last upgrade slot
        write(0) // immutable: no upgrade authority
        write(0x42)
    }.toByteArray()

    private fun pythPriceData(feedIdHex: String, price: Long, confidence: Long): ByteArray =
        ByteBuffer.allocate(PythPriceUpdateV2Decoder.ACCOUNT_ALLOCATION_SIZE).order(ByteOrder.LITTLE_ENDIAN).apply {
            put(byteArrayOf(0x22, 0xf1.toByte(), 0x23, 0x63, 0x9d.toByte(), 0x7e, 0xf4.toByte(), 0xcd.toByte()))
            put(ByteArray(32) { 0x11 }) // write authority
            put(1.toByte()) // Full verification
            put(feedIdHex.removePrefix("0x").chunked(2).map { it.toInt(16).toByte() }.toByteArray())
            putLong(price)
            putLong(confidence)
            putInt(-8)
            putLong(1_800_000_090L) // publish time, ten seconds before the fake block time
            putLong(1_800_000_089L) // previous publish time
            putLong(price) // EMA price
            putLong(confidence) // EMA confidence
            putLong(104) // posted slot
        }.array()

    private fun u32(value: Int): ByteArray = byteArrayOf(
        value.toByte(), (value ushr 8).toByte(), (value ushr 16).toByte(), (value ushr 24).toByte(),
    )

    private fun accountBatch(slot: Long, values: List<JSONObject?>): JSONObject = JSONObject()
        .put("context", JSONObject().put("slot", slot))
        .put("value", JSONArray().also { output -> values.forEach { output.put(it ?: JSONObject.NULL) } })

    private fun response(id: Int, result: Any): String = JSONObject()
        .put("jsonrpc", "2.0")
        .put("id", id)
        .put("result", result)
        .toString()

    private inner class SnapshotTransport(private val accounts: Map<String, JSONObject>) : RpcTransport {
        val requests = mutableListOf<JSONObject>()
        private var accountReadCount = 0

        override suspend fun postJson(url: String, body: String): String {
            val request = JSONObject(body)
            requests += request
            val id = request.getInt("id")
            return when (request.getString("method")) {
                "getGenesisHash" -> response(id, "local-genesis")
                "getMultipleAccounts" -> {
                    val addresses = request.getJSONArray("params").getJSONArray(0)
                    accountReadCount += 1
                    val slot = if (accountReadCount == 1) 100L else 105L
                    val values = if (accountReadCount == 1) {
                        listOf(accounts[ColoyondAddresses.vault()])
                    } else {
                        List(addresses.length()) { accounts[addresses.getString(it)] }
                    }
                    response(id, accountBatch(slot, values))
                }
                "getBlockTime" -> response(id, 1_800_000_100L)
                else -> error("Unexpected RPC method ${request.getString("method")}")
            }
        }
    }

    private fun discriminator(name: String): ByteArray {
        val accounts = JSONObject(idlJson).getJSONArray("accounts")
        val spec = (0 until accounts.length()).map(accounts::getJSONObject).first { it.getString("name") == name }
        val bytes = spec.getJSONArray("discriminator")
        return ByteArray(bytes.length()) { bytes.getInt(it).toByte() }
    }

    private fun pubkey(value: String): ByteArray = ColoyondAddresses.key(value).bytes
    private fun u64(value: Long): ByteArray = ByteArrayOutputStream().apply {
        repeat(8) { index -> write((value ushr (index * 8)).toInt()) }
    }.toByteArray()
    private fun u16(value: Int): ByteArray = byteArrayOf(value.toByte(), (value shr 8).toByte())

    private fun repositoryFile(path: String): File {
        var directory: File? = File(requireNotNull(System.getProperty("user.dir"))).canonicalFile
        while (directory != null) {
            File(directory, path).takeIf(File::isFile)?.let { return it }
            directory = directory.parentFile
        }
        error("Cannot find $path from ${System.getProperty("user.dir")}")
    }

    private inner class FakeTransport(
        private val responses: List<String>,
        private val secondBatchVaultAccount: JSONObject? = null,
    ) : RpcTransport {
        private val pending = responses.toMutableList()
        val requests = mutableListOf<JSONObject>()

        override suspend fun postJson(url: String, body: String): String {
            requests += JSONObject(body)
            val request = requests.last()
            val method = request.getString("method")
            if (method == "getMultipleAccounts" && requests.count { it.getString("method") == method } == 2) {
                val raw = request.getJSONArray("params").getJSONArray(0)
                val values = List(raw.length()) { index ->
                    if (raw.getString(index) == ColoyondAddresses.vault()) secondBatchVaultAccount else null
                }
                val result = accountBatch(11, values)
                return response(request.getInt("id"), result)
            }
            return pending.removeAt(0)
        }
    }

    private companion object {
        const val SOL_FEED_ID = "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d"
        const val USDC_FEED_ID = "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a"
    }
}
