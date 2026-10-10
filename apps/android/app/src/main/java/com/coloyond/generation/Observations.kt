package com.coloyond.generation

import com.coloyond.strategy.JsonValue
import com.coloyond.strategy.StrictJsonException
import com.coloyond.strategy.asArray
import com.coloyond.strategy.asLong
import com.coloyond.strategy.asObject
import com.coloyond.strategy.asString
import java.util.Locale

enum class ObservedLayerType(val label: String) { POLYGON("polygon"), BEAM("beam"), ELLIPSE("ellipse"), RING("ring") }
enum class ObservedRegion(val label: String) {
    UPPER_LEFT("upper-left"), UPPER_CENTER("upper-center"), UPPER_RIGHT("upper-right"),
    MIDDLE_LEFT("middle-left"), MIDDLE_CENTER("middle-center"), MIDDLE_RIGHT("middle-right"),
    LOWER_LEFT("lower-left"), LOWER_CENTER("lower-center"), LOWER_RIGHT("lower-right"),
}
enum class ObservedPaletteToken(val label: String) { PAPER("paper"), INK("ink"), COBALT("cobalt"), VIOLET("violet"), YELLOW("yellow"), CORAL("coral") }
enum class ObservationKind { LAYER, BOUNDS_OVERLAP }

/** Typed fields prevent arbitrary caller text from being copied into a model request. */
class SceneObservation internal constructor(
    val kind: ObservationKind,
    layerIndexes: List<Int>,
    val layerType: ObservedLayerType? = null,
    val region: ObservedRegion? = null,
    paletteTokens: List<ObservedPaletteToken> = emptyList(),
) {
    val layerIndexes: List<Int> = layerIndexes.toList()
    val paletteTokens: List<ObservedPaletteToken> = paletteTokens.toList()

    val fact: String
        get() = when (kind) {
            ObservationKind.LAYER -> "Layer ${layerIndexes.single() + 1} bounds center: ${region!!.label}; ${layerType!!.label}; palette ${paletteTokens.joinToString(" and ") { it.label }}."
            ObservationKind.BOUNDS_OVERLAP -> "The bounds of layers ${layerIndexes[0] + 1} and ${layerIndexes[1] + 1} overlap."
        }
}

object Observations {
    /** Validates the complete scene before deriving any caption input. */
    fun fromScene(scene: JsonValue): List<SceneObservation> {
        Scene.validate(scene)
        val fields = scene.asObject("scene")
        val layers = fields.getValue("layers").asArray("layers")
        val visible = layers.mapIndexedNotNull { index, value ->
            val layer = value.asObject("layer")
            if (layer.getValue("opacity").asLong("opacity") == 0L) return@mapIndexedNotNull null
            VisibleLayer(index, layer, bounds(layer), palette(layer.getValue("fill")))
        }

        val result = mutableListOf<SceneObservation>()
        for (layer in visible.take(MAX_LAYER_FACTS)) {
            val type = layer.fields.getValue("type").asString("layer.type")
            val region = region(layer.bounds.centerX, layer.bounds.centerY)
            result += SceneObservation(
                kind = ObservationKind.LAYER,
                layerIndexes = listOf(layer.index),
                layerType = ObservedLayerType.valueOf(type.uppercase(Locale.ROOT)),
                region = ObservedRegion.valueOf(region.uppercase(Locale.ROOT).replace('-', '_')),
                paletteTokens = layer.paletteTokens.map { ObservedPaletteToken.valueOf(it.uppercase(Locale.ROOT)) },
            )
        }

        if (result.size < MAX_FACTS) {
            val overlap = visible.asSequence().flatMapIndexed { leftPosition, left ->
                visible.drop(leftPosition + 1).asSequence().map { right -> left to right }
            }.firstOrNull { (left, right) -> left.bounds.intersectsArea(right.bounds) }
            if (overlap != null) {
                val (left, right) = overlap
                result += SceneObservation(
                    kind = ObservationKind.BOUNDS_OVERLAP,
                    layerIndexes = listOf(left.index, right.index),
                )
            }
        }
        return result.take(MAX_FACTS)
    }

    private data class VisibleLayer(
        val index: Int,
        val fields: Map<String, JsonValue>,
        val bounds: Bounds,
        val paletteTokens: List<String>,
    )

    private data class Bounds(val left: Int, val top: Int, val right: Int, val bottom: Int) {
        val centerX: Int get() = (left + right) / 2
        val centerY: Int get() = (top + bottom) / 2

        /** Bounds overlap only when their intersection has positive area; touching is not overlap. */
        fun intersectsArea(other: Bounds): Boolean =
            maxOf(left, other.left) < minOf(right, other.right) &&
                maxOf(top, other.top) < minOf(bottom, other.bottom)
    }

    private fun bounds(layer: Map<String, JsonValue>): Bounds {
        fun coord(value: JsonValue, label: String) = value.asLong(label).toInt()
        val type = layer.getValue("type").asString("layer.type")
        return when (type) {
            "polygon", "beam" -> {
                val points = layer.getValue("points").asArray("points").map { point ->
                    val pair = point.asArray("point")
                    require(pair.size == 2) { "Point must contain x and y" }
                    coord(pair[0], "point.x") to coord(pair[1], "point.y")
                }
                Bounds(points.minOf { it.first }, points.minOf { it.second }, points.maxOf { it.first }, points.maxOf { it.second })
            }
            "ellipse" -> {
                val cx = coord(layer.getValue("cx"), "ellipse.cx")
                val cy = coord(layer.getValue("cy"), "ellipse.cy")
                val rx = coord(layer.getValue("rx"), "ellipse.rx")
                val ry = coord(layer.getValue("ry"), "ellipse.ry")
                Bounds((cx - rx).coerceAtLeast(0), (cy - ry).coerceAtLeast(0), (cx + rx).coerceAtMost(1000), (cy + ry).coerceAtMost(1000))
            }
            "ring" -> {
                val cx = coord(layer.getValue("cx"), "ring.cx")
                val cy = coord(layer.getValue("cy"), "ring.cy")
                val extent = coord(layer.getValue("radius"), "ring.radius") + coord(layer.getValue("strokeWidth"), "ring.strokeWidth") / 2
                Bounds((cx - extent).coerceAtLeast(0), (cy - extent).coerceAtLeast(0), (cx + extent).coerceAtMost(1000), (cy + extent).coerceAtMost(1000))
            }
            else -> throw StrictJsonException("Unsupported scene layer")
        }
    }

    private fun palette(fillValue: JsonValue): List<String> {
        val fill = fillValue.asObject("fill")
        return when (fill.getValue("type").asString("fill.type")) {
            "solid" -> listOf(fill.getValue("color").asString("fill.color"))
            "linear" -> fill.getValue("stops").asArray("fill.stops")
                .map { it.asObject("gradient stop").getValue("color").asString("stop.color") }
                .distinct()
            else -> throw StrictJsonException("Unsupported scene fill")
        }
    }

    private fun region(x: Int, y: Int): String {
        val horizontal = when {
            x < 333 -> "left"
            x <= 666 -> "center"
            else -> "right"
        }
        val vertical = when {
            y < 333 -> "upper"
            y <= 666 -> "middle"
            else -> "lower"
        }
        return "$vertical-$horizontal"
    }

    private const val MAX_LAYER_FACTS = 3
    private const val MAX_FACTS = 4
}
