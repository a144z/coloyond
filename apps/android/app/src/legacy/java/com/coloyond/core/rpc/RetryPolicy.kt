package com.coloyond.core.rpc

import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.delay

/** Exponential-backoff policy shape from the ruleset (17). */
data class RetryPolicy(
    val maxAttempts: Int = 3,
    val initialDelayMs: Int = 1_000,
    val maxDelayMs: Int = 8_000,
)

class RpcException(message: String, cause: Throwable? = null) : Exception(message, cause)

/** Runs [block] under [policy]; the final failure surfaces as an RpcException (17). */
suspend fun <T> withRetry(policy: RetryPolicy, tag: String, block: suspend () -> T): T {
    var delayMs = policy.initialDelayMs
    for (attempt in 1..policy.maxAttempts) {
        try {
            return block()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (cause: Exception) {
            if (attempt == policy.maxAttempts) {
                throw RpcException("$tag failed after $attempt attempts: ${cause.message}", cause)
            }
            delay(minOf(delayMs, policy.maxDelayMs).toLong())
            delayMs *= 2
        }
    }
    error("unreachable")
}
