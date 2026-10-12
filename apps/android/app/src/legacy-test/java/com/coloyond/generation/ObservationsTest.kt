package com.coloyond.generation

import com.coloyond.strategy.JsonValue
import com.coloyond.strategy.StrategyRecords
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ObservationsTest {
    @Test fun reportsOnlyFactsDerivedFromValidatedGeometryAndPalette() {
        val scene = StrategyRecords.parse(
            """{"schemaVersion":1,"rendererVersion":1,"canvasRatio":"1:1","background":"paper","seed":5,"layers":[{"type":"polygon","points":[[100,100],[600,100],[300,700]],"fill":{"type":"solid","color":"cobalt"},"opacity":1000},{"type":"ellipse","cx":400,"cy":400,"rx":200,"ry":100,"fill":{"type":"linear","from":[0,0],"to":[100,100],"stops":[{"at":0,"color":"yellow"},{"at":1000,"color":"coral"}]},"opacity":800},{"type":"ring","cx":800,"cy":800,"radius":100,"strokeWidth":20,"fill":{"type":"solid","color":"ink"},"opacity":0}],"texture":{"grainIntensity":0},"inheritedFeature":null}""",
        )
        val observations = Observations.fromScene(scene)
        assertEquals(3, observations.size)
        assertTrue(observations[0].fact.contains("middle-center; polygon"))
        assertEquals(listOf(ObservedPaletteToken.COBALT), observations[0].paletteTokens)
        assertEquals(listOf(ObservedPaletteToken.YELLOW, ObservedPaletteToken.CORAL), observations[1].paletteTokens)
        assertTrue(observations.none { it.layerIndexes.contains(2) })
        assertTrue(observations.any { it.fact.contains("bounds") && it.layerIndexes == listOf(0, 1) })
    }

    @Test fun rejectsSceneBeforeObservingIt() {
        val invalid = StrategyRecords.parse(
            """{"schemaVersion":1,"rendererVersion":1,"canvasRatio":"1:1","background":"paper","seed":1,"layers":[{"type":"polygon","points":[[0,0],[100,0],[100,100],[0,100]],"fill":{"type":"solid","color":"unknown"},"opacity":1000}],"texture":{"grainIntensity":0},"inheritedFeature":null}""",
        )
        assertTrue(runCatching { Observations.fromScene(invalid) }.isFailure)
    }
}
