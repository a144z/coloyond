package com.coloyond.strategy

import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.util.Base64

/** Portable card files and strategy-only links. This package has no Android dependency. */
object CardExchange {
    const val LINK_PREFIX = "coloyond://import#"
    const val MAX_LINK_CHARS = 2_000

    data class PortableCard(
        val strategy: ValidatedRecord,
        val expression: ValidatedRecord?,
        val envelope: ValidatedRecord,
    )

    /** Builds the strict versioned export envelope. Configuration snapshots stay null until mapped. */
    fun export(strategy: ValidatedRecord, expression: ValidatedRecord? = null): ValidatedRecord {
        val checkedStrategy = StrategyRecords.validateStrategy(strategy.value)
        require(checkedStrategy.id == strategy.id) { "Strategy identity changed" }
        val checkedExpression = expression?.let { record ->
            val checked = StrategyRecords.validateExpression(record.value, coloyond = record.id.startsWith("cbe2:"))
            require(checked.id == record.id) { "Expression identity changed" }
            require(checked.value.asObject("expression").field("strategyId").asString("strategyId") == checkedStrategy.id) {
                "Expression belongs to another strategy"
            }
            checked
        }
        val version = if (checkedStrategy.id.startsWith("cb3:")) 3 else 2
        val envelope = JsonValue.Obj(mapOf(
            "exportVersion" to JsonValue.Num(version.toString()),
            "configurationSnapshot" to JsonValue.Null,
            "strategy" to checkedStrategy.value,
            "strategyId" to JsonValue.Str(checkedStrategy.id),
            "expression" to (checkedExpression?.value ?: JsonValue.Null),
        ))
        return StrategyRecords.validateExport(envelope)
    }

    /** Parses and validates every nested record in a bounded .coloyond.json file. */
    fun parseExport(bytes: ByteArray): PortableCard {
        require(bytes.size <= StrategyRecords.MAX_IMPORT_BYTES) { "Strategy file exceeds 256 KiB" }
        val source = decodeUtf8(bytes)
        val envelope = StrategyRecords.validateExport(StrategyRecords.parse(source))
        val fields = envelope.value.asObject("export")
        val strategy = StrategyRecords.validateStrategy(fields.getValue("strategy"))
        val expressionValue = fields.getValue("expression")
        val expression = if (expressionValue == JsonValue.Null) null else
            StrategyRecords.validateExpression(expressionValue, coloyond = strategy.id.startsWith("cb3:"))
        return PortableCard(strategy, expression, envelope)
    }

    /** Encodes only a strategy record. Art is shared as a PNG or validated file attachment. */
    fun strategyLink(strategy: ValidatedRecord): String {
        val checked = StrategyRecords.validateStrategy(strategy.value)
        require(checked.id == strategy.id) { "Strategy identity changed" }
        val payload = JsonValue.Obj(mapOf(
            "linkVersion" to JsonValue.Num("1"),
            "strategyId" to JsonValue.Str(checked.id),
            "strategy" to checked.value,
        ))
        val encoded = Base64.getUrlEncoder().withoutPadding()
            .encodeToString(StrictJson.canonical(payload).toByteArray(Charsets.UTF_8))
        val link = LINK_PREFIX + encoded
        require(link.length < MAX_LINK_CHARS) { "Strategy link exceeds the 2,000-character limit; export the file instead" }
        return link
    }

    /** Validates a versioned strategy-only link, including its recomputed identity. */
    fun parseStrategyLink(link: String): ValidatedRecord {
        require(link.length < MAX_LINK_CHARS) { "Strategy link exceeds the 2,000-character limit" }
        require(link.startsWith(LINK_PREFIX)) { "Unsupported strategy link" }
        val encoded = link.substring(LINK_PREFIX.length)
        require(encoded.isNotEmpty() && encoded.matches(Regex("[A-Za-z0-9_-]+"))) { "Malformed strategy link payload" }
        val bytes = try {
            Base64.getUrlDecoder().decode(encoded)
        } catch (_: IllegalArgumentException) {
            throw IllegalArgumentException("Malformed strategy link payload")
        }
        require(bytes.size <= StrategyRecords.MAX_IMPORT_BYTES) { "Strategy link payload exceeds 256 KiB" }
        val fields = StrategyRecords.parse(decodeUtf8(bytes)).asObject("strategy link")
        require(fields.keys == setOf("linkVersion", "strategyId", "strategy")) { "Unknown strategy link fields" }
        require(fields.getValue("linkVersion").asLong("linkVersion") == 1L) { "Unsupported strategy link version" }
        val checked = StrategyRecords.validateStrategy(fields.getValue("strategy"))
        require(fields.getValue("strategyId").asString("strategyId") == checked.id) { "Strategy link identity mismatch" }
        return checked
    }

    private fun decodeUtf8(bytes: ByteArray): String = try {
        Charsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
            .decode(ByteBuffer.wrap(bytes))
            .toString()
    } catch (_: Exception) {
        throw IllegalArgumentException("Import is not valid UTF-8")
    }
}
