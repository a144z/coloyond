package com.coloyond.platform

import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import android.os.Build
import com.coloyond.strategy.CardExchange
import com.coloyond.strategy.ValidatedRecord
import java.io.InputStream

/** Bounded Activity intent ingress. Call [readValidated] before exposing imported records to UI code. */
sealed interface ImportProbeResult {
    data class Link(val payloadChars: Int, val encodedPayload: String) : ImportProbeResult
    data class File(val uri: Uri, val mime: String?, val bytes: ByteArray) : ImportProbeResult
    data class Rejected(val reason: String) : ImportProbeResult
}

sealed interface ValidatedImport {
    data class StrategyOnly(val strategy: ValidatedRecord) : ValidatedImport
    data class CardFile(val card: CardExchange.PortableCard) : ValidatedImport
    data class Rejected(val reason: String) : ValidatedImport
}

object ImportIntents {
    const val SCHEME = "coloyond"
    const val HOST = "import"
    const val MAX_LINK_CHARS = CardExchange.MAX_LINK_CHARS
    const val MAX_IMPORT_BYTES = 256 * 1024

    /** Returns null when [intent] is not an import (for example, the launcher intent). */
    fun read(intent: Intent, resolver: ContentResolver): ImportProbeResult? {
        val data = intent.data
        return when {
            intent.action == Intent.ACTION_VIEW && data?.scheme == SCHEME -> readLink(data)
            intent.action == Intent.ACTION_VIEW && data?.scheme == ContentResolver.SCHEME_CONTENT ->
                readContent(data, intent.type ?: resolver.getType(data), resolver)
            intent.action == Intent.ACTION_SEND -> {
                val uri = intent.streamUri() ?: return ImportProbeResult.Rejected("share had no file")
                if (uri.scheme != ContentResolver.SCHEME_CONTENT) return ImportProbeResult.Rejected("not a content URI")
                readContent(uri, intent.type ?: resolver.getType(uri), resolver)
            }
            else -> null
        }
    }

    /** Validates a cold/warm activity import before the UI receives strategy data. */
    fun readValidated(intent: Intent, resolver: ContentResolver): ValidatedImport? {
        if (intent.action == Intent.ACTION_SEND_MULTIPLE) return readMultiple(intent, resolver)
        return when (val raw = read(intent, resolver)) {
            null -> null
            is ImportProbeResult.Rejected -> ValidatedImport.Rejected(raw.reason)
            is ImportProbeResult.Link -> try {
                ValidatedImport.StrategyOnly(CardExchange.parseStrategyLink("$LINK_PREFIX${raw.encodedPayload}"))
            } catch (error: IllegalArgumentException) {
                ValidatedImport.Rejected(error.message ?: "Strategy link is invalid")
            }
            is ImportProbeResult.File -> try {
                ValidatedImport.CardFile(CardExchange.parseExport(raw.bytes))
            } catch (error: IllegalArgumentException) {
                ValidatedImport.Rejected(error.message ?: "Strategy file is invalid")
            }
        }
    }

    private fun readMultiple(intent: Intent, resolver: ContentResolver): ValidatedImport {
        val uris = intent.streamUris()
        if (uris.isEmpty() || uris.size > MAX_SHARED_URIS) return ValidatedImport.Rejected("share must contain one or two files")
        val valid = uris.mapNotNull { uri ->
            if (uri.scheme != ContentResolver.SCHEME_CONTENT) return@mapNotNull null
            val file = readContent(uri, intent.type ?: resolver.getType(uri), resolver) as? ImportProbeResult.File
                ?: return@mapNotNull null
            runCatching { CardExchange.parseExport(file.bytes) }.getOrNull()
        }
        return when (valid.size) {
            1 -> ValidatedImport.CardFile(valid.single())
            0 -> ValidatedImport.Rejected("share contains no valid .coloyond.json strategy")
            else -> ValidatedImport.Rejected("share contains multiple strategy files")
        }
    }

    private fun readLink(uri: Uri): ImportProbeResult {
        val whole = uri.toString()
        if (whole.length >= MAX_LINK_CHARS) return ImportProbeResult.Rejected("link is ${whole.length} characters")
        if (uri.host != HOST || uri.userInfo != null || uri.port != -1 || !uri.path.isNullOrEmpty() || uri.query != null) {
            return ImportProbeResult.Rejected("unknown or malformed link address")
        }
        val fragment = uri.encodedFragment ?: return ImportProbeResult.Rejected("link has no payload")
        return ImportProbeResult.Link(fragment.length, fragment)
    }

    private fun readContent(uri: Uri, mime: String?, resolver: ContentResolver): ImportProbeResult {
        val stream = try {
            resolver.openInputStream(uri)
        } catch (e: SecurityException) {
            return ImportProbeResult.Rejected("no read permission")
        } catch (e: java.io.FileNotFoundException) {
            return ImportProbeResult.Rejected("file not found")
        } ?: return ImportProbeResult.Rejected("file could not be opened")
        val bytes = stream.use { it.readBounded(MAX_IMPORT_BYTES) }
            ?: return ImportProbeResult.Rejected("file is larger than ${MAX_IMPORT_BYTES / 1024} KiB")
        return ImportProbeResult.File(uri, mime, bytes)
    }

    /** Reads at most [limit] bytes; returns null when the stream is longer. */
    internal fun InputStream.readBounded(limit: Int): ByteArray? {
        val buffer = ByteArray(limit + 1)
        var total = 0
        while (total <= limit) {
            val n = read(buffer, total, buffer.size - total)
            if (n < 0) break
            total += n
        }
        return if (total > limit) null else buffer.copyOf(total)
    }

    @Suppress("DEPRECATION")
    private fun Intent.streamUri(): Uri? =
        if (Build.VERSION.SDK_INT >= 33) getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
        else getParcelableExtra(Intent.EXTRA_STREAM)

    @Suppress("DEPRECATION")
    private fun Intent.streamUris(): List<Uri> =
        if (Build.VERSION.SDK_INT >= 33) getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java).orEmpty()
        else getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM).orEmpty()

    private const val MAX_SHARED_URIS = 2
    private const val LINK_PREFIX = CardExchange.LINK_PREFIX
}
