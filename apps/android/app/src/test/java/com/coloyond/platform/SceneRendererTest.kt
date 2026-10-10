package com.coloyond.platform

import com.coloyond.strategy.JsonValue
import com.coloyond.strategy.StrategyRecords
import com.coloyond.strategy.ValidatedRecord
import com.coloyond.strategy.asArray
import com.coloyond.strategy.asObject
import com.coloyond.strategy.asString
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SceneRendererTest {
    @Test
    fun versionOneUsesTheReviewedCardRectangles() {
        assertEquals(1080f, CardLayoutV1.WIDTH)
        assertEquals(1350f, CardLayoutV1.HEIGHT)
        assertEquals(60f, CardLayoutV1.ART.left)
        assertEquals(60f, CardLayoutV1.ART.top)
        assertEquals(960f, CardLayoutV1.ART.width)
        assertEquals(960f, CardLayoutV1.ART.height)
        assertEquals(1050f, CardLayoutV1.CAPTION.top)
        assertEquals(960f, CardLayoutV1.CAPTION.width)
        assertEquals(110f, CardLayoutV1.CAPTION.height)
        assertEquals(1210f, CardLayoutV1.FOOTER.top)
        assertEquals(960f, CardLayoutV1.FOOTER.width)
        assertEquals(80f, CardLayoutV1.FOOTER.height)
    }

    @Test
    fun supportedSceneIsRenderableAndUnknownRendererStaysViewOnly() {
        val strategy = draftStrategy()
        val supported = expression(strategy, rendererVersion = 1)
        assertEquals(SceneRenderer.Support.Supported, SceneRenderer.support(supported, strategy))

        val unknown = expression(strategy, rendererVersion = 2)
        assertEquals(SceneRenderer.Support.ViewOnly(2, 1), SceneRenderer.support(unknown, strategy))
    }

    @Test
    fun expressionCannotRenderAgainstAnotherStrategy() {
        val original = draftStrategy()
        val other = managedStrategy()
        val expression = expression(original, rendererVersion = 1)
        assertTrue(runCatching { SceneRenderer.support(expression, other) }.isFailure)
    }

    @Test
    fun seededGrainIsPureRepeatableAndClippedToItsViewport() {
        val first = SceneGrainV1.specks(seed = 4_294_967_000L, intensity = 65, width = 120, height = 80)
        val replay = SceneGrainV1.specks(seed = 4_294_967_000L, intensity = 65, width = 120, height = 80)
        assertEquals(2500, first.size)
        assertEquals(first, replay)
        assertTrue(first.all { it.x in 0 until 120 && it.y in 0 until 80 && it.alpha in 0f..0.0715f })
        assertTrue(SceneGrainV1.specks(seed = 7, intensity = 0).isEmpty())
        assertTrue(first != SceneGrainV1.specks(seed = 9, intensity = 65, width = 120, height = 80))
    }

    private fun draftStrategy(): ValidatedRecord {
        val rows = vectors().fields.getValue("vectors").asArray("vectors")
        val row = rows.map { it.asObject("vector") }.first { it.getValue("name").asString("name") == "draft-70-30" }
        return StrategyRecords.validateStrategy(row.getValue("input"))
    }

    private fun managedStrategy(): ValidatedRecord {
        val rows = vectors().fields.getValue("vectors").asArray("vectors")
        val row = rows.map { it.asObject("vector") }.first { it.getValue("name").asString("name") == "managed-60-40" }
        return StrategyRecords.validateStrategy(row.getValue("input"))
    }

    private fun expression(strategy: ValidatedRecord, rendererVersion: Long): ValidatedRecord {
        val sceneValue = vectors().fields.getValue("sceneVectors").asArray("sceneVectors").single().asObject("scene vector").getValue("scene")
        val sceneFields = sceneValue.asObject("scene").toMutableMap()
        sceneFields["rendererVersion"] = JsonValue.Num(rendererVersion.toString())
        val scene = StrategyRecords.validateScene(JsonValue.Obj(sceneFields))
        val payload = JsonValue.Obj(mapOf(
            "schemaVersion" to JsonValue.Num("1"),
            "strategyId" to JsonValue.Str(strategy.id),
            "scene" to scene.value,
            "sceneHash" to JsonValue.Str(scene.id),
            "rendererVersion" to JsonValue.Num(rendererVersion.toString()),
            "layoutVersion" to JsonValue.Num("1"),
            "caption" to JsonValue.Null,
            "captionOrigin" to JsonValue.Str("none"),
            "generationOrigin" to JsonValue.Str("local-preview"),
            "parentExpressionId" to JsonValue.Null,
        ))
        return StrategyRecords.validateExpression(payload)
    }

    private fun vectors(): JsonValue.Obj {
        val stream = requireNotNull(javaClass.classLoader?.getResourceAsStream("strategy-identity-vectors.json"))
        return StrategyRecords.parse(stream.bufferedReader(Charsets.UTF_8).use { it.readText() }) as JsonValue.Obj
    }
}
