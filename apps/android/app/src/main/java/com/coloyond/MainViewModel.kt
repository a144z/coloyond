package com.coloyond

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.coloyond.config.AppConfig
import com.coloyond.di.AppContainer
import com.coloyond.wallet.WalletState
import com.solana.mobilewalletadapter.clientlib.ActivityResultSender
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** Everything the wallet screen renders, merged from the repository flows. */
data class WalletUiState(
    val wallet: WalletState = WalletState.Disconnected,
    val feedback: String? = null,
    val pendingNotice: String? = null,
    val mockMode: Boolean = false,
) {
    val address: String? = (wallet as? WalletState.Connected)?.publicKeyBase58
    val shortAddress: String? = address?.let { "${it.take(4)}…${it.takeLast(4)}" }
    val busy: Boolean = wallet is WalletState.Connecting || wallet is WalletState.Signing
    val failed: String? = (wallet as? WalletState.Failed)?.reason
}

/** Thin shell over [WalletRepository]; actions map to one user tap each (36). */
class MainViewModel(private val container: AppContainer) : ViewModel() {

    private val repository = container.wallet

    val uiState: StateFlow<WalletUiState> = combine(
        repository.state,
        repository.feedback,
        repository.pendingNotice,
        container.prefs.mockMode,
    ) { wallet, feedback, pending, mock ->
        WalletUiState(wallet = wallet, feedback = feedback, pendingNotice = pending, mockMode = mock)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), WalletUiState())

    init {
        repository.reportPendingIntents()
    }

    fun connect(sender: ActivityResultSender) = viewModelScope.launch { repository.connect(sender) }

    fun signMessage(sender: ActivityResultSender) =
        viewModelScope.launch { repository.signMessage(sender, AppConfig.sampleMessage) }

    fun sendDevnetMemoTest(sender: ActivityResultSender) =
        viewModelScope.launch { repository.signTransaction(sender, AppConfig.sampleMemo) }

    fun disconnect(sender: ActivityResultSender) = viewModelScope.launch { repository.disconnect(sender) }

    fun toggleMockMode() = repository.toggleMockMode()
}
