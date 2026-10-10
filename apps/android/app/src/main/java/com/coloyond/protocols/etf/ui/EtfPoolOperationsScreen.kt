package com.coloyond.protocols.etf.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.coloyond.protocols.etf.presentation.EtfAssetPresentation
import com.coloyond.protocols.etf.presentation.EtfOraclePresentation
import com.coloyond.protocols.etf.presentation.EtfPresentationState
import com.coloyond.protocols.etf.presentation.EtfPresentationText
import com.coloyond.protocols.etf.presentation.EtfSwapPreviewPresentation
import com.coloyond.protocols.etf.presentation.EtfWalletActionState

/** Synthetic, display-only S5G composition. It has no wallet, RPC, or transaction capability. */
@Composable
fun EtfPoolOperationsScreen(
    state: EtfPresentationState,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("ETF Pool Lab · provisional", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.semantics { heading() })
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(EtfPresentationText.SYNTHETIC_NOTICE, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.error)
                Text(
                    "Sample presentation only. No live pool, oracle, wallet, or transaction is connected.",
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }

        Section("Deployment · sample data") {
            Fact("Cluster", "Solana Devnet · synthetic preview")
            Fact("Genesis hash", EtfPresentationText.optional(state.genesisHash), code = true)
            Fact("Program ID", EtfPresentationText.optional(state.programId), code = true)
            Fact("Pool address", EtfPresentationText.optional(state.poolAddress), code = true)
            Fact("Config revision", EtfPresentationText.optional(state.configRevision), code = true)
            Fact("Observed slot", EtfPresentationText.optional(state.observedSlot), code = true)
        }

        Section("Pool overview · estimates only") {
            Fact("Estimated NAV · not an execution quote", EtfPresentationText.usd(state.estimatedNavUsd))
            Fact("Share mint", EtfPresentationText.optional(state.shareMint), code = true)
            Fact("Total shares · sample base units", EtfPresentationText.tokenAmount(state.totalShareSupplyBaseUnits, 6), code = true)
            Fact("Wallet shares · sample base units", EtfPresentationText.tokenAmount(state.walletShareBalanceBaseUnits, 6), code = true)
            Fact("Fee observations", EtfPresentationText.optional(state.feeObservation))
        }

        Section("Assets · synthetic / unbacked test mints") {
            if (state.assets.isEmpty()) Fact("Asset list", "Unknown")
            state.assets.forEach { AssetCard(it) }
        }

        Section("Swap preview · not a fill guarantee") {
            state.swapPreview?.let { SwapPreview(it) } ?: Fact("Preview", "Unavailable · no quote supplied")
        }

        Section("Wallet action status · sample only") {
            val action = state.walletAction
            if (action == null) {
                Fact("Status", "No wallet action · this screen cannot sign or submit")
            } else {
                Fact("Status", EtfPresentationText.walletAction(action.state))
                Fact("Signature", EtfPresentationText.optional(action.signature), code = true)
                if (action.state == EtfWalletActionState.CONFIRMED) {
                    Fact("Confirmation slot", EtfPresentationText.optional(action.confirmationSlot), code = true)
                }
                action.detail?.let { Fact("Detail", it) }
            }
        }

        Section("Financial actions") {
            Text("Disabled until the real ETF client, reviewed deployment, and S5H Devnet evidence are integrated.", style = MaterialTheme.typography.bodySmall)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = {}, enabled = false) { Text("Initialize") }
                Button(onClick = {}, enabled = false) { Text("Seed") }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = {}, enabled = false) { Text("Swap") }
                OutlinedButton(onClick = {}, enabled = false) { Text("Redeem") }
            }
        }
    }
}

@Composable
private fun AssetCard(asset: EtfAssetPresentation) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(asset.symbol, style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { heading() })
            Fact("Mint · synthetic / unbacked", EtfPresentationText.optional(asset.mint), code = true)
            Fact("Target weight", EtfPresentationText.weightBps(asset.targetWeightBps))
            Fact("Actual value weight", EtfPresentationText.weightBps(asset.actualValueWeightBps))
            Fact("Custody · sample", EtfPresentationText.tokenAmount(asset.custodyAmountBaseUnits, asset.decimals))
            Fact("Wallet · sample", EtfPresentationText.tokenAmount(asset.walletAmountBaseUnits, asset.decimals))
            OracleFacts(asset.oracle)
        }
    }
}

@Composable
private fun OracleFacts(oracle: EtfOraclePresentation) {
    Text("Oracle observation · sample", style = MaterialTheme.typography.titleSmall, modifier = Modifier.semantics { heading() })
    Fact("Feed ID", EtfPresentationText.optional(oracle.feedId), code = true)
    Fact("Mode", EtfPresentationText.oracleMode(oracle.mode))
    Fact("State", EtfPresentationText.oracleState(oracle.state))
    Fact("Price", EtfPresentationText.optional(oracle.price))
    Fact("Publish time", EtfPresentationText.optional(oracle.publishTime))
    Fact("Age", EtfPresentationText.ageSeconds(oracle.ageSeconds))
    Fact("Confidence", EtfPresentationText.optional(oracle.confidence))
    if (oracle.owner != null) Fact("Account owner", oracle.owner, code = true)
    if (oracle.layoutEvidence != null) Fact("Layout / update evidence", oracle.layoutEvidence)
}

@Composable
private fun SwapPreview(preview: EtfSwapPreviewPresentation) {
    Fact("Direction", "${preview.inputSymbol} → ${preview.outputSymbol}")
    Fact("Gross input · sample base units", EtfPresentationText.optional(preview.grossInputBaseUnits), code = true)
    Fact("Fee · sample base units", EtfPresentationText.optional(preview.feeBaseUnits), code = true)
    Fact("Estimated output · sample base units", EtfPresentationText.optional(preview.estimatedOutputBaseUnits), code = true)
    Fact("Minimum output · sample base units", EtfPresentationText.optional(preview.minimumOutputBaseUnits), code = true)
    Fact("Deviation before", EtfPresentationText.weightBps(preview.deviationBeforeBps))
    Fact("Deviation after", EtfPresentationText.weightBps(preview.deviationAfterBps))
    Fact("Expiry slot", EtfPresentationText.optional(preview.expirySlot), code = true)
}

@Composable
private fun Section(title: String, content: @Composable ColumnScope.() -> Unit) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { heading() })
            content()
        }
    }
}

@Composable
private fun Fact(label: String, value: String, code: Boolean = false) {
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = if (code) MaterialTheme.typography.bodySmall else MaterialTheme.typography.bodyMedium)
    }
}
