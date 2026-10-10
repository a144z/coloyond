package com.coloyond.generation

import com.coloyond.strategy.JsonValue
import com.coloyond.strategy.StrategyRecords
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CaptionsTest {
    @Test fun enforcesStoredCodePointAndWhitespaceWordLimits() {
        val eighty = "A " + "x".repeat(78)
        val eightyOne = "A " + "x".repeat(79)
        assertEquals(80, eighty.codePointCount(0, eighty.length))
        assertEquals(eighty, Captions.validateUserCaption(eighty))
        assertNull(Captions.validateUserCaption(eightyOne))
        assertEquals("Held\u3000lightly", Captions.validateUserCaption("Held\u3000lightly"))
        assertNull(Captions.validateUserCaption("光与影"))
        assertEquals("A 😊", Captions.validateUserCaption("A 😊"))
        assertNull(Captions.validateUserCaption("A \uD83D\uDE0A" + "x".repeat(78)))
        assertEquals("cafe\u0301 arrives", Captions.validateUserCaption("cafe\u0301 arrives"))
    }

    @Test fun rejectsFinancialClaimsUrlsControlsAndVerifiedTickersForModelAndUser() {
        listOf("Buy the yellow", "A guaranteed return", "A quiet yield", "Open https://example.com", "A $100 shape", "A 5% shape", "A\u0000shape", "SOL rests here")
            .forEach { text -> assertNull("$text", Captions.validateUserCaption(text, setOf("SOL"))) }
        assertEquals("Sol rests here", Captions.validateUserCaption("Sol rests here", setOf("SOL")))
        val parsed = StrategyRecords.parse("""{"candidates":["buy the yellow","An opening here"]}""")
        assertEquals(listOf("An opening here"), Captions.parseModelCandidates(parsed, emptyList()))
    }

    @Test fun modelCandidatesDeduplicateNormalizedPhrasesAndRecentMotifs() {
        val history = listOf("Café arrives", "Where the LIGHT goes", "An old horizon")
        val candidates = listOf(
            "Cafe\u0301 arrives!", // NFKC + case + terminal punctuation duplicate.
            "A small opening",
            "A small opening.", // duplicate within the batch.
            "The horizon turns",
            "An unfamiliar color",
        )
        assertEquals(listOf("A small opening", "An unfamiliar color"), Captions.filterModelCandidates(candidates, history))
        assertEquals(listOf("Café arrives", "Where the LIGHT goes", "An old horizon", "custom words"),
            Captions.appendAccepted(history, "custom words"))
        assertTrue(Captions.recentMotifStems(history).contains("light"))
    }

    @Test fun userCaptionsCanRepeatButKeepSharedSafetyAndHistoryRules() {
        val history = listOf("Still becoming")
        assertEquals("Still becoming", Captions.validateUserCaption("Still becoming"))
        assertTrue(Captions.filterModelCandidates(listOf("Still becoming"), history).isEmpty())
        assertEquals(20, Captions.appendAccepted((1..20).map { "Caption $it" }, "New caption").size)
        assertTrue(Captions.parseModelCandidates(StrategyRecords.parse("""{"candidates":[]}"""), emptyList()).isEmpty())
        assertFalse(Captions.recentMotifStems(emptyList()).isNotEmpty())
    }

    @Test fun candidateJsonRejectsExtraKeysAndTooManyItems() {
        assertTrue(runCatching { Captions.parseModelCandidates(StrategyRecords.parse("""{"candidates":[],"other":true}"""), emptyList()) }.isFailure)
        assertTrue(runCatching {
            Captions.parseModelCandidates(StrategyRecords.parse("""{"candidates":["one two","two three","three four","four five"]}"""), emptyList())
        }.isFailure)
    }
}
