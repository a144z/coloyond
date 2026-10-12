package com.coloyond.generation

import com.coloyond.strategy.JsonValue
import com.coloyond.strategy.StrategyRecords
import com.coloyond.strategy.ValidatedRecord

/** Versioned, platform-independent scene contract shared by imports and generation. */
object Scene {
    const val MAX_CANONICAL_BYTES = 32 * 1024

    fun validate(value: JsonValue): ValidatedRecord = StrategyRecords.validateScene(value)

    fun parseAndValidate(json: String): ValidatedRecord = validate(StrategyRecords.parse(json))
}
