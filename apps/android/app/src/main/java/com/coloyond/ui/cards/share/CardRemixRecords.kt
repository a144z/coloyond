package com.coloyond.ui.cards.share

import com.coloyond.generation.Captions
import com.coloyond.generation.GenerationOrigin
import com.coloyond.generation.Scene
import com.coloyond.strategy.JsonValue
import com.coloyond.strategy.StrategyRecords
import com.coloyond.strategy.ValidatedRecord
import com.coloyond.strategy.asObject

data class CardRemixSelection(val strategy: ValidatedRecord, val parentExpression: ValidatedRecord) {
    init {
        val checkedStrategy = StrategyRecords.validateStrategy(strategy.value)
        require(checkedStrategy.id == strategy.id) { "Strategy identity changed" }
        val checkedParent = StrategyRecords.validateExpression(
            parentExpression.value,
            coloyond = parentExpression.id.startsWith("cbe2:"),
        )
        require(checkedParent.id == parentExpression.id) { "Parent expression identity changed" }
        require(checkedParent.value.asObject("parent expression").getValue("strategyId") == JsonValue.Str(checkedStrategy.id)) {
            "A visual remix must keep the same strategy"
        }
    }
}

/** Creates a new expression while preserving the original strategy and immutable parent link. */
object CardRemixRecords {
    fun expression(
        strategy: ValidatedRecord,
        parentExpression: ValidatedRecord,
        scene: JsonValue,
        caption: String?,
        captionOrigin: String,
        generationOrigin: GenerationOrigin,
        verifiedTickerSymbols: Set<String> = emptySet(),
    ): ValidatedRecord {
        val checkedStrategy = StrategyRecords.validateStrategy(strategy.value)
        require(checkedStrategy.id == strategy.id) { "Strategy identity changed" }
        val checkedParent = StrategyRecords.validateExpression(
            parentExpression.value,
            coloyond = parentExpression.id.startsWith("cbe2:"),
        )
        require(checkedParent.id == parentExpression.id) { "Parent expression identity changed" }
        val parentStrategyId = checkedParent.value.asObject("parent expression").getValue("strategyId")
        require(parentStrategyId == JsonValue.Str(checkedStrategy.id)) { "A visual remix must keep the same strategy" }

        val checkedScene = Scene.validate(scene)
        if (caption == null) require(captionOrigin == "none") { "A hidden caption has no origin" }
        else {
            require(captionOrigin == "model" || captionOrigin == "user") { "Unknown caption origin" }
            require(Captions.validateUserCaption(caption, verifiedTickerSymbols) == caption) {
                "Caption is invalid or contains unverified financial content"
            }
        }
        val coloyond = checkedStrategy.id.startsWith("cb3:")
        val value = JsonValue.Obj(mapOf(
            "schemaVersion" to JsonValue.Num(if (coloyond) "2" else "1"),
            "strategyId" to JsonValue.Str(checkedStrategy.id),
            "scene" to checkedScene.value,
            "sceneHash" to JsonValue.Str(checkedScene.id),
            "rendererVersion" to checkedScene.value.asObject("scene").getValue("rendererVersion"),
            "layoutVersion" to JsonValue.Num("1"),
            "caption" to (caption?.let(JsonValue::Str) ?: JsonValue.Null),
            "captionOrigin" to JsonValue.Str(captionOrigin),
            "generationOrigin" to JsonValue.Str(when (generationOrigin) {
                GenerationOrigin.MODEL -> "model"
                GenerationOrigin.LOCAL_PREVIEW -> "local-preview"
            }),
            "parentExpressionId" to JsonValue.Str(checkedParent.id),
        ))
        return StrategyRecords.validateExpression(value, coloyond = coloyond)
    }
}
