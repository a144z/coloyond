package com.coloyond.platform

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import java.io.File

/** Writes share files to app-private cache and builds share-sheet intents with read grants. */
object Sharing {
    private const val DIR = "shared"
    const val JSON_MIME = "application/json"

    fun authority(context: Context) = "${context.packageName}.files"

    /** Saves [bytes] under the cache share directory and returns its content URI. */
    fun stage(context: Context, name: String, bytes: ByteArray): Uri {
        val dir = File(context.cacheDir, DIR).apply { mkdirs() }
        val file = File(dir, name)
        file.writeBytes(bytes)
        return FileProvider.getUriForFile(context, authority(context), file)
    }

    /** One share with a PNG and a strategy file. Some targets drop one of them. */
    fun cardAndStrategy(png: Uri, strategy: Uri): Intent =
        Intent(Intent.ACTION_SEND_MULTIPLE).apply {
            type = "*/*"
            putParcelableArrayListExtra(Intent.EXTRA_STREAM, arrayListOf(png, strategy))
            clipData = ClipData.newUri(null, "card", png).apply { addItem(ClipData.Item(strategy)) }
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
