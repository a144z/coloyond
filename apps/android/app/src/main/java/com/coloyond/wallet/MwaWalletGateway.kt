package com.coloyond.wallet

import com.coloyond.config.AppConfig
import com.funkatronics.encoders.Base58
import com.solana.mobilewalletadapter.clientlib.ActivityResultSender
import com.solana.mobilewalletadapter.clientlib.ConnectionIdentity
import com.solana.mobilewalletadapter.clientlib.MobileWalletAdapter
import com.solana.mobilewalletadapter.clientlib.Solana
import com.solana.mobilewalletadapter.clientlib.TransactionResult
import com.solana.programs.MemoProgram
import com.solana.publickey.SolanaPublicKey
import com.solana.transaction.Message
import com.solana.transaction.Transaction

/**
 * Production path: MWA talks to Phantom-compatible wallets over Android
 * Intents, so the identity fields below must point at verified app-owned
 * metadata or signing requests get rejected (33, 35). Solana-only — no
 * web3j/Ethereum crypto libraries in this dependency set (34, 40).
 */
class MwaWalletGateway : WalletGateway {

    private val adapter = MobileWalletAdapter(
        connectionIdentity = ConnectionIdentity(
            identityUri = AppConfig.identityUri,
            iconUri = AppConfig.iconUri,
            identityName = AppConfig.identityName,
        ),
    ).apply {
        blockchain = Solana.Devnet
    }

    override suspend fun connect(sender: ActivityResultSender): GatewayResult =
        when (val result = adapter.connect(sender)) {
            is TransactionResult.Success -> GatewayResult.Ok(
                SolanaPublicKey(result.authResult.accounts.first().publicKey).base58(),
            )
            is TransactionResult.NoWalletFound -> GatewayResult.NoWallet
            is TransactionResult.Failure -> GatewayResult.Rejected(result.message)
        }

    override suspend fun signMessage(sender: ActivityResultSender, message: String): GatewayResult =
        when (val result = adapter.transact(sender) { authResult ->
            signMessagesDetached(
                arrayOf(message.encodeToByteArray()),
                arrayOf(authResult.accounts.first().publicKey),
            ).messages.first().signatures.first()
        }) {
            is TransactionResult.Success -> GatewayResult.Ok(Base58.encodeToString(result.payload))
            is TransactionResult.NoWalletFound -> GatewayResult.NoWallet
            is TransactionResult.Failure -> GatewayResult.Rejected(result.message)
        }

    override suspend fun signAndSendMemo(
        sender: ActivityResultSender,
        memo: String,
        recentBlockhash: String,
    ): GatewayResult =
        when (val result = adapter.transact(sender) { authResult ->
            val payer = SolanaPublicKey(authResult.accounts.first().publicKey)
            signAndSendTransactions(arrayOf(memoTransaction(payer, memo, recentBlockhash))).signatures.first()
        }) {
            is TransactionResult.Success -> GatewayResult.Ok(Base58.encodeToString(result.payload))
            is TransactionResult.NoWalletFound -> GatewayResult.NoWallet
            is TransactionResult.Failure -> GatewayResult.Rejected(result.message)
        }

    override suspend fun disconnect(sender: ActivityResultSender): GatewayResult =
        when (val result = adapter.disconnect(sender)) {
            is TransactionResult.Success -> GatewayResult.Ok()
            is TransactionResult.NoWalletFound -> GatewayResult.NoWallet
            is TransactionResult.Failure -> GatewayResult.Rejected(result.message)
        }
}

/** Unsigned legacy transaction with one Memo instruction; [payer] signs and pays the fee. */
internal fun memoTransaction(payer: SolanaPublicKey, memo: String, recentBlockhash: String): ByteArray {
    val message = Message.Builder()
        .addInstruction(MemoProgram.publishMemo(payer, memo))
        .setRecentBlockhash(recentBlockhash)
        .build()
    return Transaction(message).serialize()
}
