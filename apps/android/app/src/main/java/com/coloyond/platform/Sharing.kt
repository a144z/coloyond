package com.coloyond.platform

import android.content.ClipData
import android.content.ClipDescription
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import com.coloyond.strategy.CardExchange
import com.coloyond.strategy.StrategyRecords
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
        val snapshot = bytes.copyOf()
        val dir = File(context.cacheDir, DIR)
        check(dir.isDirectory || dir.mkdirs()) { "Could not create share cache" }
        val digest = sha256(snapshot)
        val extension = when {
            name.endsWith(".coloyond.json") -> ".coloyond.json"
            name.contains('.') -> ".${name.substringAfterLast('.')}"
            else -> ""
        }
        val stem = name.removeSuffix(extension)
        val fileName = "$stem-$digest$extension"
        val file = File(dir, fileName)
        if (file.exists()) {
            check(file.isFile && file.readBytes().contentEquals(snapshot)) { "Staged share file changed" }
        } else {
            val temporary = File.createTempFile("share-", ".tmp", dir)
            try {
                FileOutputStream(temporary).use { stream ->
                    stream.write(snapshot)
                    stream.fd.sync()
                }
                if (!temporary.renameTo(file)) {
                    check(file.isFile && file.readBytes().contentEquals(snapshot)) { "Could not stage share file" }
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

    /** Validates and stages the exact saved PNG together with its matching strategy and expression. */
    fun cardAndStrategy(context: Context, card: SavedCard): Intent {
        val checked = validateSavedCard(card)
        val png = stage(context, "coloyond-card.png", checked.png)
        val strategy = strategyFile(context, checked.strategy, checked.expression)
        return cardAndStrategy(png, strategy)
    }

    /** Validates and stages the saved card image for an image-only share. */
    fun cardImage(context: Context, card: SavedCard): Uri =
        stage(context, "coloyond-card.png", validateSavedCard(card).png)

    /** Revalidates a saved bundle and detaches its mutable PNG bytes before it crosses a share boundary. */
    internal fun validateSavedCard(card: SavedCard): SavedCard {
        val strategy = StrategyRecords.validateStrategy(card.strategy.value)
        require(strategy.id == card.strategy.id && strategy.canonicalJson == card.strategy.canonicalJson) {
            "Saved strategy identity changed"
        }
        val expression = StrategyRecords.validateExpression(
            card.expression.value,
            coloyond = strategy.id.startsWith("cb3:"),
        )
        require(expression.id == card.expression.id && expression.canonicalJson == card.expression.canonicalJson) {
            "Saved expression identity changed"
        }
        // Export validates the nested strategy/expression association and the portable envelope.
        CardExchange.export(strategy, expression)

        val png = card.png.copyOf()
        require(png.size in 24..MAX_CARD_PNG_BYTES && isCardPng(png)) {
            "Saved PNG must be a 1080 × 1350 card image"
        }
        val digest = sha256(png)
        require(card.pngSha256 == digest) { "Saved PNG digest changed" }
        val viewOnly = strategy.viewOnly || expression.viewOnly
        require(card.viewOnly == viewOnly) { "Saved card capability changed" }
        return SavedCard(strategy, expression, png, digest, viewOnly)
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

    private fun isCardPng(bytes: ByteArray): Boolean {
        val signature = byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
        if (!bytes.copyOfRange(0, 8).contentEquals(signature)) return false
        fun u32(offset: Int): Long = (0..3).fold(0L) { value, index ->
            (value shl 8) or (bytes[offset + index].toLong() and 0xff)
        }
        return u32(8) == 13L && bytes.copyOfRange(12, 16).contentEquals(byteArrayOf(0x49, 0x48, 0x44, 0x52)) &&
            u32(16) == CardLayoutV1.WIDTH.toLong() && u32(20) == CardLayoutV1.HEIGHT.toLong()
    }

    private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
        .digest(bytes)
        .joinToString("") { "%02x".format(it) }

    private const val MAX_CARD_PNG_BYTES = 16 * 1024 * 1024
}
