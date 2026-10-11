package com.coloyond.strategy

/** Where a strategy record came from; imported content is never promoted by matching alone. */
enum class StrategyRecordOrigin { LOCAL, IMPORTED }

enum class VaultPublication { PUBLISHED, NOT_PUBLISHED }
enum class VaultVerification { VERIFIED_ON_CHAIN, UNVERIFIED }
enum class VaultFreshness { CURRENT, STALE }

/**
 * Snapshot supplied by the verified-vault catalog after it checks the live account and manifest.
 * This value is evidence input to a pure mapping, not a cryptographic proof or signing capability.
 */
data class PublishedVaultSnapshot(
    val strategy: ValidatedRecord,
    val publication: VaultPublication,
    val verification: VaultVerification,
    val freshness: VaultFreshness,
)

enum class VaultMappingState { MATCHED_PUBLISHED_REVISION, VIEW_ONLY }

enum class VaultMappingReason {
    EXACT_MATCH,
    IMPORTED_RECORD,
    INVALID_RECORD,
    UNSUPPORTED_STRATEGY,
    NO_PUBLISHED_VAULT,
    NOT_PUBLISHED,
    UNVERIFIED_ON_CHAIN,
    STALE_CONFIGURATION,
    NETWORK_MISMATCH,
    PROGRAM_MISMATCH,
    VAULT_MISMATCH,
    SHARE_MINT_MISMATCH,
    CONFIGURATION_REVISION_MISMATCH,
    TARGET_MINTS_OR_WEIGHTS_MISMATCH,
    POLICY_MISMATCH,
    MANIFEST_REVISION_MISMATCH,
}

data class VaultMappingResult(
    val state: VaultMappingState,
    val reason: VaultMappingReason,
)

/**
 * Matches a local Coloyond managed-strategy revision to a currently verified published vault.
 *
 * An exact match is only catalog/UI mapping. It does not authorize, construct, sign, or submit a
 * transaction. Transaction builders must independently re-read and validate current chain state.
 */
object VaultMapping {
    private const val COLOYOND_SCHEMA = "coloyond/ColoyondManagedStrategy/v1"

    fun map(
        record: ValidatedRecord,
        origin: StrategyRecordOrigin,
        published: PublishedVaultSnapshot?,
    ): VaultMappingResult {
        if (origin == StrategyRecordOrigin.IMPORTED) return viewOnly(VaultMappingReason.IMPORTED_RECORD)

        val candidate = validate(record) ?: return viewOnly(VaultMappingReason.INVALID_RECORD)
        val candidateFields = candidate.value.asObject("strategy")
        if (candidateFields["schema"] != JsonValue.Str(COLOYOND_SCHEMA) || !candidate.id.startsWith("cb3:")) {
            return viewOnly(VaultMappingReason.UNSUPPORTED_STRATEGY)
        }

        if (published == null) return viewOnly(VaultMappingReason.NO_PUBLISHED_VAULT)
        if (published.publication != VaultPublication.PUBLISHED) return viewOnly(VaultMappingReason.NOT_PUBLISHED)
        if (published.verification != VaultVerification.VERIFIED_ON_CHAIN) return viewOnly(VaultMappingReason.UNVERIFIED_ON_CHAIN)
        if (published.freshness != VaultFreshness.CURRENT) return viewOnly(VaultMappingReason.STALE_CONFIGURATION)

        val live = validate(published.strategy) ?: return viewOnly(VaultMappingReason.UNVERIFIED_ON_CHAIN)
        val liveFields = live.value.asObject("published strategy")
        if (liveFields["schema"] != JsonValue.Str(COLOYOND_SCHEMA) || !live.id.startsWith("cb3:")) {
            return viewOnly(VaultMappingReason.UNVERIFIED_ON_CHAIN)
        }

        val mismatch = when {
            candidateFields.getValue("cluster") != liveFields.getValue("cluster") ||
                candidateFields.getValue("genesisHash") != liveFields.getValue("genesisHash") -> VaultMappingReason.NETWORK_MISMATCH
            candidateFields.getValue("programId") != liveFields.getValue("programId") -> VaultMappingReason.PROGRAM_MISMATCH
            candidateFields.getValue("vaultAddress") != liveFields.getValue("vaultAddress") -> VaultMappingReason.VAULT_MISMATCH
            candidateFields.getValue("shareMint") != liveFields.getValue("shareMint") -> VaultMappingReason.SHARE_MINT_MISMATCH
            candidateFields.getValue("configurationRevision") != liveFields.getValue("configurationRevision") ->
                VaultMappingReason.CONFIGURATION_REVISION_MISMATCH
            candidateFields.getValue("tokens") != liveFields.getValue("tokens") -> VaultMappingReason.TARGET_MINTS_OR_WEIGHTS_MISMATCH
            candidateFields.getValue("policyDigest") != liveFields.getValue("policyDigest") -> VaultMappingReason.POLICY_MISMATCH
            candidateFields.getValue("sourceManifestRevision") != liveFields.getValue("sourceManifestRevision") ->
                VaultMappingReason.MANIFEST_REVISION_MISMATCH
            else -> null
        }
        return if (mismatch == null) {
            VaultMappingResult(VaultMappingState.MATCHED_PUBLISHED_REVISION, VaultMappingReason.EXACT_MATCH)
        } else {
            viewOnly(mismatch)
        }
    }

    private fun validate(record: ValidatedRecord): ValidatedRecord? = runCatching {
        StrategyRecords.validateStrategy(record.value).also {
            require(it.id == record.id) { "Strategy identity mismatch" }
        }
    }.getOrNull()

    private fun viewOnly(reason: VaultMappingReason) =
        VaultMappingResult(VaultMappingState.VIEW_ONLY, reason)
}
