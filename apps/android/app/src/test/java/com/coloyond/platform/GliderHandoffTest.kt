package com.coloyond.platform

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GliderHandoffTest {
    @Test
    fun handoffShowsFullMintsExactWeightsAndDisclosureWithoutPortfolioUrl() {
        val mintA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
        val mintB = "So11111111111111111111111111111111111111112"
        val text = GliderHandoff.reviewText(listOf(
            GliderHandoff.Allocation(mintA, "USDC", 6_750),
            GliderHandoff.Allocation(mintB, "SOL", 3_250),
        ))

        assertTrue(text.contains("$mintA — 67.50%"))
        assertTrue(text.contains("$mintB — 32.50%"))
        assertTrue(text.contains(GliderHandoff.DISCLOSURE))
        assertTrue(GliderHandoff.URL == "https://glider.fi")
        assertFalse(text.contains("API key", ignoreCase = true))
        assertFalse(text.contains("partner", ignoreCase = true))
        assertFalse(text.contains("completed", ignoreCase = true))
    }

    @Test
    fun handoffRejectsWeightsThatDoNotAddToOneHundredPercent() {
        assertTrue(runCatching {
            GliderHandoff.reviewText(listOf(GliderHandoff.Allocation("So11111111111111111111111111111111111111112", null, 9_999)))
        }.isFailure)
    }
}
