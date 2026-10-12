package com.coloyond.platform

/** A user-provided Anthropic session key. It is intentionally memory-only. */
class InferenceCredentials private constructor(private val value: String) {
    internal fun addToHeaders(headers: MutableMap<String, String>) {
        headers[API_KEY_HEADER] = value
    }

    override fun toString(): String = "InferenceCredentials([redacted])"

    companion object {
        /** Returns null for an empty or malformed entry without echoing it in an error. */
        fun fromUserInput(input: String?): InferenceCredentials? {
            val candidate = input?.trim() ?: return null
            if (candidate.isEmpty() || candidate.length > MAX_LENGTH) return null
            if (candidate.any { it.code !in 0x21..0x7e }) return null
            return InferenceCredentials(candidate)
        }

        private const val MAX_LENGTH = 4096
        internal const val API_KEY_HEADER = "x-api-key"
    }
}
