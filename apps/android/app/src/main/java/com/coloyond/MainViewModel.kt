package com.coloyond

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.funkatronics.encoders.Base58
import com.solana.mobilewalletadapter.clientlib.ActivityResultSender
import com.solana.mobilewalletadapter.clientlib.ConnectionIdentity
import com.solana.mobilewalletadapter.clientlib.MobileWalletAdapter
import com.solana.mobilewalletadapter.clientlib.Solana
import com.solana.mobilewalletadapter.clientlib.TransactionResult
import com.solana.publickey.SolanaPublicKey
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class WalletUiState(
    val address: String? = null,
    val isLoading: Boolean = false,
    val message: String? = null,
)

class MainViewModel : ViewModel() {

    // Replace with your app's own domain and host a Digital Asset Links file there so
    // wallets can verify your app identity: https://docs.solanamobile.com/android-native/using_mobile_wallet_adapter
    private val walletAdapter = MobileWalletAdapter(
        connectionIdentity = ConnectionIdentity(
            identityUri = Uri.parse("https://yourdapp.com"),
            iconUri = Uri.parse("favicon.ico"),
            identityName = "Coloyond",
        )
    ).apply {
        blockchain = Solana.Devnet
    }

    private val _uiState = MutableStateFlow(WalletUiState())
    val uiState: StateFlow<WalletUiState> = _uiState.asStateFlow()

    fun connect(sender: ActivityResultSender) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, message = null) }
            when (val result = walletAdapter.connect(sender)) {
                is TransactionResult.Success -> _uiState.update {
                    it.copy(
                        address = SolanaPublicKey(result.authResult.accounts.first().publicKey).base58(),
                        isLoading = false,
                    )
                }
                is TransactionResult.NoWalletFound -> _uiState.update {
                    it.copy(isLoading = false, message = result.message)
                }
                is TransactionResult.Failure -> _uiState.update {
                    it.copy(isLoading = false, message = result.message)
                }
            }
        }
    }

    fun signMessage(sender: ActivityResultSender, message: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, message = null) }
            val result = walletAdapter.transact(sender) { authResult ->
                signMessagesDetached(
                    arrayOf(message.encodeToByteArray()),
                    arrayOf(authResult.accounts.first().publicKey),
                ).messages.first().signatures.first()
            }
            when (result) {
                is TransactionResult.Success -> _uiState.update {
                    it.copy(
                        address = SolanaPublicKey(result.authResult.accounts.first().publicKey).base58(),
                        isLoading = false,
                        message = "Signature: ${Base58.encodeToString(result.payload)}",
                    )
                }
                is TransactionResult.NoWalletFound -> _uiState.update {
                    it.copy(isLoading = false, message = result.message)
                }
                is TransactionResult.Failure -> _uiState.update {
                    it.copy(isLoading = false, message = result.message)
                }
            }
        }
    }

    fun disconnect(sender: ActivityResultSender) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, message = null) }
            when (val result = walletAdapter.disconnect(sender)) {
                is TransactionResult.Success -> _uiState.value = WalletUiState()
                is TransactionResult.NoWalletFound -> _uiState.update {
                    it.copy(isLoading = false, message = result.message)
                }
                is TransactionResult.Failure -> _uiState.update {
                    it.copy(isLoading = false, message = result.message)
                }
            }
        }
    }
}
