package com.coloyond.platform

import android.graphics.Typeface
import android.graphics.Bitmap
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Canvas
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.drawscope.CanvasDrawScope
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import com.coloyond.strategy.ValidatedRecord
import java.io.ByteArrayOutputStream

object CardExport {
    sealed interface Result {
        data class Png(val bytes: ByteArray) : Result
        data class ViewOnly(val rendererVersion: Long, val layoutVersion: Long) : Result
    }

    /** Exports only the pinned renderer/layout at the contract's exact dimensions. */
    fun renderCardPng(
        expression: ValidatedRecord,
        strategy: ValidatedRecord,
        typeface: Typeface,
    ): Result {
        when (val support = SceneRenderer.support(expression, strategy)) {
            is SceneRenderer.Support.ViewOnly -> return Result.ViewOnly(support.rendererVersion, support.layoutVersion)
            SceneRenderer.Support.Supported -> Unit
        }
        var rendered = false
        val bytes = renderPng(CardLayoutV1.WIDTH.toInt(), CardLayoutV1.HEIGHT.toInt()) {
            rendered = SceneRenderer.run { drawCard(expression, strategy, typeface) is SceneRenderer.Support.Supported }
        }
        check(rendered) { "Renderer support changed during export" }
        return Result.Png(bytes)
    }

    /**
     * Draws [draw] onto an off-screen [ImageBitmap] through [CanvasDrawScope] and
     * returns PNG bytes. The same DrawScope function draws the on-screen Canvas,
     * so the screen and the export share geometry code.
     */
    fun renderPng(
        width: Int = CardLayoutV1.WIDTH.toInt(),
        height: Int = CardLayoutV1.HEIGHT.toInt(),
        draw: DrawScope.() -> Unit,
    ): ByteArray {
        val image = ImageBitmap(width, height)
        CanvasDrawScope().draw(
            density = Density(1f),
            layoutDirection = LayoutDirection.Ltr,
            canvas = Canvas(image),
            size = Size(width.toFloat(), height.toFloat()),
            block = draw,
        )
        return ByteArrayOutputStream().use { out ->
            check(image.asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, out)) { "PNG encode failed" }
            out.toByteArray()
        }
    }
}
