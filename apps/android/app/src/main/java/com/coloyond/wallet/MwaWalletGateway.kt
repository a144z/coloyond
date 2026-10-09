package com.coloyond.wallet

import com.coloyond.config.AppConfig
import com.funkatronics.encoders.Base58
import com.solana.mobilewalletadapter.clientlib.ActivityResultSender
import com.solana.mobilewalletadapter.clientlib.ConnectionIdentity
import com.solana.mobilewalletadapter.clientlib.MobileWalletAdapter
import com.solana.mobilewalletadapter.clientlib.Solana
import com.solana.mobilewalletadapter.clientlib.TransactionResult
import com.solana.publickey.SolanaPublicKey

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
            is TransactionResult.Failure -> GatewayResult.Rejected(result.message ?: "connect rejected")
        }

    override suspend fun signMessage(sender: ActivityResultSender, message: String): GatewayResult =
        when (val result = adapter.transact(sender) { authResult ->
            signMessagesDetached(
                arrayOf(message.toByteArray()),
                arrayOf(authResult.accounts.first().publicKey),
            ).messages.first().signatures.first()
        }) {
            is TransactionResult.Success -> GatewayResult.Ok(Base58.encodeToString(result.payload))
            is TransactionResult.NoWalletFound -> GatewayResult.NoWallet
            is TransactionResult.Failure -> GatewayResult.Rejected(result.message ?: "sign rejected")
        }

    override suspend fun signTransaction(sender: ActivityResultSender, message: ByteArray): GatewayResult =
        when (val result = adapter.transact(sender) { authResult ->
            signTransaction(message, listOf(authResult.accounts.first().publicKey), false).signatures
        }) {
            is TransactionResult.Success -> GatewayResult.Ok(Base58.encodeToString(result.payload))
            is TransactionResult.NoWalletFound -> GatewayResult.NoWallet
            is TransactionResult.Failure -> GatewayResult.Rejected(result.message ?: "sign rejected")
        }

    override suspend fun disconnect(sender: ActivityResultSender): GatewayResult =
        when (val result = adapter.disconnect(sender)) {
            is TransactionResult.Success -> GatewayResult.Ok()
            is TransactionResult.NoWalletFound -> GatewayResult.NoWallet
            is TransactionResult.Failure -> GatewayResult.Rejected(result.message ?: "disconnect failed")
        }
}
