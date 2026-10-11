package com.coloyond.platform

import android.graphics.BitmapFactory
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.coloyond.strategy.JsonValue
import com.coloyond.strategy.StrategyRecords
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class CardExportInstrumentedTest {
    @Test
    fun savedSceneProducesDeterministic1080By1350PngWithPinnedLayout() {
        val strategy = StrategyRecords.validateStrategy(StrategyRecords.parse(
            """{"schemaVersion":1,"kind":"allocation-draft","network":"solana:mainnet-beta","targetWeights":[{"mint":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v","weightBps":6000},{"mint":"So11111111111111111111111111111111111111112","weightBps":4000}]}""",
        ))
        val scene = StrategyRecords.validateScene(StrategyRecords.parse(
            """{"schemaVersion":1,"rendererVersion":1,"canvasRatio":"1:1","background":"paper","seed":1776,"layers":[{"type":"ellipse","cx":500,"cy":500,"rx":300,"ry":300,"fill":{"type":"linear","from":[100,100],"to":[900,900],"stops":[{"at":0,"color":"cobalt"},{"at":1000,"color":"coral"}]},"opacity":1000},{"type":"ring","cx":500,"cy":500,"radius":420,"strokeWidth":20,"fill":{"type":"solid","color":"ink"},"opacity":800}],"texture":{"grainIntensity":65},"inheritedFeature":"opening"}""",
        ))
        val expression = StrategyRecords.validateExpression(JsonValue.Obj(mapOf(
            "schemaVersion" to JsonValue.Num("1"),
            "strategyId" to JsonValue.Str(strategy.id),
            "scene" to scene.value,
            "sceneHash" to JsonValue.Str(scene.id),
            "rendererVersion" to JsonValue.Num("1"),
            "layoutVersion" to JsonValue.Num("1"),
            "caption" to JsonValue.Str("Where unfamiliar colors gather, open forms meet the edge of another possibility!"),
            "captionOrigin" to JsonValue.Str("user"),
            "generationOrigin" to JsonValue.Str("local-preview"),
            "parentExpressionId" to JsonValue.Null,
        )))
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val font = SceneRenderer.exportTypeface(context)

        val first = (CardExport.renderCardPng(expression, strategy, font) as CardExport.Result.Png).bytes
        val second = (CardExport.renderCardPng(expression, strategy, font) as CardExport.Result.Png).bytes
        assertArrayEquals(first, second)
        val bitmap = BitmapFactory.decodeByteArray(first, 0, first.size)
        assertTrue(bitmap != null)
        assertEquals(1080, bitmap.width)
        assertEquals(1350, bitmap.height)
        assertEquals(0xFFF1ECDD.toInt(), bitmap.getPixel(0, 0))
        assertEquals(60f, CardLayoutV1.ART.left)
        assertEquals(1050f, CardLayoutV1.CAPTION.top)
        assertEquals(1210f, CardLayoutV1.FOOTER.top)
    }
}
