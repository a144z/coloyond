package com.coloyond

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.FilterChip
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.coloyond.di.AppContainer
import com.coloyond.platform.ImportIntents
import com.coloyond.platform.ValidatedImport
import com.coloyond.ui.screens.CardJourneyScreen
import com.coloyond.ui.theme.ColoyondTheme
import com.coloyond.wallet.WalletState
import com.solana.mobilewalletadapter.clientlib.ActivityResultSender

class MainActivity : ComponentActivity() {
    private var lastImport by mutableStateOf<ValidatedImport?>(null)
    private var importVersion by mutableIntStateOf(0)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // A process restart re-delivers the original intent; read it only on a fresh start.
        if (savedInstanceState == null) handleImport(intent)

        val sender = ActivityResultSender(this)
        val container = (application as ColoyondApplication).container

        setContent {
            ColoyondTheme {
                val viewModel: MainViewModel = viewModel { MainViewModel(container) }
                val state by viewModel.uiState.collectAsStateWithLifecycle()

                var showCards by rememberSaveable { mutableStateOf(true) }

                Scaffold(modifier = Modifier.fillMaxSize()) { innerPadding ->
                    Column(modifier = Modifier.padding(innerPadding)) {
                        Row(
                            modifier = Modifier.padding(horizontal = 16.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            FilterChip(selected = showCards, onClick = { showCards = true }, label = { Text("Cards") })
                            FilterChip(selected = !showCards, onClick = { showCards = false }, label = { Text("Wallet · Devnet") })
                        }
                        if (showCards) {
                            CardJourneyScreen(
                                storage = container.cards,
                                inference = container.inference,
                                imported = lastImport,
                                importVersion = importVersion,
                                onImportConsumed = { lastImport = null },
                            )
                        } else {
                            WalletScreen(
                                state = state,
                                onConnect = { viewModel.connect(sender) },
                                onSignMessage = { viewModel.signMessage(sender) },
                                onSendMemoTest = { viewModel.sendDevnetMemoTest(sender) },
                                onDisconnect = { viewModel.disconnect(sender) },
                                onToggleMockMode = { viewModel.toggleMockMode() },
                            )
                        }
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleImport(intent)
    }

    private fun handleImport(intent: Intent) {
        ImportIntents.readValidated(intent, contentResolver)?.let {
            lastImport = it
            importVersion += 1
        }
    }
}

@Composable
fun WalletScreen(
    state: WalletUiState,
    onConnect: () -> Unit,
    onSignMessage: () -> Unit,
    onSendMemoTest: () -> Unit,
    onDisconnect: () -> Unit,
    onToggleMockMode: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val walletModeDetails = if (state.mockMode) {
        "Mock mode simulates wallet calls and sends no network transaction."
    } else {
        "The Memo test is a Devnet transaction and may use Devnet SOL for fees."
    }
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = "Devnet wallet test",
            style = MaterialTheme.typography.titleLarge,
            textAlign = TextAlign.Center,
        )
        Text(
            text = "Solana ${com.coloyond.config.AppConfig.blockchainLabel} · ${if (state.mockMode) "mock wallet mode" else "real wallet mode"}\n$walletModeDetails No vault, rebalance, purchase or sale is available here.",
            style = MaterialTheme.typography.bodySmall,
            textAlign = TextAlign.Center,
        )
        if (state.address == null) {
            Button(onClick = onConnect, enabled = !state.busy) {
                Text(if (state.wallet is WalletState.Connecting) "Connecting…" else "Connect wallet")
            }
        } else {
            Text(
                text = "Connected: ${state.shortAddress}",
                style = MaterialTheme.typography.bodyLarge,
            )
            Button(onClick = onSignMessage, enabled = !state.busy) {
                Text("Sign message")
            }
            Button(onClick = onSendMemoTest, enabled = !state.busy) {
                Text("Send Devnet Memo test")
            }
            OutlinedButton(onClick = onDisconnect, enabled = !state.busy) {
                Text("Disconnect")
            }
        }
        OutlinedButton(onClick = onToggleMockMode, enabled = !state.busy) {
            Text("Demo mode: ${if (state.mockMode) "on" else "off"} (43)")
        }
        state.failed?.let {
            Text(
                text = it,
                style = MaterialTheme.typography.bodySmall,
                textAlign = TextAlign.Center,
            )
        }
        state.feedback?.let {
            Text(
                text = it,
                style = MaterialTheme.typography.bodySmall,
                textAlign = TextAlign.Center,
            )
        }
        state.pendingNotice?.let {
            Text(
                text = "Pending intent: $it",
                style = MaterialTheme.typography.bodySmall,
                textAlign = TextAlign.Center,
            )
        }
    }
}

@Preview(showBackground = true)
@Composable
fun WalletScreenDisconnectedPreview() {
    ColoyondTheme {
        WalletScreen(
            state = WalletUiState(),
            onConnect = {},
            onSignMessage = {},
            onSendMemoTest = {},
            onDisconnect = {},
            onToggleMockMode = {},
        )
    }
}

@Preview(showBackground = true)
@Composable
fun WalletScreenConnectedPreview() {
    ColoyondTheme {
        WalletScreen(
            state = WalletUiState(
                wallet = WalletState.Connected("Ho5vmods3ZvjAegHJ8mZTnDa1zbp2Rw4HDNy8Ni2bjfU"),
                feedback = "Signature: 5eQxqFu4…",
            ),
            onConnect = {},
            onSignMessage = {},
            onSendMemoTest = {},
            onDisconnect = {},
            onToggleMockMode = {},
        )
    }
}
