package com.coloyond.wallet

/** Wallet lifecycle states the UI renders, per the MWA one-connection model (33). */
sealed interface WalletState {
    data object Disconnected : WalletState
    data object Connecting : WalletState
    data class Connected(val publicKeyBase58: String) : WalletState
    data class Signing(val label: String) : WalletState
    data class Failed(val reason: String) : WalletState
}
