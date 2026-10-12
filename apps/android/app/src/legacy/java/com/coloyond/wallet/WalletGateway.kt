package com.coloyond.wallet

import com.solana.mobilewalletadapter.clientlib.ActivityResultSender

/** Outcome of one wallet action; [payload] carries the base58 account or signature. */
sealed interface GatewayResult {
    data class Ok(val payload: String? = null) : GatewayResult
    data class Rejected(val reason: String) : GatewayResult
    data object NoWallet : GatewayResult
}

sealed interface VaultSigningResult {
    class Signed(wireTransaction: ByteArray) : VaultSigningResult {
        private val bytes = wireTransaction.copyOf()
        fun wireTransaction(): ByteArray = bytes.copyOf()
    }

    data class RejectedBeforeSubmission(val reason: String) : VaultSigningResult
    data class Unknown(val reason: String) : VaultSigningResult
    data object NoWallet : VaultSigningResult
    data object Unsupported : VaultSigningResult
}

/**
 * Wallet seam for the app (20). Connect, sign, and disconnect are separate
 * suspend calls so each can bind to one user action (36); the real device path
 * is [MwaWalletGateway] and the no-wallet fallback is [MockWalletGateway] (43).
 */
interface WalletGateway {
    suspend fun connect(sender: ActivityResultSender): GatewayResult
    suspend fun signMessage(sender: ActivityResultSender, message: String): GatewayResult
    /** Builds a Memo-program transaction, has the wallet sign and send it, and returns its signature. */
    suspend fun signAndSendMemo(sender: ActivityResultSender, memo: String, recentBlockhash: String): GatewayResult
    /** Requests signing only; it must never broadcast or rebuild the supplied transaction. */
    suspend fun signVaultTransaction(sender: ActivityResultSender, unsignedWireTransaction: ByteArray): VaultSigningResult
    suspend fun disconnect(sender: ActivityResultSender): GatewayResult
}
