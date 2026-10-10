package com.coloyond.platform

import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import android.os.Build
import java.io.InputStream

/**
 * Task 1 probe for incoming imports. It only reads bounded bytes; Task 2's
 * `parseImport` validates them. Limits are checked before any decoding.
 */
sealed interface ImportProbeResult {
    data class Link(val payloadChars: Int) : ImportProbeResult
    data class File(val uri: Uri, val mime: String?, val bytes: ByteArray) : ImportProbeResult
    data class Rejected(val reason: String) : ImportProbeResult
}

object ImportIntents {
    const val SCHEME = "coloyond"
    const val HOST = "import"
    const val MAX_LINK_CHARS = 2000
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

    private fun readLink(uri: Uri): ImportProbeResult {
        val whole = uri.toString()
        if (whole.length >= MAX_LINK_CHARS) return ImportProbeResult.Rejected("link is ${whole.length} characters")
        if (uri.host != HOST) return ImportProbeResult.Rejected("unknown link host")
        val fragment = uri.encodedFragment ?: return ImportProbeResult.Rejected("link has no payload")
        return ImportProbeResult.Link(fragment.length)
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
}
