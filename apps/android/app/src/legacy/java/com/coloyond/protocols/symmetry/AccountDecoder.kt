package com.coloyond.protocols.symmetry

import com.funkatronics.encoders.Base58

/**
 * Read-only decoder for Symmetry V3 accounts, ported from the borsh layouts in
 * `@symmetry-hq/sdk` 1.0.23 (`dist/layouts/{basket,config,oracle,fraction}.js`).
 *
 * The SDK is TypeScript, so the app does not run it. `tools/symmetry-fixtures`
 * runs the pinned SDK off-device and writes fixtures; `AccountDecoderTest`
 * checks that this decoder reproduces them exactly. A layout change in a new
 * SDK release must update this file, its fixtures and [LAYOUT_VERSION] together.
 */
object SymmetryLayout {
    const val LAYOUT_VERSION = "symmetry-v3/sdk-1.0.23"
    const val PROGRAM_ID = "BASKT7aKd8n7ibpUbwLP3Wiyxyi3yoiXsxBk4Hpumate"

    const val DISCRIMINATOR_SIZE = 8
    const val MAX_SUPPORTED_TOKENS_PER_VAULT = 100
    const val MAX_MANAGERS_PER_VAULT = 10
    const val MAX_ORACLES_PER_TOKEN = 4
    const val MAX_ACCOUNTS_PER_ORACLE = 4
    const val MAX_SYMBOL_LENGTH = 10
    const val MAX_NAME_LENGTH = 32
    const val MAX_URI_LENGTH = 200

    /** Borsh span of `VaultLayout`, without the discriminator. */
    const val VAULT_SPAN = 30651

    /** Borsh span of `GlobalConfigLayout`, without the discriminator. */
    const val GLOBAL_CONFIG_SPAN = 652
}

class AccountDecodeException(message: String) : IllegalArgumentException(message)

/** u128 fixed-point value `high + low / 2^64`, kept as raw words. */
data class Fraction(val high: ULong, val low: ULong)

data class OracleSettings(
    val oracleType: Int,
    val numRequiredAccounts: Int,
    val weight: Int,
    val isRequired: Int,
    val confThreshBps: Int,
    val volatilityThreshBps: Int,
    val maxSlippageBps: Int,
    val minLiquidity: ULong,
    val stalenessThresh: ULong,
    val stalenessConfRateBps: Int,
    val tokenDecimals: Int,
    val twapSecondsAgo: ULong,
    val twapSecondarySecondsAgo: ULong,
    val quote: Int,
    val side: Int,
)

data class OracleData(
    val oracleSettings: OracleSettings,
    val accountsToLoadLutIds: List<Int>,
    val accountsToLoadLutIndices: List<Int>,
)

data class OracleAggregator(
    val numOracles: Int,
    val minOraclesThresh: Int,
    val oracles: List<OracleData>,
    val minConfBps: Int,
    val confThreshBps: Int,
    val confMultiplier: Fraction,
)

data class Asset(
    val mint: String,
    val amount: ULong,
    val weight: Int,
    val active: Int,
    val oracleAggregator: OracleAggregator,
)

data class ManagerSettings(
    val managers: List<String>,
    val managersWeightBps: List<Int>,
    val modificationDelay: ULong,
)

data class FeeSettings(
    val hostDepositFeeBps: Int,
    val hostWithdrawFeeBps: Int,
    val hostManagementFeeBps: Int,
    val hostPerformanceFeeBps: Int,
    val creatorDepositFeeBps: Int,
    val creatorWithdrawFeeBps: Int,
    val creatorManagementFeeBps: Int,
    val creatorPerformanceFeeBps: Int,
    val managersDepositFeeBps: Int,
    val managersWithdrawFeeBps: Int,
    val managersManagementFeeBps: Int,
    val managersPerformanceFeeBps: Int,
    val vaultDepositFeeBps: Int,
    val vaultWithdrawFeeBps: Int,
    val extraData: List<Int>,
    val modificationDelay: ULong,
)

data class ScheduleSettings(
    val cycleStartTime: ULong,
    val cycleDuration: ULong,
    val depositsStart: ULong,
    val depositsEnd: ULong,
    val automationStart: ULong,
    val automationEnd: ULong,
    val managementStart: ULong,
    val managementEnd: ULong,
    val modificationDelay: ULong,
)

data class AutomationSettings(
    val allowAutomation: Int,
    val rebalanceSlippageThresholdBps: Int,
    val perTradeRebalanceSlippageThresholdBps: Int,
    val rebalanceActivationThresholdAbsBps: Int,
    val rebalanceActivationThresholdRelBps: Int,
    val rebalanceActivationCooldown: ULong,
    val extraData: List<String>,
    val modificationDelay: ULong,
)

data class LpSettings(
    val allowLp: Int,
    val lpThresholdBps: Int,
    val extraData: List<Int>,
    val modificationDelay: ULong,
)

data class MetadataSettings(
    val symbolLength: Int,
    val symbol: List<Int>,
    val nameLength: Int,
    val name: List<Int>,
    val uriLength: Int,
    val uri: List<Int>,
    val modificationDelay: ULong,
)

data class VaultSettings(
    val creator: String,
    val host: String,
    val vaultType: Int,
    val bountyMint: String,
    val bountyBalance: ULong,
    val startPrice: Fraction,
    val highWaterMark: Fraction,
    val activeRebalance: ULong,
    val activeWithdraws: ULong,
    val activeManagements: ULong,
    val lastAutomationExecutionTimestamp: ULong,
    val managers: ManagerSettings,
    val managersLastUpdateTimestamp: ULong,
    val managersAuthorityBitmask: Int,
    val fees: FeeSettings,
    val feesLastUpdateTimestamp: ULong,
    val feesAuthorityBitmask: Int,
    val schedule: ScheduleSettings,
    val scheduleLastUpdateTimestamp: ULong,
    val scheduleAuthorityBitmask: Int,
    val automation: AutomationSettings,
    val automationLastUpdateTimestamp: ULong,
    val automationAuthorityBitmask: Int,
    val lp: LpSettings,
    val lpLastUpdateTimestamp: ULong,
    val lpAuthorityBitmask: Int,
    val metadata: MetadataSettings,
    val metadataLastUpdateTimestamp: ULong,
    val metadataAuthorityBitmask: Int,
    val depositsAreAllowed: Int,
    val depositsAuthorityBitmask: Int,
    val forceRebalanceIsAllowed: Int,
    val forceRebalanceModificationDelay: ULong,
    val forceRebalanceLastUpdateTimestamp: ULong,
    val forceRebalanceAuthorityBitmask: Int,
    val customRebalanceIsAllowed: Int,
    val customRebalanceModificationDelay: ULong,
    val customRebalanceLastUpdateTimestamp: ULong,
    val customRebalanceAuthorityBitmask: Int,
    val addTokenDelay: ULong,
    val addTokenLastUpdateTimestamp: ULong,
    val addTokenIntentAuthorityBitmask: Int,
    val updateWeightsDelay: ULong,
    val updateWeightsLastUpdateTimestamp: ULong,
    val updateWeightsIntentAuthorityBitmask: Int,
    val makeDirectSwapDelay: ULong,
    val makeDirectSwapLastUpdateTimestamp: ULong,
    val makeDirectSwapIntentAuthorityBitmask: Int,
    val extraData: List<ULong>,
    val creationTimestamp: ULong,
)

data class VaultFees(
    val symmetryFees: ULong,
    val creatorFees: ULong,
    val hostFees: ULong,
    val managersFees: ULong,
)

data class LookupTables(val active: List<String>, val temp: List<String>)

/**
 * A full `VaultLayout` decode. [composition] keeps all
 * [SymmetryLayout.MAX_SUPPORTED_TOKENS_PER_VAULT] slots, as the SDK's raw
 * decode does; only the first [numTokens] are in use.
 */
data class VaultAccount(
    val version: Int,
    val ownAddress: String,
    val mint: String,
    val supplyOutstanding: ULong,
    val settings: VaultSettings,
    val accumulatedFees: VaultFees,
    val lookupTables: LookupTables,
    val numTokens: Int,
    val composition: List<Asset>,
) {
    val activeComposition: List<Asset> get() = composition.take(numTokens)
}

data class BountySchedule(
    val minBounty: ULong,
    val maxBounty: ULong,
    val minBountyUntil: ULong,
    val maxBountyAfter: ULong,
)

data class GlobalConfigAccount(
    val admin: String,
    val owners: List<String>,
    val totalNumberOfVaults: ULong,
    val allowInteractions: Int,
    val allowCreation: Int,
    val allowManagement: Int,
    val allowAutomation: Int,
    val allowDeposits: Int,
    val allowWithdraws: Int,
    val maxDepositFeeBps: Int,
    val maxWithdrawFeeBps: Int,
    val maxManagementFeeBps: Int,
    val maxPerformanceFeeBps: Int,
    val symmetryFeeCollector: String,
    val symmetryDepositFeeBps: Int,
    val symmetryDepositFeeShareBps: Int,
    val symmetryWithdrawFeeBps: Int,
    val symmetryWithdrawFeeShareBps: Int,
    val symmetryManagementFeeBps: Int,
    val symmetryManagementFeeShareBps: Int,
    val symmetryPerformanceFeeBps: Int,
    val symmetryPerformanceFeeShareBps: Int,
    val symmetryTradeFeeBps: Int,
    val symmetryLimitOrderFeeBps: Int,
    val symmetryFeesExtraData: List<Int>,
    val bountyMint: String,
    val minBountyForVaultAutomation: ULong,
    val bountyBondAmount: ULong,
    val bountyPerTask: BountySchedule,
    val bountyPerPriceUpdateTaskDivisor: ULong,
    val minRemainingValue: Fraction,
    val minMintRatio: Fraction,
    val aprBpsPerYear: Int,
    val rebalanceIntentLifetime: ULong,
    val rebalanceAuction1Timeframe: ULong,
    val rebalanceAuction2Timeframe: ULong,
    val rebalanceAuction3Timeframe: ULong,
    val priceUpdateDelayAfterCreation: ULong,
    val priceUpdateLifetime: ULong,
    val priceUpdateReexecutionDelay: ULong,
    val extraData: List<ULong>,
)

object AccountDecoder {
    /**
     * Decodes a full vault account, including its 8-byte discriminator.
     * Rejects data whose length is not exactly discriminator + [SymmetryLayout.VAULT_SPAN],
     * so a layout change fails closed instead of decoding shifted fields.
     */
    fun decodeVault(data: ByteArray): VaultAccount {
        requireSize(data, SymmetryLayout.VAULT_SPAN, "vault")
        val r = BorshReader(data, SymmetryLayout.DISCRIMINATOR_SIZE)
        val vault = VaultAccount(
            version = r.u8(),
            ownAddress = r.pubkey(),
            mint = r.pubkey(),
            supplyOutstanding = r.u64(),
            settings = r.vaultSettings(),
            accumulatedFees = VaultFees(r.u64(), r.u64(), r.u64(), r.u64()),
            lookupTables = LookupTables(r.list(2) { pubkey() }, r.list(2) { pubkey() }),
            numTokens = r.u8(),
            composition = r.list(SymmetryLayout.MAX_SUPPORTED_TOKENS_PER_VAULT) { asset() },
        )
        r.expectEnd("vault")
        if (vault.numTokens > SymmetryLayout.MAX_SUPPORTED_TOKENS_PER_VAULT) {
            throw AccountDecodeException("vault numTokens ${vault.numTokens} exceeds slots")
        }
        return vault
    }

    /** Decodes the global config account, including its 8-byte discriminator. */
    fun decodeGlobalConfig(data: ByteArray): GlobalConfigAccount {
        requireSize(data, SymmetryLayout.GLOBAL_CONFIG_SPAN, "global config")
        val r = BorshReader(data, SymmetryLayout.DISCRIMINATOR_SIZE)
        val config = GlobalConfigAccount(
            admin = r.pubkey(),
            owners = r.list(3) { pubkey() },
            totalNumberOfVaults = r.u64(),
            allowInteractions = r.u8(),
            allowCreation = r.u8(),
            allowManagement = r.u8(),
            allowAutomation = r.u8(),
            allowDeposits = r.u8(),
            allowWithdraws = r.u8(),
            maxDepositFeeBps = r.u16(),
            maxWithdrawFeeBps = r.u16(),
            maxManagementFeeBps = r.u16(),
            maxPerformanceFeeBps = r.u16(),
            symmetryFeeCollector = r.pubkey(),
            symmetryDepositFeeBps = r.u16(),
            symmetryDepositFeeShareBps = r.u16(),
            symmetryWithdrawFeeBps = r.u16(),
            symmetryWithdrawFeeShareBps = r.u16(),
            symmetryManagementFeeBps = r.u16(),
            symmetryManagementFeeShareBps = r.u16(),
            symmetryPerformanceFeeBps = r.u16(),
            symmetryPerformanceFeeShareBps = r.u16(),
            symmetryTradeFeeBps = r.u16(),
            symmetryLimitOrderFeeBps = r.u16(),
            symmetryFeesExtraData = r.list(16) { u8() },
            bountyMint = r.pubkey(),
            minBountyForVaultAutomation = r.u64(),
            bountyBondAmount = r.u64(),
            bountyPerTask = BountySchedule(r.u64(), r.u64(), r.u64(), r.u64()),
            bountyPerPriceUpdateTaskDivisor = r.u64(),
            minRemainingValue = r.fraction(),
            minMintRatio = r.fraction(),
            aprBpsPerYear = r.u16(),
            rebalanceIntentLifetime = r.u64(),
            rebalanceAuction1Timeframe = r.u64(),
            rebalanceAuction2Timeframe = r.u64(),
            rebalanceAuction3Timeframe = r.u64(),
            priceUpdateDelayAfterCreation = r.u64(),
            priceUpdateLifetime = r.u64(),
            priceUpdateReexecutionDelay = r.u64(),
            extraData = r.list(32) { u64() },
        )
        r.expectEnd("global config")
        return config
    }

    private fun requireSize(data: ByteArray, span: Int, what: String) {
        val expected = SymmetryLayout.DISCRIMINATOR_SIZE + span
        if (data.size != expected) {
            throw AccountDecodeException("$what account is ${data.size} bytes, expected $expected")
        }
    }
}

/** Little-endian borsh reader for fixed-size layouts. */
private class BorshReader(private val data: ByteArray, private var offset: Int) {
    private fun take(n: Int): Int {
        if (offset + n > data.size) throw AccountDecodeException("read past end at $offset")
        val start = offset
        offset += n
        return start
    }

    fun u8(): Int = data[take(1)].toInt() and 0xff

    fun u16(): Int {
        val s = take(2)
        return (data[s].toInt() and 0xff) or ((data[s + 1].toInt() and 0xff) shl 8)
    }

    fun u64(): ULong {
        val s = take(8)
        var v = 0UL
        for (i in 7 downTo 0) v = (v shl 8) or (data[s + i].toULong() and 0xffUL)
        return v
    }

    fun pubkey(): String {
        val s = take(32)
        return Base58.encodeToString(data.copyOfRange(s, s + 32))
    }

    fun fraction(): Fraction = Fraction(high = u64(), low = u64())

    inline fun <T> list(n: Int, item: BorshReader.() -> T): List<T> = List(n) { item() }

    fun expectEnd(what: String) {
        if (offset != data.size) throw AccountDecodeException("$what decode ended at $offset of ${data.size}")
    }

    fun oracleSettings() = OracleSettings(
        oracleType = u8(),
        numRequiredAccounts = u8(),
        weight = u16(),
        isRequired = u8(),
        confThreshBps = u16(),
        volatilityThreshBps = u16(),
        maxSlippageBps = u16(),
        minLiquidity = u64(),
        stalenessThresh = u64(),
        stalenessConfRateBps = u16(),
        tokenDecimals = u8(),
        twapSecondsAgo = u64(),
        twapSecondarySecondsAgo = u64(),
        quote = u8(),
        side = u8(),
    )

    fun oracleAggregator() = OracleAggregator(
        numOracles = u8(),
        minOraclesThresh = u8(),
        oracles = list(SymmetryLayout.MAX_ORACLES_PER_TOKEN) {
            OracleData(
                oracleSettings = oracleSettings(),
                accountsToLoadLutIds = list(SymmetryLayout.MAX_ACCOUNTS_PER_ORACLE) { u8() },
                accountsToLoadLutIndices = list(SymmetryLayout.MAX_ACCOUNTS_PER_ORACLE) { u8() },
            )
        },
        minConfBps = u16(),
        confThreshBps = u16(),
        confMultiplier = fraction(),
    )

    fun asset() = Asset(
        mint = pubkey(),
        amount = u64(),
        weight = u16(),
        active = u8(),
        oracleAggregator = oracleAggregator(),
    )

    fun vaultSettings() = VaultSettings(
        creator = pubkey(),
        host = pubkey(),
        vaultType = u8(),
        bountyMint = pubkey(),
        bountyBalance = u64(),
        startPrice = fraction(),
        highWaterMark = fraction(),
        activeRebalance = u64(),
        activeWithdraws = u64(),
        activeManagements = u64(),
        lastAutomationExecutionTimestamp = u64(),
        managers = ManagerSettings(
            managers = list(SymmetryLayout.MAX_MANAGERS_PER_VAULT) { pubkey() },
            managersWeightBps = list(SymmetryLayout.MAX_MANAGERS_PER_VAULT) { u16() },
            modificationDelay = u64(),
        ),
        managersLastUpdateTimestamp = u64(),
        managersAuthorityBitmask = u16(),
        fees = FeeSettings(
            hostDepositFeeBps = u16(),
            hostWithdrawFeeBps = u16(),
            hostManagementFeeBps = u16(),
            hostPerformanceFeeBps = u16(),
            creatorDepositFeeBps = u16(),
            creatorWithdrawFeeBps = u16(),
            creatorManagementFeeBps = u16(),
            creatorPerformanceFeeBps = u16(),
            managersDepositFeeBps = u16(),
            managersWithdrawFeeBps = u16(),
            managersManagementFeeBps = u16(),
            managersPerformanceFeeBps = u16(),
            vaultDepositFeeBps = u16(),
            vaultWithdrawFeeBps = u16(),
            extraData = list(32) { u8() },
            modificationDelay = u64(),
        ),
        feesLastUpdateTimestamp = u64(),
        feesAuthorityBitmask = u16(),
        schedule = ScheduleSettings(
            cycleStartTime = u64(),
            cycleDuration = u64(),
            depositsStart = u64(),
            depositsEnd = u64(),
            automationStart = u64(),
            automationEnd = u64(),
            managementStart = u64(),
            managementEnd = u64(),
            modificationDelay = u64(),
        ),
        scheduleLastUpdateTimestamp = u64(),
        scheduleAuthorityBitmask = u16(),
        automation = AutomationSettings(
            allowAutomation = u8(),
            rebalanceSlippageThresholdBps = u16(),
            perTradeRebalanceSlippageThresholdBps = u16(),
            rebalanceActivationThresholdAbsBps = u16(),
            rebalanceActivationThresholdRelBps = u16(),
            rebalanceActivationCooldown = u64(),
            extraData = list(4) { pubkey() },
            modificationDelay = u64(),
        ),
        automationLastUpdateTimestamp = u64(),
        automationAuthorityBitmask = u16(),
        lp = LpSettings(
            allowLp = u8(),
            lpThresholdBps = u16(),
            extraData = list(32) { u8() },
            modificationDelay = u64(),
        ),
        lpLastUpdateTimestamp = u64(),
        lpAuthorityBitmask = u16(),
        metadata = MetadataSettings(
            symbolLength = u8(),
            symbol = list(SymmetryLayout.MAX_SYMBOL_LENGTH) { u8() },
            nameLength = u8(),
            name = list(SymmetryLayout.MAX_NAME_LENGTH) { u8() },
            uriLength = u8(),
            uri = list(SymmetryLayout.MAX_URI_LENGTH) { u8() },
            modificationDelay = u64(),
        ),
        metadataLastUpdateTimestamp = u64(),
        metadataAuthorityBitmask = u16(),
        depositsAreAllowed = u8(),
        depositsAuthorityBitmask = u16(),
        forceRebalanceIsAllowed = u8(),
        forceRebalanceModificationDelay = u64(),
        forceRebalanceLastUpdateTimestamp = u64(),
        forceRebalanceAuthorityBitmask = u16(),
        customRebalanceIsAllowed = u8(),
        customRebalanceModificationDelay = u64(),
        customRebalanceLastUpdateTimestamp = u64(),
        customRebalanceAuthorityBitmask = u16(),
        addTokenDelay = u64(),
        addTokenLastUpdateTimestamp = u64(),
        addTokenIntentAuthorityBitmask = u16(),
        updateWeightsDelay = u64(),
        updateWeightsLastUpdateTimestamp = u64(),
        updateWeightsIntentAuthorityBitmask = u16(),
        makeDirectSwapDelay = u64(),
        makeDirectSwapLastUpdateTimestamp = u64(),
        makeDirectSwapIntentAuthorityBitmask = u16(),
        extraData = list(31) { u64() },
        creationTimestamp = u64(),
    )
}
