package com.coloyond.generation

import com.coloyond.strategy.JsonValue
import com.coloyond.strategy.StrictJson
import com.coloyond.strategy.asArray
import com.coloyond.strategy.asObject
import com.coloyond.strategy.asString
import com.coloyond.strategy.exactKeys
import java.text.Normalizer
import java.util.Locale

object Captions {
    const val MAX_CODE_POINTS = 80
    const val MAX_WORDS = 12
    const val MAX_HISTORY = 20

    private val motifStems = listOf("light", "horizon", "possib", "beyond", "becom", "unfold")
    private val url = Regex("(?i)(?:https?://|www\\.)\\S+")
    private val forbiddenFinancialWord = Regex("(?iu)(?<![\\p{L}\\p{N}_])(?:return|returns|yield|yields|profit|profits|buy|sell|guaranteed|risk-free)(?![\\p{L}\\p{N}_])")

    /** Parses the sole allowed provider shape and applies local diversity and safety checks. */
    fun parseModelCandidates(
        json: JsonValue,
        acceptedHistory: List<String>,
        verifiedTickerSymbols: Set<String> = emptySet(),
    ): List<String> {
        val root = json.asObject("caption response")
        root.exactKeys("candidates")
        val raw = root.getValue("candidates").asArray("candidates")
        require(raw.size <= 3) { "Too many caption candidates" }
        return filterModelCandidates(raw.map { it.asString("caption candidate") }, acceptedHistory, verifiedTickerSymbols)
    }

    fun filterModelCandidates(
        candidates: List<String>,
        acceptedHistory: List<String>,
        verifiedTickerSymbols: Set<String> = emptySet(),
    ): List<String> {
        val recent = acceptedHistory.takeLast(MAX_HISTORY)
        val usedPhrases = recent.map(::diversityKey).toMutableSet()
        val usedMotifs = recent.takeLast(5).flatMap(::motifs).toMutableSet()
        val tickers = verifiedTickerSymbols.filter { it.matches(Regex("[A-Z0-9]{1,12}")) }.toSet()
        val accepted = mutableListOf<String>()
        for (candidate in candidates) {
            if (!isSafeText(candidate, tickers)) continue
            val phrase = diversityKey(candidate)
            if (phrase.isEmpty() || !usedPhrases.add(phrase)) continue
            if (motifs(candidate).any { it in usedMotifs }) continue
            accepted += candidate
            usedMotifs += motifs(candidate)
        }
        return accepted
    }

    /** User edits skip repetition/motif checks, but not factual, length, URL, or text safety. */
    fun validateUserCaption(caption: String, verifiedTickerSymbols: Set<String> = emptySet()): String? =
        caption.takeIf { isSafeText(it, verifiedTickerSymbols) }

    fun appendAccepted(history: List<String>, caption: String): List<String> =
        (history + caption).takeLast(MAX_HISTORY)

    /** Only fixed motif vocabulary leaves the device; raw caption history can contain personal text. */
    fun recentMotifStems(history: List<String>): List<String> =
        history.takeLast(5).flatMap(::motifs).distinct().sorted()

    private fun isSafeText(text: String, tickerSymbols: Set<String>): Boolean {
        if (text != text.trim() || text.isBlank()) return false
        if (text.codePointCount(0, text.length) > MAX_CODE_POINTS) return false
        val codePoints = text.codePoints().toArray()
        if (codePoints.any { Character.isISOControl(it) || it == '$'.code || it == '%'.code }) return false
        if (url.containsMatchIn(text) || forbiddenFinancialWord.containsMatchIn(text)) return false
        if (tickerSymbols.any { ticker -> Regex("(?<![A-Za-z0-9])${Regex.escape(ticker)}(?![A-Za-z0-9])").containsMatchIn(text) }) return false
        val wordCount = countWhitespaceRuns(codePoints)
        if (wordCount !in 2..MAX_WORDS) return false
        return runCatching { StrictJson.requireWellFormedUnicode(text); Normalizer.normalize(text, Normalizer.Form.NFKC); true }.getOrDefault(false)
    }

    private fun diversityKey(text: String): String =
        Normalizer.normalize(text, Normalizer.Form.NFKC)
            .lowercase(Locale.ROOT)
            .trim()
            .replace(Regex("\\s+"), " ")
            .replace(Regex("[.!?,;:…]+$"), "")
            .trim()

    private fun motifs(text: String): Set<String> {
        val normalized = Normalizer.normalize(text, Normalizer.Form.NFKC).lowercase(Locale.ROOT)
        val tokens = normalized.split(Regex("[^\\p{L}\\p{N}]+"))
        return tokens.flatMap { token -> motifStems.filter { token.startsWith(it) } }.toSet()
    }

    /** Unicode White_Space runs (including NBSP and ideographic space), not UTF-16 length. */
    private fun countWhitespaceRuns(codePoints: IntArray): Int {
        var count = 0
        var inWord = false
        for (cp in codePoints) {
            if (isUnicodeWhitespace(cp)) inWord = false
            else if (!inWord) { count++; inWord = true }
        }
        return count
    }

    private fun isUnicodeWhitespace(cp: Int): Boolean = cp == 0x0009 || cp == 0x000a || cp == 0x000b || cp == 0x000c || cp == 0x000d ||
        cp == 0x0020 || cp == 0x0085 || cp == 0x00a0 || cp == 0x1680 || cp in 0x2000..0x200a || cp == 0x2028 || cp == 0x2029 || cp == 0x202f || cp == 0x205f || cp == 0x3000
}
