package com.coloyond.ui.screens

import android.content.Intent
import android.os.SystemClock
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.res.ResourcesCompat
import com.coloyond.R
import com.coloyond.platform.CardExport
import com.coloyond.platform.CardLayoutV1
import com.coloyond.platform.ImportProbeResult
import com.coloyond.platform.Sharing
import com.coloyond.platform.drawProbeCard

private const val PROBE_CAPTION = "Two weights lean on one quiet line, and the red holds its ground."
private const val PROBE_FOOTER = "cb2:7c4a91…e912b7 · Target weights · saved configuration · SOL 60% · JUP 40% · solana"
private const val PROBE_SEED = 20261010
private val PROBE_STRATEGY = """{"probe":true,"note":"Task 1 device probe file, not a strategy record"}""".toByteArray()

/** Task 1 device probe: shared on-screen/export drawing, PNG export, sharing, and import reads. */
@Composable
fun ProbeScreen(lastImport: ImportProbeResult?, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val typeface = remember { requireNotNull(ResourcesCompat.getFont(context, R.font.arimo)) }
    var status by remember { mutableStateOf<String?>(null) }

    fun export(): Pair<android.net.Uri, android.net.Uri> {
        val started = SystemClock.elapsedRealtime()
        val png = CardExport.renderPng { drawProbeCard(PROBE_CAPTION, PROBE_FOOTER, typeface, PROBE_SEED) }
        val pngUri = Sharing.stage(context, "coloyond-card.png", png)
        val jsonUri = Sharing.stage(context, "card.coloyond.json", PROBE_STRATEGY)
        status = "Exported ${png.size / 1024} KiB PNG in ${SystemClock.elapsedRealtime() - started} ms"
        return pngUri to jsonUri
    }

    fun launch(intent: Intent) = context.startActivity(Intent.createChooser(intent, "Share card"))

    Column(
        modifier = modifier
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Device probe (Task 1)", style = MaterialTheme.typography.titleLarge)
        Canvas(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(CardLayoutV1.WIDTH / CardLayoutV1.HEIGHT),
        ) { drawProbeCard(PROBE_CAPTION, PROBE_FOOTER, typeface, PROBE_SEED) }
        Button(onClick = { val (png, json) = export(); launch(Sharing.cardAndStrategy(png, json)) }) {
            Text("Share PNG and strategy file")
        }
        OutlinedButton(onClick = { launch(Sharing.single(export().first, "image/png")) }) {
            Text("Share PNG only")
        }
        OutlinedButton(onClick = { launch(Sharing.single(export().second, Sharing.JSON_MIME)) }) {
            Text("Share strategy file only")
        }
        status?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        Text(
            text = "Last import: " + when (lastImport) {
                null -> "none"
                is ImportProbeResult.Link -> "link, ${lastImport.payloadChars}-character payload"
                is ImportProbeResult.File -> "file, ${lastImport.bytes.size} bytes, type ${lastImport.mime ?: "unknown"}"
                is ImportProbeResult.Rejected -> "rejected (${lastImport.reason})"
            },
            style = MaterialTheme.typography.bodySmall,
        )
    }
}
