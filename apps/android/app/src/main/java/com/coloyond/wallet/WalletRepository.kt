package com.coloyond.wallet

import com.coloyond.config.AppConfig
import com.coloyond.core.rpc.SolanaRpc
import com.coloyond.core.storage.PendingIntentStore
import com.coloyond.core.storage.PrefsStore
import com.solana.mobilewalletadapter.clientlib.ActivityResultSender
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Orchestrates the demo path connect -> sign message -> sign transaction
 * (41). Enforces the ruleset: connect and sign are separate user actions
 * (36), nothing ever fails silently (21), signed transactions are verified
 * against on-chain events (21), and the whole gateway is swappable for the
 * Mock Mode fallback (43).
 */
class WalletRepository(
    private val mwaGateway: WalletGateway,
    private val mockGateway: WalletGateway,
    private val rpc: SolanaRpc,
    private val pendingIntents: PendingIntentStore,
    private val prefs: PrefsStore,
) {

    private val _state = MutableStateFlow<WalletState>(WalletState.Disconnected)
    val state: StateFlow<WalletState> = _state

    private val _feedback = MutableStateFlow<String?>(null)
    val feedback: StateFlow<String?> = _feedback

    private val _pendingNotice = MutableStateFlow<String?>(pendingIntents.pending())
    val pendingNotice: StateFlow<String?> = _pendingNotice

    private val gateway: WalletGateway
        get() = if (prefs.currentMockMode) mockGateway else mwaGateway

    val useMockMode: Boolean
        get() = prefs.currentMockMode

    private val connectedAddress: String?
        get() = (_state.value as? WalletState.Connected)?.publicKeyBase58

    /** Rule 21: on an Activity reload, surface an interrupted transaction. */
    fun reportPendingIntents() {
        pendingIntents.pending()?.let { notice ->
            _feedback.value = "Pending transaction from an earlier session: $notice"
        }
    }

    suspend fun connect(sender: ActivityResultSender) {
        _state.value = WalletState.Connecting
        _feedback.value = null
        when (val result = gateway.connect(sender)) {
            is GatewayResult.Ok -> {
                val address = result.payload ?: return fail("Wallet returned no account")
                _state.value = WalletState.Connected(address)
                runCatching { rpc.getBalance(address) }
                    .onSuccess { balance ->
                        _feedback.value = "Connected on ${AppConfig.blockchainLabel} · balance $balance lamports"
                    }
                    .onFailure { error ->
                        _feedback.value = "Connected · balance check failed: ${error.message}"
                    }
            }
            GatewayResult.NoWallet -> fail("No MWA-compatible wallet found")
            is GatewayResult.Rejected -> fail(result.reason)
        }
    }

    suspend fun signMessage(sender: ActivityResultSender, message: String) {
        val address = connectedAddress
            ?: return fail("Connect first; connect and sign are separate steps")
        _state.value = WalletState.Signing("message")
        when (val result = gateway.signMessage(sender, message)) {
            is GatewayResult.Ok -> {
                _state.value = WalletState.Connected(address)
                _feedback.value = "Signature: ${result.payload}"
            }
            GatewayResult.NoWallet -> fail("No MWA-compatible wallet found")
            is GatewayResult.Rejected -> fail(result.reason, address)
        }
    }

    suspend fun signTransaction(sender: ActivityResultSender, memo: String) {
        val address = connectedAddress
            ?: return fail("Connect first; connect and sign are separate steps")
        pendingIntents.save("signTransaction", memo)
        _pendingNotice.value = pendingIntents.pending()
        _state.value = WalletState.Signing("transaction")
        // Demo mode never touches the network, so it needs no real blockhash.
        val blockhash = if (useMockMode) {
            MOCK_BLOCKHASH
        } else {
            runCatching { rpc.getLatestBlockhash() }.getOrElse { error ->
                clearPending()
                return fail("Could not fetch a blockhash: ${error.message}", address)
            }
        }
        when (val result = gateway.signAndSendMemo(sender, memo, blockhash)) {
            is GatewayResult.Ok -> {
                val signature = result.payload ?: run {
                    clearPending()
                    return fail("Wallet returned no signature", address)
                }
                if (useMockMode) {
                    clearPending()
                    _state.value = WalletState.Connected(address)
                    _feedback.value = "Demo mode: signature $signature accepted without the network"
                    return
                }
                runCatching { awaitStatus(signature) }
                    .onSuccess { status ->
                        clearPending()
                        _state.value = WalletState.Connected(address)
                        _feedback.value = if (status != null) {
                            "Signature $signature $status on-chain"
                        } else {
                            "Signature $signature sent; not seen on-chain yet"
                        }
                    }
                    .onFailure { error ->
                        // Keep the pending intent: the transaction may still land.
                        fail("Sent, but the status check failed: ${error.message}", address)
                    }
            }
            GatewayResult.NoWallet -> {
                clearPending()
                fail("No MWA-compatible wallet found", address)
            }
            is GatewayResult.Rejected -> {
                clearPending()
                fail(result.reason, address)
            }
        }
    }

    /** Polls until the node reports the signature, or gives up and returns null. */
    private suspend fun awaitStatus(signature: String): String? {
        repeat(STATUS_POLLS) { poll ->
            rpc.signatureStatuses(listOf(signature)).firstOrNull()?.let { return it }
            if (poll < STATUS_POLLS - 1) delay(STATUS_POLL_DELAY_MS)
        }
        return null
    }

    suspend fun disconnect(sender: ActivityResultSender) {
        _feedback.value = null
        when (val result = gateway.disconnect(sender)) {
            is GatewayResult.Ok -> _state.value = WalletState.Disconnected
            GatewayResult.NoWallet -> _state.value = WalletState.Disconnected
            is GatewayResult.Rejected -> fail(result.reason, connectedAddress)
        }
    }

    /** Demo-mode switch (43); connection state resets so the other gateway drives the next connect. */
    fun toggleMockMode() {
        prefs.setMockMode(!prefs.currentMockMode)
        _feedback.value = if (prefs.currentMockMode) {
            "Demo mode on: wallet calls are faked"
        } else {
            "Demo mode off: MWA drives wallet calls"
        }
        _state.value = WalletState.Disconnected
    }

    private fun fail(reason: String, restoreAddress: String? = connectedAddress) {
        _state.value = restoreAddress?.let { WalletState.Connected(it) } ?: WalletState.Failed(reason)
        if (restoreAddress != null) {
            _feedback.value = reason
        }
    }

    private fun clearPending() {
        pendingIntents.clear()
        _pendingNotice.value = null
    }

    private companion object {
        const val STATUS_POLLS = 5
        const val STATUS_POLL_DELAY_MS = 2_000L
        const val MOCK_BLOCKHASH = "11111111111111111111111111111111"
    }
}
