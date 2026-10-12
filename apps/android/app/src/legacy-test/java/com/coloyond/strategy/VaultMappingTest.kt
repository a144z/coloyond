package com.coloyond.strategy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class VaultMappingTest {
    private val publishedJson = """{"schema":"coloyond/ColoyondManagedStrategy/v1","cluster":"mainnet-beta","genesisHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","programId":"BASKT7aKd8n7ibpUbwLP3Wiyxyi3yoiXsxBk4Hpumate","vaultAddress":"CBmmqkqszmEzHJqRx6ExKqq6TWLaDg3wpFcGhVm63HGW","shareMint":"69F1mz9iPdTJwPX8aUmx94HeiTncVuzRue3C8FU6u3bv","configurationRevision":"5","tokens":[{"mint":"So11111111111111111111111111111111111111112","tokenProgram":"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA","decimals":9,"targetBps":6000},{"mint":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v","tokenProgram":"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA","decimals":6,"targetBps":4000}],"policyDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","sourceManifestRevision":"1"}"""

    private fun strategy(json: String = publishedJson) =
        StrategyRecords.validateStrategy(StrategyRecords.parse(json))

    private fun snapshot(
        record: ValidatedRecord = strategy(),
        publication: VaultPublication = VaultPublication.PUBLISHED,
        verification: VaultVerification = VaultVerification.VERIFIED_ON_CHAIN,
        freshness: VaultFreshness = VaultFreshness.CURRENT,
    ) = PublishedVaultSnapshot(record, publication, verification, freshness)

    @Test fun onlyLocalExactCurrentPublishedColoyondRevisionMapsAsMatched() {
        val record = strategy()
        assertTrue(record.viewOnly) // Hash validity is not the publication signal.
        assertEquals(
            VaultMappingResult(VaultMappingState.MATCHED_PUBLISHED_REVISION, VaultMappingReason.EXACT_MATCH),
            VaultMapping.map(record, StrategyRecordOrigin.LOCAL, snapshot()),
        )
    }

    @Test fun importedContentAndHashOnlyRecordsNeverBecomePublished() {
        val imported = strategy()
        assertEquals(
            VaultMappingReason.IMPORTED_RECORD,
            VaultMapping.map(imported, StrategyRecordOrigin.IMPORTED, snapshot()).reason,
        )
        assertEquals(
            VaultMappingReason.NOT_PUBLISHED,
            VaultMapping.map(imported, StrategyRecordOrigin.LOCAL, snapshot(publication = VaultPublication.NOT_PUBLISHED)).reason,
        )
        assertEquals(
            VaultMappingReason.UNVERIFIED_ON_CHAIN,
            VaultMapping.map(imported, StrategyRecordOrigin.LOCAL, snapshot(verification = VaultVerification.UNVERIFIED)).reason,
        )
        assertEquals(
            VaultMappingReason.STALE_CONFIGURATION,
            VaultMapping.map(imported, StrategyRecordOrigin.LOCAL, snapshot(freshness = VaultFreshness.STALE)).reason,
        )
    }

    @Test fun draftsAndLegacySymmetryStrategiesStayViewOnly() {
        val draft = StrategyRecords.validateStrategy(StrategyRecords.parse(
            """{"schemaVersion":1,"kind":"allocation-draft","network":"solana:mainnet-beta","targetWeights":[{"mint":"So11111111111111111111111111111111111111112","weightBps":10000}]}""",
        ))
        val symmetry = StrategyRecords.validateStrategy(StrategyRecords.parse(
            """{"schemaVersion":2,"kind":"managed-vault","network":"solana:mainnet-beta","protocol":"symmetry","programId":"BASKT7aKd8n7ibpUbwLP3Wiyxyi3yoiXsxBk4Hpumate","vaultAddress":"CBmmqkqszmEzHJqRx6ExKqq6TWLaDg3wpFcGhVm63HGW","shareMint":"69F1mz9iPdTJwPX8aUmx94HeiTncVuzRue3C8FU6u3bv","targetWeights":[{"mint":"So11111111111111111111111111111111111111112","weightBps":10000}],"configDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","configProjectionVersion":1}""",
        ))

        assertEquals(VaultMappingReason.UNSUPPORTED_STRATEGY, VaultMapping.map(draft, StrategyRecordOrigin.LOCAL, snapshot()).reason)
        assertEquals(VaultMappingReason.UNSUPPORTED_STRATEGY, VaultMapping.map(symmetry, StrategyRecordOrigin.LOCAL, snapshot()).reason)
        assertEquals(VaultMappingReason.NO_PUBLISHED_VAULT, VaultMapping.map(strategy(), StrategyRecordOrigin.LOCAL, null).reason)
    }

    @Test fun mismatchedNetworkProgramMintsAndRevisionStayUnavailable() {
        val cases = listOf(
            Triple("\"cluster\":\"mainnet-beta\"", "\"cluster\":\"devnet\"", VaultMappingReason.NETWORK_MISMATCH),
            Triple("\"programId\":\"BASKT7aKd8n7ibpUbwLP3Wiyxyi3yoiXsxBk4Hpumate\"", "\"programId\":\"11111111111111111111111111111111\"", VaultMappingReason.PROGRAM_MISMATCH),
            Triple("\"vaultAddress\":\"CBmmqkqszmEzHJqRx6ExKqq6TWLaDg3wpFcGhVm63HGW\"", "\"vaultAddress\":\"11111111111111111111111111111111\"", VaultMappingReason.VAULT_MISMATCH),
            Triple("\"shareMint\":\"69F1mz9iPdTJwPX8aUmx94HeiTncVuzRue3C8FU6u3bv\"", "\"shareMint\":\"11111111111111111111111111111111\"", VaultMappingReason.SHARE_MINT_MISMATCH),
            Triple("\"mint\":\"So11111111111111111111111111111111111111112\"", "\"mint\":\"11111111111111111111111111111111\"", VaultMappingReason.TARGET_MINTS_OR_WEIGHTS_MISMATCH),
            Triple("\"configurationRevision\":\"5\"", "\"configurationRevision\":\"6\"", VaultMappingReason.CONFIGURATION_REVISION_MISMATCH),
            Triple("\"policyDigest\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\"", "\"policyDigest\":\"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc\"", VaultMappingReason.POLICY_MISMATCH),
        )
        cases.forEach { (before, after, reason) ->
            val changed = strategy(publishedJson.replace(before, after))
            val result = VaultMapping.map(changed, StrategyRecordOrigin.LOCAL, snapshot())
            assertEquals(reason, result.reason)
            assertEquals(VaultMappingState.VIEW_ONLY, result.state)
        }
    }

    @Test fun aChangedTargetCreatesANewIdentityAndDoesNotPromoteTheOldCard() {
        val old = strategy()
        val updated = strategy(publishedJson.replace("\"targetBps\":6000", "\"targetBps\":6100")
            .replace("\"targetBps\":4000", "\"targetBps\":3900"))
        assertNotEquals(old.id, updated.id)
        assertEquals(VaultMappingReason.TARGET_MINTS_OR_WEIGHTS_MISMATCH, VaultMapping.map(old, StrategyRecordOrigin.LOCAL, snapshot(updated)).reason)
        assertEquals(VaultMappingState.MATCHED_PUBLISHED_REVISION, VaultMapping.map(updated, StrategyRecordOrigin.LOCAL, snapshot(updated)).state)
        assertEquals("6000", old.value.asObject("old strategy").getValue("tokens").asArray("tokens")[0].asObject("token").getValue("targetBps").asLong("targetBps").toString())
    }

    @Test fun malformedOrTamperedValidatedRecordsFailClosed() {
        val original = strategy()
        val tampered = original.copy(id = "cb3:" + "0".repeat(64))
        assertEquals(VaultMappingReason.INVALID_RECORD, VaultMapping.map(tampered, StrategyRecordOrigin.LOCAL, snapshot()).reason)
    }
}
