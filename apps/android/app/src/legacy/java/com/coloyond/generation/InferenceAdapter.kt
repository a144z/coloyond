package com.coloyond.generation

import com.coloyond.platform.InferenceCredentials
import com.coloyond.strategy.JsonValue
import com.coloyond.strategy.StrategyRecords
import com.coloyond.strategy.StrictJson
import com.coloyond.strategy.asArray
import com.coloyond.strategy.asLong
import com.coloyond.strategy.asObject
import com.coloyond.strategy.asString
import com.coloyond.strategy.exactKeys
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.security.SecureRandom
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** Target weights influence only coarse visual mass roles; asset identities and exact weights stay local. */
data class CompositionBrief(
    val targetWeightBps: List<Int>,
    val inheritedFeature: String? = null,
) {
    init {
        require(targetWeightBps.isNotEmpty() && targetWeightBps.size <= 100)
        require(targetWeightBps.all { it in 1..10_000 } && targetWeightBps.sum() == 10_000)
        require(inheritedFeature == null || inheritedFeature in setOf("diagonal", "opening", "overlap"))
    }

    internal fun providerFeatures(): List<String> {
        val sorted = targetWeightBps.sortedDescending()
        return sorted.map { weight ->
            when {
                weight >= 5_000 -> "dominant"
                weight >= 2_500 -> "substantial"
                else -> "subtle"
            }
        }
    }
}

/** Local request/revision binding. Neither value is serialized into provider requests. */
class GenerationContext private constructor(
    val requestId: String,
    val configurationRevision: String,
    val absoluteDeadlineNanos: Long,
    private val stillCurrent: () -> Boolean,
    private val nowNanos: () -> Long,
) {
    internal fun checkRevisionCurrent() {
        if (!stillCurrent()) throw CancellationException("Generation request was superseded")
    }

    internal fun checkCurrent() {
        checkRevisionCurrent()
        remainingTimeoutMillis()
    }

    internal fun remainingTimeoutMillis(): Int {
        val nanos = absoluteDeadlineNanos - nowNanos()
        if (nanos <= 0) throw GenerationDeadlineExceededException()
        return ((nanos + NANOS_PER_MILLI - 1) / NANOS_PER_MILLI).coerceAtMost(Int.MAX_VALUE.toLong()).toInt().coerceAtLeast(1)
    }

    companion object {
        fun scene(
            requestId: String,
            configurationRevision: String,
            stillCurrent: () -> Boolean = { true },
            nowNanos: () -> Long = System::nanoTime,
        ) = create(requestId, configurationRevision, SCENE_DEADLINE_MS, stillCurrent, nowNanos)

        fun captions(
            requestId: String,
            configurationRevision: String,
            stillCurrent: () -> Boolean = { true },
            nowNanos: () -> Long = System::nanoTime,
        ) = create(requestId, configurationRevision, CAPTION_DEADLINE_MS, stillCurrent, nowNanos)

        private fun create(
            requestId: String,
            configurationRevision: String,
            durationMs: Long,
            stillCurrent: () -> Boolean,
            nowNanos: () -> Long,
        ): GenerationContext {
            require(requestId.isNotBlank() && configurationRevision.isNotBlank())
            return GenerationContext(requestId, configurationRevision, nowNanos() + durationMs * NANOS_PER_MILLI, stillCurrent, nowNanos)
        }

        private const val SCENE_DEADLINE_MS = 45_000L
        private const val CAPTION_DEADLINE_MS = 15_000L
        private const val NANOS_PER_MILLI = 1_000_000L
    }
}

class GenerationDeadlineExceededException : IOException("Inference stage deadline exceeded")

enum class GenerationOrigin { MODEL, LOCAL_PREVIEW }

enum class GenerationUnavailableReason {
    NO_SESSION_CREDENTIAL,
    CREDENTIAL_REJECTED,
    MODEL_UNAVAILABLE,
    RATE_LIMITED,
    PROVIDER_UNAVAILABLE,
    INVALID_MODEL_OUTPUT,
    DEADLINE_EXCEEDED,
}

data class GeneratedScene(
    val value: JsonValue,
    val sceneHash: String,
    val seed: Long,
    val origin: GenerationOrigin,
    val requestId: String,
    val configurationRevision: String,
    val unavailableReason: GenerationUnavailableReason? = null,
)

data class InferenceHttpRequest(
    val url: String,
    val headers: Map<String, String>,
    val body: String,
    val timeoutMillis: Int,
    val absoluteDeadlineNanos: Long,
) {
    override fun toString(): String = "InferenceHttpRequest(url=$url, headers=[redacted], bodyBytes=${body.toByteArray(StandardCharsets.UTF_8).size}, timeoutMillis=$timeoutMillis)"
}

data class InferenceHttpResponse(val status: Int, val body: String)

fun interface InferenceTransport {
    suspend fun post(request: InferenceHttpRequest): InferenceHttpResponse
}

fun interface SceneSeedSource {
    /** Unsigned 32-bit value represented losslessly as a Long. */
    fun nextSeed(): Long
}

/** Anthropic Messages adapter. All provider calls are client-run and BYOK. */
class InferenceAdapter(
    private val transport: InferenceTransport = HttpInferenceTransport,
    private val seeds: SceneSeedSource = SecureSceneSeedSource,
) {
    suspend fun generateScene(
        brief: CompositionBrief,
        context: GenerationContext,
        credentials: InferenceCredentials?,
    ): GeneratedScene {
        currentCoroutineContext().ensureActive()
        context.checkRevisionCurrent()
        if (credentials == null) return localPreview(context, GenerationUnavailableReason.NO_SESSION_CREDENTIAL)

        var reason = GenerationUnavailableReason.INVALID_MODEL_OUTPUT
        repeat(MAX_ATTEMPTS) { attempt ->
            currentCoroutineContext().ensureActive()
            context.checkRevisionCurrent()
            try {
                val response = transport.post(sceneRequest(brief, context, credentials))
                currentCoroutineContext().ensureActive()
                context.checkCurrent()
                if (response.status !in 200..299) {
                    reason = reasonForStatus(response.status)
                    if (attempt == 0 && response.status in RETRYABLE_STATUS && context.remainingTimeoutMillis() > 100) return@repeat
                    return localPreview(context, reason)
                }
                val text = extractMessageText(response.body)
                val draft = parseAndValidateDraft(text)
                // The client creates a seed only after the provider draft has passed strict validation.
                val seed = seeds.nextSeed()
                require(seed in 0L..MAX_UINT32) { "Seed source returned an invalid value" }
                val finalScene = JsonValue.Obj(draft.fields + ("seed" to JsonValue.Num(seed.toString())))
                val validated = Scene.validate(finalScene)
                context.checkCurrent()
                currentCoroutineContext().ensureActive()
                return GeneratedScene(finalScene, validated.id, seed, GenerationOrigin.MODEL, context.requestId, context.configurationRevision)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: GenerationDeadlineExceededException) {
                reason = GenerationUnavailableReason.DEADLINE_EXCEEDED
                return localPreview(context, reason)
            } catch (_: Exception) {
                reason = if (context.remainingOrExpired() == null) GenerationUnavailableReason.DEADLINE_EXCEEDED
                    else GenerationUnavailableReason.INVALID_MODEL_OUTPUT
                if (attempt == 0 && context.remainingOrExpired() != null) return@repeat
                return localPreview(context, reason)
            }
        }
        return localPreview(context, reason)
    }

    suspend fun generateCaptions(
        observations: List<SceneObservation>,
        acceptedHistory: List<String>,
        context: GenerationContext,
        credentials: InferenceCredentials?,
        verifiedTickerSymbols: Set<String> = emptySet(),
    ): List<String> {
        currentCoroutineContext().ensureActive()
        context.checkCurrent()
        if (credentials == null) return emptyList()
        val boundedObservations = observations.take(MAX_OBSERVATIONS).filter(::isSafeObservation)
        if (boundedObservations.isEmpty()) return emptyList()
        var result: List<String> = emptyList()
        repeat(MAX_ATTEMPTS) { attempt ->
            currentCoroutineContext().ensureActive()
            context.checkCurrent()
            try {
                val response = transport.post(captionRequest(boundedObservations, acceptedHistory, context, credentials))
                currentCoroutineContext().ensureActive()
                context.checkCurrent()
                if (response.status !in 200..299) {
                    if (attempt == 0 && response.status in RETRYABLE_STATUS && context.remainingTimeoutMillis() > 100) return@repeat
                    return emptyList()
                }
                val text = extractMessageText(response.body)
                val json = StrategyRecords.parse(text)
                result = Captions.parseModelCandidates(json, acceptedHistory, verifiedTickerSymbols)
                context.checkCurrent()
                currentCoroutineContext().ensureActive()
                return result
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                if (attempt == 0 && context.remainingOrExpired() != null) return@repeat
                return emptyList()
            }
        }
        return result
    }

    private fun sceneRequest(brief: CompositionBrief, context: GenerationContext, credentials: InferenceCredentials): InferenceHttpRequest {
        val features = JsonValue.Obj(linkedMapOf(
            "assetCount" to JsonValue.Num(brief.targetWeightBps.size.toString()),
            "massRoles" to JsonValue.Arr(brief.providerFeatures().map(JsonValue::Str)),
            "inheritedFeature" to (brief.inheritedFeature?.let(JsonValue::Str) ?: JsonValue.Null),
        ))
        return request(
            system = SCENE_SYSTEM_PROMPT,
            user = "Compose an abstract card artwork from these visual-only features: ${StrictJson.canonical(features)}",
            maxTokens = 4096,
            credentials = credentials,
            timeoutMillis = context.remainingTimeoutMillis(),
            absoluteDeadlineNanos = context.absoluteDeadlineNanos,
        )
    }

    private fun captionRequest(
        observations: List<SceneObservation>,
        acceptedHistory: List<String>,
        context: GenerationContext,
        credentials: InferenceCredentials,
    ): InferenceHttpRequest {
        val facts = JsonValue.Arr(observations.map { observation ->
            JsonValue.Obj(linkedMapOf(
                "fact" to JsonValue.Str(observation.fact),
                "layerIndexes" to JsonValue.Arr(observation.layerIndexes.map { JsonValue.Num(it.toString()) }),
                "paletteTokens" to JsonValue.Arr(observation.paletteTokens.map { JsonValue.Str(it.label) }),
            ))
        })
        // Do not ship raw caption history: user-edited text may contain personal information.
        val recentMotifs = JsonValue.Arr(Captions.recentMotifStems(acceptedHistory).map(JsonValue::Str))
        val user = "Visible scene facts (derived locally from validated geometry): ${StrictJson.canonical(facts)}\n" +
            "Recent motif stems to avoid: ${StrictJson.canonical(recentMotifs)}"
        return request(CAPTION_SYSTEM_PROMPT, user, 256, credentials, context.remainingTimeoutMillis(), context.absoluteDeadlineNanos)
    }

    private fun isSafeObservation(observation: SceneObservation): Boolean = when (observation.kind) {
        ObservationKind.LAYER -> observation.layerIndexes.size == 1 && observation.layerIndexes.single() in 0..23 &&
            observation.layerType != null && observation.region != null && observation.paletteTokens.isNotEmpty() &&
            observation.paletteTokens.size <= 6 && observation.paletteTokens.distinct().size == observation.paletteTokens.size
        ObservationKind.BOUNDS_OVERLAP -> observation.layerIndexes.size == 2 &&
            observation.layerIndexes.all { it in 0..23 } && observation.layerIndexes[0] < observation.layerIndexes[1] &&
            observation.layerType == null && observation.region == null && observation.paletteTokens.isEmpty()
    }

    private fun request(
        system: String,
        user: String,
        maxTokens: Int,
        credentials: InferenceCredentials,
        timeoutMillis: Int,
        absoluteDeadlineNanos: Long,
    ): InferenceHttpRequest {
        val body = JsonValue.Obj(linkedMapOf(
            "model" to JsonValue.Str(MODEL),
            "max_tokens" to JsonValue.Num(maxTokens.toString()),
            "stream" to JsonValue.Bool(false),
            "system" to JsonValue.Str(system),
            "messages" to JsonValue.Arr(listOf(JsonValue.Obj(linkedMapOf(
                "role" to JsonValue.Str("user"),
                "content" to JsonValue.Str(user),
            )))),
        ))
        val headers = linkedMapOf(
            "content-type" to "application/json",
            "anthropic-version" to ANTHROPIC_VERSION,
            "accept" to "application/json",
        )
        credentials.addToHeaders(headers)
        return InferenceHttpRequest(ENDPOINT, headers.toMap(), StrictJson.canonical(body), timeoutMillis, absoluteDeadlineNanos)
    }

    private fun parseAndValidateDraft(text: String): JsonValue.Obj {
        require(text.toByteArray(StandardCharsets.UTF_8).size <= MAX_RAW_RESPONSE_BYTES) { "Model response exceeds raw output limit" }
        val value = StrategyRecords.parse(text)
        val fields = value.asObject("ModelSceneDraftV1")
        fields.exactKeys("schemaVersion", "rendererVersion", "canvasRatio", "background", "layers", "texture", "inheritedFeature")
        require(fields.getValue("schemaVersion").asLong("schemaVersion") == 1L)
        require(fields.getValue("rendererVersion").asLong("rendererVersion") == 1L) { "Unsupported renderer version for generation" }
        val canonical = StrictJson.canonical(value)
        require(canonical.toByteArray(StandardCharsets.UTF_8).size <= Scene.MAX_CANONICAL_BYTES) { "Model scene draft exceeds canonical size limit" }
        // Validate every frozen schema, geometry, palette, numeric, and payload bound by adding only a sentinel seed.
        Scene.validate(JsonValue.Obj(fields + ("seed" to JsonValue.Num("0"))))
        return value as JsonValue.Obj
    }

    private fun extractMessageText(body: String): String {
        require(body.toByteArray(StandardCharsets.UTF_8).size <= MAX_RAW_RESPONSE_BYTES) { "Provider response exceeds raw output limit" }
        val root = StrategyRecords.parse(body).asObject("Anthropic response")
        val stopReason = root["stop_reason"]?.asString("stop_reason")
        require(stopReason == "end_turn" || stopReason == "stop_sequence") { "Provider response was not a complete text turn" }
        val blocks = root["content"]?.asArray("content") ?: throw IllegalArgumentException("Provider response has no content")
        require(blocks.isNotEmpty()) { "Provider response content is empty" }
        val text = StringBuilder()
        blocks.forEach { blockValue ->
            val block = blockValue.asObject("content block")
            require(block["type"]?.asString("content.type") == "text") { "Unexpected non-text provider output" }
            val segment = block["text"]?.asString("content.text") ?: throw IllegalArgumentException("Provider text block is incomplete")
            text.append(segment)
            require(text.toString().toByteArray(StandardCharsets.UTF_8).size <= MAX_RAW_RESPONSE_BYTES) { "Model response exceeds raw output limit" }
        }
        return text.toString()
    }

    private fun localPreview(context: GenerationContext, reason: GenerationUnavailableReason): GeneratedScene {
        context.checkRevisionCurrent()
        val seed = seeds.nextSeed()
        require(seed in 0L..MAX_UINT32)
        val shiftX = (seed % 121).toInt() - 60
        val shiftY = ((seed ushr 8) % 101).toInt() - 50
        val scene = JsonValue.Obj(linkedMapOf(
            "schemaVersion" to JsonValue.Num("1"),
            "rendererVersion" to JsonValue.Num("1"),
            "canvasRatio" to JsonValue.Str("1:1"),
            "background" to JsonValue.Str("paper"),
            "seed" to JsonValue.Num(seed.toString()),
            "layers" to JsonValue.Arr(listOf(
                layerPolygon(listOf(listOf(125 + shiftX, 150 + shiftY), listOf(670 + shiftX, 275 + shiftY), listOf(420 + shiftX, 790 + shiftY)), "cobalt"),
                layerEllipse(690 - shiftX / 2, 420 + shiftY / 2, 210, 240, "yellow"),
                layerRing(520, 620, 255, 34, "ink"),
            )),
            "texture" to JsonValue.Obj(mapOf("grainIntensity" to JsonValue.Num((seed % 31).toString()))),
            "inheritedFeature" to JsonValue.Null,
        ))
        val validated = Scene.validate(scene)
        context.checkRevisionCurrent()
        return GeneratedScene(scene, validated.id, seed, GenerationOrigin.LOCAL_PREVIEW, context.requestId, context.configurationRevision, reason)
    }

    private fun layerPolygon(points: List<List<Int>>, color: String) = JsonValue.Obj(linkedMapOf(
        "type" to JsonValue.Str("polygon"),
        "points" to JsonValue.Arr(points.map { point -> JsonValue.Arr(point.map { JsonValue.Num(it.toString()) }) }),
        "fill" to solid(color),
        "opacity" to JsonValue.Num("1000"),
    ))

    private fun layerEllipse(cx: Int, cy: Int, rx: Int, ry: Int, color: String) = JsonValue.Obj(linkedMapOf(
        "type" to JsonValue.Str("ellipse"), "cx" to JsonValue.Num(cx.toString()), "cy" to JsonValue.Num(cy.toString()),
        "rx" to JsonValue.Num(rx.toString()), "ry" to JsonValue.Num(ry.toString()), "fill" to solid(color), "opacity" to JsonValue.Num("860"),
    ))

    private fun layerRing(cx: Int, cy: Int, radius: Int, strokeWidth: Int, color: String) = JsonValue.Obj(linkedMapOf(
        "type" to JsonValue.Str("ring"), "cx" to JsonValue.Num(cx.toString()), "cy" to JsonValue.Num(cy.toString()),
        "radius" to JsonValue.Num(radius.toString()), "strokeWidth" to JsonValue.Num(strokeWidth.toString()), "fill" to solid(color), "opacity" to JsonValue.Num("900"),
    ))

    private fun solid(color: String) = JsonValue.Obj(mapOf("type" to JsonValue.Str("solid"), "color" to JsonValue.Str(color)))

    private fun reasonForStatus(status: Int) = when (status) {
        401, 403 -> GenerationUnavailableReason.CREDENTIAL_REJECTED
        404 -> GenerationUnavailableReason.MODEL_UNAVAILABLE
        429 -> GenerationUnavailableReason.RATE_LIMITED
        in 500..599 -> GenerationUnavailableReason.PROVIDER_UNAVAILABLE
        else -> GenerationUnavailableReason.PROVIDER_UNAVAILABLE
    }

    private fun GenerationContext.remainingOrExpired(): Int? = runCatching { remainingTimeoutMillis() }.getOrNull()

    companion object {
        const val ENDPOINT = "https://api.anthropic.com/v1/messages"
        const val MODEL = "claude-opus-5"
        const val ANTHROPIC_VERSION = "2023-06-01"
        const val MAX_RAW_RESPONSE_BYTES = 64 * 1024
        private const val MAX_UINT32 = 4_294_967_295L
        private const val MAX_ATTEMPTS = 2
        private const val MAX_OBSERVATIONS = 4
        private val RETRYABLE_STATUS = setOf(429, 500, 502, 503, 504)
        private val SCENE_SYSTEM_PROMPT = """
            Return only one JSON object matching ModelSceneDraftV1. It has exactly these keys: schemaVersion, rendererVersion, canvasRatio, background, layers, texture, inheritedFeature. The client adds seed after validating your output; never return seed or other fields. Use schemaVersion 1, rendererVersion 1, canvasRatio 1:1, a background palette token, and 1–24 abstract geometric layers. Use only polygon, beam, ellipse, or ring geometry and the palette tokens paper, ink, cobalt, violet, yellow, coral. Use integers on the supplied 0–1000 grid, valid geometry, and bounded fills. Return no markdown, commentary, tools, HTML, SVG, URLs, financial advice, or claims. Compose open-ended abstract art with cream paper, black geometry, saturated color, grain, and generous negative space. Treat mass roles only as soft visual guidance; do not portray data, performance, safety, or financial meaning.
        """.trimIndent()
        private val CAPTION_SYSTEM_PROMPT = """
            Return only one JSON object with exactly one key, candidates, containing zero to three short strings. Each caption should be 2–8 words when possible and never exceed 12 Unicode-whitespace-delimited words or 80 Unicode code points. Vary rhythm and emotional distance, and let a visible detail inspire interpretation. Do not state financial facts, advice, performance, strategy names, calls to action, URLs, or explanations of symbolism. Return an empty array if nothing fits. Never invent visual facts beyond the supplied observations.
        """.trimIndent()
    }
}

/** Abortable, response-size-bounded HTTP transport with a watchdog for the full request deadline. */
private object HttpInferenceTransport : InferenceTransport {
    override suspend fun post(request: InferenceHttpRequest): InferenceHttpResponse = suspendCancellableCoroutine { continuation ->
        val connectionRef = AtomicReference<HttpURLConnection?>()
        val watchdogRef = AtomicReference<java.util.concurrent.ScheduledFuture<*>?>()
        continuation.invokeOnCancellation {
            watchdogRef.get()?.cancel(false)
            connectionRef.get()?.disconnect()
        }
        DeadlineThreads.io.execute {
            var connection: HttpURLConnection? = null
            try {
                if (!continuation.isActive) return@execute
                val nanosRemaining = request.absoluteDeadlineNanos - System.nanoTime()
                if (nanosRemaining <= 0) throw GenerationDeadlineExceededException()
                val timeout = ((nanosRemaining + 999_999L) / 1_000_000L).coerceAtMost(Int.MAX_VALUE.toLong()).toInt().coerceAtLeast(1)
                connection = URL(request.url).openConnection() as HttpURLConnection
                connectionRef.set(connection)
                if (!continuation.isActive) { connection.disconnect(); return@execute }
                if (System.nanoTime() >= request.absoluteDeadlineNanos) throw GenerationDeadlineExceededException()
                watchdogRef.set(DeadlineThreads.scheduler.schedule(
                    { connectionRef.get()?.disconnect() },
                    timeout.toLong(),
                    TimeUnit.MILLISECONDS,
                ))
                connection.requestMethod = "POST"
                connection.instanceFollowRedirects = false
                connection.connectTimeout = minOf(timeout, request.timeoutMillis)
                connection.readTimeout = minOf(timeout, request.timeoutMillis)
                connection.doOutput = true
                request.headers.forEach(connection::setRequestProperty)
                val bodyBytes = request.body.toByteArray(StandardCharsets.UTF_8)
                connection.setFixedLengthStreamingMode(bodyBytes.size)
                connection.outputStream.use { it.write(bodyBytes) }
                val status = connection.responseCode
                val stream = if (status in 200..299) connection.inputStream else connection.errorStream
                    ?: throw IOException("Inference provider returned HTTP $status")
                val body = stream.use { readBounded(it, request.absoluteDeadlineNanos) }
                if (continuation.isActive) continuation.resume(InferenceHttpResponse(status, body))
            } catch (failure: Exception) {
                if (continuation.isActive) continuation.resumeWithException(failure)
            } finally {
                watchdogRef.get()?.cancel(false)
                connection?.disconnect()
                connectionRef.set(null)
            }
        }
    }

    private fun readBounded(input: java.io.InputStream, deadlineNanos: Long): String {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(8 * 1024)
        while (true) {
            if (System.nanoTime() >= deadlineNanos) throw GenerationDeadlineExceededException()
            val read = input.read(buffer)
            if (read < 0) break
            if (output.size() + read > InferenceAdapter.MAX_RAW_RESPONSE_BYTES) throw IOException("Inference response exceeded size limit")
            output.write(buffer, 0, read)
        }
        return output.toString(StandardCharsets.UTF_8.name())
    }
}

private object DeadlineThreads {
    val io: ExecutorService = Executors.newFixedThreadPool(2) { runnable ->
        Thread(runnable, "coloyond-inference").apply { isDaemon = true }
    }
    val scheduler: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor { runnable ->
        Thread(runnable, "coloyond-inference-deadline").apply { isDaemon = true }
    }
}

private object SecureSceneSeedSource : SceneSeedSource {
    private val random = SecureRandom()
    override fun nextSeed(): Long = random.nextInt().toLong() and 0xffff_ffffL
}
