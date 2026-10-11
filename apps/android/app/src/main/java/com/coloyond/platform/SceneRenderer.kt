package com.coloyond.platform

import android.content.Context
import android.graphics.Typeface
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import android.text.TextUtils
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import com.coloyond.R
import com.coloyond.strategy.JsonValue
import com.coloyond.strategy.StrategyRecords
import com.coloyond.strategy.ValidatedRecord
import com.coloyond.strategy.asArray
import com.coloyond.strategy.asObject
import com.coloyond.strategy.asString
import com.coloyond.strategy.asLong
import com.coloyond.strategy.field

/** The version-1 renderer draws the same geometry into a Compose Canvas and a PNG. */
object SceneRenderer {
    const val VERSION = 1L
    const val LAYOUT_VERSION = 1L

    private val Ink = Color(0xFF171715)
    private val Palette = mapOf(
        "paper" to Color(0xFFF1ECDD),
        "ink" to Ink,
        "cobalt" to Color(0xFF1249ED),
        "violet" to Color(0xFF8D25D9),
        "yellow" to Color(0xFFFFD523),
        "coral" to Color(0xFFFF513B),
    )

    sealed interface Support {
        data object Supported : Support
        data class ViewOnly(val rendererVersion: Long, val layoutVersion: Long) : Support
    }

    /** Loads the exact licensed font bundled for export; do not use a device default. */
    fun exportTypeface(context: Context): Typeface = context.resources.getFont(R.font.arimo)

    /**
     * Validates both immutable records again at the platform boundary. An unknown
     * renderer/layout is preserved for viewing, but cannot be reconstructed here.
     */
    fun support(expression: ValidatedRecord, strategy: ValidatedRecord): Support {
        val checkedStrategy = StrategyRecords.validateStrategy(strategy.value)
        require(checkedStrategy.id == strategy.id) { "Strategy identity changed" }
        val expressionFields = expression.value.asObject("expression")
        val strategyId = expressionFields.field("strategyId").asString("strategyId")
        require(strategyId == checkedStrategy.id) { "Expression belongs to another strategy" }
        val checkedExpression = StrategyRecords.validateExpression(
            expression.value,
            coloyond = strategyId.startsWith("cb3:"),
        )
        require(checkedExpression.id == expression.id) { "Expression identity changed" }
        val fields = checkedExpression.value.asObject("expression")
        val renderer = fields.field("rendererVersion").asLong("rendererVersion")
        val layout = fields.field("layoutVersion").asLong("layoutVersion")
        return if (renderer == VERSION && layout == LAYOUT_VERSION) Support.Supported
        else Support.ViewOnly(renderer, layout)
    }

    /**
     * Draws a complete card in export-pixel coordinates, fitting and centering it
     * in the current Canvas. Returns ViewOnly without drawing for unknown versions.
     */
    fun DrawScope.drawCard(
        expression: ValidatedRecord,
        strategy: ValidatedRecord,
        typeface: Typeface,
    ): Support {
        val status = support(expression, strategy)
        if (status !is Support.Supported) return status

        val checkedExpression = StrategyRecords.validateExpression(
            expression.value,
            coloyond = expression.value.asObject("expression").field("strategyId").asString("strategyId").startsWith("cb3:"),
        )
        val scene = checkedExpression.value.asObject("expression").field("scene").asObject("scene")
        val fit = minOf(size.width / CardLayoutV1.WIDTH, size.height / CardLayoutV1.HEIGHT)
        if (fit <= 0f) return status
        val left = (size.width - CardLayoutV1.WIDTH * fit) / 2f
        val top = (size.height - CardLayoutV1.HEIGHT * fit) / 2f
        translate(left, top) {
            scale(fit, pivot = Offset.Zero) {
                drawRect(Palette.getValue(scene.field("background").asString("background")), size = Size(CardLayoutV1.WIDTH, CardLayoutV1.HEIGHT))
                val art = CardLayoutV1.ART
                clipRect(art.left, art.top, art.right, art.bottom) {
                    scene.field("layers").asArray("layers").forEach { layer -> drawLayer(layer.asObject("layer"), art) }
                    drawGrain(art, scene.field("seed").asLong("seed"), scene.field("texture").asObject("texture").field("grainIntensity").asLong("grainIntensity").toInt())
                }
                val expressionFields = checkedExpression.value.asObject("expression")
                val captionValue = expressionFields.field("caption")
                val caption = (captionValue as? JsonValue.Str)?.value
                drawText(caption, CardLayoutV1.CAPTION, typeface, 44f, 2, bold = false)
                // The printed short code is the strategy revision, matching the
                // card contract; the expression ID stays in the saved record.
                drawFooter(strategy, strategy.id, typeface)
            }
        }
        return status
    }

    private fun DrawScope.drawLayer(fields: Map<String, JsonValue>, art: Rect) {
        val fill = fields.field("fill").asObject("fill")
        val opacity = fields.field("opacity").asLong("opacity").toFloat() / 1000f
        val brush = fillBrush(fill, art, opacity)
        when (fields.field("type").asString("layer.type")) {
            "polygon", "beam" -> {
                val points = fields.field("points").asArray("points").map { point ->
                    val pair = point.asArray("point")
                    Offset(
                        art.left + pair[0].asLong("x").toFloat() * art.width / 1000f,
                        art.top + pair[1].asLong("y").toFloat() * art.height / 1000f,
                    )
                }
                val path = Path().apply {
                    moveTo(points.first().x, points.first().y)
                    points.drop(1).forEach { lineTo(it.x, it.y) }
                    close()
                }
                drawPath(path, brush)
            }
            "ellipse" -> {
                val cx = art.left + fields.field("cx").asLong("cx").toFloat() * art.width / 1000f
                val cy = art.top + fields.field("cy").asLong("cy").toFloat() * art.height / 1000f
                val rx = fields.field("rx").asLong("rx").toFloat() * art.width / 1000f
                val ry = fields.field("ry").asLong("ry").toFloat() * art.height / 1000f
                drawOval(brush, Offset(cx - rx, cy - ry), Size(rx * 2f, ry * 2f))
            }
            "ring" -> {
                val cx = art.left + fields.field("cx").asLong("cx").toFloat() * art.width / 1000f
                val cy = art.top + fields.field("cy").asLong("cy").toFloat() * art.height / 1000f
                val radius = fields.field("radius").asLong("radius").toFloat() * art.width / 1000f
                val stroke = fields.field("strokeWidth").asLong("strokeWidth").toFloat() * art.width / 1000f
                drawCircle(brush, radius, Offset(cx, cy), style = Stroke(stroke))
            }
            else -> error("Validated scene contains an unsupported layer")
        }
    }

    private fun fillBrush(fill: Map<String, JsonValue>, art: Rect, opacity: Float): Brush = when (fill.field("type").asString("fill.type")) {
        "solid" -> SolidColor(color(fill.field("color").asString("fill.color"), opacity))
        "linear" -> {
            fun coordinate(value: JsonValue, name: String): Offset {
                val pair = value.asArray(name)
                return Offset(
                    art.left + pair[0].asLong("x").toFloat() * art.width / 1000f,
                    art.top + pair[1].asLong("y").toFloat() * art.height / 1000f,
                )
            }
            val stops = fill.field("stops").asArray("stops").map { stop ->
                val fields = stop.asObject("gradient stop")
                fields.field("at").asLong("at").toFloat() / 1000f to color(fields.field("color").asString("color"), opacity)
            }.toTypedArray()
            Brush.linearGradient(
                colorStops = stops,
                start = coordinate(fill.field("from"), "from"),
                end = coordinate(fill.field("to"), "to"),
            )
        }
        else -> error("Validated scene contains an unsupported fill")
    }

    private fun color(token: String, opacity: Float): Color = Palette.getValue(token).copy(alpha = Palette.getValue(token).alpha * opacity)

    /** Draws the fixed, pure xorshift32 sample sequence inside the art clip only. */
    private fun DrawScope.drawGrain(art: Rect, seed: Long, intensity: Int) {
        SceneGrainV1.specks(seed, intensity, art.width.toInt(), art.height.toInt()).forEach { speck ->
            drawRect(Ink.copy(alpha = speck.alpha), Offset(art.left + speck.x, art.top + speck.y), Size(SceneGrainV1.DOT_SIZE, SceneGrainV1.DOT_SIZE))
        }
    }

    private fun DrawScope.drawFooter(strategy: ValidatedRecord, strategyId: String, typeface: Typeface) {
        val fields = strategy.value.asObject("strategy")
        val (label, network, weights, protocol) = strategyFacts(fields)
        val prefix = strategyId.substringBefore(':') + ":"
        val digest = strategyId.substringAfter(':')
        val abbreviated = "$prefix${digest.take(6)}…${digest.takeLast(6)}"
        val title = if (protocol == null) "coloyond  ·  $abbreviated" else "coloyond  ·  $protocol  ·  $abbreviated"
        val facts = listOfNotNull(label, weights, network).joinToString("  ·  ")
        drawText(title, Rect(CardLayoutV1.FOOTER.left, CardLayoutV1.FOOTER.top, CardLayoutV1.FOOTER.right, CardLayoutV1.FOOTER.top + 28f), typeface, 21f, 1, bold = true)
        drawText(facts, Rect(CardLayoutV1.FOOTER.left, CardLayoutV1.FOOTER.top + 30f, CardLayoutV1.FOOTER.right, CardLayoutV1.FOOTER.bottom), typeface, 18f, 2, bold = false)
    }

    private fun strategyFacts(fields: Map<String, JsonValue>): StrategyFacts {
        val schema = fields["schema"] as? JsonValue.Str
        if (schema?.value == "coloyond/ColoyondManagedStrategy/v1") {
            val weights = fields.field("tokens").asArray("tokens").map { value ->
                val token = value.asObject("token")
                token.field("mint").asString("mint") to token.field("targetBps").asLong("targetBps")
            }
            val cluster = fields.field("cluster").asString("cluster")
            return StrategyFacts("Target weights · saved configuration", "Solana · $cluster", formatWeights(weights), null)
        }

        val kind = (fields["kind"] as? JsonValue.Str)?.value
        if (kind == "allocation-draft") {
            val weights = fields.field("targetWeights").asArray("targetWeights").map { value ->
                val item = value.asObject("target weight")
                item.field("mint").asString("mint") to item.field("weightBps").asLong("weightBps")
            }
            return StrategyFacts("Allocation draft · desired weights", fields.field("network").asString("network"), formatWeights(weights), null)
        }

        val targetWeights = fields["targetWeights"]
        if (targetWeights != null) {
            val weights = targetWeights.asArray("targetWeights").map { value ->
                val item = value.asObject("target weight")
                item.field("mint").asString("mint") to item.field("weightBps").asLong("weightBps")
            }
            return StrategyFacts("Target weights · saved configuration", fields.field("network").asString("network"), formatWeights(weights), (fields["protocol"] as? JsonValue.Str)?.value)
        }

        val allocations = fields.field("allocations").asArray("allocations").map { value ->
            val item = value.asObject("allocation")
            item.field("outputMint").asString("outputMint") to item.field("weightBps").asLong("weightBps")
        }
        return StrategyFacts("Saved recipe · view-only", fields.field("network").asString("network"), formatWeights(allocations), null)
    }

    private fun formatWeights(weights: List<Pair<String, Long>>): String = weights.joinToString(" / ") { (mint, bps) ->
        val abbreviatedMint = if (mint.length > 12) "${mint.take(4)}…${mint.takeLast(4)}" else mint
        val percent = "${bps / 100}.${(bps % 100).toString().padStart(2, '0')}%"
        "$percent $abbreviatedMint"
    }

    private data class StrategyFacts(val label: String, val network: String, val weights: String, val protocol: String?)

    private fun DrawScope.drawText(text: String?, box: Rect, typeface: Typeface, sizePx: Float, maxLines: Int, bold: Boolean) {
        if (text.isNullOrEmpty()) return
        val paint = TextPaint(TextPaint.ANTI_ALIAS_FLAG).apply {
            this.typeface = Typeface.create(typeface, if (bold) Typeface.BOLD else Typeface.NORMAL)
            textSize = sizePx
            color = Ink.toArgb()
        }
        val layout = StaticLayout.Builder.obtain(text, 0, text.length, paint, box.width.toInt())
            .setAlignment(Layout.Alignment.ALIGN_NORMAL)
            .setIncludePad(false)
            .setMaxLines(maxLines)
            .setEllipsize(TextUtils.TruncateAt.END)
            .build()
        val canvas = drawContext.canvas.nativeCanvas
        canvas.save()
        canvas.translate(box.left, box.top)
        canvas.clipRect(0f, 0f, box.width, box.height)
        layout.draw(canvas)
        canvas.restore()
    }
}

/** Pure deterministic grain recipe, exposed to JVM tests independently of Canvas. */
internal object SceneGrainV1 {
    const val DOT_SIZE = 2f
    private const val COUNT = 2500

    data class Speck(val x: Int, val y: Int, val alpha: Float)

    fun specks(seed: Long, intensity: Int, width: Int = 960, height: Int = 960): List<Speck> {
        require(seed in 0L..4_294_967_295L)
        require(intensity in 0..100)
        require(width > 0 && height > 0)
        if (intensity == 0) return emptyList()
        var state = if (seed == 0L) 0x9E3779B9.toInt() else seed.toInt()
        fun next(): Int {
            state = state xor (state shl 13)
            state = state xor (state ushr 17)
            state = state xor (state shl 5)
            return state
        }
        return List(COUNT) {
            val x = (next().toLong() and 0xffff_ffffL) % width
            val y = (next().toLong() and 0xffff_ffffL) % height
            val level = (next().toLong() and 0xffff_ffffL) % 8L
            Speck(x.toInt(), y.toInt(), (0.04f + level / 100f) * intensity / 100f)
        }
    }
}
