package com.coloyond.wallet

import com.coloyond.config.AppConfig
import com.coloyond.core.rpc.SignatureStatus
import com.coloyond.core.rpc.SolanaRpc
import com.coloyond.core.storage.PendingIntentStore
import com.coloyond.core.storage.PrefsStore
import com.solana.mobilewalletadapter.clientlib.ActivityResultSender
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Orchestrates the demo path connect -> sign message -> sign transaction
 * (41). Enforces the ruleset: connect and sign are separate user actions
 * (36), nothing ever fails silently (21), signed transactions are verified
 * against on-chain events (21), and the whole gateway is swappable for the
 * Mock Mode fallback (43).
 *
 * Each operation reads the demo-mode flag once at its start, and the flag
 * cannot change while an operation runs, so one operation never mixes the
 * mock and real paths.
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

    /** Bumped on every connect, disconnect, and mode switch; late results from an older session are dropped. */
    private var session = 0L

    private val connectedAddress: String?
        get() = (_state.value as? WalletState.Connected)?.publicKeyBase58

    private val busy: Boolean
        get() = _state.value is WalletState.Connecting || _state.value is WalletState.Signing

    private fun gatewayFor(mock: Boolean): WalletGateway = if (mock) mockGateway else mwaGateway

    /** Rule 21: on an Activity reload, surface an interrupted transaction. */
    fun reportPendingIntents() {
        pendingIntents.pending()?.let { notice ->
            _feedback.value = "Pending transaction from an earlier session: $notice"
        }
    }

    suspend fun connect(sender: ActivityResultSender) {
        val mock = prefs.currentMockMode
        val thisSession = ++session
        _state.value = WalletState.Connecting
        _feedback.value = null
        val result = try {
            gatewayFor(mock).connect(sender)
        } catch (cancelled: CancellationException) {
            _state.value = WalletState.Disconnected
            throw cancelled
        }
        when (result) {
            is GatewayResult.Ok -> {
                val address = result.payload ?: return fail("Wallet returned no account")
                _state.value = WalletState.Connected(address)
                if (mock) {
                    _feedback.value = "Demo mode: connected to a simulated wallet"
                    return
                }
                val balance = attempt { rpc.getBalance(address) }
                // The user may have signed, disconnected, or switched mode meanwhile.
                if (session != thisSession || _feedback.value != null) return
                _feedback.value = balance.fold(
                    onSuccess = { "Connected on ${AppConfig.blockchainLabel} · balance $it lamports" },
                    onFailure = { "Connected · balance check failed: ${it.message}" },
                )
            }
            GatewayResult.NoWallet -> fail("No MWA-compatible wallet found")
            is GatewayResult.Rejected -> fail(result.reason)
        }
    }

    suspend fun signMessage(sender: ActivityResultSender, message: String) {
        val address = connectedAddress
            ?: return fail("Connect first; connect and sign are separate steps")
        val mock = prefs.currentMockMode
        _state.value = WalletState.Signing("message")
        val result = try {
            gatewayFor(mock).signMessage(sender, message)
        } catch (cancelled: CancellationException) {
            _state.value = WalletState.Connected(address)
            throw cancelled
        }
        when (result) {
            is GatewayResult.Ok -> {
                _state.value = WalletState.Connected(address)
                _feedback.value = "Signature: ${result.payload}"
            }
            GatewayResult.NoWallet -> fail("No MWA-compatible wallet found", address)
            is GatewayResult.Rejected -> fail(result.reason, address)
        }
    }

    suspend fun signTransaction(sender: ActivityResultSender, memo: String) {
        val address = connectedAddress
            ?: return fail("Connect first; connect and sign are separate steps")
        val mock = prefs.currentMockMode
        pendingIntents.save("signTransaction", memo)
        _pendingNotice.value = pendingIntents.pending()
        _state.value = WalletState.Signing("transaction")
        try {
            // Demo mode never touches the network, so it needs no real blockhash.
            val blockhash = if (mock) {
                MOCK_BLOCKHASH
            } else {
                attempt { rpc.getLatestBlockhash() }.getOrElse { error ->
                    clearPending()
                    return fail("Could not fetch a blockhash: ${error.message}", address)
                }
            }
            when (val result = gatewayFor(mock).signAndSendMemo(sender, memo, blockhash)) {
                is GatewayResult.Ok -> {
                    val signature = result.payload ?: run {
                        clearPending()
                        return fail("Wallet returned no signature", address)
                    }
                    if (mock) {
                        clearPending()
                        _state.value = WalletState.Connected(address)
                        _feedback.value = "Demo mode: signature $signature accepted without the network"
                        return
                    }
                    // Saved before polling, so a crash or timeout still leaves a signature to check.
                    pendingIntents.save("signTransaction", memo, signature)
                    _pendingNotice.value = pendingIntents.pending()
                    _state.value = WalletState.Connected(address)
                    reportStatus(signature, attempt { awaitStatus(signature) })
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
        } catch (cancelled: CancellationException) {
            // Keep the pending record: the wallet may already have sent the transaction.
            _state.value = WalletState.Connected(address)
            throw cancelled
        }
    }

    private fun reportStatus(signature: String, outcome: Result<SignatureStatus?>) {
        outcome.fold(
            onSuccess = { status ->
                when {
                    status == null ->
                        _feedback.value = "Signature $signature sent; not seen on-chain yet. Kept as pending."
                    status.err != null -> {
                        clearPending()
                        _feedback.value = "Transaction $signature failed on-chain: ${status.err}"
                    }
                    else -> {
                        clearPending()
                        _feedback.value = "Signature $signature ${status.confirmationStatus} on-chain"
                    }
                }
            },
            onFailure = { error ->
                _feedback.value = "Signature $signature sent, but the status check failed: ${error.message}. Kept as pending."
            },
        )
    }

    /** Polls until the node reports the signature, or gives up and returns null. */
    private suspend fun awaitStatus(signature: String): SignatureStatus? {
        repeat(STATUS_POLLS) { poll ->
            rpc.signatureStatuses(listOf(signature)).firstOrNull()?.let { return it }
            if (poll < STATUS_POLLS - 1) delay(STATUS_POLL_DELAY_MS)
        }
        return null
    }

    suspend fun disconnect(sender: ActivityResultSender) {
        val mock = prefs.currentMockMode
        val address = connectedAddress
        session++
        _feedback.value = null
        val result = try {
            gatewayFor(mock).disconnect(sender)
        } catch (cancelled: CancellationException) {
            _state.value = WalletState.Disconnected
            throw cancelled
        }
        when (result) {
            is GatewayResult.Ok -> _state.value = WalletState.Disconnected
            GatewayResult.NoWallet -> _state.value = WalletState.Disconnected
            is GatewayResult.Rejected -> fail(result.reason, address)
        }
    }

    /** Demo-mode switch (43); connection state resets so the other gateway drives the next connect. */
    fun toggleMockMode() {
        if (busy) {
            _feedback.value = "Finish the current wallet action before switching demo mode"
            return
        }
        session++
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

    /** Like runCatching, but cancellation propagates instead of becoming a failure. */
    private inline fun <T> attempt(block: () -> T): Result<T> = try {
        Result.success(block())
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (error: Exception) {
        Result.failure(error)
    }

    private companion object {
        const val STATUS_POLLS = 5
        const val STATUS_POLL_DELAY_MS = 2_000L
        const val MOCK_BLOCKHASH = "11111111111111111111111111111111"
    }
}
