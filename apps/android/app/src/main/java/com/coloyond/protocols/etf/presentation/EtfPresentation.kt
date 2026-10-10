package com.coloyond.protocols.etf.presentation

import java.math.BigDecimal
import java.math.BigInteger
import java.math.RoundingMode

/**
 * Provisional, display-only ETF state. Every instance is a synthetic fixture;
 * this is intentionally not the shared S5A read model or a wallet/RPC port.
 */
data class EtfPresentationState(
    val genesisHash: String?,
    val programId: String?,
    val poolAddress: String?,
    val configRevision: String?,
    val observedSlot: String?,
    val assets: List<EtfAssetPresentation>,
    val estimatedNavUsd: String?,
    val shareMint: String?,
    val totalShareSupplyBaseUnits: String?,
    val walletShareBalanceBaseUnits: String?,
    val feeObservation: String?,
    val swapPreview: EtfSwapPreviewPresentation? = null,
    val walletAction: EtfWalletActionPresentation? = null,
)

data class EtfAssetPresentation(
    val symbol: String,
    val mint: String?,
    val decimals: Int,
    val targetWeightBps: Int?,
    val actualValueWeightBps: Int?,
    val custodyAmountBaseUnits: String?,
    val walletAmountBaseUnits: String?,
    val oracle: EtfOraclePresentation,
)

data class EtfOraclePresentation(
    val feedId: String?,
    val mode: EtfOracleMode,
    val state: EtfOracleState,
    val price: String?,
    val publishTime: String?,
    val ageSeconds: Long?,
    val confidence: String?,
    val owner: String?,
    val layoutEvidence: String?,
)

data class EtfSwapPreviewPresentation(
    val inputSymbol: String,
    val outputSymbol: String,
    val grossInputBaseUnits: String?,
    val feeBaseUnits: String?,
    val estimatedOutputBaseUnits: String?,
    val minimumOutputBaseUnits: String?,
    val deviationBeforeBps: Int?,
    val deviationAfterBps: Int?,
    val expirySlot: String?,
)

data class EtfWalletActionPresentation(
    val state: EtfWalletActionState,
    val signature: String? = null,
    val confirmationSlot: String? = null,
    val detail: String? = null,
)

enum class EtfOracleMode { RECEIVER_FULL, PUSH_FEED, UNKNOWN }
enum class EtfOracleState { FRESH, STALE, UNAVAILABLE, INVALID, UNKNOWN }
enum class EtfWalletActionState { DRAFT, AWAITING_SIGNATURE, SUBMITTED, CONFIRMED, REJECTED, UNKNOWN }

/** Small pure helpers shared by the provisional Compose screen and JVM tests. */
object EtfPresentationText {
    const val SYNTHETIC_NOTICE = "SYNTHETIC FIXTURE · NO RPC · NO WALLET ACTIONS"

    fun weightBps(value: Int?): String = when {
        value == null -> "Unknown"
        value !in 0..10_000 -> "Invalid"
        else -> "${value / 100}.${(value % 100).toString().padStart(2, '0')}%"
    }

    /** Formats an unsigned base-unit amount without converting through floating point. */
    fun tokenAmount(baseUnits: String?, decimals: Int): String {
        if (baseUnits == null) return "Unknown"
        if (decimals !in 0..18) return "Invalid"
        val integer = baseUnits.toBigIntegerOrNull() ?: return "Invalid"
        if (integer.signum() < 0) return "Invalid"
        return BigDecimal(integer, decimals).stripTrailingZeros().toPlainString()
    }

    fun oracleMode(mode: EtfOracleMode): String = when (mode) {
        EtfOracleMode.RECEIVER_FULL -> "Receiver · Full verification"
        EtfOracleMode.PUSH_FEED -> "Push Feed · owner/layout/update evidence"
        EtfOracleMode.UNKNOWN -> "Unknown oracle mode"
    }

    fun oracleState(state: EtfOracleState): String = when (state) {
        EtfOracleState.FRESH -> "Fresh"
        EtfOracleState.STALE -> "Stale"
        EtfOracleState.UNAVAILABLE -> "Unavailable"
        EtfOracleState.INVALID -> "Invalid"
        EtfOracleState.UNKNOWN -> "Unknown"
    }

    fun walletAction(state: EtfWalletActionState): String = when (state) {
        EtfWalletActionState.DRAFT -> "Draft · not submitted"
        EtfWalletActionState.AWAITING_SIGNATURE -> "Awaiting wallet signature"
        EtfWalletActionState.SUBMITTED -> "Submitted · confirmation not established"
        EtfWalletActionState.CONFIRMED -> "Confirmed · verify against RPC"
        EtfWalletActionState.REJECTED -> "Rejected"
        EtfWalletActionState.UNKNOWN -> "Unknown · do not resend automatically"
    }

    fun usd(value: String?): String {
        if (value == null) return "Unknown"
        val amount = value.toBigDecimalOrNull() ?: return "Invalid"
        if (amount.signum() < 0) return "Invalid"
        return "$" + amount.setScale(2, RoundingMode.HALF_UP).toPlainString()
    }

    fun ageSeconds(value: Long?): String = when {
        value == null -> "Unknown"
        value < 0 -> "Invalid"
        else -> "$value seconds"
    }

    fun optional(value: String?): String = value ?: "Unknown"
}
