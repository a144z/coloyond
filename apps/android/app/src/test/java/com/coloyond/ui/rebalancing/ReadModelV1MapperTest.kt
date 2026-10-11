package com.coloyond.ui.rebalancing

import com.coloyond.protocols.coloyond.transactions.ColoyondAddresses
import com.coloyond.protocols.coloyond.transactions.SolanaCluster
import com.coloyond.protocols.coloyond.transactions.SolanaNetwork
import com.coloyond.protocols.coloyond.transactions.reader.AccountPresence
import com.coloyond.protocols.coloyond.transactions.reader.ClassicMintAccount
import com.coloyond.protocols.coloyond.transactions.reader.ClassicTokenAccount
import com.coloyond.protocols.coloyond.transactions.reader.ColoyondChainSnapshot
import com.coloyond.protocols.coloyond.transactions.reader.CustodyReconciliation
import com.coloyond.protocols.coloyond.transactions.reader.OracleRead
import com.coloyond.protocols.coloyond.transactions.reader.PythPriceUpdateV2Decoder
import com.coloyond.protocols.coloyond.transactions.reader.ProgramDeploymentRead
import com.coloyond.protocols.coloyond.transactions.reader.VaultAssetRead
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ReadModelV1MapperTest {
    @Test
    fun freshVerifiedPricesProduceNavAndActualWeights() {
        val model = mapSnapshot()

        assertEquals("700.00", model.vault.estimatedNavUsd)
        assertEquals(listOf(2_857, 7_143), model.vault.actual?.map { it.weightBps })
    }

    @Test
    fun blockedOraclePricesCannotProduceNavOrActualWeights() {
        for (blocker in listOf("ORACLE_STALE", "USDC_DEPEG_OUTSIDE_POLICY", "ORACLE_NOT_FULLY_VERIFIED")) {
            val model = mapSnapshot(blocker)

            assertNull("NAV must be unavailable for $blocker", model.vault.estimatedNavUsd)
            assertNull("actual weights must be unavailable for $blocker", model.vault.actual)
        }
    }

    private fun mapSnapshot(blocker: String? = null): ReadModelV1 {
        val vault = ColoyondAddresses.vault()
        val assets = listOf(
            asset(ColoyondAddresses.WSOL_MINT, 9, "2000000000", "custody-sol"),
            asset(ColoyondAddresses.DEVNET_USDC_MINT, 6, "500000000", "custody-usdc"),
        )
        val oracles = listOf(
            oracle(ColoyondAddresses.SOL_USD_FEED, "100000000000000000000", blocker.takeIf { it != "USDC_DEPEG_OUTSIDE_POLICY" }),
            oracle(ColoyondAddresses.USDC_USD_FEED, "1000000000000000000", blocker.takeIf { it == "USDC_DEPEG_OUTSIDE_POLICY" }),
        )
        val snapshot = ColoyondChainSnapshot(
            endpoint = "https://api.devnet.solana.com",
            genesisHash = ColoyondAddresses.DEVNET_GENESIS_HASH,
            contextSlot = 42uL,
            blockTime = null,
            vault = mapOf("status" to 1, "share_mint" to "share-mint", "configuration_revision" to "4"),
            assets = assets,
            shareMint = ClassicMintAccount(null, "1000000", 6, null, true),
            governance = AccountPresence.Present(mapOf("risk_paused" to false)),
            auctionPolicy = AccountPresence.Absent,
            pendingPolicy = AccountPresence.Absent,
            conditionState = AccountPresence.Absent,
            rebalanceIntent = AccountPresence.Absent,
            programDeployment = ProgramDeploymentRead("1", null),
            oracles = oracles,
            walletTokenAccounts = emptyMap(),
            riskBlockers = emptyList(),
        )
        return ReadModelV1Mapper.from(
            snapshot,
            SolanaNetwork(SolanaCluster.DEVNET, ColoyondAddresses.DEVNET_GENESIS_HASH, "https://api.devnet.solana.com"),
        )
    }

    private fun asset(mint: String, decimals: Int, amount: String, custody: String) = VaultAssetRead(
        mint = mint,
        tokenProgram = ColoyondAddresses.TOKEN_PROGRAM_ID,
        custody = custody,
        decimals = decimals,
        targetBps = 5_000,
        mintState = ClassicMintAccount(null, "0", decimals, null, true),
        custodyState = ClassicTokenAccount(mint, ColoyondAddresses.vault(), amount, null, ClassicTokenAccount.State.INITIALIZED, null, "0", null),
        custodyReconciliation = CustodyReconciliation(amount, amount, "0", "0", "0", CustodyReconciliation.Status.MATCH),
    )

    private fun oracle(address: String, priceQ18: String, blocker: String?) = OracleRead(
        address = address,
        feedIdHex = "feed",
        verificationLevel = if (blocker == "ORACLE_NOT_FULLY_VERIFIED") PythPriceUpdateV2Decoder.VerificationLevel.Partial(1)
            else PythPriceUpdateV2Decoder.VerificationLevel.Full,
        price = "100000000",
        confidence = "1",
        exponent = -8,
        priceQ18 = priceQ18,
        confidenceQ18 = "1",
        publishTime = "100",
        postedSlot = "42",
        ageSeconds = 1,
        confidenceBps = "1",
        usdDeviationBps = null,
        blockers = listOfNotNull(blocker),
    )
}
