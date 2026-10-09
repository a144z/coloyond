package com.coloyond

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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.coloyond.ui.theme.ColoyondTheme
import com.solana.mobilewalletadapter.clientlib.ActivityResultSender

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val sender = ActivityResultSender(this)

        setContent {
            ColoyondTheme {
                val viewModel: MainViewModel = viewModel()
                val state by viewModel.uiState.collectAsStateWithLifecycle()

                Scaffold(modifier = Modifier.fillMaxSize()) { innerPadding ->
                    WalletScreen(
                        state = state,
                        onConnect = { viewModel.connect(sender) },
                        onSignMessage = { viewModel.signMessage(sender, "Hello from Coloyond!") },
                        onDisconnect = { viewModel.disconnect(sender) },
                        modifier = Modifier.padding(innerPadding),
                    )
                }
            }
        }
    }
}

@Composable
fun WalletScreen(
    state: WalletUiState,
    onConnect: () -> Unit,
    onSignMessage: () -> Unit,
    onDisconnect: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = "Coloyond + Mobile Wallet Adapter",
            style = MaterialTheme.typography.titleLarge,
            textAlign = TextAlign.Center,
        )
        if (state.address == null) {
            Button(onClick = onConnect, enabled = !state.isLoading) {
                Text("Connect wallet")
            }
        } else {
            Text(
                text = "Connected: ${state.address.take(4)}…${state.address.takeLast(4)}",
                style = MaterialTheme.typography.bodyLarge,
            )
            Button(onClick = onSignMessage, enabled = !state.isLoading) {
                Text("Sign message")
            }
            OutlinedButton(onClick = onDisconnect, enabled = !state.isLoading) {
                Text("Disconnect")
            }
        }
        state.message?.let {
            Text(
                text = it,
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
            onDisconnect = {},
        )
    }
}

@Preview(showBackground = true)
@Composable
fun WalletScreenConnectedPreview() {
    ColoyondTheme {
        WalletScreen(
            state = WalletUiState(address = "Ho5vmods3ZvjAegHJ8mZTnDa1zbp2Rw4HDNy8Ni2bjfU"),
            onConnect = {},
            onSignMessage = {},
            onDisconnect = {},
        )
    }
}
