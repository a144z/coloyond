package com.coloyond.di

import android.content.Context
import com.coloyond.config.AppConfig
import com.coloyond.core.rpc.HttpRpcTransport
import com.coloyond.core.rpc.SolanaRpc
import com.coloyond.core.storage.PendingIntentStore
import com.coloyond.core.storage.PrefsStore
import com.coloyond.wallet.MockWalletGateway
import com.coloyond.wallet.MwaWalletGateway
import com.coloyond.wallet.WalletRepository

/**
 * Hand-wired singletons: no DI framework at hackathon speed (23), one clean
 * composition root (10). Every later feature module gets built here.
 */
class AppContainer(context: Context) {

    val prefs = PrefsStore(context)
    val pendingIntents = PendingIntentStore(context)

    val rpc = SolanaRpc(
        transport = HttpRpcTransport(
            connectTimeoutMs = AppConfig.connectTimeoutMs,
            readTimeoutMs = AppConfig.readTimeoutMs,
        ),
        endpoint = AppConfig.rpcUrl,
        retry = AppConfig.retry,
    )

    val wallet = WalletRepository(
        mwaGateway = MwaWalletGateway(),
        mockGateway = MockWalletGateway(),
        rpc = rpc,
        pendingIntents = pendingIntents,
        prefs = prefs,
    )
}
