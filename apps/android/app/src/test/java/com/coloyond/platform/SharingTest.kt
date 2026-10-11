package com.coloyond.platform

import com.coloyond.strategy.CardExchange
import com.coloyond.strategy.JsonValue
import com.coloyond.strategy.StrategyRecords
import com.coloyond.strategy.ValidatedRecord
import com.coloyond.strategy.asArray
import com.coloyond.strategy.asObject
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class SharingTest {
    @get:Rule val temporary = TemporaryFolder()

    @Test
    fun shareValidationReturnsDetachedExactSavedCardBundle() {
        val (strategy, expression) = records()
        val saved = CardStorage(temporary.newFolder()).save(strategy, expression, cardPng())

        val checked = Sharing.validateSavedCard(saved)

        assertEquals(strategy.id, checked.strategy.id)
        assertEquals(expression.id, checked.expression.id)
        assertEquals(saved.pngSha256, checked.pngSha256)
        assertTrue(checked.viewOnly)
        assertNotSame(saved.png, checked.png)
        assertArrayEquals(saved.png, checked.png)
    }

    @Test
    fun schemeLinkAndPortableFileKeepValidatedRecordIdentities() {
        val saved = savedCard()
        val link = Sharing.strategyLink(saved.strategy)
        val portable = CardExchange.parseExport(
            CardExchange.export(saved.strategy, saved.expression).canonicalJson.toByteArray(Charsets.UTF_8),
        )

        assertTrue(link.length < CardExchange.MAX_LINK_CHARS)
        assertEquals(saved.strategy.id, CardExchange.parseStrategyLink(link).id)
        assertEquals(saved.strategy.id, portable.strategy.id)
        assertEquals(saved.expression.id, portable.expression?.id)
    }

    @Test
    fun shareValidationRejectsChangedImageOrDigest() {
        val saved = savedCard()
        val changedPng = saved.png.copyOf().also { it[24] = 1 }

        assertTrue(runCatching { Sharing.validateSavedCard(saved.copy(png = changedPng)) }.isFailure)
        assertTrue(runCatching { Sharing.validateSavedCard(saved.copy(pngSha256 = "0".repeat(64))) }.isFailure)
    }

    @Test
    fun shareValidationRejectsMismatchedExpressionAndStrategy() {
        val saved = savedCard()
        val otherStrategy = StrategyRecords.validateStrategy(
            StrategyRecords.parse(draft("7000", "3000")),
        )

        assertTrue(runCatching { Sharing.validateSavedCard(saved.copy(strategy = otherStrategy)) }.isFailure)
    }

    @Test
    fun shareValidationRejectsFalseViewOnlyClaimAndWrongPngDimensions() {
        val saved = savedCard()
        val wrongDimensions = saved.png.copyOf().also {
            ByteBuffer.wrap(it, 16, 4).order(ByteOrder.BIG_ENDIAN).putInt(1080)
            ByteBuffer.wrap(it, 20, 4).order(ByteOrder.BIG_ENDIAN).putInt(1080)
        }
        val wrongDigest = MessageDigest.getInstance("SHA-256").digest(wrongDimensions)
            .joinToString("") { "%02x".format(it) }

        assertTrue(runCatching { Sharing.validateSavedCard(saved.copy(viewOnly = false)) }.isFailure)
        assertTrue(runCatching {
            Sharing.validateSavedCard(saved.copy(png = wrongDimensions, pngSha256 = wrongDigest))
        }.isFailure)
    }

    private fun savedCard(): SavedCard {
        val (strategy, expression) = records()
        return CardStorage(temporary.newFolder()).save(strategy, expression, cardPng())
    }

    private fun records(): Pair<ValidatedRecord, ValidatedRecord> {
        val strategy = StrategyRecords.validateStrategy(StrategyRecords.parse(draft("6000", "4000")))
        val vectors = requireNotNull(javaClass.classLoader?.getResourceAsStream("strategy-identity-vectors.json"))
            .bufferedReader(Charsets.UTF_8).use { StrategyRecords.parse(it.readText()) }
            .asObject("vectors")
        val sceneFields = vectors.getValue("sceneVectors").asArray("sceneVectors").single()
            .asObject("scene vector").getValue("scene").asObject("scene").toMutableMap()
        sceneFields["seed"] = JsonValue.Num("9")
        val scene = StrategyRecords.validateScene(JsonValue.Obj(sceneFields))
        val expression = StrategyRecords.validateExpression(JsonValue.Obj(mapOf(
            "schemaVersion" to JsonValue.Num("1"),
            "strategyId" to JsonValue.Str(strategy.id),
            "scene" to scene.value,
            "sceneHash" to JsonValue.Str(scene.id),
            "rendererVersion" to scene.value.asObject("scene").getValue("rendererVersion"),
            "layoutVersion" to JsonValue.Num("1"),
            "caption" to JsonValue.Null,
            "captionOrigin" to JsonValue.Str("none"),
            "generationOrigin" to JsonValue.Str("local-preview"),
            "parentExpressionId" to JsonValue.Null,
        )))
        return strategy to expression
    }

    private fun draft(first: String, second: String): String =
        """{"schemaVersion":1,"kind":"allocation-draft","network":"solana:mainnet-beta","targetWeights":[{"mint":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v","weightBps":$first},{"mint":"So11111111111111111111111111111111111111112","weightBps":$second}]}"""

    private fun cardPng(): ByteArray = ByteArray(25).also { bytes ->
        byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a).copyInto(bytes)
        ByteBuffer.wrap(bytes, 8, 4).order(ByteOrder.BIG_ENDIAN).putInt(13)
        byteArrayOf(0x49, 0x48, 0x44, 0x52).copyInto(bytes, 12)
        ByteBuffer.wrap(bytes, 16, 4).order(ByteOrder.BIG_ENDIAN).putInt(1080)
        ByteBuffer.wrap(bytes, 20, 4).order(ByteOrder.BIG_ENDIAN).putInt(1350)
    }
}
