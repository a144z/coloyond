package com.coloyond.ui.cards.create

import com.coloyond.generation.GeneratedScene
import com.coloyond.generation.GenerationOrigin
import com.coloyond.strategy.JsonValue
import com.coloyond.strategy.StrategyRecords
import com.coloyond.strategy.asArray
import com.coloyond.strategy.asObject
import com.coloyond.strategy.asString
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CardCreationRecordsTest {
    @Test fun percentagesUseExactHundredthsAndRejectAmbiguousInput() {
        assertEquals(5_000, CardCreationRecords.percentToBasisPoints("50.00"))
        assertEquals(1, CardCreationRecords.percentToBasisPoints("0.01"))
        assertEquals(10_000, CardCreationRecords.percentToBasisPoints("100"))
        listOf("0", "100.01", "1.001", "01", "1e2", " 50", "50,0").forEach {
            assertNull("accepted $it", CardCreationRecords.percentToBasisPoints(it))
        }
    }

    @Test fun draftIsSortedStrictAndAlwaysInspectOnly() {
        val draft = CardCreationRecords.allocationDraft(listOf(
            CardTargetWeight("So11111111111111111111111111111111111111112", 6_000),
            CardTargetWeight("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", 4_000),
        ))
        assertTrue(draft.id.startsWith("cbd1:"))
        assertTrue(draft.viewOnly)
        val weights = draft.value.asObject("draft").getValue("targetWeights").asArray("weights")
        assertEquals("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", weights.first().asObject("weight").getValue("mint").asString("mint"))
        var persisted: com.coloyond.strategy.ValidatedRecord? = null
        val savedDraft = CardCreationRecords.saveDraft(draft) { persisted = it }
        assertEquals(savedDraft.id, persisted?.id)
        assertTrue(persisted?.viewOnly == true)
        assertTrue(runCatching { CardCreationRecords.saveDraft(strategyRecord(), {}) }.isFailure)
        assertTrue(runCatching {
            CardCreationRecords.allocationDraft(listOf(
                CardTargetWeight("So11111111111111111111111111111111111111112", 5_000),
                CardTargetWeight("So11111111111111111111111111111111111111112", 5_000),
            ))
        }.isFailure)
        assertTrue(runCatching {
            CardCreationRecords.allocationDraft(listOf(CardTargetWeight("So11111111111111111111111111111111111111112", 9_999)))
        }.isFailure)
    }

    @Test fun expressionBindsSceneAndStrategyButCaptionCannotChangeStrategyIdentity() {
        val strategy = CardCreationRecords.allocationDraft(listOf(
            CardTargetWeight("So11111111111111111111111111111111111111112", 6_000),
            CardTargetWeight("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", 4_000),
        ))
        val scene = sceneFixture()
        val sceneHash = StrategyRecords.validateScene(scene).id
        val withoutCaption = CardCreationRecords.expression(strategy, scene, sceneHash, null, null, com.coloyond.generation.GenerationOrigin.MODEL)
        val withCaption = CardCreationRecords.expression(
            strategy,
            scene,
            sceneHash,
            "The yellow arrived first",
            CardCaptionOrigin.USER,
            com.coloyond.generation.GenerationOrigin.MODEL,
        )
        assertNotEquals(withoutCaption.id, withCaption.id)
        assertEquals(strategy.id, withCaption.value.asObject("expression").getValue("strategyId").asString("strategyId"))
        assertEquals("user", withCaption.value.asObject("expression").getValue("captionOrigin").asString("captionOrigin"))
        assertTrue(withCaption.id.startsWith("cbe1:"))
        assertFalse(withCaption.viewOnly)
    }

    @Test fun expressionRejectsStaleSceneHashAndFinancialCaption() {
        val strategy = CardCreationRecords.allocationDraft(listOf(CardTargetWeight("So11111111111111111111111111111111111111112", 10_000)))
        val scene = sceneFixture()
        val sceneHash = StrategyRecords.validateScene(scene).id
        assertTrue(runCatching {
            CardCreationRecords.expression(strategy, scene, "0".repeat(64), null, null, com.coloyond.generation.GenerationOrigin.LOCAL_PREVIEW)
        }.isFailure)
        assertTrue(runCatching {
            CardCreationRecords.expression(
                strategy, scene, sceneHash, "Guaranteed returns", CardCaptionOrigin.USER,
                com.coloyond.generation.GenerationOrigin.LOCAL_PREVIEW,
            )
        }.isFailure)
    }

    @Test fun catalogEntryMustBeAValidatedManagedRevision() {
        val vectorStream = requireNotNull(javaClass.classLoader?.getResourceAsStream("strategy-identity-vectors.json"))
        val vectors = StrategyRecords.parse(vectorStream.bufferedReader().use { it.readText() })
        val row = vectors.asObject("vectors").getValue("vectors").asArray("vectors").first().asObject("managed vector")
        val strategy = StrategyRecords.validateStrategy(row.getValue("input"))
        val option = PublishedVaultCard("Sample catalog entry", strategy)
        assertEquals(strategy.id, option.strategy.id)
        assertEquals(2, CardCreationRecords.targetWeights(strategy).size)
        assertTrue(runCatching { PublishedVaultCard("", strategy) }.isFailure)
        val draft = CardCreationRecords.allocationDraft(listOf(CardTargetWeight("So11111111111111111111111111111111111111112", 10_000)))
        assertTrue(runCatching { PublishedVaultCard("Draft", draft) }.isFailure)
    }

    @Test fun actualCompositionRequiresCompleteProvenanceAndAFullDistribution() {
        val weights = listOf(
            CardTargetWeight("So11111111111111111111111111111111111111112", 6_000),
            CardTargetWeight("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", 4_000),
        )
        assertTrue(CardActualComposition(weights, CardObservationSource.RPC, "Localnet RPC", "2026-10-10T12:00:00Z", "42").isComplete)
        assertFalse(CardActualComposition(weights, CardObservationSource.RPC, "Localnet RPC", null, "42").isComplete)
        assertTrue(CardActualComposition(weights, CardObservationSource.FIXTURE, null, "sample", "42").isComplete)
        assertFalse(CardActualComposition(weights.dropLast(1), CardObservationSource.RPC, "RPC", "2026-10-10T12:00:00Z", "42").isComplete)
        assertFalse(CardActualComposition(weights, CardObservationSource.RPC, "RPC", "2026-10-10T12:00:00Z", "01").isComplete)
        assertFalse(CardActualComposition(weights, CardObservationSource.RPC, "RPC", "2026-10-10T12:00:00Z", "18446744073709551616").isComplete)
        assertFalse(CardActualComposition(
            listOf(weights.first().copy(weightBps = 0), weights.last().copy(weightBps = 10_000)),
            CardObservationSource.RPC,
            "RPC",
            "2026-10-10T12:00:00Z",
            "42",
        ).isComplete)
    }

    @Test fun lateGenerationResultMustMatchRequestAndStrategyRevision() {
        val scene = sceneFixture()
        val sceneHash = StrategyRecords.validateScene(scene).id
        val result = GeneratedScene(scene, sceneHash, 7L, GenerationOrigin.MODEL, "request-1", "revision-1")

        assertTrue(CardCreationRecords.isCurrentGeneration(3, 3, "revision-1", "revision-1", result))
        assertFalse(CardCreationRecords.isCurrentGeneration(2, 3, "revision-1", "revision-1", result))
        assertFalse(CardCreationRecords.isCurrentGeneration(3, 3, "revision-1", "revision-2", result))
        assertFalse(CardCreationRecords.isCurrentGeneration(3, 3, "revision-2", "revision-2", result))
    }

    private fun sceneFixture(): JsonValue {
        val input = requireNotNull(javaClass.classLoader?.getResourceAsStream("strategy-identity-vectors.json"))
        val root = StrategyRecords.parse(input.bufferedReader().use { it.readText() }).asObject("vectors")
        return root.getValue("sceneVectors").asArray("sceneVectors").first().asObject("scene vector").getValue("scene")
    }

    private fun strategyRecord(): com.coloyond.strategy.ValidatedRecord = StrategyRecords.validateStrategy(
        StrategyRecords.parse(
            """{"schemaVersion":2,"kind":"managed-vault","network":"solana:mainnet-beta","protocol":"symmetry","programId":"BASKT7aKd8n7ibpUbwLP3Wiyxyi3yoiXsxBk4Hpumate","vaultAddress":"CBmmqkqszmEzHJqRx6ExKqq6TWLaDg3wpFcGhVm63HGW","shareMint":"69F1mz9iPdTJwPX8aUmx94HeiTncVuzRue3C8FU6u3bv","targetWeights":[{"mint":"So11111111111111111111111111111111111111112","weightBps":6000},{"mint":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v","weightBps":4000}],"configDigest":"1111111111111111111111111111111111111111111111111111111111111111","configProjectionVersion":1}""",
        ),
    )
}
