package com.coloyond.core.storage

import java.security.MessageDigest
import java.util.Base64
import java.math.BigInteger
import java.net.URI

private val U64_MAX = BigInteger("18446744073709551615")

/** A durable wallet handoff snapshot. Unknown fields are never inferred from an older record. */
data class PendingActionRecord(
    val id: String,
    val kind: PendingActionKind,
    val state: PendingActionState,
    val createdAtMillis: Long,
    val cluster: String,
    val walletAddress: String? = null,
    val programId: String? = null,
    val vaultAddress: String? = null,
    val configurationRevision: BigInteger? = null,
    val reviewedMessageDigest: String? = null,
    val reviewedMessageBase64: String? = null,
    val reviewedAccountKeys: List<String> = emptyList(),
    val reviewedInstructionProgramId: String? = null,
    val reviewedInstructionAccounts: List<String> = emptyList(),
    val reviewedInstructionDataBase64: String? = null,
    val rpcEndpoint: String? = null,
    val genesisHash: String? = null,
    val recentBlockhash: String? = null,
    val lastValidBlockHeight: BigInteger? = null,
    val reviewContextSlot: BigInteger? = null,
    val signedTransactionBase64: String? = null,
    val signature: String? = null,
    val expectedEffects: List<ExpectedAccountEffect> = emptyList(),
    val observedEffects: List<ObservedAccountEffect> = emptyList(),
    val lastError: String? = null,
) {
    init {
        require(id.isNotBlank())
        require(createdAtMillis >= 0)
        require(cluster.isNotBlank())
        require(programId == null || programId.isNotBlank())
        require(vaultAddress == null || vaultAddress.isNotBlank())
        require(configurationRevision == null || configurationRevision in BigInteger.ZERO..U64_MAX)
        require(lastValidBlockHeight == null || lastValidBlockHeight in BigInteger.ZERO..U64_MAX)
        require(reviewContextSlot == null || reviewContextSlot in BigInteger.ZERO..U64_MAX)
        require(signature == null || signature.isNotBlank())
        require(reviewedMessageDigest == null || reviewedMessageDigest.matches(Regex("[0-9a-f]{64}")))
        require(reviewedMessageBase64 == null || reviewedMessageBase64.isNotBlank())
        require(rpcEndpoint == null || rpcEndpoint.isSafeRpcEndpoint())
        require(genesisHash == null || genesisHash.isNotBlank())
        require(recentBlockhash == null || recentBlockhash.isNotBlank())
        require(signedTransactionBase64 == null || signedTransactionBase64.isNotBlank())
        if (kind == PendingActionKind.VAULT_DEPOSIT || kind == PendingActionKind.VAULT_REDEEM) {
            require(programId != null && vaultAddress != null && configurationRevision != null)
            require(reviewedMessageDigest != null && expectedEffects.isNotEmpty())
            require(reviewedMessageBase64 != null && rpcEndpoint != null && genesisHash != null)
            require(recentBlockhash != null && lastValidBlockHeight != null && reviewContextSlot != null)
            require(reviewedAccountKeys.isNotEmpty() && reviewedInstructionProgramId == programId)
            require(reviewedInstructionAccounts.isNotEmpty() && reviewedInstructionDataBase64 != null)
            require(vaultAddress in reviewedInstructionAccounts)
            require(expectedEffects.all { effect -> effect.account in reviewedInstructionAccounts })
            val messageBytes = Base64.getDecoder().decode(reviewedMessageBase64)
            require(sha256Hex(messageBytes) == reviewedMessageDigest) { "Reviewed message digest does not match stored bytes" }
            if (signedTransactionBase64 != null) require(signature != null) {
                "A saved signed transaction must have its immutable signature"
            }
        }
    }

    fun handedOff(): PendingActionRecord {
        require(state == PendingActionState.PREPARED) { "Only a prepared action can be handed to a wallet" }
        return copy(state = PendingActionState.HANDOFF_ATTEMPTED)
    }

    fun withSignature(value: String): PendingActionRecord {
        require(kind == PendingActionKind.DEMO_MEMO) { "Vault actions must persist the exact signed transaction" }
        require(state == PendingActionState.HANDOFF_ATTEMPTED || state == PendingActionState.RECONCILIATION_REQUIRED)
        require(value.isNotBlank())
        require(signature == null || signature == value) { "A pending action cannot change signatures" }
        return copy(state = PendingActionState.SIGNATURE_KNOWN, signature = value, lastError = null)
    }

    fun withSignedTransaction(base64WireTransaction: String, value: String): PendingActionRecord {
        require(kind == PendingActionKind.VAULT_DEPOSIT || kind == PendingActionKind.VAULT_REDEEM)
        require(state == PendingActionState.HANDOFF_ATTEMPTED || state == PendingActionState.RECONCILIATION_REQUIRED)
        require(base64WireTransaction.isNotBlank() && value.isNotBlank())
        require(signedTransactionBase64 == null || signedTransactionBase64 == base64WireTransaction) {
            "A pending action cannot change its signed transaction"
        }
        require(signature == null || signature == value) { "A pending action cannot change signatures" }
        return copy(
            state = PendingActionState.SIGNATURE_KNOWN,
            signedTransactionBase64 = base64WireTransaction,
            signature = value,
            lastError = null,
        )
    }

    /** Only use when the caller has evidence that no wallet handoff or broadcast occurred. */
    fun rejectedBeforeSubmission(reason: String): PendingActionRecord {
        require(state == PendingActionState.PREPARED || state == PendingActionState.HANDOFF_ATTEMPTED)
        require(signature == null && signedTransactionBase64 == null)
        require(reason.isNotBlank())
        return copy(state = PendingActionState.REJECTED, lastError = reason)
    }

    /** Use after cancellation, timeout, process death, or any ambiguous wallet result. Never resends. */
    fun needsReconciliation(reason: String? = null): PendingActionRecord {
        if (state.isTerminal) return this
        return copy(state = PendingActionState.RECONCILIATION_REQUIRED, lastError = reason)
    }

    /** Applies observations only; this type has no resend or wallet-dispatch operation. */
    fun reconcile(observation: ReconciliationObservation): PendingActionRecord {
        if (state.isTerminal) return this

        val observedSignature = observation.signature
        require(observedSignature == null || signature == null || observedSignature == signature) {
            "Observed signature does not belong to this pending action"
        }
        val resolvedSignature = signature ?: observedSignature
        if (kind == PendingActionKind.VAULT_DEPOSIT || kind == PendingActionKind.VAULT_REDEEM) {
            val exactTransactionMatches =
                observedSignature != null && observedSignature == signature &&
                    observation.transactionMessageDigest == reviewedMessageDigest &&
                    observation.transactionProgramId == programId &&
                    observation.transactionAccountKeys == reviewedAccountKeys &&
                    observation.transactionInstructionAccounts == reviewedInstructionAccounts &&
                    observation.transactionInstructionDataBase64 == reviewedInstructionDataBase64 &&
                    observation.transactionSlot != null
            if (!exactTransactionMatches) {
                return copy(
                    state = PendingActionState.RECONCILIATION_REQUIRED,
                    observedEffects = observation.accountEffects,
                    lastError = observation.error ?: "Fetched transaction does not match the reviewed message, program, or accounts",
                )
            }
        }
        if (observation.signatureStatus == ObservedSignatureStatus.FAILED && resolvedSignature != null) {
            return copy(
                state = PendingActionState.FAILED_ON_CHAIN,
                signature = resolvedSignature,
                observedEffects = observation.accountEffects,
                lastError = observation.error ?: "Transaction failed on-chain",
            )
        }

        val hasConfirmedSignature = observation.signatureStatus == ObservedSignatureStatus.CONFIRMED ||
            observation.signatureStatus == ObservedSignatureStatus.FINALIZED
        if (!hasConfirmedSignature || resolvedSignature == null) {
            return copy(
                state = PendingActionState.RECONCILIATION_REQUIRED,
                signature = resolvedSignature,
                observedEffects = observation.accountEffects,
                lastError = observation.error,
            )
        }

        val effectsMatch = expectedEffects.all { expected ->
            val actual = observation.accountEffects.singleOrNull { it.account == expected.account && it.mint == expected.mint }
                ?: return@all false
            if (actual.slot != observation.transactionSlot) return@all false
            val delta = actual.amountBaseUnits - expected.baselineAmountBaseUnits
            delta >= expected.minimumDeltaBaseUnits && delta <= expected.maximumDeltaBaseUnits
        } && observation.accountEffects.size == expectedEffects.size
        val canConfirmWithoutEffects = kind == PendingActionKind.DEMO_MEMO && expectedEffects.isEmpty()
        val transactionEvidenceAvailable = kind == PendingActionKind.DEMO_MEMO || (
            observation.metadataAvailable && observation.preTokenBalancesAvailable && observation.postTokenBalancesAvailable
        )
        return copy(
            state = if (canConfirmWithoutEffects || (transactionEvidenceAvailable && expectedEffects.isNotEmpty() && effectsMatch)) {
                PendingActionState.CONFIRMED
            } else {
                PendingActionState.RECONCILIATION_REQUIRED
            },
            signature = resolvedSignature,
            observedEffects = observation.accountEffects,
            lastError = if (canConfirmWithoutEffects || (transactionEvidenceAvailable && effectsMatch)) null else observation.error,
        )
    }
}

enum class PendingActionKind { DEMO_MEMO, VAULT_DEPOSIT, VAULT_REDEEM, UNKNOWN_LEGACY }

enum class PendingActionState {
    PREPARED,
    HANDOFF_ATTEMPTED,
    SIGNATURE_KNOWN,
    RECONCILIATION_REQUIRED,
    CONFIRMED,
    FAILED_ON_CHAIN,
    REJECTED,
    ;

    val isTerminal: Boolean
        get() = this == CONFIRMED || this == FAILED_ON_CHAIN || this == REJECTED
}

data class ExpectedAccountEffect(
    val account: String,
    val mint: String,
    val baselineAmountBaseUnits: BigInteger,
    val minimumDeltaBaseUnits: BigInteger,
    val maximumDeltaBaseUnits: BigInteger,
) {
    init {
        require(account.isNotBlank() && mint.isNotBlank())
        require(baselineAmountBaseUnits in BigInteger.ZERO..U64_MAX)
        require(minimumDeltaBaseUnits >= U64_MAX.negate() && maximumDeltaBaseUnits <= U64_MAX)
        require(minimumDeltaBaseUnits <= maximumDeltaBaseUnits)
    }
}

data class ObservedAccountEffect(
    val account: String,
    val mint: String,
    val amountBaseUnits: BigInteger,
    val slot: BigInteger,
) {
    init {
        require(account.isNotBlank() && mint.isNotBlank())
        require(amountBaseUnits in BigInteger.ZERO..U64_MAX)
        require(slot in BigInteger.ZERO..U64_MAX)
    }
}

enum class ObservedSignatureStatus { NOT_FOUND, PENDING, CONFIRMED, FINALIZED, FAILED }

data class ReconciliationObservation(
    val signatureStatus: ObservedSignatureStatus,
    val signature: String? = null,
    val accountEffects: List<ObservedAccountEffect> = emptyList(),
    val error: String? = null,
    val transactionMessageDigest: String? = null,
    val transactionProgramId: String? = null,
    val transactionAccountKeys: List<String> = emptyList(),
    val transactionInstructionAccounts: List<String>? = null,
    val transactionInstructionDataBase64: String? = null,
    val transactionSlot: BigInteger? = null,
    val metadataAvailable: Boolean = false,
    val preTokenBalancesAvailable: Boolean = false,
    val postTokenBalancesAvailable: Boolean = false,
)

private fun sha256Hex(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
    .digest(bytes)
    .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }

private fun String.isSafeRpcEndpoint(): Boolean {
    val uri = runCatching { URI(this) }.getOrNull() ?: return false
    val host = uri.host?.lowercase() ?: return false
    return when (uri.scheme?.lowercase()) {
        "https" -> true
        "http" -> host in setOf("localhost", "127.0.0.1", "::1", "[::1]")
        else -> false
    }
}
