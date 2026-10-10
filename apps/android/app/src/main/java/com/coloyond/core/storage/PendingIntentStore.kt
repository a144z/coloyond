package com.coloyond.core.storage

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.math.BigInteger
import java.util.UUID

/** Writes synchronously before wallet handoff so process death cannot silently lose an attempted action. */
class PendingIntentStore(context: Context) {

    private val prefs = context.getSharedPreferences("coloyond-pending", Context.MODE_PRIVATE)

    fun current(): PendingActionRecord? {
        val encoded = prefs.getString(KEY_ACTION, null)
        if (encoded != null) return PendingActionCodec.decode(encoded)

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
    fun save(record: PendingActionRecord) {
        check(prefs.edit().putString(KEY_ACTION, PendingActionCodec.encode(record)).commit()) {
            "Could not durably save pending wallet action"
        }
    }

    fun clear() {
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
                    .put("slot", effect.slot))
            }
        })
        .putNullable("lastError", record.lastError)
        .toString()

    fun decode(json: String): PendingActionRecord {
        val obj = JSONObject(json)
        require(obj.getInt("version") == VERSION) { "Unsupported pending action version" }
        val expected = obj.getJSONArray("expectedEffects").let { array ->
            List(array.length()) { index ->
                val item = array.getJSONObject(index)
                ExpectedAccountEffect(
                    account = item.getString("account"),
                    mint = item.getString("mint"),
                    baselineAmountBaseUnits = BigInteger(item.getString("baselineAmountBaseUnits")),
                    minimumDeltaBaseUnits = BigInteger(item.getString("minimumDeltaBaseUnits")),
                    maximumDeltaBaseUnits = BigInteger(item.getString("maximumDeltaBaseUnits")),
                )
            }
        }
        val observed = obj.getJSONArray("observedEffects").let { array ->
            List(array.length()) { index ->
                val item = array.getJSONObject(index)
                ObservedAccountEffect(
                    account = item.getString("account"),
                    mint = item.getString("mint"),
                    amountBaseUnits = BigInteger(item.getString("amountBaseUnits")),
                    slot = item.getLong("slot"),
                )
            }
        }
        return PendingActionRecord(
            id = obj.getString("id"),
            kind = PendingActionKind.valueOf(obj.getString("kind")),
            state = PendingActionState.valueOf(obj.getString("state")),
            createdAtMillis = obj.getLong("createdAtMillis"),
            cluster = obj.getString("cluster"),
            walletAddress = obj.optNullableString("walletAddress"),
            programId = obj.optNullableString("programId"),
            vaultAddress = obj.optNullableString("vaultAddress"),
            configurationRevision = obj.optNullableString("configurationRevision")?.toLong(),
            reviewedMessageDigest = obj.optNullableString("reviewedMessageDigest"),
            signature = obj.optNullableString("signature"),
            expectedEffects = expected,
            observedEffects = observed,
            lastError = obj.optNullableString("lastError"),
        )
    }

    private fun JSONObject.putNullable(key: String, value: String?): JSONObject = put(key, value ?: JSONObject.NULL)
    private fun JSONObject.optNullableString(key: String): String? =
        if (!has(key) || isNull(key)) null else getString(key)

    private const val VERSION = 1
}
