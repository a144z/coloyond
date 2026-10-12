package com.coloyond.strategy

/** Small strict JSON/JCS core for the immutable card records. No Android APIs. */
sealed interface JsonValue {
    data class Obj(val fields: Map<String, JsonValue>) : JsonValue
    data class Arr(val values: List<JsonValue>) : JsonValue
    data class Str(val value: String) : JsonValue
    data class Num(val raw: String) : JsonValue
    data class Bool(val value: Boolean) : JsonValue
    data object Null : JsonValue
}

internal class StrictJsonException(message: String) : IllegalArgumentException(message)

internal object StrictJson {
    fun parse(source: String, maxBytes: Int = Int.MAX_VALUE): JsonValue {
        require(source.toByteArray(Charsets.UTF_8).size <= maxBytes) { "JSON exceeds byte limit" }
        return Parser(source).parse()
    }

    fun canonical(value: JsonValue): String = when (value) {
        is JsonValue.Obj -> value.fields.keys.sorted().joinToString(",", "{", "}") { key ->
            "${quote(key)}:${canonical(value.fields.getValue(key))}"
        }
        is JsonValue.Arr -> value.values.joinToString(",", "[", "]", transform = ::canonical)
        is JsonValue.Str -> quote(value.value)
        is JsonValue.Num -> canonicalNumber(value.raw)
        is JsonValue.Bool -> if (value.value) "true" else "false"
        JsonValue.Null -> "null"
    }

    private fun canonicalNumber(raw: String): String {
        // Every numeric field in the frozen records is an integer. Restricting
        // JSON numbers here prevents a lossy Double round-trip during JCS.
        val parsed = raw.toLongOrNull() ?: throw StrictJsonException("Integer outside supported range")
        require(parsed in -9_007_199_254_740_991L..9_007_199_254_740_991L) { "Integer outside JCS safe range" }
        return parsed.toString()
    }

    private fun quote(value: String): String {
        requireWellFormedUnicode(value)
        val out = StringBuilder(value.length + 2).append('"')
        value.forEach { ch ->
            when (ch) {
                '"' -> out.append("\\\"")
                '\\' -> out.append("\\\\")
                '\b' -> out.append("\\b")
                '\t' -> out.append("\\t")
                '\n' -> out.append("\\n")
                '\u000c' -> out.append("\\f")
                '\r' -> out.append("\\r")
                in '\u0000'..'\u001f' -> out.append("\\u%04x".format(ch.code))
                else -> out.append(ch)
            }
        }
        return out.append('"').toString()
    }

    fun requireWellFormedUnicode(value: String) {
        var i = 0
        while (i < value.length) {
            val c = value[i]
            if (c.isHighSurrogate()) {
                require(i + 1 < value.length && value[i + 1].isLowSurrogate()) { "Unpaired Unicode surrogate" }
                i += 2
            } else {
                require(!c.isLowSurrogate()) { "Unpaired Unicode surrogate" }
                i++
            }
        }
    }

    private class Parser(private val input: String) {
        private var i = 0
        fun parse(): JsonValue {
            whitespace()
            val value = value()
            whitespace()
            if (i != input.length) fail("Trailing JSON data")
            return value
        }

        private fun value(): JsonValue {
            if (i >= input.length) fail("Unexpected end of JSON")
            return when (input[i]) {
                '{' -> obj()
                '[' -> array()
                '"' -> JsonValue.Str(string())
                't' -> literal("true", JsonValue.Bool(true))
                'f' -> literal("false", JsonValue.Bool(false))
                'n' -> literal("null", JsonValue.Null)
                '-', in '0'..'9' -> number()
                else -> fail("Unexpected JSON token")
            }
        }

        private fun obj(): JsonValue.Obj {
            i++
            whitespace()
            val fields = linkedMapOf<String, JsonValue>()
            if (take('}')) return JsonValue.Obj(fields)
            while (true) {
                if (i >= input.length || input[i] != '"') fail("Object key must be a string")
                val key = string()
                if (fields.containsKey(key)) fail("Duplicate object key: $key")
                whitespace(); expect(':'); whitespace()
                fields[key] = value()
                whitespace()
                if (take('}')) break
                expect(','); whitespace()
            }
            return JsonValue.Obj(fields)
        }

        private fun array(): JsonValue.Arr {
            i++
            whitespace()
            val values = mutableListOf<JsonValue>()
            if (take(']')) return JsonValue.Arr(values)
            while (true) {
                values += value()
                whitespace()
                if (take(']')) break
                expect(','); whitespace()
            }
            return JsonValue.Arr(values)
        }

        private fun string(): String {
            expect('"')
            val out = StringBuilder()
            while (i < input.length) {
                val c = input[i++]
                when {
                    c == '"' -> return out.toString().also(StrictJson::requireWellFormedUnicode)
                    c == '\\' -> {
                        if (i >= input.length) fail("Incomplete escape")
                        when (val e = input[i++]) {
                            '"', '\\', '/' -> out.append(e)
                            'b' -> out.append('\b')
                            'f' -> out.append('\u000c')
                            'n' -> out.append('\n')
                            'r' -> out.append('\r')
                            't' -> out.append('\t')
                            'u' -> {
                                if (i + 4 > input.length) fail("Incomplete Unicode escape")
                                val code = input.substring(i, i + 4).toIntOrNull(16) ?: fail("Invalid Unicode escape")
                                out.append(code.toChar()); i += 4
                            }
                            else -> fail("Invalid string escape")
                        }
                    }
                    c.code < 0x20 -> fail("Unescaped control in string")
                    else -> out.append(c)
                }
            }
            fail("Unterminated string")
        }

        private fun number(): JsonValue.Num {
            val start = i
            if (take('-') && i >= input.length) fail("Invalid number")
            if (take('0')) {
                if (i < input.length && input[i].isDigit()) fail("Leading zero")
            } else {
                if (i >= input.length || input[i] !in '1'..'9') fail("Invalid number")
                while (i < input.length && input[i].isDigit()) i++
            }
            // Current records are integer-only; reject fractions/exponents rather than
            // accidentally changing the identity through a non-JCS numeric parser.
            if (i < input.length && input[i] in ".eE") fail("Non-integer JSON numbers are not supported")
            return JsonValue.Num(input.substring(start, i))
        }

        private fun <T : JsonValue> literal(word: String, result: T): T {
            if (!input.startsWith(word, i)) fail("Invalid literal")
            i += word.length
            return result
        }

        private fun whitespace() { while (i < input.length && input[i] in " \n\r\t") i++ }
        private fun expect(c: Char) { if (!take(c)) fail("Expected '$c'") }
        private fun take(c: Char): Boolean = if (i < input.length && input[i] == c) { i++; true } else false
        private fun fail(message: String): Nothing = throw StrictJsonException("$message at byte/character $i")
    }
}

internal fun JsonValue.asObject(label: String): Map<String, JsonValue> =
    (this as? JsonValue.Obj)?.fields ?: throw StrictJsonException("$label must be an object")

internal fun JsonValue.asArray(label: String): List<JsonValue> =
    (this as? JsonValue.Arr)?.values ?: throw StrictJsonException("$label must be an array")

internal fun JsonValue.asString(label: String): String =
    (this as? JsonValue.Str)?.value ?: throw StrictJsonException("$label must be a string")

internal fun JsonValue.asLong(label: String): Long {
    val raw = (this as? JsonValue.Num)?.raw ?: throw StrictJsonException("$label must be an integer")
    return raw.toLongOrNull() ?: throw StrictJsonException("$label is outside supported integer range")
}

internal fun Map<String, JsonValue>.exactKeys(vararg expected: String) {
    require(keys == expected.toSet()) { "Expected exactly keys ${expected.sorted()}, found ${keys.sorted()}" }
}

internal fun Map<String, JsonValue>.field(name: String): JsonValue =
    this[name] ?: throw StrictJsonException("Missing field: $name")
