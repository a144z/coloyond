package com.coloyond

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.coloyond.config.AppConfig
import com.coloyond.core.storage.PendingActionKind
import com.coloyond.core.storage.PendingActionRecord
import com.coloyond.di.AppContainer
import com.coloyond.ui.rebalancing.ReadModelV1
import com.coloyond.ui.rebalancing.ReadModelV1Mapper
import com.coloyond.wallet.WalletState
import com.solana.mobilewalletadapter.clientlib.ActivityResultSender
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlin.coroutines.cancellation.CancellationException

data class PortfolioUiState(
    val loading: Boolean = false,
    val model: ReadModelV1? = null,
    val error: String? = null,
    val pendingAction: PendingActionRecord? = null,
    val reconciliationNotice: String? = null,
)

/** Everything the wallet screen renders, merged from the repository flows. */
data class WalletUiState(
    val wallet: WalletState = WalletState.Disconnected,
    val feedback: String? = null,
    val pendingNotice: String? = null,
    val mockMode: Boolean = false,
    val portfolio: PortfolioUiState = PortfolioUiState(),
) {
    val address: String? = (wallet as? WalletState.Connected)?.publicKeyBase58
    val shortAddress: String? = address?.let { "${it.take(4)}…${it.takeLast(4)}" }
    val busy: Boolean = wallet is WalletState.Connecting || wallet is WalletState.Signing
    val failed: String? = (wallet as? WalletState.Failed)?.reason
}

/** Thin shell over [WalletRepository]; actions map to one user tap each (36). */
class MainViewModel(private val container: AppContainer) : ViewModel() {

    private val repository = container.wallet
    private val portfolioState = MutableStateFlow(PortfolioUiState())

    val uiState: StateFlow<WalletUiState> = combine(
        repository.state,
        repository.feedback,
        repository.pendingNotice,
        container.prefs.mockMode,
        portfolioState,
    ) { wallet, feedback, pending, mock, portfolio ->
        WalletUiState(wallet = wallet, feedback = feedback, pendingNotice = pending, mockMode = mock, portfolio = portfolio)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), WalletUiState())

    init {
        repository.reportPendingIntents()
        viewModelScope.launch {
            val (pending, error) = reconcilePendingVaultAction()
            portfolioState.value = portfolioState.value.copy(pendingAction = pending, reconciliationNotice = error)
        }
    }

    fun connect(sender: ActivityResultSender) = viewModelScope.launch { repository.connect(sender) }

    fun signMessage(sender: ActivityResultSender) =
        viewModelScope.launch { repository.signMessage(sender, AppConfig.sampleMessage) }

    fun sendDevnetMemoTest(sender: ActivityResultSender) =
        viewModelScope.launch { repository.signTransaction(sender, AppConfig.sampleMemo) }

    fun disconnect(sender: ActivityResultSender) = viewModelScope.launch { repository.disconnect(sender) }

    fun toggleMockMode() = repository.toggleMockMode()

    /** Reads the pinned Devnet vault and reconciles an existing signed action; it never sends or rebuilds. */
    fun refreshPortfolio() = viewModelScope.launch {
        portfolioState.value = portfolioState.value.copy(
            loading = true,
            model = null,
            error = null,
            reconciliationNotice = null,
        )
        var pending = portfolioState.value.pendingAction
        var reconcileError: String? = null
        try {
            val reconciliation = reconcilePendingVaultAction()
            pending = reconciliation.first
            reconcileError = reconciliation.second
            val walletAddress = if (container.prefs.mockMode.value) null
            else (repository.state.value as? WalletState.Connected)?.publicKeyBase58
            val snapshot = container.coloyondChainReader.read(walletAddress)
            portfolioState.value = PortfolioUiState(
                loading = false,
                model = ReadModelV1Mapper.from(snapshot, container.coloyondDevnet, walletAddress),
                pendingAction = pending,
                reconciliationNotice = reconcileError,
            )
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            portfolioState.value = PortfolioUiState(
                loading = false,
                error = error.message ?: "Could not read the pinned Devnet vault snapshot",
                pendingAction = pending,
                reconciliationNotice = reconcileError,
            )
        }
    }

    private suspend fun reconcilePendingVaultAction(): Pair<PendingActionRecord?, String?> {
        val current = container.pendingIntents.current() ?: return null to null
        if (current.kind !in setOf(PendingActionKind.VAULT_DEPOSIT, PendingActionKind.VAULT_REDEEM) || current.state.isTerminal) {
            return current to null
        }
        return try {
            container.vaultTransactionCoordinator.reconcilePending() to null
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            current to (error.message ?: "Pending wallet action still needs reconciliation")
        }
    }
}
