package com.coloyond.ui.screens

import com.coloyond.platform.GliderHandoff
import com.coloyond.strategy.StrategyRecords
import com.coloyond.strategy.ValidatedRecord
import com.coloyond.ui.cards.create.CardCreationRecords

data class GliderReviewAllocation(
    val mint: String,
    val percent: String,
) {
    val displayMint: String = mint.chunked(8).joinToString("\u200B")
    val clipboardLine: String = "$mint — $percent"
}

/** Review data only; the UI must explicitly acknowledge the disclosure before opening Glider. */
data class GliderHandoffReview(
    val allocations: List<GliderReviewAllocation>,
    val disclosure: String = GliderHandoff.DISCLOSURE,
    val url: String = GliderHandoff.URL,
    val disclosureReviewed: Boolean = false,
    val allocationCopied: Boolean = false,
) {
    val allocationText: String get() = allocations.joinToString("\n") { it.clipboardLine }
    val canOpen: Boolean
        get() = disclosureReviewed && disclosure == GliderHandoff.DISCLOSURE &&
            url == GliderHandoff.URL && allocations.isNotEmpty()
}

fun makeGliderHandoffReview(strategy: ValidatedRecord): GliderHandoffReview {
    val checked = StrategyRecords.validateStrategy(strategy.value)
    require(checked.id == strategy.id) { "Strategy identity changed" }
    val targetWeights = CardCreationRecords.targetWeights(checked)
    val allocations = targetWeights.map { weight ->
        GliderHandoff.Allocation(weight.mint, null, weight.weightBps)
    }
    // Keep the old handoff's strict supported-asset-count and exact-100% validation.
    GliderHandoff.reviewText(allocations)
    return GliderHandoffReview(
        allocations = targetWeights.map { weight ->
            GliderReviewAllocation(weight.mint, CardCreationRecords.formatPercent(weight.weightBps))
        },
    )
}

/** Starts weight exploration in a separate, inspect-only draft domain. */
fun makeWeightExplorationDraft(strategy: ValidatedRecord): ValidatedRecord {
    val checked = StrategyRecords.validateStrategy(strategy.value)
    require(checked.id == strategy.id) { "Strategy identity changed" }
    return CardCreationRecords.allocationDraft(CardCreationRecords.targetWeights(checked))
}
