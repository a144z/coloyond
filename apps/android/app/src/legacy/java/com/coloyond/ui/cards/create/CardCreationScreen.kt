package com.coloyond.ui.cards.create

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.coloyond.generation.Captions
import com.coloyond.generation.CompositionBrief
import com.coloyond.generation.GeneratedScene
import com.coloyond.generation.GenerationContext
import com.coloyond.generation.GenerationOrigin
import com.coloyond.generation.InferenceAdapter
import com.coloyond.generation.Observations
import com.coloyond.platform.CardExport
import com.coloyond.platform.CardStorage
import com.coloyond.platform.InferenceCredentials
import com.coloyond.platform.SavedCard
import com.coloyond.platform.SceneRenderer
import com.coloyond.platform.SceneRenderer.drawCard
import com.coloyond.strategy.asObject
import com.coloyond.strategy.asString
import com.coloyond.strategy.ValidatedRecord
import com.coloyond.ui.cards.share.CardRemixRecords
import com.coloyond.ui.cards.share.CardRemixSelection
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

private val Paper = Color(0xFFF1ECDD)
private val Ink = Color(0xFF171715)
private val Rule = Color(0xFFD9D3C3)
private val Cobalt = Color(0xFF1249ED)

/**
 * Isolated creation surface. The caller supplies only verified catalog entries and
 * client-local generation/storage dependencies; this screen has no wallet actions.
 */
@Composable
fun CardCreationScreen(
    publishedVaults: List<PublishedVaultCard>,
    inference: InferenceAdapter,
    credentials: () -> InferenceCredentials?,
    storage: CardStorage,
    onDraftSaved: (ValidatedRecord) -> Unit,
    initialDraft: ValidatedRecord? = null,
    importedStrategy: ValidatedRecord? = null,
    remix: CardRemixSelection? = null,
    acceptedCaptionHistory: () -> List<String> = { emptyList() },
    onCaptionAccepted: (String) -> Unit = {},
    onSaved: (SavedCard) -> Unit = {},
    modifier: Modifier = Modifier,
) {
    require(listOf(initialDraft, importedStrategy, remix).count { it != null } <= 1) { "Choose one card creation source" }
    val initialWeights = remember(initialDraft?.id) {
        initialDraft?.let { runCatching { CardCreationRecords.targetWeights(it) }.getOrNull() }.orEmpty()
    }
    val publishedIds = remember(publishedVaults) { publishedVaults.map { it.strategy.id } }
    var mode by rememberSaveable { mutableStateOf(when {
        remix != null -> "remix"
        importedStrategy != null -> "imported"
        initialDraft != null || publishedVaults.isEmpty() -> "draft"
        else -> "published"
    }) }
    var selectedVaultId by rememberSaveable { mutableStateOf(publishedVaults.firstOrNull()?.strategy?.id.orEmpty()) }
    var firstMint by rememberSaveable(initialDraft?.id) { mutableStateOf(initialWeights.getOrNull(0)?.mint.orEmpty()) }
    var secondMint by rememberSaveable(initialDraft?.id) { mutableStateOf(initialWeights.getOrNull(1)?.mint.orEmpty()) }
    var firstPercent by rememberSaveable(initialDraft?.id) { mutableStateOf(initialWeights.getOrNull(0)?.let { CardCreationRecords.formatPercent(it.weightBps).removeSuffix("%") } ?: "50.00") }
    var secondPercent by rememberSaveable(initialDraft?.id) { mutableStateOf(initialWeights.getOrNull(1)?.let { CardCreationRecords.formatPercent(it.weightBps).removeSuffix("%") } ?: "50.00") }
    var twoAssets by rememberSaveable(initialDraft?.id) { mutableStateOf(initialWeights.size > 1 || initialDraft == null) }

    var generatedScene by remember { mutableStateOf<GeneratedScene?>(null) }
    var captionCandidates by remember { mutableStateOf<List<String>>(emptyList()) }
    var captionEnabled by remember { mutableStateOf(false) }
    var captionText by remember { mutableStateOf("") }
    var captionOrigin by remember { mutableStateOf<CardCaptionOrigin?>(null) }
    var busy by remember { mutableStateOf(false) }
    var status by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var savedCard by remember { mutableStateOf<SavedCard?>(null) }
    var savedDraftId by rememberSaveable(initialDraft?.id) { mutableStateOf(initialDraft?.id) }
    val requestToken = remember { mutableIntStateOf(0) }
    var activeRequest by remember { mutableStateOf<Job?>(null) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val typeface = remember(context) { SceneRenderer.exportTypeface(context) }

    val selectedVault = publishedVaults.firstOrNull { it.strategy.id == selectedVaultId }
    val draftWeights = remember(mode, firstMint, secondMint, firstPercent, secondPercent, twoAssets) {
        if (mode != "draft") null else runCatching {
            val weights = if (twoAssets) {
                val left = CardCreationRecords.percentToBasisPoints(firstPercent)
                    ?: throw IllegalArgumentException("Use a positive percentage with at most two decimals.")
                val right = CardCreationRecords.percentToBasisPoints(secondPercent)
                    ?: throw IllegalArgumentException("Use a positive percentage with at most two decimals.")
                require(left + right == 10_000) { "Desired weights must total 100.00%." }
                listOf(CardTargetWeight(firstMint.trim(), left), CardTargetWeight(secondMint.trim(), right))
            } else {
                listOf(CardTargetWeight(firstMint.trim(), 10_000))
            }
            CardCreationRecords.allocationDraft(weights)
        }.getOrNull()
    }
    val selectedStrategy = when (mode) {
        "published" -> selectedVault?.strategy
        "imported" -> importedStrategy
        "remix" -> remix?.strategy
        else -> draftWeights
    }
    val selectionId = selectedStrategy?.id
    val latestSelectionId by rememberUpdatedState(selectionId)
    val selectedSymbols = selectedVault?.displaySymbols.orEmpty()
    val verifiedTickers = selectedVault?.verifiedTickerSymbols.orEmpty()
    val selectedActual = if (mode == "published") selectedVault?.actual else null

    fun clearExpression() {
        generatedScene = null
        captionCandidates = emptyList()
        captionEnabled = false
        captionText = ""
        captionOrigin = null
        savedCard = null
        busy = false
        status = null
        error = null
    }

    fun cancelAndInvalidate() {
        requestToken.intValue += 1
        activeRequest?.cancel()
        activeRequest = null
        clearExpression()
    }

    LaunchedEffect(publishedIds) {
        if (selectedVaultId !in publishedIds) selectedVaultId = publishedIds.firstOrNull().orEmpty()
        if (publishedIds.isEmpty() && mode == "published") mode = "draft"
    }
    LaunchedEffect(remix?.parentExpression?.id, importedStrategy?.id, initialDraft?.id, publishedIds) {
        mode = when {
            remix != null -> "remix"
            importedStrategy != null -> "imported"
            initialDraft != null || publishedIds.isEmpty() -> "draft"
            else -> "published"
        }
    }
    LaunchedEffect(mode, selectionId, remix?.parentExpression?.id, importedStrategy?.id, initialDraft?.id) {
        cancelAndInvalidate()
        if (mode != "draft" || selectionId != savedDraftId) savedDraftId = null
    }

    fun editDraft(change: () -> Unit) {
        change()
        savedDraftId = null
        cancelAndInvalidate()
    }

    fun generateImage() {
        val strategy = selectedStrategy ?: run {
            error = if (mode == "draft") draftError(twoAssets, firstMint, secondMint, firstPercent, secondPercent)
            else "Select a published vault first."
            return
        }
        cancelAndInvalidate()
        val ticket = requestToken.intValue
        val revision = strategy.id
        val composition = CardCreationRecords.targetWeights(strategy)
        val requestId = UUID.randomUUID().toString()
        val userCredentials = credentials()
        busy = true
        error = null
        status = "Generating artwork for ${shortId(revision)}…"
        activeRequest = scope.launch {
            try {
                val sceneContext = GenerationContext.scene(
                    requestId = requestId,
                    configurationRevision = revision,
                    stillCurrent = { requestToken.intValue == ticket && latestSelectionId == revision },
                )
                val scene = inference.generateScene(
                    CompositionBrief(composition.map { it.weightBps }),
                    sceneContext,
                    userCredentials,
                )
                if (!CardCreationRecords.isCurrentGeneration(ticket, requestToken.intValue, revision, latestSelectionId, scene)) return@launch
                generatedScene = scene
                captionEnabled = false
                captionText = ""
                captionOrigin = null
                captionCandidates = emptyList()
                savedCard = null
                status = if (scene.origin == GenerationOrigin.MODEL) "Artwork ready · strategy ${shortId(revision)}" else "Local preview · model generation unavailable"

                val sceneHash = scene.sceneHash
                val captionContext = GenerationContext.captions(
                    requestId = requestId,
                    configurationRevision = revision,
                    stillCurrent = { requestToken.intValue == ticket && latestSelectionId == revision && generatedScene?.sceneHash == sceneHash },
                )
                val observations = Observations.fromScene(scene.value)
                val candidates = inference.generateCaptions(
                    observations = observations,
                    acceptedHistory = acceptedCaptionHistory(),
                    context = captionContext,
                    credentials = userCredentials,
                    verifiedTickerSymbols = verifiedTickers,
                )
                if (requestToken.intValue != ticket || generatedScene?.sceneHash != sceneHash) return@launch
                captionCandidates = candidates
                if (candidates.isNotEmpty()) status = "Artwork and caption ideas ready"
                else status = if (scene.origin == GenerationOrigin.LOCAL_PREVIEW) {
                    "Local preview ready · no caption candidates available"
                } else {
                    "Artwork ready · add your own caption or continue without one"
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                if (requestToken.intValue == ticket) error = "Generation could not be completed. Try again or continue with a local preview."
            } finally {
                if (requestToken.intValue == ticket) busy = false
            }
        }
    }

    fun cancelCaptionRequestOnly() {
        activeRequest?.cancel()
        requestToken.intValue += 1
        activeRequest = null
    }

    fun generateAnotherCaption() {
        val strategy = selectedStrategy ?: return
        val scene = generatedScene ?: return
        cancelCaptionRequestOnly()
        val ticket = requestToken.intValue
        val revision = strategy.id
        val sceneHash = scene.sceneHash
        val requestId = UUID.randomUUID().toString()
        val captionContext = GenerationContext.captions(
            requestId = requestId,
            configurationRevision = revision,
            stillCurrent = { requestToken.intValue == ticket && latestSelectionId == revision && generatedScene?.sceneHash == sceneHash },
        )
        busy = true
        error = null
        status = "Finding another caption for this image…"
        activeRequest = scope.launch {
            try {
                val candidates = inference.generateCaptions(
                    observations = Observations.fromScene(scene.value),
                    acceptedHistory = acceptedCaptionHistory(),
                    context = captionContext,
                    credentials = credentials(),
                    verifiedTickerSymbols = verifiedTickers,
                )
                if (requestToken.intValue != ticket || generatedScene?.sceneHash != sceneHash || latestSelectionId != revision) return@launch
                captionCandidates = candidates
                status = if (candidates.isEmpty()) "No new captions available · the image is unchanged" else "Choose a caption for this image"
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                if (requestToken.intValue == ticket) error = "Caption generation could not be completed. The image is unchanged."
            } finally {
                if (requestToken.intValue == ticket) busy = false
            }
        }
    }

    fun saveExpression() {
        val strategy = selectedStrategy ?: return
        val scene = generatedScene ?: return
        val acceptedCaption = if (captionEnabled && captionText.isNotBlank() && Captions.validateUserCaption(captionText, verifiedTickers) != null) captionText else null
        val origin = acceptedCaption?.let { captionOrigin }
        try {
            val expression = if (remix == null) {
                CardCreationRecords.expression(
                    strategy = strategy,
                    scene = scene.value,
                    sceneHash = scene.sceneHash,
                    caption = acceptedCaption,
                    captionOrigin = origin,
                    generationOrigin = scene.origin,
                    verifiedTickerSymbols = verifiedTickers,
                )
            } else {
                CardRemixRecords.expression(
                    strategy = strategy,
                    parentExpression = remix.parentExpression,
                    scene = scene.value,
                    caption = acceptedCaption,
                    captionOrigin = origin?.recordValue ?: "none",
                    generationOrigin = scene.origin,
                    verifiedTickerSymbols = verifiedTickers,
                )
            }
            val png = when (val result = CardExport.renderCardPng(expression, strategy, typeface)) {
                is CardExport.Result.Png -> result.bytes
                is CardExport.Result.ViewOnly -> throw IllegalStateException("This renderer version is view-only")
            }
            val saved = storage.save(strategy, expression, png)
            savedCard = saved
            acceptedCaption?.let(onCaptionAccepted)
            onSaved(saved)
            status = "Expression saved · ${shortId(saved.expression.id)}"
            error = null
        } catch (_: Exception) {
            error = "The expression could not be saved. Your selected strategy and artwork are unchanged."
        }
    }

    val validCaption = if (captionEnabled && captionText.isNotBlank()) {
        Captions.validateUserCaption(captionText, verifiedTickers) != null
    } else true
    val previewCaption = if (validCaption && captionEnabled && captionText.isNotBlank()) captionText else null
    val previewCaptionOrigin = if (previewCaption == null) null else captionOrigin
    val previewExpression = remember(selectedStrategy, generatedScene, previewCaption, previewCaptionOrigin, remix) {
        val strategy = selectedStrategy
        val scene = generatedScene
        if (strategy == null || scene == null) null else runCatching {
            if (remix == null) {
                CardCreationRecords.expression(strategy, scene.value, scene.sceneHash, previewCaption, previewCaptionOrigin, scene.origin, verifiedTickers)
            } else {
                CardRemixRecords.expression(
                    strategy = strategy,
                    parentExpression = remix.parentExpression,
                    scene = scene.value,
                    caption = previewCaption,
                    captionOrigin = previewCaptionOrigin?.recordValue ?: "none",
                    generationOrigin = scene.origin,
                    verifiedTickerSymbols = verifiedTickers,
                )
            }
        }.getOrNull()
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(Paper)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 18.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("COLOYOND", color = Ink, fontSize = 13.sp, fontWeight = FontWeight.Bold, letterSpacing = 2.sp)
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("Create a strategy card", color = Ink, fontSize = 27.sp, fontWeight = FontWeight.Bold, lineHeight = 32.sp)
            Text("A saved target, expressed as an image. Artwork never changes the strategy.", color = Ink.copy(alpha = 0.72f), style = MaterialTheme.typography.bodyMedium)
        }

        if (remix == null && importedStrategy == null) Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            ModeButton("Published vault", mode == "published", Modifier.weight(1f)) {
                if (mode != "published") {
                    cancelAndInvalidate()
                    savedDraftId = null
                    mode = "published"
                }
            }
            ModeButton("Allocation draft", mode == "draft", Modifier.weight(1f)) {
                if (mode != "draft") {
                    cancelAndInvalidate()
                    savedDraftId = null
                    mode = "draft"
                }
            }
        }

        if (mode == "published") {
            SectionHeading("SELECT A PUBLISHED VAULT")
            if (publishedVaults.isEmpty()) {
                Text("No published vaults are available from the verified catalog yet. You can still create a nonexecutable allocation draft.", color = Ink)
                OutlinedButton(onClick = { cancelAndInvalidate(); mode = "draft" }, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text("Create an allocation draft")
                }
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    publishedVaults.forEach { vault ->
                        VaultChoice(vault, selected = vault.strategy.id == selectedVaultId) {
                            if (selectedVaultId != vault.strategy.id) {
                                cancelAndInvalidate()
                                selectedVaultId = vault.strategy.id
                            }
                        }
                    }
                }
            }
        } else if (mode == "draft") {
            SectionHeading("DESIRED WEIGHTS")
            Text("Drafts are local, inspect-only allocations. They do not identify a vault or authorize transactions.", color = Ink.copy(alpha = 0.72f), style = MaterialTheme.typography.bodySmall)
            Text("The saved draft contract is scoped to Solana mainnet-beta.", color = Ink.copy(alpha = 0.72f), style = MaterialTheme.typography.bodySmall)
            MintInput("Asset 1 · full mint address", firstMint, KeyboardType.Ascii) {
                editDraft { firstMint = it }
            }
            if (twoAssets) {
                MintInput("Target · asset 1 percent", firstPercent, KeyboardType.Decimal) {
                    editDraft { firstPercent = it }
                }
                MintInput("Asset 2 · full mint address", secondMint, KeyboardType.Ascii) {
                    editDraft { secondMint = it }
                }
                MintInput("Target · asset 2 percent", secondPercent, KeyboardType.Decimal) {
                    editDraft { secondPercent = it }
                }
                OutlinedButton(onClick = {
                    editDraft { twoAssets = false; firstPercent = "100.00"; secondMint = ""; secondPercent = "" }
                }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Use one asset") }
            } else {
                Text("Target · ${CardCreationRecords.formatPercent(10_000)}", color = Ink, fontWeight = FontWeight.Medium)
                OutlinedButton(onClick = {
                    editDraft { twoAssets = true; firstPercent = "50.00"; secondPercent = "50.00" }
                }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Add a second asset") }
            }
            if (draftWeights == null) {
                Text(
                    draftError(twoAssets, firstMint, secondMint, firstPercent, secondPercent),
                    color = Color(0xFF8B2A1D),
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            OutlinedButton(
                onClick = {
                    val draft = draftWeights ?: return@OutlinedButton
                    try {
                        val saved = CardCreationRecords.saveDraft(draft, onDraftSaved)
                        savedDraftId = saved.id
                        status = "Allocation draft saved · nonexecutable · ${shortId(saved.id)}"
                        error = null
                    } catch (_: Exception) {
                        error = "The allocation draft could not be saved. Your entered weights are still here."
                    }
                },
                enabled = draftWeights != null && savedDraftId != draftWeights?.id,
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                border = BorderStroke(1.dp, Ink),
            ) { Text(if (savedDraftId == draftWeights?.id) "Draft saved" else "Save allocation draft", color = Ink) }
        } else if (mode == "remix") {
            SectionHeading("VISUAL REMIX · SAME STRATEGY")
            Text("The allocation and strategy identity are locked to the original card. Only the new artwork and optional caption will change.", color = Ink.copy(alpha = 0.72f), style = MaterialTheme.typography.bodySmall)
        } else {
            SectionHeading("IMPORTED STRATEGY · UNVERIFIED")
            Text("This validated import is not proof of a published vault. Artwork keeps its original strategy identity; no transaction or live balance is available.", color = Ink.copy(alpha = 0.72f), style = MaterialTheme.typography.bodySmall)
        }

        selectedStrategy?.let { strategy ->
            SectionHeading(when (mode) { "draft" -> "ALLOCATION DRAFT"; "remix" -> "UNCHANGED STRATEGY"; "imported" -> "IMPORTED STRATEGY"; else -> "SAVED STRATEGY REVISION" })
            WeightList(
                title = when (mode) { "draft" -> "Allocation draft · desired weights"; "remix" -> "Same strategy · target weights"; "imported" -> "Imported target weights · unverified"; else -> "Target weights · saved configuration" },
                weights = CardCreationRecords.targetWeights(strategy),
                symbols = selectedSymbols,
            )
            if (mode == "published") ActualComposition(selectedActual, selectedSymbols)
            else Text(when (mode) {
                "remix" -> "No live balance observation is attached to this card."
                "imported" -> "Publication, network state and balances have not been verified."
                else -> "Actual composition unavailable · a draft has no vault balances"
            }, color = Ink.copy(alpha = 0.72f), style = MaterialTheme.typography.bodySmall)
            if (mode == "published") StrategyFacts(selectedVault)
        }

        Button(
            onClick = { generateImage() },
            enabled = selectedStrategy != null && !busy,
            modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Ink, contentColor = Paper, disabledContainerColor = Ink.copy(alpha = 0.35f)),
        ) { Text(if (generatedScene == null) "Generate image" else "Another image") }

        if (busy) Text(status ?: "Working…", color = Ink, style = MaterialTheme.typography.bodySmall)

        previewExpression?.let { expression ->
            SectionHeading("EXPRESSION")
            Canvas(
                modifier = Modifier
                    .fillMaxWidth()
                    .aspectRatio(1080f / 1350f)
                    .border(BorderStroke(1.dp, Rule)),
            ) { drawCard(expression, selectedStrategy!!, typeface) }
            generatedScene?.let { scene ->
                val label = when (scene.origin) {
                    GenerationOrigin.MODEL -> "Model-generated scene · seed ${scene.seed}"
                    GenerationOrigin.LOCAL_PREVIEW -> "Local preview · inference unavailable"
                }
                Text(label, color = Ink.copy(alpha = 0.72f), style = MaterialTheme.typography.bodySmall)
            }

            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.weight(1f)) {
                    Text("Caption", color = Ink, fontWeight = FontWeight.Medium)
                    Text("Optional · interpreted separately from the strategy", color = Ink.copy(alpha = 0.72f), style = MaterialTheme.typography.bodySmall)
                }
                Switch(
                    checked = captionEnabled,
                    onCheckedChange = { enabled ->
                        captionEnabled = enabled
                        if (!enabled) {
                            captionText = ""
                            captionOrigin = null
                            captionCandidates = emptyList()
                            savedCard = null
                        }
                        status = null
                        error = null
                    },
                    modifier = Modifier.semantics { contentDescription = "Include caption on card" },
                )
            }
            if (captionEnabled) {
                MintInput("Edit caption · 2–12 words, at most 80 code points", captionText, KeyboardType.Text, singleLine = false) {
                    captionText = it
                    captionOrigin = if (it.isBlank()) null else CardCaptionOrigin.USER
                    savedCard = null
                    status = null
                    error = null
                }
                if (!validCaption) Text("Use 2–12 words and at most 80 code points; financial terms and URLs are not allowed.", color = Color(0xFF8B2A1D), style = MaterialTheme.typography.bodySmall)
            }
            if (captionCandidates.isNotEmpty()) {
                Text("Caption ideas · tap to use", color = Ink, fontWeight = FontWeight.Medium)
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    captionCandidates.forEach { candidate ->
                        OutlinedButton(
                            onClick = {
                                captionEnabled = true
                                captionText = candidate
                                captionOrigin = CardCaptionOrigin.MODEL
                                savedCard = null
                                status = null
                                error = null
                            },
                            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                            border = BorderStroke(1.dp, if (captionText == candidate) Cobalt else Rule),
                        ) { Text(candidate, color = Ink) }
                    }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                OutlinedButton(
                    onClick = { generateAnotherCaption() },
                    enabled = !busy,
                    modifier = Modifier.weight(1f).heightIn(min = 48.dp),
                    border = BorderStroke(1.dp, Rule),
                ) { Text("Another caption", color = Ink) }
                Button(
                    onClick = { saveExpression() },
                    enabled = !busy && validCaption && selectedStrategy != null && savedCard?.expression?.id != previewExpression?.id,
                    modifier = Modifier.weight(1f).heightIn(min = 48.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Ink, contentColor = Paper),
                ) { Text(if (savedCard == null) "Save expression" else "Expression saved") }
            }
            savedCard?.let { saved ->
                Text("Saved immutably · ${shortId(saved.expression.id)}", color = Ink, style = MaterialTheme.typography.bodySmall)
            }
        }

        status?.takeIf { !busy }?.let { StatusText(it, isError = false) }
        error?.let { StatusText(it, isError = true) }
    }

}

@Composable
private fun ModeButton(label: String, selected: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    if (selected) {
        Button(onClick = onClick, modifier = modifier.heightIn(min = 48.dp), colors = ButtonDefaults.buttonColors(containerColor = Ink, contentColor = Paper)) {
            Text(label)
        }
    } else {
        OutlinedButton(onClick = onClick, modifier = modifier.heightIn(min = 48.dp), border = BorderStroke(1.dp, Rule)) {
            Text(label, color = Ink)
        }
    }
}

@Composable
private fun SectionHeading(label: String) {
    Column(verticalArrangement = Arrangement.spacedBy(7.dp), modifier = Modifier.fillMaxWidth()) {
        Text(label, color = Ink, fontFamily = FontFamily.Monospace, fontSize = 11.sp, letterSpacing = 1.sp)
        Spacer(Modifier.fillMaxWidth().heightIn(min = 1.dp).background(Rule))
    }
}

@Composable
private fun VaultChoice(vault: PublishedVaultCard, selected: Boolean, onClick: () -> Unit) {
    val facts = vault.strategy.value.asObjectOrNull()
    val protocol = facts?.get("protocol")?.asStringOrNull() ?: "Coloyond"
    val address = facts?.get("vaultAddress")?.asStringOrNull()
    val shareMint = facts?.get("shareMint")?.asStringOrNull()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .border(1.dp, if (selected) Ink else Rule)
            .selectable(selected, onClick = onClick, role = Role.RadioButton)
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RadioButton(selected = selected, onClick = null, modifier = Modifier.size(48.dp))
        Column(verticalArrangement = Arrangement.spacedBy(3.dp), modifier = Modifier.padding(start = 4.dp)) {
            Text(vault.title, color = Ink, fontWeight = FontWeight.Bold)
            Text(
                listOfNotNull(protocol, address?.let { "Vault ${shortAddress(it)}" }, shareMint?.let { "Share ${shortAddress(it)}" }).joinToString(" · "),
                color = Ink.copy(alpha = 0.72f),
                style = MaterialTheme.typography.bodySmall,
            )
            Text(shortId(vault.strategy.id), color = Ink.copy(alpha = 0.72f), fontFamily = FontFamily.Monospace, fontSize = 11.sp)
        }
    }
}

@Composable
private fun MintInput(label: String, value: String, keyboard: KeyboardType, singleLine: Boolean = true, onValueChange: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(5.dp), modifier = Modifier.fillMaxWidth()) {
        Text(label, color = Ink, style = MaterialTheme.typography.bodySmall)
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = 48.dp)
                .border(1.dp, Rule, RoundedCornerShape(2.dp))
                .padding(horizontal = 12.dp, vertical = 13.dp)
                .semantics { contentDescription = label },
            singleLine = singleLine,
            keyboardOptions = KeyboardOptions(keyboardType = keyboard),
            textStyle = MaterialTheme.typography.bodyMedium.copy(color = Ink),
            decorationBox = { inner ->
                if (value.isEmpty()) Text(label, color = Ink.copy(alpha = 0.45f), style = MaterialTheme.typography.bodyMedium)
                inner()
            },
        )
    }
}

@Composable
private fun WeightList(title: String, weights: List<CardTargetWeight>, symbols: Map<String, String>) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
        Text(title, color = Ink, fontWeight = FontWeight.Medium)
        weights.forEach { weight ->
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                Text(symbols[weight.mint] ?: shortAddress(weight.mint), color = Ink, modifier = Modifier.weight(1f))
                Text(CardCreationRecords.formatPercent(weight.weightBps), color = Ink, fontFamily = FontFamily.Monospace)
            }
        }
    }
}

@Composable
private fun ActualComposition(actual: CardActualComposition?, symbols: Map<String, String>) {
    SectionHeading("OBSERVED ACTUAL COMPOSITION")
    if (actual == null || !actual.isComplete) {
        Text("Actual composition unavailable · no complete source, time and slot observation", color = Ink.copy(alpha = 0.72f), style = MaterialTheme.typography.bodySmall)
        return
    }
    Text(
        (if (actual.source == CardObservationSource.FIXTURE) "Sample data" else "RPC observation") +
            (actual.providerLabel?.takeIf { it.isNotBlank() }?.let { " · $it" } ?: "") +
            " · ${actual.observedAt} · slot ${actual.slot}",
        color = Ink.copy(alpha = 0.72f),
        style = MaterialTheme.typography.bodySmall,
    )
    WeightList("Actual weights · observed", actual.weights, symbols)
}

@Composable
private fun StrategyFacts(vault: PublishedVaultCard?) {
    val fields = vault?.strategy?.value?.asObjectOrNull() ?: return
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("Protocol · ${fields["protocol"]?.asStringOrNull() ?: "Coloyond"}", color = Ink.copy(alpha = 0.72f), style = MaterialTheme.typography.bodySmall)
        Text("Configuration revision · ${vault.strategy.id}", color = Ink.copy(alpha = 0.72f), fontFamily = FontFamily.Monospace, fontSize = 11.sp)
        Text("Generation is tied to this revision. A later configuration is a different strategy card.", color = Ink.copy(alpha = 0.72f), style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun StatusText(text: String, isError: Boolean) {
    Text(text, color = if (isError) Color(0xFF8B2A1D) else Ink, style = MaterialTheme.typography.bodySmall)
}

private fun draftError(twoAssets: Boolean, firstMint: String, secondMint: String, firstPercent: String, secondPercent: String): String = when {
    firstMint.isBlank() -> "Enter the full mint address for asset 1."
    twoAssets && secondMint.isBlank() -> "Enter the full mint address for asset 2."
    twoAssets && (CardCreationRecords.percentToBasisPoints(firstPercent) == null || CardCreationRecords.percentToBasisPoints(secondPercent) == null) ->
        "Enter positive percentages with at most two decimal places."
    twoAssets && CardCreationRecords.percentToBasisPoints(firstPercent)!! + CardCreationRecords.percentToBasisPoints(secondPercent)!! != 10_000 ->
        "Desired weights must total 100.00%."
    else -> "Enter distinct, valid Solana mint addresses."
}

private fun shortAddress(value: String): String = if (value.length > 14) "${value.take(5)}…${value.takeLast(5)}" else value

private fun shortId(value: String): String {
    val prefix = value.substringBefore(':') + ":"
    val digest = value.substringAfter(':')
    return if (digest.length <= 14) value else "$prefix${digest.take(6)}…${digest.takeLast(6)}"
}

private fun com.coloyond.strategy.JsonValue.asObjectOrNull(): Map<String, com.coloyond.strategy.JsonValue>? =
    runCatching { asObject("strategy") }.getOrNull()

private fun com.coloyond.strategy.JsonValue.asStringOrNull(): String? =
    runCatching { asString("value") }.getOrNull()
