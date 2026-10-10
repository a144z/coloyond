package com.coloyond.platform

import android.graphics.Bitmap
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Canvas
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.drawscope.CanvasDrawScope
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import java.io.ByteArrayOutputStream

object CardExport {
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
