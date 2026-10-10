package com.coloyond.platform

import android.content.ClipData
import android.content.ClipDescription
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import com.coloyond.strategy.CardExchange
import com.coloyond.strategy.ValidatedRecord
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest

/** Writes share files to app-private cache and builds share-sheet intents with read grants. */
object Sharing {
    private const val DIR = "shared"
    const val JSON_MIME = "application/json"

    fun authority(context: Context) = "${context.packageName}.files"

    /** Saves [bytes] under the cache share directory and returns its content URI. */
    fun stage(context: Context, name: String, bytes: ByteArray): Uri {
        require(name.matches(Regex("[A-Za-z0-9._-]{1,80}")) && name != "." && name != "..") {
            "Share filename is invalid"
        }
        val dir = File(context.cacheDir, DIR).apply { mkdirs() }
        val digest = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        val extension = when {
            name.endsWith(".coloyond.json") -> ".coloyond.json"
            name.contains('.') -> ".${name.substringAfterLast('.')}"
            else -> ""
        }
        val stem = name.removeSuffix(extension)
        val fileName = "$stem-$digest$extension"
        val file = File(dir, fileName)
        if (file.exists()) {
            check(file.isFile && file.readBytes().contentEquals(bytes)) { "Staged share file changed" }
        } else {
            val temporary = File.createTempFile("share-", ".tmp", dir)
            try {
                FileOutputStream(temporary).use { stream ->
                    stream.write(bytes)
                    stream.fd.sync()
                }
                if (!temporary.renameTo(file)) {
                    check(file.isFile && file.readBytes().contentEquals(bytes)) { "Could not stage share file" }
                }
            } finally {
                temporary.delete()
            }
        }
        return FileProvider.getUriForFile(context, authority(context), file)
    }

    /** Stages a validated portable export as a `.coloyond.json` attachment. */
    fun strategyFile(context: Context, strategy: ValidatedRecord, expression: ValidatedRecord? = null): Uri {
        val bytes = CardExchange.export(strategy, expression).canonicalJson.toByteArray(Charsets.UTF_8)
        return stage(context, "card.coloyond.json", bytes)
    }

    /** A strategy-only custom-scheme link; it contains no image or server URL. */
    fun strategyLink(strategy: ValidatedRecord): String = CardExchange.strategyLink(strategy)

    /** One share with a PNG and a strategy file. Some targets drop one of them. */
    fun cardAndStrategy(png: Uri, strategy: Uri): Intent =
        Intent(Intent.ACTION_SEND_MULTIPLE).apply {
            type = "*/*"
            putParcelableArrayListExtra(Intent.EXTRA_STREAM, arrayListOf(png, strategy))
            // newUri(null, …) crashes: it asks a ContentResolver for the MIME type.
            clipData = ClipData(ClipDescription("card", arrayOf("image/png", JSON_MIME)), ClipData.Item(png))
                .apply { addItem(ClipData.Item(strategy)) }
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }

    /** A single-file share, offered when a target drops attachments from a multi-file share. */
    fun single(uri: Uri, mime: String): Intent =
        Intent(Intent.ACTION_SEND).apply {
            type = mime
            putExtra(Intent.EXTRA_STREAM, uri)
            clipData = ClipData.newRawUri(null, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
}
