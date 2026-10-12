package com.coloyond.platform

import com.coloyond.strategy.StrategyRecords
import java.math.BigDecimal
import java.math.RoundingMode

/** Copy/review text for a user-operated handoff. It never creates an API request or encodes a portfolio URL. */
object GliderHandoff {
    data class Allocation(val mint: String, val symbol: String?, val weightBps: Int)

    const val URL = "https://glider.fi"
    /**
     * Symbols for mints with a Glider Verified Solana asset page (checked 12 October 2026).
     * Glider labels the wrapped-SOL mint as SOL. A label helps the user find the asset; it is not a support claim.
     */
    private val verifiedSymbols = mapOf(
        "So11111111111111111111111111111111111111112" to "SOL",
        "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN" to "JUP",
    )

    fun knownSymbol(mint: String): String? = verifiedSymbols[mint]

    const val DISCLOSURE = "Glider is a separate service. coloyond is not affiliated with it. You set up, fund, and approve the portfolio in Glider. Glider may not support every asset."

    fun reviewText(allocations: List<Allocation>): String {
        require(allocations.isNotEmpty() && allocations.size <= 2) { "Expected one or two assets" }
        require(allocations.all { it.weightBps in 1..10_000 } && allocations.sumOf { it.weightBps } == 10_000) {
            "Allocation weights must total 100.00%"
        }
        require(allocations.map { it.mint }.distinct().size == allocations.size) { "Asset mints must be distinct" }
        allocations.forEach { StrategyRecords.decodeCanonicalPubkey(it.mint) }
        val rows = allocations.joinToString("\n") { allocation ->
            val percent = BigDecimal.valueOf(allocation.weightBps.toLong(), 2)
                .setScale(2, RoundingMode.UNNECESSARY)
                .toPlainString()
            "${allocation.symbol?.takeIf { it.isNotBlank() }?.let { "$it · " } ?: ""}${allocation.mint} — $percent%"
        }
        return "Review these target weights and enter them yourself in Glider:\n$rows\n\n$DISCLOSURE"
    }
}
