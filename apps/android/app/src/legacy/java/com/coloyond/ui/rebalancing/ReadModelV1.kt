package com.coloyond.ui.rebalancing

/** Exact read-only projection used by the portfolio UI; all u64 values stay decimal strings. */
data class ReadModelV1(
    val schema: String,
    val network: Network,
    val source: Source,
    val program: Program,
    val vault: Vault,
    val wallet: Wallet?,
    val oracle: List<OracleFeed>,
    val riskBlockers: List<String>,
    val auction: Auction?,
    val reserve: Reserve?,
    val lastConfirmedTransition: ConfirmedTransition?,
) {
    data class Network(val cluster: Cluster, val genesisHash: String?)

    data class Source(
        val kind: SourceKind,
        val providerLabel: String?,
        val observedAt: String?,
        val slot: String?,
    )

    data class Program(val programId: String?, val binaryHash: String?, val verified: Boolean)

    data class Vault(
        val address: String?,
        val shareMint: String?,
        val configRevision: String?,
        val phase: Phase,
        val target: List<Weight>,
        val actual: List<Weight>?,
        val totalSupply: String?,
        val estimatedNavUsd: String?,
        val exit: Exit,
    )

    data class Wallet(val address: String, val balances: List<WalletBalance>)

    data class WalletBalance(
        val mint: String,
        val symbol: String,
        val decimals: Int,
        val amountBaseUnits: String?,
        val tokenAccount: String,
        val accountExists: Boolean?,
    )

    data class Weight(val mint: String, val symbol: String, val weightBps: Int)

    data class Exit(val available: Boolean?, val mode: ExitMode)

    data class OracleFeed(
        val feedId: String,
        val publishTime: String?,
        val ageSeconds: Long?,
        val verification: OracleVerification,
        val confidenceBps: Int?,
        val state: OracleState,
    )

    data class Auction(
        val sequence: String?,
        val remaining: String?,
        val endSlot: String?,
        val feeBps: Int?,
    )

    data class Reserve(
        val amountByMint: Map<String, String>,
        val bountyLiabilityByMint: Map<String, String>,
    )

    data class ConfirmedTransition(val signature: String, val kind: String, val slot: String)

    enum class Cluster(val wireValue: String) {
        MAINNET_BETA("mainnet-beta"), DEVNET("devnet"), LOCALNET("localnet"),
    }

    enum class SourceKind(val wireValue: String) { RPC("rpc"), FIXTURE("fixture") }
    enum class Phase(val wireValue: String) { UNAVAILABLE("unavailable"), ACTIVE("active"), PAUSED("paused"), AUCTION("auction"), FINALIZATION_REQUIRED("finalization_required"), UNKNOWN("unknown") }
    enum class ExitMode(val wireValue: String) { IN_KIND("in_kind"), UNKNOWN("unknown") }
    enum class OracleVerification(val wireValue: String) { FULL("full"), PARTIAL("partial"), UNKNOWN("unknown") }
    enum class OracleState(val wireValue: String) { FRESH("fresh"), STALE("stale"), DEPEGGED("depegged"), UNAVAILABLE("unavailable"), UNKNOWN("unknown") }

    companion object {
        const val SCHEMA = "coloyond/ReadModel/v1"
    }
}

/** Saved card facts are displayed separately and never treated as a live vault read. */
data class CardTargetSnapshot(
    val recordId: String,
    val kind: Kind,
    val network: String?,
    val protocol: String?,
    val vaultAddress: String?,
    val shareMint: String?,
    val configurationRevision: String?,
    val target: List<ReadModelV1.Weight>,
) {
    enum class Kind { SAVED_MANAGED_STRATEGY, ALLOCATION_DRAFT, HISTORICAL_OR_IMPORTED }
}

/** Pure labels/formatters shared by the Compose screen and unit tests. */
object PortfolioReadModelPresentation {
    fun sourceLabel(kind: ReadModelV1.SourceKind): String = when (kind) {
        ReadModelV1.SourceKind.RPC -> "RPC snapshot"
        ReadModelV1.SourceKind.FIXTURE -> "FIXTURE · sample data"
    }

    fun phaseLabel(phase: ReadModelV1.Phase): String = when (phase) {
        ReadModelV1.Phase.UNAVAILABLE -> "Unavailable"
        ReadModelV1.Phase.ACTIVE -> "Active"
        ReadModelV1.Phase.PAUSED -> "Paused"
        ReadModelV1.Phase.AUCTION -> "Auction"
        ReadModelV1.Phase.FINALIZATION_REQUIRED -> "Auction · finalization required"
        ReadModelV1.Phase.UNKNOWN -> "Unknown"
    }

    fun cardKindLabel(kind: CardTargetSnapshot.Kind): String = when (kind) {
        CardTargetSnapshot.Kind.SAVED_MANAGED_STRATEGY -> "Saved managed strategy · saved target"
        CardTargetSnapshot.Kind.ALLOCATION_DRAFT -> "Allocation draft · desired target"
        CardTargetSnapshot.Kind.HISTORICAL_OR_IMPORTED -> "Historical or imported · saved target"
    }

    fun oracleStateLabel(state: ReadModelV1.OracleState): String = when (state) {
        ReadModelV1.OracleState.FRESH -> "Fresh"
        ReadModelV1.OracleState.STALE -> "Stale"
        ReadModelV1.OracleState.DEPEGGED -> "Depegged"
        ReadModelV1.OracleState.UNAVAILABLE -> "Unavailable"
        ReadModelV1.OracleState.UNKNOWN -> "Unknown"
    }

    fun verificationLabel(value: ReadModelV1.OracleVerification): String = when (value) {
        ReadModelV1.OracleVerification.FULL -> "Full"
        ReadModelV1.OracleVerification.PARTIAL -> "Partial"
        ReadModelV1.OracleVerification.UNKNOWN -> "Unknown"
    }

    fun exitModeLabel(value: ReadModelV1.ExitMode): String = when (value) {
        ReadModelV1.ExitMode.IN_KIND -> "In kind"
        ReadModelV1.ExitMode.UNKNOWN -> "Unknown"
    }

    fun yesNoUnknown(value: Boolean?): String = when (value) {
        true -> "Yes"
        false -> "No"
        null -> "Unknown"
    }

    fun optional(value: String?): String = value ?: "Unknown"

    fun bps(value: Int?): String = value?.let { "${java.math.BigDecimal.valueOf(it.toLong(), 2).toPlainString()}%" } ?: "Unknown"

    fun ageSeconds(value: Long?): String = value?.let { "$it seconds" } ?: "Unknown"

    fun confirmedTransitionLabel(transition: ReadModelV1.ConfirmedTransition?): String =
        if (transition == null) "No confirmed transition available" else "Confirmed · ${transition.kind}"
}
