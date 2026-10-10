package com.coloyond.strategy

import java.util.Base64
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CardExchangeTest {
    @Test
    fun strategyLinkRoundTripsAValidatedVersionedRecord() {
        val strategy = strategy()
        val link = CardExchange.strategyLink(strategy)

        assertTrue(link.startsWith(CardExchange.LINK_PREFIX))
        assertTrue(link.length < CardExchange.MAX_LINK_CHARS)
        assertEquals(strategy.id, CardExchange.parseStrategyLink(link).id)
    }

    @Test
    fun portableExportKeepsStrategyAndOptionalExpressionSeparate() {
        val strategy = strategy()
        val exported = CardExchange.export(strategy)
        val imported = CardExchange.parseExport(exported.canonicalJson.toByteArray(Charsets.UTF_8))

        assertEquals(strategy.id, imported.strategy.id)
        assertEquals(null, imported.expression)
        assertEquals(strategy.id, imported.envelope.id)
        assertTrue(imported.strategy.viewOnly)
    }

    @Test
    fun linkRejectsTamperedIdentityUnknownFieldsAndNonBase64Payloads() {
        val strategy = strategy()
        val valid = CardExchange.strategyLink(strategy)
        val payloadBytes = Base64.getUrlDecoder().decode(valid.removePrefix(CardExchange.LINK_PREFIX))
        val payload = StrictJson.parse(payloadBytes.toString(Charsets.UTF_8)).asObject("payload")
        val tampered = JsonValue.Obj(payload.fields + ("strategyId" to JsonValue.Str("cbd1:${"0".repeat(64)}")))
        val encodedTampered = Base64.getUrlEncoder().withoutPadding()
            .encodeToString(StrictJson.canonical(tampered).toByteArray(Charsets.UTF_8))

        assertFalse(runCatching { CardExchange.parseStrategyLink("${CardExchange.LINK_PREFIX}!") }.isSuccess)
        assertFalse(runCatching { CardExchange.parseStrategyLink(CardExchange.LINK_PREFIX + encodedTampered) }.isSuccess)
        assertFalse(runCatching { CardExchange.parseStrategyLink(valid + "?redirect=example") }.isSuccess)
        assertFalse(runCatching { CardExchange.parseStrategyLink(valid + "a".repeat(2_000)) }.isSuccess)
    }

    @Test
    fun exportRejectsOversizedAndMalformedUtf8Files() {
        assertFalse(runCatching { CardExchange.parseExport(ByteArray(StrategyRecords.MAX_IMPORT_BYTES + 1)) }.isSuccess)
        assertFalse(runCatching { CardExchange.parseExport(byteArrayOf(0xc3.toByte(), 0x28)) }.isSuccess)
    }

    private fun strategy(): ValidatedRecord = StrategyRecords.validateStrategy(StrategyRecords.parse(
        """{"schemaVersion":1,"kind":"allocation-draft","network":"solana:mainnet-beta","targetWeights":[{"mint":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v","weightBps":6000},{"mint":"So11111111111111111111111111111111111111112","weightBps":4000}]}""",
    ))
}
