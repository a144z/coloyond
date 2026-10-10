package com.coloyond.ui.cards.share

import com.coloyond.generation.GenerationOrigin
import com.coloyond.strategy.JsonValue
import com.coloyond.strategy.StrategyRecords
import com.coloyond.strategy.asArray
import com.coloyond.strategy.asObject
import com.coloyond.ui.cards.create.CardCreationRecords
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CardRemixRecordsTest {
    @Test
    fun sameStrategyRemixCreatesNewIdentityWithImmutableParentReference() {
        val strategy = StrategyRecords.validateStrategy(StrategyRecords.parse(draft("6000", "4000")))
        val parent = CardCreationRecords.expression(strategy, scene(seed = 4), scene(seed = 4).let(StrategyRecords::validateScene).id, null, null, GenerationOrigin.LOCAL_PREVIEW)
        val nextScene = scene(seed = 5)
        val remix = CardRemixRecords.expression(
            strategy = strategy,
            parentExpression = parent,
            scene = nextScene,
            caption = null,
            captionOrigin = "none",
            generationOrigin = GenerationOrigin.LOCAL_PREVIEW,
        )

        assertEquals(strategy.id, remix.value.asObject("remix").getValue("strategyId").let { (it as JsonValue.Str).value })
        assertEquals(parent.id, remix.value.asObject("remix").getValue("parentExpressionId").let { (it as JsonValue.Str).value })
        assertNotEquals(parent.id, remix.id)
        assertEquals(null, parent.value.asObject("parent").getValue("parentExpressionId").let { if (it == JsonValue.Null) null else it })
    }

    @Test
    fun remixCannotSilentlyChangeStrategy() {
        val strategy = StrategyRecords.validateStrategy(StrategyRecords.parse(draft("6000", "4000")))
        val other = StrategyRecords.validateStrategy(StrategyRecords.parse(draft("5000", "5000")))
        val scene = scene(seed = 4)
        val parent = CardCreationRecords.expression(strategy, scene, StrategyRecords.validateScene(scene).id, null, null, GenerationOrigin.LOCAL_PREVIEW)

        assertTrue(runCatching {
            CardRemixRecords.expression(other, parent, scene(seed = 5), null, "none", GenerationOrigin.LOCAL_PREVIEW)
        }.isFailure)
    }

    private fun scene(seed: Int): JsonValue {
        val stream = requireNotNull(javaClass.classLoader?.getResourceAsStream("strategy-identity-vectors.json"))
        val vectors = StrategyRecords.parse(stream.bufferedReader(Charsets.UTF_8).use { it.readText() }) as JsonValue.Obj
        val vector = vectors.fields.getValue("sceneVectors").asArray("sceneVectors").single().asObject("scene vector")
        val fields = vector.getValue("scene").asObject("scene").toMutableMap()
        fields["seed"] = JsonValue.Num(seed.toString())
        return JsonValue.Obj(fields)
    }

    private fun draft(first: String, second: String): String =
        """{"schemaVersion":1,"kind":"allocation-draft","network":"solana:mainnet-beta","targetWeights":[{"mint":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v","weightBps":$first},{"mint":"So11111111111111111111111111111111111111112","weightBps":$second}]}"""
}
