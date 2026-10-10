package com.coloyond.ui.rebalancing

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.coloyond.PortfolioUiState
import com.coloyond.core.storage.PendingActionKind

/** Read-only v0.3.0 Devnet route; wallet transaction controls stay disabled while admission gates are held. */
@Composable
fun PortfolioRoute(
    state: PortfolioUiState,
    walletAddress: String?,
    mockMode: Boolean,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxSize()) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text("Coloyond vault · v0.3.0", style = MaterialTheme.typography.titleLarge)
            Text(
                "Live Devnet RPC snapshot · read-only. ETF v1 is a separate protocol and is not represented here.",
                style = MaterialTheme.typography.bodySmall,
            )
            Text(
                if (mockMode) "Demo wallet mode · no demo address is used for an on-chain wallet lookup."
                else if (walletAddress == null) "Wallet not connected · portfolio facts are still read from RPC."
                else "Wallet · ${shortAddress(walletAddress)}",
                style = MaterialTheme.typography.bodySmall,
            )
            Text(
                "Deposit, swap and rebalance actions are unavailable while asset, deployment, economics and wallet-identity gates remain open. Saved cards and drafts do not authorize transactions.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onRefresh, enabled = !state.loading) {
                    Text(if (state.loading) "Reading RPC…" else "Refresh from RPC")
                }
                if (state.pendingAction?.kind == PendingActionKind.VAULT_DEPOSIT ||
                    state.pendingAction?.kind == PendingActionKind.VAULT_REDEEM
                ) {
                    OutlinedButton(onClick = onRefresh, enabled = !state.loading) {
                        Text("Reconcile pending")
                    }
                }
            }
            state.reconciliationNotice?.let {
                Text("Pending action · $it", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
            }
            state.pendingAction?.takeIf {
                it.kind == PendingActionKind.VAULT_DEPOSIT || it.kind == PendingActionKind.VAULT_REDEEM
            }?.let { pending ->
                Text(
                    "Pending ${pending.kind.name.lowercase().replace('_', ' ')} · ${pending.state.name.lowercase().replace('_', ' ')}\nSignature: ${pending.signature ?: "not available"}\n${pending.lastError ?: "No resend is offered from this screen."}",
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
            }
            state.error?.let {
                Text("RPC read unavailable · $it", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
            }
        }
        val model = state.model
        if (model != null) {
            PortfolioStatusScreen(model = model, modifier = Modifier.weight(1f))
        } else if (!state.loading && state.error == null) {
            Text(
                "No RPC snapshot loaded yet.",
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                style = MaterialTheme.typography.bodyMedium,
            )
        }
    }
}

private fun shortAddress(address: String): String = if (address.length <= 12) address else "${address.take(4)}…${address.takeLast(4)}"
