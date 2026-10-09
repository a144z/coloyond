package com.coloyond.wallet

import com.solana.mobilewalletadapter.clientlib.ActivityResultSender

/**
 * No-wallet fallback path (43): skips wallet calls and returns preset
 * success, so the demo keeps running when Phantom is missing, outdated, or
 * an Intent gets blocked. Mirrors the Mock MWA Wallet behavior (37).
 */
class MockWalletGateway(
    private val fakePublicKey: String = "Ho5vmods3ZvjAegHJ8mZTnDa1zbp2Rw4HDNy8Ni2bjfU",
    private val fakeSignature: String = "5eQxqFu4Em4TrEf4qV3K5Mh5T3kx8n3k4V3Uw7Y2w5rB",
) : WalletGateway {

    override suspend fun connect(sender: ActivityResultSender) = GatewayResult.Ok(fakePublicKey)

    override suspend fun signMessage(sender: ActivityResultSender, message: String) =
        GatewayResult.Ok(fakeSignature)

    override suspend fun signAndSendMemo(sender: ActivityResultSender, memo: String, recentBlockhash: String) =
        GatewayResult.Ok(fakeSignature)

    override suspend fun disconnect(sender: ActivityResultSender) = GatewayResult.Ok()
}
