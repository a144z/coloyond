package com.coloyond.platform

import com.coloyond.strategy.JsonValue
import com.coloyond.strategy.StrategyRecords
import com.coloyond.strategy.ValidatedRecord
import com.coloyond.strategy.asArray
import com.coloyond.strategy.asObject
import com.coloyond.strategy.asString
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class CardStorageTest {
    @get:Rule val temporary = TemporaryFolder()

    @Test
    fun savesStrategyExpressionAndPngAsSeparateImmutableObjects() {
        val (strategy, expression) = records()
        val png = cardPng()
        val root = temporary.newFolder()
        val storage = CardStorage(root)

        val saved = storage.save(strategy, expression, png)
        assertEquals(strategy.id, saved.strategy.id)
        assertEquals(expression.id, saved.expression.id)
        assertArrayEquals(png, saved.png)
        assertEquals(64, saved.pngSha256.length)
        assertEquals(1, storage.list().size)
        assertEquals(expression.id, storage.load(expression.id)?.expression?.id)
        assertTrue(File(root, "strategies/${strategy.id.replace(':', '_')}.json").isFile)
        assertTrue(File(root, "expressions/${expression.id.replace(':', '_')}.json").isFile)
        assertTrue(File(root, "png/${expression.id.replace(':', '_')}.png").isFile)
    }

    @Test
    fun identicalSaveIsIdempotentButChangedPngCannotReplaceSavedArt() {
        val (strategy, expression) = records()
        val root = temporary.newFolder()
        val storage = CardStorage(root)
        val png = cardPng()
        storage.save(strategy, expression, png)
        storage.save(strategy, expression, png.copyOf())

        val changed = png.copyOf().also { it[24] = 1 }
        assertTrue(runCatching { storage.save(strategy, expression, changed) }.exceptionOrNull() is CardStorageConflictException)
        assertArrayEquals(png, storage.load(expression.id)?.png)
    }

    @Test
    fun rejectsMismatchedStrategyAndWrongSizePng() {
        val (strategy, expression) = records()
        val storage = CardStorage(temporary.newFolder())
        val other = StrategyRecords.validateStrategy(StrategyRecords.parse(draftJson("6000", "4000")))
        assertTrue(runCatching { storage.save(other, expression, cardPng()) }.isFailure)
        assertTrue(runCatching { storage.save(strategy, expression, cardPng(width = 1080, height = 1080)) }.isFailure)
        assertTrue(storage.list().isEmpty())
    }

    @Test
    fun unknownRendererCanBeKeptWithItsPngAsViewOnly() {
        val (strategy, _) = records()
        val expression = expression(strategy, renderer = 9)
        val storage = CardStorage(temporary.newFolder())
        val saved = storage.save(strategy, expression, cardPng())
        assertTrue(saved.viewOnly)
        assertEquals(expression.id, storage.load(expression.id)?.expression?.id)
    }

    @Test
    fun incompleteStoredExpressionIsNotListed() {
        val (strategy, expression) = records()
        val root = temporary.newFolder()
        val storage = CardStorage(root)
        storage.save(strategy, expression, cardPng())
        File(root, "png/${expression.id.replace(':', '_')}.png").delete()
        assertNull(storage.load(expression.id))
        assertFalse(storage.list().any { it.expression.id == expression.id })
    }

    private fun records(): Pair<ValidatedRecord, ValidatedRecord> {
        val strategy = StrategyRecords.validateStrategy(StrategyRecords.parse(draftJson("7000", "3000")))
        return strategy to expression(strategy, renderer = 1)
    }

    private fun expression(strategy: ValidatedRecord, renderer: Int): ValidatedRecord {
        val vectorStream = requireNotNull(javaClass.classLoader?.getResourceAsStream("strategy-identity-vectors.json"))
        val vectors = StrategyRecords.parse(vectorStream.bufferedReader(Charsets.UTF_8).use { it.readText() }) as JsonValue.Obj
        val sceneValue = vectors.fields.getValue("sceneVectors").asArray("sceneVectors").single().asObject("scene vector").getValue("scene")
        val sceneFields = sceneValue.asObject("scene").toMutableMap()
        sceneFields["rendererVersion"] = JsonValue.Num(renderer.toString())
        val scene = StrategyRecords.validateScene(JsonValue.Obj(sceneFields))
        val value = JsonValue.Obj(mapOf(
            "schemaVersion" to JsonValue.Num("1"),
            "strategyId" to JsonValue.Str(strategy.id),
            "scene" to scene.value,
            "sceneHash" to JsonValue.Str(scene.id),
            "rendererVersion" to JsonValue.Num(renderer.toString()),
            "layoutVersion" to JsonValue.Num("1"),
            "caption" to JsonValue.Null,
            "captionOrigin" to JsonValue.Str("none"),
            "generationOrigin" to JsonValue.Str("local-preview"),
            "parentExpressionId" to JsonValue.Null,
        ))
        return StrategyRecords.validateExpression(value)
    }

    private fun draftJson(firstWeight: String, secondWeight: String): String =
        """{"schemaVersion":1,"kind":"allocation-draft","network":"solana:mainnet-beta","targetWeights":[{"mint":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v","weightBps":$firstWeight},{"mint":"So11111111111111111111111111111111111111112","weightBps":$secondWeight}]}"""

    private fun cardPng(width: Int = 1080, height: Int = 1350): ByteArray {
        val bytes = ByteArray(25)
        byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a).copyInto(bytes)
        ByteBuffer.wrap(bytes, 8, 4).order(ByteOrder.BIG_ENDIAN).putInt(13)
        byteArrayOf(0x49, 0x48, 0x44, 0x52).copyInto(bytes, 12)
        ByteBuffer.wrap(bytes, 16, 4).order(ByteOrder.BIG_ENDIAN).putInt(width)
        ByteBuffer.wrap(bytes, 20, 4).order(ByteOrder.BIG_ENDIAN).putInt(height)
        return bytes
    }
}
