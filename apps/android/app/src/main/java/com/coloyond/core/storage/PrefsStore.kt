package com.coloyond.core.storage

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * App-level key-value state. Key material itself lives with the wallet and
 * Android Keystore, never in these prefs (19).
 */
class PrefsStore(context: Context) {

    private val prefs = context.getSharedPreferences("coloyond", Context.MODE_PRIVATE)
    private val mockModeCache = MutableStateFlow(prefs.getBoolean(KEY_MOCK, false))

    val mockMode: StateFlow<Boolean> = mockModeCache
    val currentMockMode: Boolean
        get() = mockModeCache.value

    fun setMockMode(value: Boolean) {
        mockModeCache.value = value
        prefs.edit().putBoolean(KEY_MOCK, value).apply()
    }

    private companion object {
        const val KEY_MOCK = "mock-mode"
    }
}
