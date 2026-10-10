package com.coloyond.platform

import android.content.Context
import com.coloyond.strategy.StrategyRecords
import com.coloyond.strategy.ValidatedRecord
import com.coloyond.strategy.asObject
import com.coloyond.strategy.asString
import com.coloyond.strategy.field
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest

/** An immutable expression, its separately stored strategy, and its local PNG. */
data class SavedCard(
    val strategy: ValidatedRecord,
    val expression: ValidatedRecord,
    val png: ByteArray,
    val pngSha256: String,
    val viewOnly: Boolean,
)

/** App-private, content-addressed card storage. It never persists wallet/model credentials. */
class CardStorage(private val root: File) {
    constructor(context: Context) : this(File(context.filesDir, "cards-v1"))

    private val strategies = File(root, "strategies")
    private val expressions = File(root, "expressions")
    private val images = File(root, "png")
    private val imageDigests = File(root, "png-digests")

    /**
     * Saves each content object once. The expression is written last, so it is
     * also the commit marker used by [list] if the process stops mid-save.
     */
    fun save(strategy: ValidatedRecord, expression: ValidatedRecord, png: ByteArray): SavedCard = synchronized(processLock) {
        val checkedStrategy = StrategyRecords.validateStrategy(strategy.value)
        require(checkedStrategy.id == strategy.id) { "Strategy identity changed" }
        val strategyId = expression.value.asObject("expression").field("strategyId").asString("strategyId")
        require(strategyId == checkedStrategy.id) { "Expression belongs to another strategy" }
        val checkedExpression = StrategyRecords.validateExpression(expression.value, coloyond = strategyId.startsWith("cbe2:"))
        require(checkedExpression.id == expression.id) { "Expression identity changed" }
        require(expressionIdPattern.matches(checkedExpression.id)) { "Unsupported expression identity" }
        require(strategyIdPattern.matches(checkedStrategy.id)) { "Unsupported strategy identity" }
        require(png.size <= MAX_PNG_BYTES) { "Card PNG exceeds the local storage limit" }
        require(isCardPng(png)) { "PNG must be a 1080 × 1350 card image" }

        writeImmutable(File(strategies, fileName(checkedStrategy.id, ".json")), checkedStrategy.canonicalJson.toByteArray(Charsets.UTF_8))
        writeImmutable(File(images, fileName(checkedExpression.id, ".png")), png)
        writeImmutable(File(imageDigests, fileName(checkedExpression.id, ".sha256")), sha256(png).toByteArray(Charsets.US_ASCII))
        writeImmutable(File(expressions, fileName(checkedExpression.id, ".json")), checkedExpression.canonicalJson.toByteArray(Charsets.UTF_8))
        SavedCard(checkedStrategy, checkedExpression, png.copyOf(), sha256(png), checkedStrategy.viewOnly || checkedExpression.viewOnly)
    }

    /** Returns a fully revalidated card, or null when the expression is absent/incomplete. */
    fun load(expressionId: String): SavedCard? {
        if (!expressionIdPattern.matches(expressionId)) return null
        val expressionFile = File(expressions, fileName(expressionId, ".json"))
        if (!expressionFile.isFile || expressionFile.length() > StrategyRecords.MAX_IMPORT_BYTES) return null
        val expressionBytes = expressionFile.readBytes()
        val expression = runCatching {
            StrategyRecords.validateExpression(
                StrategyRecords.parse(expressionBytes.toString(Charsets.UTF_8)),
                coloyond = expressionId.startsWith("cbe2:"),
            )
        }.getOrNull() ?: return null
        if (expression.id != expressionId) return null
        val strategyId = expression.value.asObject("expression").field("strategyId").asString("strategyId")
        if (!strategyIdPattern.matches(strategyId)) return null
        val strategyFile = File(strategies, fileName(strategyId, ".json"))
        if (!strategyFile.isFile || strategyFile.length() > StrategyRecords.MAX_IMPORT_BYTES) return null
        val strategyBytes = strategyFile.readBytes()
        val strategy = runCatching { StrategyRecords.validateStrategy(StrategyRecords.parse(strategyBytes.toString(Charsets.UTF_8))) }.getOrNull()
            ?: return null
        if (strategy.id != strategyId) return null
        val pngFile = File(images, fileName(expressionId, ".png"))
        if (!pngFile.isFile || pngFile.length() > MAX_PNG_BYTES) return null
        val png = pngFile.readBytes()
        if (!isCardPng(png)) return null
        val digestFile = File(imageDigests, fileName(expressionId, ".sha256"))
        if (!digestFile.isFile || digestFile.length() != 64L || digestFile.readText(Charsets.US_ASCII) != sha256(png)) return null
        return SavedCard(strategy, expression, png, sha256(png), strategy.viewOnly || expression.viewOnly)
    }

    /** Lists only expression files whose strategy and image objects are complete and valid. */
    fun list(): List<SavedCard> = expressions.listFiles()
        .orEmpty()
        .asSequence()
        .filter { it.isFile && it.name.endsWith(".json") }
        .mapNotNull { file -> load(file.name.removeSuffix(".json").replace('_', ':')) }
        .sortedBy { it.expression.id }
        .toList()

    private fun writeImmutable(destination: File, bytes: ByteArray) {
        destination.parentFile?.let { parent -> check(parent.isDirectory || parent.mkdirs()) { "Could not create card storage" } }
        if (destination.exists()) {
            val existing = destination.readBytes()
            if (!existing.contentEquals(bytes)) throw CardStorageConflictException("Immutable card content already exists")
            return
        }
        val temporary = File.createTempFile("card-", ".tmp", destination.parentFile)
        try {
            FileOutputStream(temporary).use { stream ->
                stream.write(bytes)
                stream.fd.sync()
            }
            if (!temporary.renameTo(destination)) {
                if (destination.isFile && destination.readBytes().contentEquals(bytes)) return
                throw CardStorageConflictException("Could not commit immutable card content")
            }
        } finally {
            temporary.delete()
        }
    }

    private fun fileName(id: String, suffix: String): String = id.replace(':', '_') + suffix

    private fun isCardPng(bytes: ByteArray): Boolean {
        if (bytes.size < 24) return false
        val signature = byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
        if (!bytes.copyOfRange(0, 8).contentEquals(signature)) return false
        fun u32(offset: Int): Long = (0..3).fold(0L) { value, index -> (value shl 8) or (bytes[offset + index].toLong() and 0xff) }
        return u32(8) == 13L && bytes.copyOfRange(12, 16).contentEquals(byteArrayOf(0x49, 0x48, 0x44, 0x52)) &&
            u32(16) == CardLayoutV1.WIDTH.toLong() && u32(20) == CardLayoutV1.HEIGHT.toLong()
    }

    private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    companion object {
        private val processLock = Any()
        private val strategyIdPattern = Regex("(?:cb1|cb2|cb3|cbd1):[0-9a-f]{64}")
        private val expressionIdPattern = Regex("cbe[12]:[0-9a-f]{64}")
        private const val MAX_PNG_BYTES = 16 * 1024 * 1024L
    }
}

class CardStorageConflictException(message: String) : IllegalStateException(message)
