package com.coloyond.generation

import com.coloyond.platform.InferenceCredentials
import com.coloyond.strategy.JsonValue
import com.coloyond.strategy.asLong
import com.coloyond.strategy.asObject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.suspendCancellableCoroutine

class InferenceAdapterTest {
    @Test fun sceneRequestUsesOnlyCoarseCreativeFeaturesAndSeedsValidatedDraftOnClient() = runBlocking {
        val provider = FakeTransport(listOf(response(draft())))
        val seed = CountingSeeds(42L)
        val adapter = InferenceAdapter(provider, seed)
        val requestId = "local-request-identifier"
        val revision = "local-configuration-revision"
        val result = adapter.generateScene(
            CompositionBrief(listOf(7_000, 3_000), "opening"),
            GenerationContext.scene(requestId, revision),
            InferenceCredentials.fromUserInput("sk-ant-test-secret"),
        )
        assertEquals(GenerationOrigin.MODEL, result.origin)
        assertEquals(42L, result.seed)
        assertEquals(requestId, result.requestId)
        assertEquals(revision, result.configurationRevision)
        assertEquals(1, seed.calls)
        assertEquals(result.sceneHash, Scene.validate(result.value).id)
        val request = provider.requests.single()
        assertEquals(InferenceAdapter.ENDPOINT, request.url)
        assertTrue(request.body.contains("\"model\":\"claude-opus-5\""))
        assertEquals("sk-ant-test-secret", request.headers["x-api-key"])
        assertTrue(request.body.contains("dominant"))
        assertTrue(request.body.contains("substantial"))
        listOf("7000", "3000", "SOL-MINT-SECRET", "wallet-address", requestId, revision, "sk-ant-test-secret")
            .forEach { assertFalse(request.body.contains(it)) }
        assertFalse(request.url.contains("sk-ant-test-secret"))
        assertFalse(request.toString().contains("sk-ant-test-secret"))
    }

    @Test fun draftSeedIsForbiddenAndMalformedDraftRetriesWithinTheSameDeadline() = runBlocking {
        var now = 1_000_000_000L
        val provider = FakeTransport(listOf(response(draftWithSeed()), response(draft()))) {
            if (it == 0) now += 44_500_000_000L
        }
        val seed = CountingSeeds(10L)
        val result = InferenceAdapter(provider, seed).generateScene(
            CompositionBrief(listOf(5_000, 5_000)),
            GenerationContext.scene("request", "revision", nowNanos = { now }),
            InferenceCredentials.fromUserInput("session"),
        )
        assertEquals(GenerationOrigin.MODEL, result.origin)
        assertEquals(2, provider.requests.size)
        assertTrue(provider.requests[1].timeoutMillis < provider.requests[0].timeoutMillis)
        assertEquals(10L, result.seed)
        assertEquals(1, seed.calls)
    }

    @Test fun invalidDraftIsRetriedOnceThenReturnsLabeledValidatedLocalPreview() = runBlocking {
        val provider = FakeTransport(listOf(response(draftWithSeed()), response(draftWithSeed())))
        val seeds = CountingSeeds(10L, 55L)
        val result = InferenceAdapter(provider, seeds).generateScene(
            CompositionBrief(listOf(6_000, 4_000)),
            GenerationContext.scene("request-local", "revision-local"),
            InferenceCredentials.fromUserInput("session"),
        )
        assertEquals(GenerationOrigin.LOCAL_PREVIEW, result.origin)
        assertEquals(GenerationUnavailableReason.INVALID_MODEL_OUTPUT, result.unavailableReason)
        assertEquals(2, provider.requests.size)
        assertEquals(10L, result.seed) // The invalid drafts did not consume a seed; only the preview needs one.
        assertEquals(1, seeds.calls)
        assertEquals(result.sceneHash, Scene.validate(result.value).id)
    }

    @Test fun absentCredentialsNeverCallProviderAndKeepPreviewOriginExplicit() = runBlocking {
        val provider = FakeTransport(emptyList())
        val result = InferenceAdapter(provider, CountingSeeds(9L)).generateScene(
            CompositionBrief(listOf(5_000, 5_000)), GenerationContext.scene("r", "c"), null,
        )
        assertEquals(GenerationOrigin.LOCAL_PREVIEW, result.origin)
        assertEquals(GenerationUnavailableReason.NO_SESSION_CREDENTIAL, result.unavailableReason)
        assertTrue(provider.requests.isEmpty())
        assertEquals(9L, result.seed)
    }

    @Test fun cancellationAndSupersededRevisionDiscardResultsInsteadOfPreviewing() = runBlocking {
        val called = AtomicBoolean(false)
        val transport = InferenceTransport { request ->
            called.set(true)
            throw CancellationException("test cancellation")
        }
        val credential = InferenceCredentials.fromUserInput("session")
        assertTrue(runCatching {
            runBlocking {
                InferenceAdapter(transport, CountingSeeds(2L)).generateScene(
                    CompositionBrief(listOf(5_000, 5_000)), GenerationContext.scene("r", "c", stillCurrent = { false }), credential,
                )
            }
        }.exceptionOrNull() is CancellationException)
        assertFalse(called.get())
    }

    @Test fun cancelingDuringProviderWaitCancelsTheInFlightCall() = runBlocking {
        val providerCanceled = AtomicBoolean(false)
        val transport = InferenceTransport {
            suspendCancellableCoroutine<InferenceHttpResponse> { continuation ->
                continuation.invokeOnCancellation { providerCanceled.set(true) }
            }
        }
        val job = launch {
            InferenceAdapter(transport, CountingSeeds(8L)).generateScene(
                CompositionBrief(listOf(5_000, 5_000)),
                GenerationContext.scene("local-request", "local-revision"),
                InferenceCredentials.fromUserInput("session"),
            )
        }
        yield()
        job.cancelAndJoin()
        assertTrue(providerCanceled.get())
    }

    @Test fun revisionChangeAfterNetworkResponseDiscardsLateScene() = runBlocking {
        val isCurrent = AtomicBoolean(true)
        val transport = InferenceTransport {
            isCurrent.set(false)
            response(draft())
        }
        val failure = runCatching {
            InferenceAdapter(transport, CountingSeeds(4L)).generateScene(
                CompositionBrief(listOf(5_000, 5_000)),
                GenerationContext.scene("local-request", "revision-1", stillCurrent = isCurrent::get),
                InferenceCredentials.fromUserInput("session"),
            )
        }.exceptionOrNull()
        assertTrue(failure is CancellationException)
    }

    @Test fun captionRequestSendsOnlyDerivedFactsAndFixedMotifsNotRawUserHistory() = runBlocking {
        val provider = FakeTransport(listOf(response("""{"candidates":["A quiet opening","Held, lightly"]}""")))
        val history = listOf("private note Alice 123 Main Street")
        val observations = listOf(SceneObservation(
            ObservationKind.LAYER, listOf(0), ObservedLayerType.POLYGON, ObservedRegion.UPPER_LEFT, listOf(ObservedPaletteToken.COBALT),
        ))
        val result = InferenceAdapter(provider, CountingSeeds()).generateCaptions(
            observations, history, GenerationContext.captions("r", "c"), InferenceCredentials.fromUserInput("session"),
        )
        assertEquals(listOf("A quiet opening", "Held, lightly"), result)
        val body = provider.requests.single().body
        assertTrue(body.contains("upper-left"))
        assertFalse(body.contains("Alice"))
        assertFalse(body.contains("123 Main Street"))
        assertFalse(body.contains("private note"))
        assertFalse(body.contains("session"))
        assertEquals(256, body.toIntField("max_tokens"))
    }

    @Test fun captionUnavailableOrMalformedOutputLeavesCaptionBlank() = runBlocking {
        val provider = FakeTransport(listOf(InferenceHttpResponse(401, "")))
        assertTrue(InferenceAdapter(provider).generateCaptions(
            emptyList(), emptyList(), GenerationContext.captions("r", "c"), InferenceCredentials.fromUserInput("session"),
        ).isEmpty())
    }

    @Test fun deadlineIsAbsoluteAcrossRetryAndCaptionStageHasShorterBudget() {
        var now = 5_000_000L
        val scene = GenerationContext.scene("r", "c", nowNanos = { now })
        val caption = GenerationContext.captions("r", "c", nowNanos = { now })
        assertEquals(45_000, scene.remainingTimeoutMillis())
        assertEquals(15_000, caption.remainingTimeoutMillis())
        now += 44_500_000_000L
        assertEquals(500, scene.remainingTimeoutMillis())
    }

    private fun response(text: String): InferenceHttpResponse = InferenceHttpResponse(
        200,
        """{"stop_reason":"end_turn","content":[{"type":"text","text":${jsonString(text)}}]}""",
    )

    private fun jsonString(value: String): String = com.coloyond.strategy.StrictJson.canonical(JsonValue.Str(value))

    private fun draft() = """{"schemaVersion":1,"rendererVersion":1,"canvasRatio":"1:1","background":"paper","layers":[{"type":"polygon","points":[[100,100],[600,100],[300,700]],"fill":{"type":"solid","color":"cobalt"},"opacity":1000}],"texture":{"grainIntensity":12},"inheritedFeature":null}"""
    private fun draftWithSeed() = draft().replace("\"layers\"", "\"seed\":9,\"layers\"")

    private class CountingSeeds(vararg private val values: Long) : SceneSeedSource {
        var calls = 0
        override fun nextSeed(): Long = values[calls++].also { if (calls > values.size) error("No seed fixture") }
    }

    private class FakeTransport(
        private val responses: List<InferenceHttpResponse>,
        private val afterCall: (Int) -> Unit = {},
    ) : InferenceTransport {
        val requests = mutableListOf<InferenceHttpRequest>()
        override suspend fun post(request: InferenceHttpRequest): InferenceHttpResponse {
            val call = requests.size
            requests += request
            afterCall(call)
            return responses.getOrElse(call) { error("Unexpected provider request") }
        }
    }
}

private fun String.toIntField(name: String): Int {
    val parsed = com.coloyond.strategy.StrategyRecords.parse(this).asObject("request")
    return parsed.getValue(name).asLong(name).toInt()
}
