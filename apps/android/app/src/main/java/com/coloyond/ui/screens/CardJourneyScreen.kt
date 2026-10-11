package com.coloyond.ui.screens

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import com.coloyond.generation.InferenceAdapter
import com.coloyond.platform.CardExport
import com.coloyond.platform.CardStorage
import com.coloyond.platform.ValidatedImport
import com.coloyond.platform.InferenceCredentials
import com.coloyond.platform.SavedCard
import com.coloyond.platform.SceneRenderer
import com.coloyond.platform.Sharing
import com.coloyond.strategy.CardExchange
import com.coloyond.strategy.ValidatedRecord
import com.coloyond.ui.cards.create.CardCreationRecords
import com.coloyond.ui.cards.create.CardCreationScreen
import com.coloyond.ui.cards.share.CardRemixSelection

/** Native card lifecycle. Imported records stay inspect-only until a separate on-chain flow exists. */
@Composable
fun CardJourneyScreen(
    storage: CardStorage,
    inference: InferenceAdapter,
    imported: ValidatedImport?,
    importVersion: Int,
    onImportConsumed: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val typeface = remember(context) { SceneRenderer.exportTypeface(context) }
    var page by rememberSaveable { mutableStateOf("create") }
    var sessionKey by remember { mutableStateOf("") }
    var pendingImport by remember { mutableStateOf<ValidatedImport?>(null) }
    var importedStrategy by remember { mutableStateOf<ValidatedRecord?>(null) }
    var remix by remember { mutableStateOf<CardRemixSelection?>(null) }
    var draft by remember { mutableStateOf<ValidatedRecord?>(null) }
    var saved by remember { mutableStateOf<SavedCard?>(null) }
    var cards by remember { mutableStateOf(storage.list()) }
    var drafts by remember { mutableStateOf(storage.listDrafts()) }
    var message by remember { mutableStateOf<String?>(null) }
    var gliderReview by remember { mutableStateOf<GliderHandoffReview?>(null) }

    fun refresh() {
        cards = storage.list()
        drafts = storage.listDrafts()
    }

    fun reviewGliderHandoff(strategy: ValidatedRecord) {
        gliderReview = runCatching { makeGliderHandoffReview(strategy) }.getOrNull()
        message = if (gliderReview == null) "This allocation cannot be shown for manual setup." else null
    }

    fun exploreWeights(strategy: ValidatedRecord): Boolean {
        val newDraft = runCatching { makeWeightExplorationDraft(strategy) }
            .mapCatching(storage::saveDraft)
            .getOrNull()
        if (newDraft == null) {
            message = "A separate allocation draft could not be created. The original card is unchanged."
            return false
        }
        draft = newDraft
        importedStrategy = null
        remix = null
        saved = null
        page = "create"
        message = "New local allocation draft created. The original strategy and card are unchanged."
        refresh()
        return true
    }

    LaunchedEffect(importVersion) {
        imported?.let {
            pendingImport = it
            page = "library"
            message = null
        }
    }

    Column(modifier = modifier.fillMaxSize()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            FilterChip(selected = page == "create", onClick = { page = "create" }, label = { Text("Create") })
            FilterChip(selected = page == "library", onClick = { page = "library" }, label = { Text("Library · ${cards.size + drafts.size}") })
        }
        Text(
            "Card creation does not use a wallet or RPC. Allocation drafts are tagged Solana mainnet-beta; the separate wallet demo uses Devnet.",
            modifier = Modifier.padding(horizontal = 16.dp),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (page == "create") {
            Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp)) {
                Text("Optional · your Anthropic key stays in memory for this session", style = MaterialTheme.typography.bodySmall)
                BasicTextField(
                    value = sessionKey,
                    onValueChange = { sessionKey = it.take(4096) },
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp).border(1.dp, MaterialTheme.colorScheme.outline).padding(12.dp),
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    textStyle = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
                    decorationBox = { inner ->
                        if (sessionKey.isEmpty()) Text("API key · blank uses a labeled local preview", style = MaterialTheme.typography.bodyMedium)
                        inner()
                    },
                )
            }
            CardCreationScreen(
                publishedVaults = emptyList(),
                inference = inference,
                credentials = { InferenceCredentials.fromUserInput(sessionKey) },
                storage = storage,
                initialDraft = draft,
                importedStrategy = importedStrategy,
                remix = remix,
                onDraftSaved = { storage.saveDraft(it); refresh() },
                onCaptionAccepted = {},
                onSaved = { saved = it; refresh(); message = "Card saved on this device." },
                modifier = Modifier.weight(1f),
            )
            saved?.let { SavedCardActions(it, onShare = { shareCard(context, it) }, onPng = { sharePng(context, it) }, onLink = {
                copyText(context, Sharing.strategyLink(it.strategy))
                message = "Strategy link copied · no image or transaction data included."
            }, onGlider = { reviewGliderHandoff(it.strategy) }, onExploreWeights = { exploreWeights(it.strategy) }) }
            message?.let { Text(it, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp), style = MaterialTheme.typography.bodySmall) }
        } else {
            Column(
                modifier = Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                pendingImport?.let { incoming ->
                    ImportReview(
                        incoming = incoming,
                        onCreate = { strategy ->
                            importedStrategy = strategy
                            draft = null
                            remix = null
                            saved = null
                            page = "create"
                            pendingImport = null
                            onImportConsumed()
                        },
                        onRemix = { strategy, expression ->
                            importedStrategy = null
                            draft = null
                            remix = runCatching { CardRemixSelection(strategy, expression) }.getOrNull()
                            if (remix != null) {
                                saved = null
                                page = "create"
                                pendingImport = null
                                onImportConsumed()
                            }
                        },
                        onSave = { card ->
                            val expression = card.expression
                            if (expression == null) {
                                message = "This strategy-only import has no card expression to save."
                            } else {
                                runCatching { CardExport.renderCardPng(expression, card.strategy, typeface) }
                                    .onSuccess { rendered ->
                                        when (rendered) {
                                            is CardExport.Result.Png -> runCatching { storage.save(card.strategy, expression, rendered.bytes) }
                                                .onSuccess { refresh(); message = "Validated card imported and saved locally." }
                                                .onFailure { message = "The imported card could not be saved locally." }
                                            is CardExport.Result.ViewOnly -> message = "Renderer ${rendered.rendererVersion} is view-only; the imported record was not rewritten."
                                        }
                                    }
                                    .onFailure { message = "The imported card could not be rendered and was not rewritten." }
                                }
                        },
                        onExploreWeights = { strategy ->
                            if (exploreWeights(strategy)) {
                                pendingImport = null
                                onImportConsumed()
                            }
                        },
                        onDismiss = { pendingImport = null; onImportConsumed() },
                    )
                }
                message?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                Text("SAVED CARDS", style = MaterialTheme.typography.labelMedium, fontFamily = FontFamily.Monospace)
                if (cards.isEmpty()) Text("No saved cards yet. Create one, or open a shared .coloyond.json file or strategy link.")
                cards.forEach { card ->
                    SavedCardTile(
                        card = card,
                        onShare = { shareCard(context, card) },
                        onRemix = {
                            remix = runCatching { CardRemixSelection(card.strategy, card.expression) }.getOrNull()
                            if (remix != null) {
                                importedStrategy = null; draft = null; saved = null; page = "create"
                            }
                        },
                        onGlider = { reviewGliderHandoff(card.strategy) },
                        onExploreWeights = { exploreWeights(card.strategy) },
                    )
                }
                Text("ALLOCATION DRAFTS", style = MaterialTheme.typography.labelMedium, fontFamily = FontFamily.Monospace)
                if (drafts.isEmpty()) Text("Drafts are created from full mint addresses and desired weights.")
                drafts.forEach { item ->
                    val weights = runCatching { CardCreationRecords.targetWeights(item) }.getOrDefault(emptyList())
                    Column(Modifier.fillMaxWidth().border(1.dp, MaterialTheme.colorScheme.outline).padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("${item.id.take(14)}… · local, inspect-only")
                        weights.forEach { Text("${it.mint} · ${CardCreationRecords.formatPercent(it.weightBps)}", style = MaterialTheme.typography.bodySmall) }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(onClick = { draft = item; importedStrategy = null; remix = null; saved = null; page = "create" }) { Text("Create card") }
                            OutlinedButton(onClick = { reviewGliderHandoff(item) }) { Text("Manual Glider handoff") }
                        }
                    }
                }
            }
        }
    }

    gliderReview?.let { review ->
        GliderHandoffReviewDialog(
            review = review,
            onReviewChanged = { reviewed -> gliderReview = review.copy(disclosureReviewed = reviewed) },
            onCopy = {
                copyText(context, review.allocationText)
                gliderReview = review.copy(allocationCopied = true)
            },
            onOpen = {
                if (review.canOpen) {
                    val opened = runCatching {
                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(review.url)))
                    }.isSuccess
                    if (opened) {
                        gliderReview = null
                        message = "Glider opened. Coloyond cannot observe setup, funding or results."
                    } else {
                        gliderReview = null
                        message = "No app could open Glider. Your saved card was not changed."
                    }
                }
            },
            onDismiss = { gliderReview = null },
        )
    }
}

@Composable
private fun GliderHandoffReviewDialog(
    review: GliderHandoffReview,
    onReviewChanged: (Boolean) -> Unit,
    onCopy: () -> Unit,
    onOpen: () -> Unit,
    onDismiss: () -> Unit,
) {
    Dialog(onDismissRequest = onDismiss) {
        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = MaterialTheme.shapes.large,
            color = MaterialTheme.colorScheme.surface,
        ) {
            Column(
                modifier = Modifier
                    .heightIn(max = 560.dp)
                    .verticalScroll(rememberScrollState())
                    .padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Text("Review before opening Glider", style = MaterialTheme.typography.titleLarge)
                Text(
                    "Enter these target weights yourself. Coloyond sends no allocation, wallet address or identifier to Glider.",
                    style = MaterialTheme.typography.bodyMedium,
                )
                review.allocations.forEach { allocation ->
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(allocation.percent, style = MaterialTheme.typography.titleMedium)
                        Text(allocation.displayMint, style = MaterialTheme.typography.bodySmall)
                    }
                }
                Text(review.disclosure, style = MaterialTheme.typography.bodyMedium)
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .toggleable(
                            value = review.disclosureReviewed,
                            role = Role.Checkbox,
                            onValueChange = onReviewChanged,
                        ),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Checkbox(checked = review.disclosureReviewed, onCheckedChange = null)
                    Text("I have reviewed the full disclosure", style = MaterialTheme.typography.bodySmall)
                }
                Button(onClick = onOpen, enabled = review.canOpen, modifier = Modifier.fillMaxWidth()) {
                    Text("Open Glider")
                }
                if (review.allocationCopied) {
                    Text("Weights copied. Enter them manually in Glider.", style = MaterialTheme.typography.bodySmall)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                    OutlinedButton(onClick = onCopy, modifier = Modifier.weight(1f)) { Text("Copy weights") }
                    TextButton(onClick = onDismiss, modifier = Modifier.weight(1f)) { Text("Cancel") }
                }
            }
        }
    }
}

@Composable
private fun ImportReview(
    incoming: ValidatedImport,
    onCreate: (ValidatedRecord) -> Unit,
    onExploreWeights: (ValidatedRecord) -> Unit,
    onRemix: (ValidatedRecord, ValidatedRecord) -> Unit,
    onSave: (CardExchange.PortableCard) -> Unit,
    onDismiss: () -> Unit,
) {
    val card = when (incoming) {
        is ValidatedImport.StrategyOnly -> CardExchange.PortableCard(incoming.strategy, null, CardExchange.export(incoming.strategy))
        is ValidatedImport.CardFile -> incoming.card
        is ValidatedImport.Rejected -> null
    }
    Column(Modifier.fillMaxWidth().border(1.dp, MaterialTheme.colorScheme.outline).padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("INCOMING IMPORT", style = MaterialTheme.typography.labelMedium, fontFamily = FontFamily.Monospace)
        when {
            incoming is ValidatedImport.Rejected -> Text("Import rejected · ${incoming.reason}")
            card == null -> Text("Import could not be validated. The file and its media type are not trusted.")
            else -> {
                Text("Validated strategy · ${card.strategy.id.take(18)}…")
                Text("This content hash proves record integrity only. It does not prove a live, published or funded vault.", style = MaterialTheme.typography.bodySmall)
                val weights = runCatching { CardCreationRecords.targetWeights(card.strategy) }.getOrNull()
                weights?.forEach { Text("${it.mint} · ${CardCreationRecords.formatPercent(it.weightBps)}", style = MaterialTheme.typography.bodySmall) }
                if (card.expression != null) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = { onSave(card) }, modifier = Modifier.weight(1f)) { Text("Save imported card") }
                        OutlinedButton(onClick = { onRemix(card.strategy, card.expression) }, modifier = Modifier.weight(1f)) { Text("Visual remix") }
                    }
                }
                if (weights != null) Button(onClick = { onCreate(card.strategy) }, modifier = Modifier.fillMaxWidth()) { Text("Create artwork with this strategy") }
                else Text("This strategy version has no supported target-weight view in the current editor.", style = MaterialTheme.typography.bodySmall)
                if (weights != null) {
                    OutlinedButton(onClick = { onExploreWeights(card.strategy) }, modifier = Modifier.fillMaxWidth()) {
                        Text("Explore weights as a new draft")
                    }
                    Text("A changed allocation stays a nonexecutable draft; the imported record remains unchanged.", style = MaterialTheme.typography.bodySmall)
                }
            }
        }
        OutlinedButton(onClick = onDismiss, modifier = Modifier.heightIn(min = 44.dp)) { Text("Dismiss import") }
    }
}

@Composable
private fun SavedCardActions(
    card: SavedCard,
    onShare: () -> Unit,
    onPng: () -> Unit,
    onLink: () -> Unit,
    onGlider: () -> Unit,
    onExploreWeights: () -> Unit,
) {
    val canExploreWeights = remember(card.strategy.id) {
        runCatching { CardCreationRecords.targetWeights(card.strategy) }.isSuccess
    }
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("${if (card.viewOnly) "View-only" else "Saved"} · ${card.expression.id.take(18)}…", style = MaterialTheme.typography.bodySmall)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = onShare, modifier = Modifier.weight(1f)) { Text("Share card + strategy") }
            OutlinedButton(onClick = onPng, modifier = Modifier.weight(1f)) { Text("Share PNG") }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = onLink, modifier = Modifier.weight(1f)) { Text("Copy strategy link") }
            OutlinedButton(onClick = onGlider, modifier = Modifier.weight(1f)) { Text("Manual Glider handoff") }
        }
        if (canExploreWeights) {
            OutlinedButton(onClick = onExploreWeights, modifier = Modifier.fillMaxWidth()) { Text("Explore weights as a new draft") }
        }
    }
}

@Composable
private fun SavedCardTile(
    card: SavedCard,
    onShare: () -> Unit,
    onRemix: () -> Unit,
    onGlider: () -> Unit,
    onExploreWeights: () -> Unit,
) {
    val canExploreWeights = remember(card.strategy.id) {
        runCatching { CardCreationRecords.targetWeights(card.strategy) }.isSuccess
    }
    val bitmap = remember(card.pngSha256) { BitmapFactory.decodeByteArray(card.png, 0, card.png.size)?.asImageBitmap() }
    Column(Modifier.fillMaxWidth().border(1.dp, MaterialTheme.colorScheme.outline).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        bitmap?.let { Image(it, contentDescription = "Saved strategy card", modifier = Modifier.fillMaxWidth().aspectRatio(1080f / 1350f)) }
        Text("${card.expression.id.take(18)}… · ${if (card.viewOnly) "view-only" else "saved locally"}")
        Text("Strategy ${card.strategy.id.take(18)}… · no live balance attached", style = MaterialTheme.typography.bodySmall)
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            OutlinedButton(onClick = onShare, modifier = Modifier.weight(1f)) { Text("Share") }
            OutlinedButton(onClick = onRemix, modifier = Modifier.weight(1f)) { Text("Visual remix") }
        }
        if (canExploreWeights) {
            OutlinedButton(onClick = onExploreWeights, modifier = Modifier.fillMaxWidth()) { Text("Explore weights as a new draft") }
        }
        OutlinedButton(onClick = onGlider, modifier = Modifier.fillMaxWidth()) { Text("Manual Glider handoff") }
    }
}

private fun shareCard(context: Context, card: SavedCard) {
    val png = Sharing.stage(context, "coloyond-card.png", card.png)
    val strategy = Sharing.strategyFile(context, card.strategy, card.expression)
    context.startActivity(Intent.createChooser(Sharing.cardAndStrategy(png, strategy), "Share Coloyond card"))
}

private fun sharePng(context: Context, card: SavedCard) {
    val uri = Sharing.stage(context, "coloyond-card.png", card.png)
    context.startActivity(Intent.createChooser(Sharing.single(uri, "image/png"), "Share card image"))
}

private fun copyText(context: Context, text: String) {
    context.getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("Coloyond strategy", text))
}
