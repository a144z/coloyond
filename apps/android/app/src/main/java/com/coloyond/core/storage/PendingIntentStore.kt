package com.coloyond.core.storage

import android.content.Context
import org.json.JSONObject

/**
 * The transaction intent is stored locally before the request starts; the app
 * checks for pending transactions when the Activity reloads and clears the
 * entry once the result is verified (21).
 */
class PendingIntentStore(context: Context) {

    private val prefs = context.getSharedPreferences("coloyond-pending", Context.MODE_PRIVATE)

    /** [signature] is null until the wallet returns one; keep it so the outcome can be checked later. */
    fun save(kind: String, note: String, signature: String? = null) {
        val intent = JSONObject()
            .put("kind", kind)
            .put("note", note)
            .put("savedAt", System.currentTimeMillis())
        if (signature != null) intent.put("signature", signature)
        prefs.edit().putString(KEY_INTENT, intent.toString()).apply()
    }

    fun pending(): String? = prefs.getString(KEY_INTENT, null)

    fun clear() {
        prefs.edit().remove(KEY_INTENT).apply()
    }

    private companion object {
        const val KEY_INTENT = "pending-intent"
    }
}
