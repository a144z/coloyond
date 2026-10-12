package com.coloyond.wallet.vault

import com.coloyond.core.rpc.SolanaRpc
import com.coloyond.core.rpc.TransactionObservation
import com.coloyond.core.storage.ExpectedAccountEffect
import com.coloyond.core.storage.ObservedAccountEffect
import com.coloyond.core.storage.ObservedSignatureStatus
import com.coloyond.core.storage.PendingActionKind
import com.coloyond.core.storage.PendingActionPersistence
import com.coloyond.core.storage.PendingActionRecord
import com.coloyond.core.storage.PendingActionState
import com.coloyond.core.storage.ReconciliationObservation
import com.coloyond.protocols.coloyond.transactions.ColoyondAddresses
import com.coloyond.protocols.coloyond.transactions.ColoyondTransactionPlan
import com.coloyond.protocols.coloyond.transactions.reader.DecodedTransactionObservation
import com.coloyond.protocols.coloyond.transactions.reader.SolanaMessageVersion
import com.coloyond.protocols.coloyond.transactions.reader.TransactionObservationDecoder
import com.coloyond.wallet.VaultSigningResult
import java.math.BigInteger
import java.util.Base64
import java.util.UUID
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

data class VaultActionReview(
    val kind: PendingActionKind,
    val plan: ColoyondTransactionPlan,
    val contextSlot: ULong,
    val expectedEffects: List<ExpectedAccountEffect>,
)

sealed interface VaultActionSubmission {
    data class Sent(val signature: String) : VaultActionSubmission
    data class Rejected(val reason: String) : VaultActionSubmission
    data class NeedsReconciliation(val reason: String) : VaultActionSubmission
    data class Blocked(val reason: String) : VaultActionSubmission
}

/** Serializes one reviewed deposit/redeem handoff and never retries an ambiguous send. */
class VaultTransactionCoordinator(
    private val rpc: SolanaRpc,
    private val pendingActions: PendingActionPersistence,
) {
    suspend fun submit(
        review: VaultActionReview,
        latestReviewStillCurrent: suspend () -> Boolean,
        signOnly: suspend (ByteArray) -> VaultSigningResult,
    ): VaultActionSubmission = ACTION_MUTEX.withLock {
        submitLocked(review, latestReviewStillCurrent, signOnly)
    }

    private suspend fun submitLocked(
        review: VaultActionReview,
        latestReviewStillCurrent: suspend () -> Boolean,
        signOnly: suspend (ByteArray) -> VaultSigningResult,
    ): VaultActionSubmission {
        val network = review.plan.network
        try {
            require(review.kind == PendingActionKind.VAULT_DEPOSIT || review.kind == PendingActionKind.VAULT_REDEEM) {
                "Only proportional deposit and in-kind redemption are supported"
            }
            ColoyondAddresses.validateNetwork(network)
            require(rpc.endpoint == network.rpcUrl) { "RPC endpoint differs from the reviewed network" }
            val current = pendingActions.current()
            if (current != null && !current.state.isTerminal) {
                return VaultActionSubmission.Blocked("Pending action ${current.id} must be reconciled before another wallet handoff")
            }
            if (current != null) pendingActions.clear()

            val genesis = rpc.getGenesisHash()
            require(genesis == network.genesisHash) { "RPC genesis hash differs from the reviewed cluster" }
            val blockhash = rpc.getLatestBlockhashWithContext(minContextSlot = review.contextSlot)
            require(blockhash.context.slot >= review.contextSlot) {
                "Blockhash snapshot is older than the reviewed vault and token-account snapshot"
            }
            val unsignedWire = review.plan.unsignedTransaction(blockhash.blockhash)
            val decoded = decode(unsignedWire)
            validateReview(review, decoded)

            val vault = review.plan.accountMetas.single { it.name == "vault" }.address
            val instruction = decoded.instructions.single()
            var pending = PendingActionRecord(
                id = UUID.randomUUID().toString(),
                kind = review.kind,
                state = PendingActionState.PREPARED,
                createdAtMillis = System.currentTimeMillis(),
                cluster = network.cluster.name.lowercase(),
                walletAddress = review.plan.feePayer,
                programId = ColoyondAddresses.PROGRAM_ID,
                vaultAddress = vault,
                configurationRevision = BigInteger(review.plan.configurationRevision.toString()),
                reviewedMessageDigest = decoded.messageSha256,
                reviewedMessageBase64 = Base64.getEncoder().encodeToString(decoded.serializedMessage),
                reviewedAccountKeys = decoded.staticAccountKeys,
                reviewedInstructionProgramId = instruction.programId,
                reviewedInstructionAccounts = requireNotNull(instruction.accountAddresses),
                reviewedInstructionDataBase64 = instruction.dataBase64,
                rpcEndpoint = rpc.endpoint,
                genesisHash = genesis,
                recentBlockhash = blockhash.blockhash,
                lastValidBlockHeight = BigInteger(blockhash.lastValidBlockHeight.toString()),
                reviewContextSlot = BigInteger(review.contextSlot.toString()),
                expectedEffects = review.expectedEffects,
            )
            pendingActions.save(pending)

            val reviewIsCurrent = try {
                latestReviewStillCurrent()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                false
            }
            if (!reviewIsCurrent) {
                pending = pending.rejectedBeforeSubmission("Vault, wallet balances, or revision changed before wallet approval")
                pendingActions.save(pending)
                return VaultActionSubmission.Rejected(pending.lastError!!)
            }

            pending = pending.handedOff()
            pendingActions.save(pending)
            when (val result = try {
                signOnly(unsignedWire.copyOf())
            } catch (cancelled: CancellationException) {
                persistUnresolved(pending, "Wallet handoff was interrupted")
                throw cancelled
            } catch (error: Exception) {
                persistUnresolved(pending, "Wallet handoff result is unknown: ${error.message}")
                return VaultActionSubmission.NeedsReconciliation("Wallet handoff result is unknown; it will not be resent")
            }) {
                VaultSigningResult.NoWallet -> {
                    pending = pending.rejectedBeforeSubmission("No compatible wallet accepted the sign-only request")
                    pendingActions.save(pending)
                    return VaultActionSubmission.Rejected(pending.lastError!!)
                }
                is VaultSigningResult.RejectedBeforeSubmission -> {
                    pending = pending.rejectedBeforeSubmission(result.reason)
                    pendingActions.save(pending)
                    return VaultActionSubmission.Rejected(result.reason)
                }
                is VaultSigningResult.Unknown -> {
                    persistUnresolved(pending, result.reason)
                    return VaultActionSubmission.NeedsReconciliation(result.reason)
                }
                VaultSigningResult.Unsupported -> {
                    pending = pending.rejectedBeforeSubmission("Wallet does not support the required sign-only method")
                    pendingActions.save(pending)
                    return VaultActionSubmission.Blocked(pending.lastError!!)
                }
                is VaultSigningResult.Signed -> {
                    val signedWire = result.wireTransaction()
                    val signed = try {
                        decode(signedWire)
                    } catch (error: Exception) {
                        persistUnresolved(pending, "Wallet returned an invalid signed transaction: ${error.message}")
                        return VaultActionSubmission.NeedsReconciliation("Wallet returned transaction bytes that cannot be safely verified")
                    }
                    if (!sameReviewedMessage(decoded, signed) || signed.firstSignatureBase58 == ZERO_SIGNATURE) {
                        persistUnresolved(pending, "Wallet signed a transaction that differs from the reviewed message")
                        return VaultActionSubmission.NeedsReconciliation("Signed bytes did not match the reviewed transaction; nothing was broadcast by this app")
                    }
                    pending = pending.withSignedTransaction(
                        Base64.getEncoder().encodeToString(signedWire),
                        signed.firstSignatureBase58,
                    )
                    pendingActions.save(pending)
                    try {
                        val returnedSignature = rpc.sendTransactionOnce(signedWire)
                        if (returnedSignature != pending.signature) {
                            persistUnresolved(pending, "RPC returned a signature different from the signed transaction")
                            return VaultActionSubmission.NeedsReconciliation("RPC response did not match the saved signature; action remains unresolved")
                        }
                        return VaultActionSubmission.Sent(returnedSignature)
                    } catch (cancelled: CancellationException) {
                        persistUnresolved(pending, "RPC send was interrupted after signed bytes were saved")
                        throw cancelled
                    } catch (error: Exception) {
                        persistUnresolved(pending, "RPC send result is ambiguous: ${error.message}")
                        return VaultActionSubmission.NeedsReconciliation("Send result is unknown; the saved transaction will not be resent")
                    }
                }
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            return VaultActionSubmission.Blocked(error.message ?: "Vault transaction could not be prepared")
        }
    }

    /** Fetches the saved signature and transaction from the exact selected RPC, then reconciles evidence. */
    suspend fun reconcilePending(): PendingActionRecord? = ACTION_MUTEX.withLock {
        reconcilePendingLocked()
    }

    private suspend fun reconcilePendingLocked(): PendingActionRecord? {
        val pending = pendingActions.current() ?: return null
        if (pending.kind != PendingActionKind.VAULT_DEPOSIT && pending.kind != PendingActionKind.VAULT_REDEEM) return pending
        if (pending.state.isTerminal) return pending
        require(pending.rpcEndpoint == rpc.endpoint) { "Reconnect to the exact RPC endpoint used for this action" }
        require(pending.genesisHash == rpc.getGenesisHash()) { "RPC genesis hash differs from the saved action" }
        val signature = pending.signature ?: return persistUnresolved(pending, "Signed transaction has no saved signature")
        val status = runCatching {
            rpc.signatureStatusesWithContext(listOf(signature), searchTransactionHistory = true).statuses.single()
        }.getOrElse { return persistUnresolved(pending, "Signature status is unavailable: ${it.message}") }
        if (status == null || (status.confirmationStatus != "confirmed" && status.confirmationStatus != "finalized")) {
            return persistUnresolved(pending, "Signature is not yet confirmed; no retry was made")
        }
        val transaction = runCatching { rpc.getTransaction(signature) }
            .getOrElse { return persistUnresolved(pending, "Confirmed transaction is unavailable: ${it.message}") }
            ?: return persistUnresolved(pending, "Confirmed transaction bytes are not available yet")
        if (status.slot != null && status.slot != transaction.slot) {
            return persistUnresolved(pending, "Signature status and fetched transaction refer to different slots")
        }
        val decoded = runCatching { TransactionObservationDecoder.decode(transaction) }
            .getOrElse { return persistUnresolved(pending, "Fetched transaction could not be decoded: ${it.message}") }
        val savedWire = pending.signedTransactionBase64?.let { Base64.getDecoder().decode(it) }
            ?: return persistUnresolved(pending, "Signed transaction bytes are missing from the saved action")
        if (!savedWire.contentEquals(transaction.wireTransaction)) {
            return persistUnresolved(pending, "Fetched signed transaction bytes differ from the saved handoff")
        }
        val instruction = decoded.instructions.singleOrNull()
        val tokenEffects = if (decoded.preTokenBalancesAvailable && decoded.postTokenBalancesAvailable) {
            decoded.tokenBalanceDeltas.mapNotNull { delta ->
                val before = delta.preAmount ?: return@mapNotNull null
                val after = delta.postAmount ?: return@mapNotNull null
                val address = decoded.staticAccountKeys.getOrNull(delta.key.accountIndex) ?: return@mapNotNull null
                ObservedAccountEffect(address, delta.key.mint, BigInteger(after), BigInteger(decoded.slot.toString()))
                    .also { require(BigInteger(after) - BigInteger(before) == BigInteger(delta.deltaAmount)) }
            }
        } else emptyList()
        val commitment = if (status.err != null || decoded.transactionErrorJson != null) {
            ObservedSignatureStatus.FAILED
        } else if (status.confirmationStatus == "finalized") {
            ObservedSignatureStatus.FINALIZED
        } else {
            ObservedSignatureStatus.CONFIRMED
        }
        val reconciled = pending.reconcile(
            ReconciliationObservation(
                signatureStatus = commitment,
                signature = decoded.firstSignatureBase58,
                accountEffects = tokenEffects,
                error = decoded.transactionErrorJson ?: status.err,
                transactionMessageDigest = decoded.messageSha256,
                transactionProgramId = instruction?.programId,
                transactionAccountKeys = decoded.staticAccountKeys,
                transactionInstructionAccounts = instruction?.accountAddresses,
                transactionInstructionDataBase64 = instruction?.dataBase64,
                transactionSlot = BigInteger(decoded.slot.toString()),
                metadataAvailable = decoded.metadataAvailable,
                preTokenBalancesAvailable = decoded.preTokenBalancesAvailable,
                postTokenBalancesAvailable = decoded.postTokenBalancesAvailable,
            ),
        )
        pendingActions.save(reconciled)
        return reconciled
    }

    private fun validateReview(review: VaultActionReview, decoded: DecodedTransactionObservation) {
        require(decoded.messageVersion == SolanaMessageVersion.LEGACY) { "Vault actions require a legacy message without address-table lookups" }
        require(decoded.staticAccountKeys.firstOrNull() == review.plan.feePayer) { "Wallet is not the reviewed fee payer" }
        val instruction = decoded.instructions.singleOrNull() ?: error("Vault action must contain exactly one instruction")
        require(instruction.programId == ColoyondAddresses.PROGRAM_ID) { "Transaction program differs from Coloyond" }
        require(instruction.accountAddresses == review.plan.accountMetas.map { it.address }) {
            "Compiled instruction accounts differ from the reviewed account list"
        }
        require(instruction.dataBase64 == Base64.getEncoder().encodeToString(review.plan.instructionData)) {
            "Compiled instruction data differs from the reviewed action"
        }
        val expectedByName = mapOf(
            review.plan.accountMetas.single { it.name == "user_asset_a" }.address to review.plan.accountMetas.single { it.name == "mint_a" }.address,
            review.plan.accountMetas.single { it.name == "user_asset_b" }.address to review.plan.accountMetas.single { it.name == "mint_b" }.address,
            review.plan.accountMetas.single { it.name == "user_shares" }.address to review.plan.accountMetas.single { it.name == "share_mint" }.address,
            review.plan.accountMetas.single { it.name == "custody_a" }.address to review.plan.accountMetas.single { it.name == "mint_a" }.address,
            review.plan.accountMetas.single { it.name == "custody_b" }.address to review.plan.accountMetas.single { it.name == "mint_b" }.address,
        )
        require(review.expectedEffects.size == expectedByName.size &&
            review.expectedEffects.map { it.account to it.mint }.toSet() == expectedByName.entries.map { it.key to it.value }.toSet()) {
            "Expected deltas must cover both user assets, user shares, and both vault custody accounts"
        }
    }

    private fun sameReviewedMessage(expected: DecodedTransactionObservation, actual: DecodedTransactionObservation): Boolean =
        actual.messageVersion == SolanaMessageVersion.LEGACY &&
            expected.messageSha256 == actual.messageSha256 &&
            expected.serializedMessage.contentEquals(actual.serializedMessage) &&
            expected.staticAccountKeys == actual.staticAccountKeys &&
            expected.instructions == actual.instructions

    private fun decode(wire: ByteArray): DecodedTransactionObservation =
        TransactionObservationDecoder.decode(TransactionObservation(0uL, wire, null, null))

    private fun persistUnresolved(record: PendingActionRecord, reason: String): PendingActionRecord =
        record.needsReconciliation(reason).also(pendingActions::save)

    private companion object {
        val ACTION_MUTEX = Mutex()
        val ZERO_SIGNATURE = "1".repeat(64)
    }
}
