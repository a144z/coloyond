package com.coloyond.strategy

import java.security.MessageDigest

data class ValidatedRecord(val value: JsonValue, val canonicalJson: String, val id: String, val viewOnly: Boolean)

/** Immutable, version-separated strategy/expression/export identity contracts. */
object StrategyRecords {
    const val MAX_IMPORT_BYTES = 256 * 1024
    const val MAX_CAPTION_CODE_POINTS = 80

    private const val CB1 = "coloyond/Strategy/v1\u0000"
    private const val DRAFT1 = "coloyond/Draft/v1\u0000"
    private const val SYMMETRY2 = "coloyond/Strategy/v2\u0000"
    private const val COLOYOND3 = "coloyond/ColoyondManagedStrategy/v1\u0000"
    private const val EXPRESSION1 = "coloyond/Expression/v1\u0000"
    private const val EXPRESSION2 = "coloyond/ColoyondExpression/v2\u0000"

    fun parse(source: String): JsonValue = StrictJson.parse(source, MAX_IMPORT_BYTES)

    fun validateStrategy(value: JsonValue): ValidatedRecord {
        val initialFields = value.asObject("strategy")
        val normalizedValue = when {
            initialFields["allocations"] != null -> sortedArray(value, "allocations", "outputMint")
            initialFields["targetWeights"] != null -> sortedArray(value, "targetWeights", "mint")
            initialFields["tokens"] != null -> sortedArrayByPubkey(value, "tokens", "mint")
            else -> value
        }
        val fields = normalizedValue.asObject("strategy")
        val kind = fields["kind"]?.asString("kind")
        return when {
            kind == "allocation-draft" -> validateDraft(normalizedValue, fields)
            kind == "managed-vault" && fields["schemaVersion"]?.asLong("schemaVersion") == 2L -> validateManagedV2(normalizedValue, fields)
            fields["schema"]?.asString("schema") == "coloyond/ColoyondManagedStrategy/v1" -> validateColoyondV1(normalizedValue, fields)
            fields["schemaVersion"]?.asLong("schemaVersion") == 1L && fields.containsKey("allocations") -> validateLegacyV1(normalizedValue, fields)
            else -> throw StrictJsonException("Unknown strategy schema")
        }
    }

    private fun validateLegacyV1(value: JsonValue, f: Map<String, JsonValue>): ValidatedRecord {
        f.exactKeys("schemaVersion", "network", "inputMint", "allocations", "policy", "adapterPolicyVersion")
        require(f.field("schemaVersion").asLong("schemaVersion") == 1L)
        require(f.field("network").asString("network") == "solana:mainnet-beta")
        requireCanonicalPubkey(f.field("inputMint").asString("inputMint"))
        require(f.field("adapterPolicyVersion").asLong("adapterPolicyVersion") == 1L)
        val policy = f.field("policy").asObject("policy")
        policy.exactKeys("maxSlippageBps", "maxPriceImpactBps", "maxPriorityFeeLamports")
        require(policy.getValue("maxSlippageBps").asLong("maxSlippageBps") in 0L..10_000L)
        require(policy.getValue("maxPriceImpactBps").asLong("maxPriceImpactBps") in 0L..10_000L)
        require(policy.getValue("maxPriorityFeeLamports").asString("maxPriorityFeeLamports").matches(Regex("0|[1-9][0-9]*")))
        val allocations = f.field("allocations").asArray("allocations")
        require(allocations.isNotEmpty())
        val seen = mutableSetOf<String>()
        allocations.forEach {
            val a = it.asObject("allocation")
            a.exactKeys("outputMint", "weightBps")
            val mint = a.getValue("outputMint").asString("outputMint")
            requireCanonicalPubkey(mint)
            require(seen.add(mint)) { "Duplicate allocation mint" }
            require(a.getValue("weightBps").asLong("weightBps") in 1L..10_000L)
        }
        require(allocations.sumOf { it.asObject("allocation").getValue("weightBps").asLong("weightBps") } == 10_000L)
        // cb1 is retained as a historical recipe and always inspect-only.
        return record(value, CB1, "cb1:", true)
    }

    private fun validateDraft(value: JsonValue, f: Map<String, JsonValue>): ValidatedRecord {
        f.exactKeys("schemaVersion", "kind", "network", "targetWeights")
        require(f.field("schemaVersion").asLong("schemaVersion") == 1L)
        require(f.field("kind").asString("kind") == "allocation-draft")
        require(f.field("network").asString("network") == "solana:mainnet-beta")
        validateTargetWeights(f.field("targetWeights"), "mint")
        return record(value, DRAFT1, "cbd1:", true)
    }

    private fun validateManagedV2(value: JsonValue, f: Map<String, JsonValue>): ValidatedRecord {
        f.exactKeys("schemaVersion", "kind", "network", "protocol", "programId", "vaultAddress", "shareMint", "targetWeights", "configDigest", "configProjectionVersion")
        require(f.field("schemaVersion").asLong("schemaVersion") == 2L)
        require(f.field("kind").asString("kind") == "managed-vault")
        require(f.field("network").asString("network") == "solana:mainnet-beta")
        require(f.field("protocol").asString("protocol") == "symmetry")
        listOf("programId", "vaultAddress", "shareMint").forEach { requireCanonicalPubkey(f.field(it).asString(it)) }
        val share = f.field("shareMint").asString("shareMint")
        validateTargetWeights(f.field("targetWeights"), "mint", forbidden = setOf(share))
        require(f.field("configDigest").asString("configDigest").matches(HEX_32))
        val projection = f.field("configProjectionVersion").asLong("configProjectionVersion")
        require(projection > 0)
        return record(value, SYMMETRY2, "cb2:", projection != 1L)
    }

    private fun validateColoyondV1(value: JsonValue, f: Map<String, JsonValue>): ValidatedRecord {
        f.exactKeys("schema", "cluster", "genesisHash", "programId", "vaultAddress", "shareMint", "configurationRevision", "tokens", "policyDigest", "sourceManifestRevision")
        require(f.field("schema").asString("schema") == "coloyond/ColoyondManagedStrategy/v1")
        require(f.field("cluster").asString("cluster") in setOf("mainnet-beta", "devnet", "localnet"))
        require(f.field("genesisHash").asString("genesisHash").matches(HEX_32))
        listOf("programId", "vaultAddress", "shareMint").forEach { requireCanonicalPubkey(f.field(it).asString(it)) }
        val revision = f.field("configurationRevision").asString("configurationRevision")
        requireCanonicalU64(revision, "configurationRevision")
        require(revision != "0")
        require(f.field("policyDigest").asString("policyDigest").matches(HEX_32))
        require(f.field("sourceManifestRevision").asString("sourceManifestRevision") == "1")
        val share = f.field("shareMint").asString("shareMint")
        val tokens = f.field("tokens").asArray("tokens")
        require(tokens.size == 2)
        val mints = mutableSetOf<String>()
        var sum = 0L
        var previous: ByteArray? = null
        tokens.forEach { tokenValue ->
            val t = tokenValue.asObject("token")
            t.exactKeys("mint", "tokenProgram", "decimals", "targetBps")
            val mint = t.getValue("mint").asString("mint")
            val tokenProgram = t.getValue("tokenProgram").asString("tokenProgram")
            requireCanonicalPubkey(mint); requireCanonicalPubkey(tokenProgram)
            require(mint != share && mints.add(mint)) { "Duplicate or share mint in target tokens" }
            // The frozen record carries tokens ordered by decoded unsigned mint bytes.
            val mintBytes = decodeCanonicalPubkey(mint)
            require(previous == null || compareBytes(previous!!, mintBytes) < 0) { "Tokens must be sorted by raw mint pubkey bytes" }
            previous = mintBytes
            require(t.getValue("decimals").asLong("decimals") in 0L..18L)
            val bps = t.getValue("targetBps").asLong("targetBps")
            require(bps in 1L..10_000L); sum += bps
        }
        require(sum == 10_000L)
        return record(value, COLOYOND3, "cb3:", false)
    }

    fun validateScene(value: JsonValue): ValidatedRecord {
        val fields = value.asObject("scene")
        fields.exactKeys("schemaVersion", "rendererVersion", "canvasRatio", "background", "seed", "layers", "texture", "inheritedFeature")
        require(fields.getValue("schemaVersion").asLong("schemaVersion") == 1L)
        val renderer = fields.getValue("rendererVersion").asLong("rendererVersion")
        require(renderer > 0)
        require(fields.getValue("canvasRatio").asString("canvasRatio") == "1:1")
        require(fields.getValue("background").asString("background") in PALETTE)
        require(fields.getValue("seed").asLong("seed") in 0..4_294_967_295L)
        val feature = fields.getValue("inheritedFeature")
        require(feature == JsonValue.Null || feature.asString("inheritedFeature") in setOf("diagonal", "opening", "overlap"))
        val texture = fields.getValue("texture").asObject("texture")
        texture.exactKeys("grainIntensity")
        require(texture.getValue("grainIntensity").asLong("grainIntensity") in 0L..100L)
        val layers = fields.getValue("layers").asArray("layers")
        require(layers.size in 1..24)
        layers.forEach(::validateLayer)
        val canonical = StrictJson.canonical(value)
        require(canonical.toByteArray(Charsets.UTF_8).size <= 32 * 1024) { "Scene exceeds 32 KiB" }
        val id = digest("coloyond/Scene/v1\u0000", canonical)
        return ValidatedRecord(value, canonical, id, renderer != 1L)
    }

    private fun validateLayer(value: JsonValue) {
        val f = value.asObject("layer")
        val type = f.field("type").asString("layer.type")
        val geometry = when (type) {
            "polygon" -> setOf("points")
            "beam" -> setOf("points")
            "ellipse" -> setOf("cx", "cy", "rx", "ry")
            "ring" -> setOf("cx", "cy", "radius", "strokeWidth")
            else -> throw StrictJsonException("Unsupported layer type")
        }
        f.exactKeys(*(setOf("type", "fill", "opacity") + geometry).toTypedArray())
        require(f.getValue("opacity").asLong("opacity") in 0L..1000L)
        validateFill(f.getValue("fill"))
        when (type) {
            "polygon", "beam" -> validatePoints(f.getValue("points"), if (type == "polygon") 3..12 else 3..4)
            "ellipse" -> {
                coordinate(f, "cx"); coordinate(f, "cy")
                require(f.getValue("rx").asLong("rx") in 1L..500L && f.getValue("ry").asLong("ry") in 1L..500L)
            }
            "ring" -> {
                coordinate(f, "cx"); coordinate(f, "cy")
                val r = f.getValue("radius").asLong("radius")
                val stroke = f.getValue("strokeWidth").asLong("strokeWidth")
                require(r in 1L..500L && stroke in 1L..125L && stroke < 2 * r)
            }
        }
    }

    private fun validateFill(value: JsonValue) {
        val f = value.asObject("fill")
        when (f.field("type").asString("fill.type")) {
            "solid" -> {
                f.exactKeys("type", "color")
                require(f.getValue("color").asString("color") in PALETTE)
            }
            "linear" -> {
                f.exactKeys("type", "from", "to", "stops")
                val from = point(f.getValue("from")); val to = point(f.getValue("to"))
                require(from != to) { "Gradient endpoints must differ" }
                val stops = f.getValue("stops").asArray("stops")
                require(stops.size in 2..4)
                var prior = -1L
                stops.forEach { stopValue ->
                    val stop = stopValue.asObject("gradient stop")
                    stop.exactKeys("at", "color")
                    val at = stop.getValue("at").asLong("at")
                    require(at in 0L..1000L && at > prior); prior = at
                    require(stop.getValue("color").asString("color") in PALETTE)
                }
                require(stops.first().asObject("stop").getValue("at").asLong("at") == 0L)
                require(stops.last().asObject("stop").getValue("at").asLong("at") == 1000L)
            }
            else -> throw StrictJsonException("Unsupported fill type")
        }
    }

    private fun validatePoints(value: JsonValue, size: IntRange) {
        val points = value.asArray("points").map(::point)
        require(points.size in size)
        require(points.toSet().size == points.size) { "Vertices must be distinct" }
        var area = 0L
        points.indices.forEach { i ->
            val a = points[i]; val b = points[(i + 1) % points.size]
            area += a.first.toLong() * b.second - b.first.toLong() * a.second
        }
        require(area != 0L) { "Polygon/beam area must be nonzero" }
        for (i in points.indices) for (j in i + 1 until points.size) {
            if (j == i + 1 || (i == 0 && j == points.lastIndex)) continue
            require(!segmentsIntersect(points[i], points[(i + 1) % points.size], points[j], points[(j + 1) % points.size])) {
                "Nonadjacent polygon/beam edges intersect"
            }
        }
    }

    private fun point(value: JsonValue): Pair<Int, Int> {
        val a = value.asArray("point")
        require(a.size == 2)
        val x = a[0].asLong("x"); val y = a[1].asLong("y")
        require(x in 0L..1000L && y in 0L..1000L)
        return x.toInt() to y.toInt()
    }

    private fun coordinate(f: Map<String, JsonValue>, key: String) { require(f.getValue(key).asLong(key) in 0L..1000L) }

    private fun segmentsIntersect(a: Pair<Int, Int>, b: Pair<Int, Int>, c: Pair<Int, Int>, d: Pair<Int, Int>): Boolean {
        fun orient(p: Pair<Int, Int>, q: Pair<Int, Int>, r: Pair<Int, Int>): Long =
            (q.first - p.first).toLong() * (r.second - p.second) - (q.second - p.second).toLong() * (r.first - p.first)
        fun on(p: Pair<Int, Int>, q: Pair<Int, Int>, r: Pair<Int, Int>) =
            q.first in minOf(p.first, r.first)..maxOf(p.first, r.first) && q.second in minOf(p.second, r.second)..maxOf(p.second, r.second)
        val o1 = orient(a, b, c); val o2 = orient(a, b, d); val o3 = orient(c, d, a); val o4 = orient(c, d, b)
        return (o1 == 0L && on(a, c, b)) || (o2 == 0L && on(a, d, b)) || (o3 == 0L && on(c, a, d)) || (o4 == 0L && on(c, b, d)) ||
            (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0)))
    }

    fun validateExpression(value: JsonValue, coloyond: Boolean = false): ValidatedRecord {
        val f = value.asObject("expression")
        val version = f.field("schemaVersion").asLong("schemaVersion")
        val expected = if (coloyond) 2L else 1L
        require(version == expected)
        f.exactKeys("schemaVersion", "strategyId", "scene", "sceneHash", "rendererVersion", "layoutVersion", "caption", "captionOrigin", "generationOrigin", "parentExpressionId")
        val strategyId = f.getValue("strategyId").asString("strategyId")
        requireId(strategyId, if (coloyond) setOf("cb3:") else setOf("cb1:", "cbd1:", "cb2:"))
        val sceneRecord = validateScene(f.getValue("scene"))
        require(f.getValue("sceneHash").asString("sceneHash") == sceneRecord.id)
        val renderer = f.getValue("rendererVersion").asLong("rendererVersion")
        val layout = f.getValue("layoutVersion").asLong("layoutVersion")
        require(renderer > 0 && layout > 0)
        require(renderer == f.getValue("scene").asObject("scene").getValue("rendererVersion").asLong("scene.rendererVersion"))
        if (coloyond) require(renderer == 1L && layout == 1L && !sceneRecord.viewOnly) {
            "Unsupported renderer/layout version for cbe2"
        }
        val caption = f.getValue("caption")
        val origin = f.getValue("captionOrigin").asString("captionOrigin")
        if (caption == JsonValue.Null) require(origin == "none") else {
            require(origin == "model" || origin == "user")
            val text = caption.asString("caption")
            StrictJson.requireWellFormedUnicode(text)
            require(text.codePointCount(0, text.length) <= MAX_CAPTION_CODE_POINTS)
        }
        require(f.getValue("generationOrigin").asString("generationOrigin") in setOf("model", "local-preview"))
        val parent = f.getValue("parentExpressionId")
        if (parent != JsonValue.Null) requireId(parent.asString("parentExpressionId"), setOf("cbe1:", "cbe2:"))
        val canonical = StrictJson.canonical(value)
        val id = digest(if (coloyond) EXPRESSION2 else EXPRESSION1, canonical)
        return ValidatedRecord(value, canonical, id, renderer != 1L || layout != 1L || sceneRecord.viewOnly)
    }

    fun validateExport(value: JsonValue): ValidatedRecord {
        val f = value.asObject("export")
        val version = f.field("exportVersion").asLong("exportVersion")
        if (version == 2L) {
            f.exactKeys("exportVersion", "configurationSnapshot", "strategy", "strategyId", "expression")
            val strategy = validateStrategy(f.getValue("strategy"))
            require(!strategy.id.startsWith("cb3:")) { "Export v2 cannot contain a Coloyond strategy" }
            require(f.getValue("strategyId").asString("strategyId") == strategy.id)
            val expression = f.getValue("expression")
            val exprResult = if (expression == JsonValue.Null) null else validateExpression(expression)
            if (exprResult != null) {
                require(exprResult.value.asObject("expression").getValue("strategyId").asString("strategyId") == strategy.id)
            }
            val snapshot = f.getValue("configurationSnapshot")
            require(snapshot == JsonValue.Null || snapshot is JsonValue.Obj)
            return ValidatedRecord(value, StrictJson.canonical(value), strategy.id, true)
        }
        require(version == 3L) { "Unsupported export version" }
        f.exactKeys("exportVersion", "configurationSnapshot", "strategy", "strategyId", "expression")
        val strategy = validateStrategy(f.getValue("strategy"))
        require(strategy.id.startsWith("cb3:")) { "Export v3 requires Coloyond strategy" }
        require(f.getValue("strategyId").asString("strategyId") == strategy.id)
        val expression = f.getValue("expression")
        if (expression != JsonValue.Null) {
            val e = validateExpression(expression, coloyond = true)
            require(e.value.asObject("expression").getValue("strategyId").asString("strategyId") == strategy.id)
        }
        val snapshot = f.getValue("configurationSnapshot")
        require(snapshot == JsonValue.Null || snapshot is JsonValue.Obj)
        return ValidatedRecord(value, StrictJson.canonical(value), strategy.id, strategy.viewOnly)
    }

    private fun validateTargetWeights(value: JsonValue, mintKey: String, forbidden: Set<String> = emptySet()) {
        val weights = value.asArray("targetWeights")
        require(weights.size in 1..2)
        var sum = 0L
        val seen = mutableSetOf<String>()
        var prior = ""
        weights.forEach {
            val f = it.asObject("target weight")
            f.exactKeys(mintKey, "weightBps")
            val mint = f.getValue(mintKey).asString(mintKey)
            requireCanonicalPubkey(mint)
            require(mint !in forbidden && seen.add(mint)) { "Duplicate or forbidden target mint" }
            require(prior.isEmpty() || prior < mint) { "Target weights must be sorted by mint bytes" }
            prior = mint
            val bps = f.getValue("weightBps").asLong("weightBps")
            require(bps in 1L..10_000L)
            sum += bps
        }
        require(sum == 10_000L)
    }

    private fun sortedArray(value: JsonValue, fieldName: String, keyName: String): JsonValue {
        val fields = value.asObject("strategy")
        val array = fields.getValue(fieldName).asArray(fieldName)
        val sorted = array.sortedBy { it.asObject(fieldName).getValue(keyName).asString(keyName) }
        return JsonValue.Obj(fields + (fieldName to JsonValue.Arr(sorted)))
    }

    private fun sortedArrayByPubkey(value: JsonValue, fieldName: String, keyName: String): JsonValue {
        val fields = value.asObject("strategy")
        val array = fields.getValue(fieldName).asArray(fieldName)
        val sorted = array.sortedWith { left, right ->
            compareBytes(
                decodeCanonicalPubkey(left.asObject(fieldName).getValue(keyName).asString(keyName)),
                decodeCanonicalPubkey(right.asObject(fieldName).getValue(keyName).asString(keyName)),
            )
        }
        return JsonValue.Obj(fields + (fieldName to JsonValue.Arr(sorted)))
    }

    private fun record(value: JsonValue, domain: String, prefix: String, viewOnly: Boolean): ValidatedRecord {
        val canonical = StrictJson.canonical(value)
        val id = prefix + digest(domain, canonical)
        return ValidatedRecord(value, canonical, id, viewOnly)
    }

    private fun digest(domain: String, canonical: String): String =
        MessageDigest.getInstance("SHA-256").digest(domain.toByteArray(Charsets.US_ASCII) + canonical.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }

    private fun requireId(value: String, prefixes: Set<String>) {
        require(prefixes.any { value.startsWith(it) && value.removePrefix(it).matches(HEX_32) }) { "Invalid record ID" }
    }

    private fun requireCanonicalPubkey(value: String) {
        decodeCanonicalPubkey(value)
    }

    private fun decodeCanonicalPubkey(value: String): ByteArray {
        require(value.isNotEmpty() && value.all { it in BASE58 }) { "Invalid base58 public key" }
        var number = java.math.BigInteger.ZERO
        value.forEach { number = number.multiply(java.math.BigInteger.valueOf(58)).add(java.math.BigInteger.valueOf(BASE58.indexOf(it).toLong())) }
        val body = if (number == java.math.BigInteger.ZERO) byteArrayOf() else number.toByteArray().let { if (it.first() == 0.toByte()) it.copyOfRange(1, it.size) else it }
        val zeros = value.takeWhile { it == '1' }.length
        val bytes = ByteArray(zeros) + body
        require(bytes.size == 32 && encodeBase58(bytes) == value) { "Public key must round-trip to 32 bytes" }
        return bytes
    }

    private fun compareBytes(left: ByteArray, right: ByteArray): Int {
        for (i in left.indices) {
            val comparison = (left[i].toInt() and 0xff).compareTo(right[i].toInt() and 0xff)
            if (comparison != 0) return comparison
        }
        return left.size.compareTo(right.size)
    }

    private fun requireCanonicalU64(value: String, label: String) {
        require(value.matches(Regex("0|[1-9][0-9]{0,19}"))) { "$label must be a canonical decimal u64 string" }
        require(java.math.BigInteger(value) <= U64_MAX) { "$label exceeds u64" }
    }

    private fun encodeBase58(bytes: ByteArray): String {
        val zeros = bytes.takeWhile { it == 0.toByte() }.size
        var n = java.math.BigInteger(1, bytes)
        val out = StringBuilder()
        val radix = java.math.BigInteger.valueOf(58)
        while (n > java.math.BigInteger.ZERO) {
            val qr = n.divideAndRemainder(radix); out.append(BASE58[qr[1].toInt()]); n = qr[0]
        }
        repeat(zeros) { out.append('1') }
        return out.reverse().toString()
    }

    private val HEX_32 = Regex("[0-9a-f]{64}")
    private val U64_MAX = java.math.BigInteger("18446744073709551615")
    private val PALETTE = setOf("paper", "ink", "cobalt", "violet", "yellow", "coral")
    private const val BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
}
