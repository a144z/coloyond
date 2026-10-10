package com.coloyond.ui.cards.create

import com.coloyond.generation.Captions
import com.coloyond.generation.GeneratedScene
import com.coloyond.generation.GenerationOrigin
import com.coloyond.generation.Scene
import com.coloyond.strategy.JsonValue
import com.coloyond.strategy.StrategyRecords
import com.coloyond.strategy.ValidatedRecord
import com.coloyond.strategy.asArray
import com.coloyond.strategy.asLong
import com.coloyond.strategy.asObject
import com.coloyond.strategy.asString
import java.math.BigDecimal
import java.math.BigInteger

data class CardTargetWeight(val mint: String, val weightBps: Int)

enum class CardObservationSource { RPC, FIXTURE }

/** Actual composition is displayable only when the complete observation metadata is present. */
data class CardActualComposition(
    val weights: List<CardTargetWeight>,
    val source: CardObservationSource,
    val providerLabel: String?,
    val observedAt: String?,
    val slot: String?,
) {
    val isComplete: Boolean
        get() = weights.isNotEmpty() && weights.all { it.weightBps in 1..10_000 } &&
            weights.sumOf { it.weightBps } == 10_000 && weights.map { it.mint }.distinct().size == weights.size &&
            !observedAt.isNullOrBlank() && isCanonicalSlot(slot)

    private fun isCanonicalSlot(value: String?): Boolean {
        if (value == null || !value.matches(Regex("(?:0|[1-9][0-9]*)"))) return false
        return runCatching { BigInteger(value) <= MAX_U64 }.getOrDefault(false)
    }

    private companion object {
        val MAX_U64 = BigInteger("18446744073709551615")
    }
}

/** Supplied by the verified published-vault catalog; an identity hash alone is not publication proof. */
data class PublishedVaultCard(
    val title: String,
    val strategy: ValidatedRecord,
    val displaySymbols: Map<String, String> = emptyMap(),
    val verifiedTickerSymbols: Set<String> = emptySet(),
    val actual: CardActualComposition? = null,
) {
    init {
        require(title.isNotBlank())
        val checked = StrategyRecords.validateStrategy(strategy.value)
        require(checked.id == strategy.id) { "Published strategy identity changed" }
        val fields = checked.value.asObject("strategy")
        val isManagedV2 = fields["kind"] == JsonValue.Str("managed-vault") && checked.id.startsWith("cb2:")
        val isColoyondV1 = fields["schema"] == JsonValue.Str("coloyond/ColoyondManagedStrategy/v1") && checked.id.startsWith("cb3:")
        require(isManagedV2 || isColoyondV1) { "Only a catalog-managed strategy can be selected as a published vault" }
    }
}

enum class CardCaptionOrigin(val recordValue: String) { MODEL("model"), USER("user") }

/** Pure card record construction; artwork and captions never enter the strategy identity. */
object CardCreationRecords {
    /** Late inference results attach only to the request and strategy revision that started them. */
    fun isCurrentGeneration(
        ticket: Int,
        currentTicket: Int,
        revision: String,
        currentRevision: String?,
        result: GeneratedScene,
    ): Boolean = ticket == currentTicket && currentRevision == revision && result.configurationRevision == revision

    fun percentToBasisPoints(input: String): Int? {
        if (!input.matches(Regex("(?:0|[1-9][0-9]{0,2})(?:\\.[0-9]{1,2})?"))) return null
        return runCatching { BigDecimal(input).movePointRight(2).intValueExact() }
            .getOrNull()
            ?.takeIf { it in 1..10_000 }
    }

    fun formatPercent(weightBps: Int): String = "${weightBps / 100}.${(weightBps % 100).toString().padStart(2, '0')}%"

    /** Creates the frozen AllocationDraftV1 shape. It is always inspect-only and never implies a vault. */
    fun allocationDraft(weights: List<CardTargetWeight>): ValidatedRecord {
        require(weights.size in 1..2) { "A draft must contain one or two assets" }
        require(weights.map { it.mint }.distinct().size == weights.size) { "Asset mints must be distinct" }
        require(weights.all { it.weightBps in 1..10_000 } && weights.sumOf { it.weightBps } == 10_000) {
            "Desired weights must be positive and total 100.00%"
        }
        val value = JsonValue.Obj(mapOf(
            "schemaVersion" to JsonValue.Num("1"),
            "kind" to JsonValue.Str("allocation-draft"),
            "network" to JsonValue.Str("solana:mainnet-beta"),
            "targetWeights" to JsonValue.Arr(weights.sortedBy { it.mint }.map { weight ->
                JsonValue.Obj(mapOf(
                    "mint" to JsonValue.Str(weight.mint),
                    "weightBps" to JsonValue.Num(weight.weightBps.toString()),
                ))
            }),
        ))
        return StrategyRecords.validateStrategy(value)
    }

    /** Calls the owning app's persistence boundary only with a revalidated inspect-only draft. */
    fun saveDraft(draft: ValidatedRecord, persist: (ValidatedRecord) -> Unit): ValidatedRecord {
        val checked = StrategyRecords.validateStrategy(draft.value)
        require(checked.id == draft.id && checked.id.startsWith("cbd1:") && checked.viewOnly) {
            "Only a validated allocation draft can be saved here"
        }
        persist(checked)
        return checked
    }

    fun targetWeights(strategy: ValidatedRecord): List<CardTargetWeight> {
        val checked = StrategyRecords.validateStrategy(strategy.value)
        require(checked.id == strategy.id) { "Strategy identity changed" }
        val fields = checked.value.asObject("strategy")
        return when {
            fields["schema"] == JsonValue.Str("coloyond/ColoyondManagedStrategy/v1") ->
                fields.getValue("tokens").asArray("tokens").map { row ->
                    val token = row.asObject("token")
                    CardTargetWeight(token.getValue("mint").asString("mint"), token.getValue("targetBps").asLong("targetBps").toInt())
                }
            fields["targetWeights"] != null -> fields.getValue("targetWeights").asArray("targetWeights").map { row ->
                val weight = row.asObject("target weight")
                CardTargetWeight(weight.getValue("mint").asString("mint"), weight.getValue("weightBps").asLong("weightBps").toInt())
            }
            else -> throw IllegalArgumentException("This strategy has no supported target weights")
        }
    }

    fun expression(
        strategy: ValidatedRecord,
        scene: JsonValue,
        sceneHash: String,
        caption: String?,
        captionOrigin: CardCaptionOrigin?,
        generationOrigin: GenerationOrigin,
        verifiedTickerSymbols: Set<String> = emptySet(),
    ): ValidatedRecord {
        val checkedStrategy = StrategyRecords.validateStrategy(strategy.value)
        require(checkedStrategy.id == strategy.id) { "Strategy identity changed" }
        val checkedScene = Scene.validate(scene)
        require(checkedScene.id == sceneHash) { "Scene changed after generation" }
        if (caption == null) require(captionOrigin == null) { "A hidden caption has no origin" }
        else {
            require(captionOrigin != null && Captions.validateUserCaption(caption, verifiedTickerSymbols) == caption) {
                "Caption is invalid or contains financial content"
            }
        }
        val sceneFields = scene.asObject("scene")
        val coloyond = checkedStrategy.id.startsWith("cb3:")
        val value = JsonValue.Obj(mapOf(
            "schemaVersion" to JsonValue.Num(if (coloyond) "2" else "1"),
            "strategyId" to JsonValue.Str(checkedStrategy.id),
            "scene" to scene,
            "sceneHash" to JsonValue.Str(checkedScene.id),
            "rendererVersion" to sceneFields.getValue("rendererVersion"),
            "layoutVersion" to JsonValue.Num("1"),
            "caption" to (caption?.let(JsonValue::Str) ?: JsonValue.Null),
            "captionOrigin" to JsonValue.Str(captionOrigin?.recordValue ?: "none"),
            "generationOrigin" to JsonValue.Str(when (generationOrigin) {
                GenerationOrigin.MODEL -> "model"
                GenerationOrigin.LOCAL_PREVIEW -> "local-preview"
            }),
            "parentExpressionId" to JsonValue.Null,
        ))
        return StrategyRecords.validateExpression(value, coloyond)
    }
}
