package com.coloyond.platform

import android.graphics.Typeface
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import android.text.TextUtils
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb

/**
 * Task 1 device probe: a fixed sample card drawn by one function, used both by
 * the on-screen Canvas and by [CardExport]. It is not the Task 5 renderer; it
 * proves the shared drawing path, layout rectangles, seeded grain and the
 * bundled font. Geometry is in export pixels (1080 × 1350) and scaled to fit.
 */
object CardLayoutV1 {
    const val WIDTH = 1080f
    const val HEIGHT = 1350f
    val ART = Rect(60f, 60f, 60f + 960f, 60f + 960f)
    val CAPTION = Rect(60f, 1050f, 60f + 960f, 1050f + 110f)
    val FOOTER = Rect(60f, 1210f, 60f + 960f, 1210f + 80f)
}

private val Paper = Color(0xFFF4EEDF)
private val Ink = Color(0xFF111111)
private val Vermilion = Color(0xFFE2402B)
private val Cobalt = Color(0xFF1F4FD8)
private val Saffron = Color(0xFFF2B33D)

fun DrawScope.drawProbeCard(caption: String?, footer: String, typeface: Typeface, seed: Int) {
    val fit = minOf(size.width / CardLayoutV1.WIDTH, size.height / CardLayoutV1.HEIGHT)
    scale(fit, pivot = Offset.Zero) {
        drawRect(Paper, size = Size(CardLayoutV1.WIDTH, CardLayoutV1.HEIGHT))
        val art = CardLayoutV1.ART
        clipRect(art.left, art.top, art.right, art.bottom) {
            drawCircle(Vermilion, radius = 300f, center = Offset(art.left + 380f, art.top + 420f))
            drawRect(Cobalt, topLeft = Offset(art.left + 520f, art.top + 160f), size = Size(300f, 620f))
            val beam = Path().apply {
                moveTo(art.left + 80f, art.bottom - 60f)
                lineTo(art.right - 40f, art.top + 120f)
                lineTo(art.right - 40f, art.top + 220f)
                lineTo(art.left + 80f, art.bottom + 40f)
                close()
            }
            drawPath(beam, Ink)
            drawCircle(Saffron, radius = 90f, center = Offset(art.left + 700f, art.top + 780f))
            drawGrain(art, seed)
        }
        drawText(caption, CardLayoutV1.CAPTION, typeface, sizePx = 44f, maxLines = 2)
        drawText(footer, CardLayoutV1.FOOTER, typeface, sizePx = 26f, maxLines = 2)
    }
}

/** Deterministic speckle grain from a 32-bit seed (xorshift32), so replays match. */
private fun DrawScope.drawGrain(area: Rect, seed: Int) {
    var x = if (seed == 0) 0x9E3779B9.toInt() else seed
    fun next(): Int {
        x = x xor (x shl 13); x = x xor (x ushr 17); x = x xor (x shl 5)
        return x
    }
    repeat(2500) {
        val px = area.left + (next().toUInt() % area.width.toUInt()).toFloat()
        val py = area.top + (next().toUInt() % area.height.toUInt()).toFloat()
        val alpha = 0.04f + (next().toUInt() % 8u).toFloat() / 100f
        drawRect(Ink.copy(alpha = alpha), topLeft = Offset(px, py), size = Size(2f, 2f))
    }
}

private fun DrawScope.drawText(text: String?, box: Rect, typeface: Typeface, sizePx: Float, maxLines: Int) {
    if (text.isNullOrEmpty()) return
    val paint = TextPaint(TextPaint.ANTI_ALIAS_FLAG).apply {
        this.typeface = typeface
        textSize = sizePx
        color = Ink.toArgb()
    }
    val layout = StaticLayout.Builder.obtain(text, 0, text.length, paint, box.width.toInt())
        .setAlignment(Layout.Alignment.ALIGN_NORMAL)
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
