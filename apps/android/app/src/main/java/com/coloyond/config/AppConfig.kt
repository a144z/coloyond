package com.coloyond.config

import android.net.Uri
import com.coloyond.core.rpc.RetryPolicy

/**
 * Single source of truth for endpoints, wallet identity, and timeouts.
 *
 * Ruleset anchors: a dedicated RPC endpoint, never a public node (16); explicit
 * timeouts and exponential-backoff retries (17); a ConnectionIdentity whose
 * identityUri and iconUri wallets can actually verify (35).
 */
object AppConfig {

    // Swap in the project-specific endpoint before demo day (16).
    const val rpcUrl = "https://api.devnet.solana.com"

    // Replace with an app-owned, reachable page that hosts Digital Asset Links (35).
    val identityUri: Uri = Uri.parse("https://yourdapp.com")
    val iconUri: Uri = Uri.parse("favicon.ico")
    const val identityName = "Coloyond"
    const val blockchainLabel = "devnet"

    const val connectTimeoutMs = 10_000
    const val readTimeoutMs = 10_000
    val retry = RetryPolicy(maxAttempts = 3, initialDelayMs = 1_000, maxDelayMs = 8_000)

    const val sampleMessage = "Hello from Coloyond!"
    val sampleTransactionBytes: ByteArray = "Coloyond demo transaction".toByteArray()
}
