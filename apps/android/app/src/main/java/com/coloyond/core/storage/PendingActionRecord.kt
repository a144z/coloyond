package com.coloyond.core.storage

import java.math.BigInteger

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
    val configurationRevision: Long? = null,
    val reviewedMessageDigest: String? = null,
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
        require(configurationRevision == null || configurationRevision >= 0)
        require(signature == null || signature.isNotBlank())
        require(reviewedMessageDigest == null || reviewedMessageDigest.matches(Regex("[0-9a-f]{64}")))
        if (kind == PendingActionKind.VAULT_DEPOSIT || kind == PendingActionKind.VAULT_REDEEM) {
            require(programId != null && vaultAddress != null && configurationRevision != null)
            require(reviewedMessageDigest != null && expectedEffects.isNotEmpty())
        }
    }

    fun handedOff(): PendingActionRecord {
        require(state == PendingActionState.PREPARED) { "Only a prepared action can be handed to a wallet" }
        return copy(state = PendingActionState.HANDOFF_ATTEMPTED)
    }

    fun withSignature(value: String): PendingActionRecord {
        require(state == PendingActionState.HANDOFF_ATTEMPTED || state == PendingActionState.RECONCILIATION_REQUIRED)
        require(value.isNotBlank())
        require(signature == null || signature == value) { "A pending action cannot change signatures" }
        return copy(state = PendingActionState.SIGNATURE_KNOWN, signature = value, lastError = null)
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
            val delta = actual.amountBaseUnits - expected.baselineAmountBaseUnits
            delta >= expected.minimumDeltaBaseUnits && delta <= expected.maximumDeltaBaseUnits
        } && observation.accountEffects.size == expectedEffects.size
        val canConfirmWithoutEffects = kind == PendingActionKind.DEMO_MEMO && expectedEffects.isEmpty()
        return copy(
            state = if (canConfirmWithoutEffects || (expectedEffects.isNotEmpty() && effectsMatch)) {
                PendingActionState.CONFIRMED
            } else {
                PendingActionState.RECONCILIATION_REQUIRED
            },
            signature = resolvedSignature,
            observedEffects = observation.accountEffects,
            lastError = if (canConfirmWithoutEffects || effectsMatch) null else observation.error,
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
        require(minimumDeltaBaseUnits <= maximumDeltaBaseUnits)
    }
}

data class ObservedAccountEffect(
    val account: String,
    val mint: String,
    val amountBaseUnits: BigInteger,
    val slot: Long,
) {
    init {
        require(account.isNotBlank() && mint.isNotBlank())
        require(slot >= 0)
    }
}

enum class ObservedSignatureStatus { NOT_FOUND, PENDING, CONFIRMED, FINALIZED, FAILED }

data class ReconciliationObservation(
    val signatureStatus: ObservedSignatureStatus,
    val signature: String? = null,
    val accountEffects: List<ObservedAccountEffect> = emptyList(),
    val error: String? = null,
)
