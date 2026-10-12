package com.coloyond.core.storage

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.math.BigInteger
import java.util.UUID

/** Writes synchronously before wallet handoff so process death cannot silently lose an attempted action. */
interface PendingActionPersistence {
    fun current(): PendingActionRecord?
    fun save(record: PendingActionRecord)
    fun clear()
}

class PendingIntentStore(context: Context) : PendingActionPersistence {

    private val prefs = context.getSharedPreferences("coloyond-pending", Context.MODE_PRIVATE)

    override fun current(): PendingActionRecord? {
        val encoded = prefs.getString(KEY_ACTION, null)
        if (encoded != null) {
            val decoded = PendingActionCodec.decodeStored(encoded, UUID.randomUUID().toString())
            if (decoded.wasCorrupt) {
                // If rewriting storage fails, keep returning the unresolved value for this session.
                runCatching { save(decoded.record) }
            }
            return decoded.record
        }

        // Older builds stored an untyped note. Preserve uncertainty, but never reinterpret or resend it.
        val legacy = prefs.getString(KEY_LEGACY_INTENT, null) ?: return null
        val old = runCatching { JSONObject(legacy) }.getOrNull()
        val signature = old?.optString("signature")?.takeIf(String::isNotBlank)
        val record = PendingActionRecord(
            id = UUID.randomUUID().toString(),
            kind = PendingActionKind.UNKNOWN_LEGACY,
            state = PendingActionState.RECONCILIATION_REQUIRED,
            createdAtMillis = old?.optLong("savedAt")?.coerceAtLeast(0) ?: 0,
            cluster = "unknown",
            signature = signature,
            lastError = "Legacy pending action lacks typed transaction and account-effect details",
        )
        save(record)
        prefs.edit().remove(KEY_LEGACY_INTENT).commit()
        return record
    }

    /** A failed durable write aborts the caller before it can open a wallet handoff. */
    override fun save(record: PendingActionRecord) {
        check(prefs.edit().putString(KEY_ACTION, PendingActionCodec.encode(record)).commit()) {
            "Could not durably save pending wallet action"
        }
    }

    override fun clear() {
        check(prefs.edit().remove(KEY_ACTION).remove(KEY_LEGACY_INTENT).commit()) {
            "Could not clear pending wallet action"
        }
    }

    private companion object {
        const val KEY_ACTION = "pending-action-v1"
        const val KEY_LEGACY_INTENT = "pending-intent"
    }
}

/** Pure codec kept separately so schema validation and recovery can be covered by JVM tests. */
internal object PendingActionCodec {
    fun decodeStored(json: String, fallbackId: String): DecodedPendingAction =
        runCatching {
            val version = JSONObject(json).getInt("version")
            DecodedPendingAction(decode(json), wasCorrupt = version < VERSION)
        }
            .getOrElse { DecodedPendingAction(unresolvedCorruptRecord(fallbackId), wasCorrupt = true) }

    fun encode(record: PendingActionRecord): String = JSONObject()
        .put("version", VERSION)
        .put("id", record.id)
        .put("kind", record.kind.name)
        .put("state", record.state.name)
        .put("createdAtMillis", record.createdAtMillis)
        .put("cluster", record.cluster)
        .putNullable("walletAddress", record.walletAddress)
        .putNullable("programId", record.programId)
        .putNullable("vaultAddress", record.vaultAddress)
        .putNullable("configurationRevision", record.configurationRevision?.toString())
        .putNullable("reviewedMessageDigest", record.reviewedMessageDigest)
        .putNullable("reviewedMessageBase64", record.reviewedMessageBase64)
        .put("reviewedAccountKeys", JSONArray(record.reviewedAccountKeys))
        .putNullable("reviewedInstructionProgramId", record.reviewedInstructionProgramId)
        .put("reviewedInstructionAccounts", JSONArray(record.reviewedInstructionAccounts))
        .putNullable("reviewedInstructionDataBase64", record.reviewedInstructionDataBase64)
        .putNullable("rpcEndpoint", record.rpcEndpoint)
        .putNullable("genesisHash", record.genesisHash)
        .putNullable("recentBlockhash", record.recentBlockhash)
        .putNullable("lastValidBlockHeight", record.lastValidBlockHeight?.toString())
        .putNullable("reviewContextSlot", record.reviewContextSlot?.toString())
        .putNullable("signedTransactionBase64", record.signedTransactionBase64)
        .putNullable("signature", record.signature)
        .put("expectedEffects", JSONArray().also { array ->
            record.expectedEffects.forEach { effect ->
                array.put(JSONObject()
                    .put("account", effect.account)
                    .put("mint", effect.mint)
                    .put("baselineAmountBaseUnits", effect.baselineAmountBaseUnits.toString())
                    .put("minimumDeltaBaseUnits", effect.minimumDeltaBaseUnits.toString())
                    .put("maximumDeltaBaseUnits", effect.maximumDeltaBaseUnits.toString()))
            }
        })
        .put("observedEffects", JSONArray().also { array ->
            record.observedEffects.forEach { effect ->
                array.put(JSONObject()
                    .put("account", effect.account)
                    .put("mint", effect.mint)
                    .put("amountBaseUnits", effect.amountBaseUnits.toString())
                    .put("slot", effect.slot.toString()))
            }
        })
        .putNullable("lastError", record.lastError)
        .toString()

    fun decode(json: String): PendingActionRecord {
        val obj = JSONObject(json)
        val version = obj.getInt("version")
        require(version in 1..VERSION) { "Unsupported pending action version" }
        val expected = obj.getJSONArray("expectedEffects").let { array ->
            List(array.length()) { index ->
                val item = array.getJSONObject(index)
                ExpectedAccountEffect(
                    account = item.getString("account"),
                    mint = item.getString("mint"),
                    baselineAmountBaseUnits = item.getString("baselineAmountBaseUnits").toCanonicalBigInteger(),
                    minimumDeltaBaseUnits = item.getString("minimumDeltaBaseUnits").toCanonicalBigInteger(),
                    maximumDeltaBaseUnits = item.getString("maximumDeltaBaseUnits").toCanonicalBigInteger(),
                )
            }
        }
        val observed = obj.getJSONArray("observedEffects").let { array ->
            List(array.length()) { index ->
                val item = array.getJSONObject(index)
                ObservedAccountEffect(
                    account = item.getString("account"),
                    mint = item.getString("mint"),
                    amountBaseUnits = item.getString("amountBaseUnits").toCanonicalBigInteger(),
                    slot = item.getString("slot").toCanonicalBigInteger(),
                )
            }
        }
        val legacy = version == 1
        return PendingActionRecord(
            id = obj.getString("id"),
            kind = if (legacy) PendingActionKind.UNKNOWN_LEGACY else PendingActionKind.valueOf(obj.getString("kind")),
            state = if (legacy) PendingActionState.RECONCILIATION_REQUIRED else PendingActionState.valueOf(obj.getString("state")),
            createdAtMillis = obj.getLong("createdAtMillis"),
            cluster = obj.getString("cluster"),
            walletAddress = obj.optNullableString("walletAddress"),
            programId = obj.optNullableString("programId"),
            vaultAddress = obj.optNullableString("vaultAddress"),
            configurationRevision = obj.optNullableString("configurationRevision")?.toCanonicalBigInteger(),
            reviewedMessageDigest = obj.optNullableString("reviewedMessageDigest"),
            reviewedMessageBase64 = if (legacy) null else obj.optNullableString("reviewedMessageBase64"),
            reviewedAccountKeys = if (legacy) emptyList() else obj.optStringList("reviewedAccountKeys"),
            reviewedInstructionProgramId = if (legacy) null else obj.optNullableString("reviewedInstructionProgramId"),
            reviewedInstructionAccounts = if (legacy) emptyList() else obj.optStringList("reviewedInstructionAccounts"),
            reviewedInstructionDataBase64 = if (legacy) null else obj.optNullableString("reviewedInstructionDataBase64"),
            rpcEndpoint = if (legacy) null else obj.optNullableString("rpcEndpoint"),
            genesisHash = if (legacy) null else obj.optNullableString("genesisHash"),
            recentBlockhash = if (legacy) null else obj.optNullableString("recentBlockhash"),
            lastValidBlockHeight = if (legacy) null else obj.optNullableString("lastValidBlockHeight")?.toCanonicalBigInteger(),
            reviewContextSlot = if (legacy) null else obj.optNullableString("reviewContextSlot")?.toCanonicalBigInteger(),
            signedTransactionBase64 = if (legacy) null else obj.optNullableString("signedTransactionBase64"),
            signature = obj.optNullableString("signature"),
            expectedEffects = expected,
            observedEffects = observed,
            lastError = if (legacy) "Recovered v1 wallet record lacks exact RPC and signed-message evidence; manual reconciliation is required"
                else obj.optNullableString("lastError"),
        )
    }

    private fun JSONObject.putNullable(key: String, value: String?): JSONObject = put(key, value ?: JSONObject.NULL)
    private fun JSONObject.optNullableString(key: String): String? =
        if (!has(key) || isNull(key)) null else getString(key)

    private fun JSONObject.optStringList(key: String): List<String> {
        val array = getJSONArray(key)
        return List(array.length()) { index -> array.getString(index).also { require(it.isNotBlank()) } }
    }

    private fun String.toCanonicalBigInteger(): BigInteger = BigInteger(this).also {
        require(it.toString() == this) { "Expected canonical decimal integer" }
    }

    fun unresolvedCorruptRecord(id: String): PendingActionRecord = PendingActionRecord(
        id = id,
        kind = PendingActionKind.UNKNOWN_LEGACY,
        state = PendingActionState.RECONCILIATION_REQUIRED,
        createdAtMillis = 0,
        cluster = "unknown",
        lastError = "Stored pending action could not be decoded; manual reconciliation is required",
    )

    private const val VERSION = 2
}

internal data class DecodedPendingAction(val record: PendingActionRecord, val wasCorrupt: Boolean)
