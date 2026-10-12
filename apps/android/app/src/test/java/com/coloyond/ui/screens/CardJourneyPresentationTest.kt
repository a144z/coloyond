package com.coloyond.ui.screens

import com.coloyond.platform.GliderHandoff
import com.coloyond.strategy.StrategyRecords
import com.coloyond.strategy.asArray
import com.coloyond.strategy.asObject
import com.coloyond.strategy.asString
import com.coloyond.ui.cards.create.CardCreationRecords
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CardJourneyPresentationTest {
    @Test
    fun gliderReviewShowsFullMintsAndWeightsAndRequiresDisclosureAcknowledgement() {
        val mintA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
        val mintB = "So11111111111111111111111111111111111111112"
        val strategy = StrategyRecords.validateStrategy(
            StrategyRecords.parse(draft(mintA, mintB, "6750", "3250")),
        )
        val strategyId = strategy.id

        val review = makeGliderHandoffReview(strategy)

        assertEquals(listOf(mintA, mintB), review.allocations.map { it.mint })
        assertEquals(listOf("67.50%", "32.50%"), review.allocations.map { it.percent })
        assertEquals(listOf(null, "SOL"), review.allocations.map { it.symbol })
        assertEquals(listOf("67.50%", "SOL · 32.50%"), review.allocations.map { it.heading })
        assertEquals("$mintA — 67.50%\nSOL · $mintB — 32.50%", review.allocationText)
        assertEquals(GliderHandoff.DISCLOSURE, review.disclosure)
        assertEquals("https://glider.fi", review.url)
        assertFalse(review.canOpen)
        assertFalse(review.allocationText.contains(review.disclosure))
        assertTrue(review.copy(disclosureReviewed = true).canOpen)
        assertFalse(review.copy(disclosureReviewed = true, disclosure = "").canOpen)
        assertFalse(review.copy(disclosureReviewed = true, url = "https://glider.fi?allocation=$mintA").canOpen)
        assertEquals(strategyId, StrategyRecords.validateStrategy(strategy.value).id)
    }

    @Test
    fun oneAssetDraftProducesACompleteHundredPercentHandoff() {
        val mint = "So11111111111111111111111111111111111111112"
        val strategy = StrategyRecords.validateStrategy(
            StrategyRecords.parse(
                """{"schemaVersion":1,"kind":"allocation-draft","network":"solana:mainnet-beta","targetWeights":[{"mint":"$mint","weightBps":10000}]}""",
            ),
        )

        val review = makeGliderHandoffReview(strategy)

        assertEquals(listOf(mint), review.allocations.map { it.mint })
        assertEquals("100.00%", review.allocations.single().percent)
        assertTrue(review.allocationText.contains(mint))
        assertTrue(review.disclosure.contains(GliderHandoff.DISCLOSURE))
        assertTrue(strategy.id.startsWith("cbd1:"))
    }

    @Test
    fun weightExplorationConvertsManagedTargetsToSeparateNonExecutableDraft() {
        val stream = requireNotNull(javaClass.classLoader?.getResourceAsStream("strategy-identity-vectors.json"))
        val root = StrategyRecords.parse(stream.bufferedReader(Charsets.UTF_8).use { it.readText() }).asObject("vectors")
        val input = root.getValue("vectors").asArray("strategy vectors")
            .map { it.asObject("strategy vector") }
            .single { it.getValue("name").asString("name") == "managed-60-40" }
            .getValue("input")
        val managed = StrategyRecords.validateStrategy(input)
        val original = managed.canonicalJson

        val draft = makeWeightExplorationDraft(managed)

        assertTrue(managed.id.startsWith("cb2:"))
        assertTrue(draft.id.startsWith("cbd1:"))
        assertNotEquals(managed.id, draft.id)
        assertTrue(draft.viewOnly)
        assertEquals(CardCreationRecords.targetWeights(managed), CardCreationRecords.targetWeights(draft))
        assertTrue(draft.value.asObject("draft").keys.none { it in setOf("protocol", "vaultAddress", "shareMint") })
        assertEquals(original, managed.canonicalJson)
    }

    private fun draft(mintA: String, mintB: String, weightA: String, weightB: String) =
        """{"schemaVersion":1,"kind":"allocation-draft","network":"solana:mainnet-beta","targetWeights":[{"mint":"$mintA","weightBps":$weightA},{"mint":"$mintB","weightBps":$weightB}]}"""
}
