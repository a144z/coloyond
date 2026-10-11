package com.coloyond.di

import android.content.Context
import com.coloyond.config.AppConfig
import com.coloyond.core.rpc.HttpRpcTransport
import com.coloyond.core.rpc.SolanaRpc
import com.coloyond.core.storage.PendingIntentStore
import com.coloyond.core.storage.PrefsStore
import com.coloyond.generation.InferenceAdapter
import com.coloyond.platform.CardStorage
import com.coloyond.protocols.coloyond.transactions.ColoyondAddresses
import com.coloyond.protocols.coloyond.transactions.SolanaCluster
import com.coloyond.protocols.coloyond.transactions.SolanaNetwork
import com.coloyond.protocols.coloyond.transactions.reader.AnchorIdlAccountDecoder
import com.coloyond.protocols.coloyond.transactions.reader.ColoyondChainReader
import com.coloyond.wallet.MockWalletGateway
import com.coloyond.wallet.MwaWalletGateway
import com.coloyond.wallet.WalletRepository
import com.coloyond.wallet.vault.VaultTransactionCoordinator

/**
 * Hand-wired singletons: no DI framework at hackathon speed (23), one clean
 * composition root (10). Every later feature module gets built here.
 */
class AppContainer(context: Context) {

    val prefs = PrefsStore(context)
    val pendingIntents = PendingIntentStore(context)
    val cards = CardStorage(context)
    val inference = InferenceAdapter()

    val rpc = SolanaRpc(
        transport = HttpRpcTransport(
            connectTimeoutMs = AppConfig.connectTimeoutMs,
            readTimeoutMs = AppConfig.readTimeoutMs,
        ),
        endpoint = AppConfig.rpcUrl,
        retry = AppConfig.retry,
    )

    val coloyondDevnet = SolanaNetwork(
        cluster = SolanaCluster.DEVNET,
        genesisHash = ColoyondAddresses.DEVNET_GENESIS_HASH,
        rpcUrl = AppConfig.rpcUrl,
    )
    val coloyondChainReader = ColoyondChainReader(
        rpc = rpc,
        network = coloyondDevnet,
        idl = AnchorIdlAccountDecoder.fromAssets(context.assets),
    )
    val vaultTransactionCoordinator = VaultTransactionCoordinator(rpc, pendingIntents)

    val wallet = WalletRepository(
        mwaGateway = MwaWalletGateway(),
        mockGateway = MockWalletGateway(),
        rpc = rpc,
        pendingIntents = pendingIntents,
        prefs = prefs,
    )
}
