package com.coloyond.strategy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class StrategyRecordsTest {
    private fun vectors(): JsonValue.Obj {
        val stream = requireNotNull(javaClass.classLoader?.getResourceAsStream("strategy-identity-vectors.json"))
        return StrictJson.parse(stream.bufferedReader(Charsets.UTF_8).use { it.readText() }) as JsonValue.Obj
    }

    @Test fun legacyAndCurrentStrategyVectorsKeepTheirPublishedIds() {
        val root = vectors().fields
        val legacy = root.getValue("legacyV1").asObject("legacyV1")
        legacy.getValue("vectors").asArray("vectors").forEach { rowValue ->
            val row = rowValue.asObject("legacy vector")
            val normalized = row.getValue("normalized")
            val result = StrategyRecords.validateStrategy(normalized)
            assertEquals(row.getValue("strategyId").asString("strategyId"), result.id)
            assertTrue(result.viewOnly)
        }
        root.getValue("vectors").asArray("strategy vectors").forEach { rowValue ->
            val row = rowValue.asObject("strategy vector")
            val result = StrategyRecords.validateStrategy(row.getValue("input"))
            assertEquals(row.getValue("strategyId").asString("strategyId"), result.id)
            assertEquals(StrictJson.canonical(row.getValue("normalized")), result.canonicalJson)
        }
    }

    @Test fun expressionFixturesNowRecomputeNestedAndOuterIds() {
        val rows = vectors().fields.getValue("expressionVectors").asArray("expressionVectors")
        rows.forEach { rowValue ->
            val row = rowValue.asObject("expression vector")
            val canonical = row.getValue("canonicalJson").asString("canonicalJson")
            val expressionFromCanonical = StrictJson.parse(canonical)
            val checked = StrategyRecords.validateExpression(row.getValue("expression"))
            assertEquals(canonical, checked.canonicalJson)
            assertEquals(row.getValue("expressionId").asString("expressionId"), checked.id)
            val canonicalFields = expressionFromCanonical.asObject("canonical expression")
            assertEquals(canonicalFields.getValue("strategyId"), row.getValue("expression").asObject("expression").getValue("strategyId"))
            assertEquals(canonicalFields.getValue("sceneHash"), row.getValue("expression").asObject("expression").getValue("sceneHash"))
        }
    }

    @Test fun sceneVectorAndStrictJsonAreStable() {
        val row = vectors().fields.getValue("sceneVectors").asArray("sceneVectors").single().asObject("scene vector")
        val scene = StrategyRecords.validateScene(row.getValue("scene"))
        assertEquals(row.getValue("sceneHash").asString("sceneHash"), scene.id)
        assertEquals(row.getValue("canonicalJson").asString("canonicalJson"), scene.canonicalJson)
        assertTrue(runCatching { StrictJson.parse("{\"x\":1,\"x\":2}") }.isFailure)
        assertTrue(runCatching { StrictJson.parse("{\"x\":1.5}") }.isFailure)
    }

    @Test fun malformedGeometryAndUnknownFieldsFailClosed() {
        val sceneText = """{"schemaVersion":1,"rendererVersion":1,"canvasRatio":"1:1","background":"paper","seed":4,"layers":[{"type":"polygon","points":[[0,0],[100,0],[100,100],[0,100]],"fill":{"type":"solid","color":"cobalt"},"opacity":1000}],"texture":{"grainIntensity":10},"inheritedFeature":null}"""
        assertTrue(StrategyRecords.validateScene(StrategyRecords.parse(sceneText)).id.matches(Regex("[0-9a-f]{64}")))
        val bowTie = sceneText.replace("[100,0],[100,100]", "[100,100],[100,0]")
        assertTrue(runCatching { StrategyRecords.validateScene(StrategyRecords.parse(bowTie)) }.isFailure)
        assertTrue(runCatching {
            StrategyRecords.validateScene(StrategyRecords.parse(sceneText.dropLast(1) + ",\"unknown\":1}"))
        }.isFailure)
    }

    @Test fun coloyondV1IsASeparateStrictIdentityDomain() {
        val record = """{"schema":"coloyond/ColoyondManagedStrategy/v1","cluster":"mainnet-beta","genesisHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","programId":"BASKT7aKd8n7ibpUbwLP3Wiyxyi3yoiXsxBk4Hpumate","vaultAddress":"CBmmqkqszmEzHJqRx6ExKqq6TWLaDg3wpFcGhVm63HGW","shareMint":"69F1mz9iPdTJwPX8aUmx94HeiTncVuzRue3C8FU6u3bv","configurationRevision":"18446744073709551615","tokens":[{"mint":"So11111111111111111111111111111111111111112","tokenProgram":"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA","decimals":9,"targetBps":6000},{"mint":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v","tokenProgram":"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA","decimals":6,"targetBps":4000}],"policyDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","sourceManifestRevision":"1"}"""
        val validated = StrategyRecords.validateStrategy(StrategyRecords.parse(record))
        assertTrue(validated.id.startsWith("cb3:"))
        assertTrue(validated.viewOnly)
        val fields = validated.value.asObject("validated cb3")
        assertEquals("18446744073709551615", fields.getValue("configurationRevision").asString("configurationRevision"))
        assertTrue(runCatching {
            StrategyRecords.validateStrategy(StrategyRecords.parse(record.replace("\"sourceManifestRevision\":\"1\"", "\"sourceManifestRevision\":\"01\"")))
        }.isFailure)
        assertTrue(runCatching {
            StrategyRecords.validateStrategy(StrategyRecords.parse(record.replace("\"configurationRevision\":\"18446744073709551615\"", "\"configurationRevision\":\"18446744073709551616\"")))
        }.isFailure)
        val reordered = record.replace(
            "\"tokens\":[{\"mint\":\"So11111111111111111111111111111111111111112\",\"tokenProgram\":\"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA\",\"decimals\":9,\"targetBps\":6000},{\"mint\":\"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v\",\"tokenProgram\":\"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA\",\"decimals\":6,\"targetBps\":4000}]",
            "\"tokens\":[{\"mint\":\"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v\",\"tokenProgram\":\"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA\",\"decimals\":6,\"targetBps\":4000},{\"mint\":\"So11111111111111111111111111111111111111112\",\"tokenProgram\":\"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA\",\"decimals\":9,\"targetBps\":6000}]",
        )
        assertTrue(reordered != record)
        assertTrue(runCatching { StrategyRecords.validateStrategy(StrategyRecords.parse(reordered)) }.isFailure)
        assertTrue(runCatching { StrategyRecords.validateStrategy(StrategyRecords.parse(record.dropLast(1) + ",\"extra\":true}")) }.isFailure)

        val scene = StrategyRecords.validateScene(vectors().fields.getValue("sceneVectors").asArray("sceneVectors").single().asObject("scene vector").getValue("scene"))
        val expression = JsonValue.Obj(mapOf(
            "schemaVersion" to JsonValue.Num("2"),
            "strategyId" to JsonValue.Str(validated.id),
            "scene" to scene.value,
            "sceneHash" to JsonValue.Str(scene.id),
            "rendererVersion" to JsonValue.Num("1"),
            "layoutVersion" to JsonValue.Num("1"),
            "caption" to JsonValue.Null,
            "captionOrigin" to JsonValue.Str("none"),
            "generationOrigin" to JsonValue.Str("local-preview"),
            "parentExpressionId" to JsonValue.Null,
        ))
        val expressionId = StrategyRecords.validateExpression(expression, coloyond = true)
        val export = JsonValue.Obj(mapOf(
            "exportVersion" to JsonValue.Num("3"),
            "configurationSnapshot" to JsonValue.Null,
            "strategy" to validated.value,
            "strategyId" to JsonValue.Str(validated.id),
            "expression" to expression,
        ))
        assertEquals(validated.id, StrategyRecords.validateExport(export).id)
        assertTrue(expressionId.id.startsWith("cbe2:"))
        assertTrue(runCatching { StrategyRecords.validateExpression(expression, coloyond = false) }.isFailure)
        val invalidV3Snapshot = JsonValue.Obj(export.fields + ("configurationSnapshot" to JsonValue.Obj(emptyMap())))
        assertTrue(runCatching { StrategyRecords.validateExport(invalidV3Snapshot) }.isFailure)

        val draftVector = vectors().fields.getValue("vectors").asArray("strategy vectors")
            .map { it.asObject("strategy vector") }
            .first { it.getValue("name").asString("name") == "draft-70-30" }
        val draft = StrategyRecords.validateStrategy(draftVector.getValue("input"))
        val exportV2 = JsonValue.Obj(mapOf(
            "exportVersion" to JsonValue.Num("2"),
            "configurationSnapshot" to JsonValue.Null,
            "strategy" to draft.value,
            "strategyId" to JsonValue.Str(draft.id),
            "expression" to JsonValue.Null,
        ))
        assertEquals(draft.id, StrategyRecords.validateExport(exportV2).id)
        val invalidV2Snapshot = JsonValue.Obj(exportV2.fields + ("configurationSnapshot" to JsonValue.Obj(emptyMap())))
        assertTrue(runCatching { StrategyRecords.validateExport(invalidV2Snapshot) }.isFailure)
    }
}
