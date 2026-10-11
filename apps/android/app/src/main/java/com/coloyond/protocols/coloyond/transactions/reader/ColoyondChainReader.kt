package com.coloyond.protocols.coloyond.transactions.reader

import com.funkatronics.encoders.Base58
import com.coloyond.core.rpc.RpcAccountInfo
import com.coloyond.core.rpc.SolanaRpc
import com.coloyond.protocols.coloyond.transactions.ColoyondAddresses
import com.coloyond.protocols.coloyond.transactions.SolanaNetwork
import java.math.BigInteger
import java.time.Clock
import java.time.Instant

sealed interface AccountPresence<out T> {
    data class Present<T>(val value: T) : AccountPresence<T>
    data object Absent : AccountPresence<Nothing>
}

data class VaultAssetRead(
    val mint: String,
    val tokenProgram: String,
    val custody: String,
    val decimals: Int,
    val targetBps: Int,
    val mintState: ClassicMintAccount,
    val custodyState: ClassicTokenAccount,
    val custodyReconciliation: CustodyReconciliation,
)

data class CustodyReconciliation(
    val actualAmount: String,
    val accountedAmount: String,
    val bootstrapReserve: String,
    val bountyLiability: String,
    val actualMinusAccounted: String,
    val status: Status,
) {
    enum class Status { MATCH, SURPLUS, DEFICIT, LIABILITY_UNCOVERED, INVALID_ACCOUNTING }
}

data class ProgramDeploymentRead(
    val lastUpgradeSlot: String,
    val upgradeAuthority: String?,
)

data class OracleRead(
    val address: String,
    val feedIdHex: String,
    val verificationLevel: PythPriceUpdateV2Decoder.VerificationLevel,
    val price: String,
    val confidence: String,
    val exponent: Int,
    val priceQ18: String?,
    val confidenceQ18: String?,
    val publishTime: String,
    val postedSlot: String,
    val ageSeconds: Long?,
    val confidenceBps: String?,
    val usdDeviationBps: String?,
    val blockers: List<String>,
)

data class ColoyondChainSnapshot(
    val endpoint: String,
    val genesisHash: String,
    val contextSlot: ULong,
    val blockTime: Long?,
    val vault: Map<String, Any?>,
    val assets: List<VaultAssetRead>,
    val shareMint: ClassicMintAccount,
    val governance: AccountPresence<Map<String, Any?>>,
    val auctionPolicy: AccountPresence<Map<String, Any?>>,
    val pendingPolicy: AccountPresence<Map<String, Any?>>,
    val conditionState: AccountPresence<Map<String, Any?>>,
    val rebalanceIntent: AccountPresence<Map<String, Any?>>,
    val programDeployment: ProgramDeploymentRead,
    val oracles: List<OracleRead>,
    val walletTokenAccounts: Map<String, AccountPresence<ClassicTokenAccount>>,
    val riskBlockers: List<String>,
    val clientRetrievedAt: Instant? = null,
)

class ChainReadException(val code: String, message: String, cause: Throwable? = null) :
    IllegalStateException(message, cause)

/** Read-only, same-endpoint and coherent-context reader for the pinned v0.3.0 vault. */
class ColoyondChainReader(
    private val rpc: SolanaRpc,
    private val network: SolanaNetwork,
    private val idl: AnchorIdlAccountDecoder,
    private val clock: Clock = Clock.systemUTC(),
) {
    init {
        ColoyondAddresses.validateNetwork(network)
        if (rpc.endpoint != network.rpcUrl) {
            throw ChainReadException("RPC_ENDPOINT_MISMATCH", "Reader RPC endpoint differs from the selected network endpoint")
        }
        if (idl.programAddress != ColoyondAddresses.PROGRAM_ID) {
            throw ChainReadException("IDL_PROGRAM_MISMATCH", "Bundled IDL program address is not the pinned Coloyond program")
        }
    }

    suspend fun read(walletAddress: String? = null): ColoyondChainSnapshot {
        val genesisHash = rpc.getGenesisHash()
        if (genesisHash != network.genesisHash) {
            throw ChainReadException("RPC_GENESIS_MISMATCH", "RPC genesis hash does not match the selected Solana cluster")
        }

        val vaultAddress = ColoyondAddresses.vault()
        val firstRead = rpc.getMultipleAccounts(listOf(vaultAddress))
        val initialVaultAccount = required(firstRead.accounts.singleOrNull(), "VAULT_MISSING", "Vault account is absent")
        val initialVault = decode("Vault", initialVaultAccount)
        validateVault(initialVault, vaultAddress)
        val vaultAssets = initialVault.assetConfigurations()

        val lifecycleRequests = ColoyondAddresses.lifecycleReadRequests(network)
        val addresses = linkedSetOf<String>().apply {
            add(vaultAddress)
            add(ColoyondAddresses.PROGRAM_ID)
            lifecycleRequests.filter { it.name != "vault" }.forEach { add(it.address) }
            vaultAssets.forEach {
                add(it.mint)
                add(it.custody)
            }
            add(initialVault.text("share_mint"))
            walletAddress?.let { wallet ->
                ColoyondAddresses.key(wallet)
                vaultAssets.forEach { add(ColoyondAddresses.associatedToken(wallet, it.mint)) }
                add(ColoyondAddresses.associatedToken(wallet, initialVault.text("share_mint")))
            }
        }.toList()

        val batch = rpc.getMultipleAccounts(addresses, minContextSlot = firstRead.context.slot)
        if (batch.context.slot < firstRead.context.slot) {
            throw ChainReadException("RPC_CONTEXT_REGRESSION", "RPC returned a context older than the discovery read")
        }
        val accounts = addresses.zip(batch.accounts).toMap()
        val repeatedVaultAccount = required(accounts[vaultAddress], "VAULT_DISAPPEARED", "Vault disappeared during the coherent read")
        if (!sameAccount(initialVaultAccount, repeatedVaultAccount)) {
            throw ChainReadException("VAULT_CHANGED_DURING_READ", "Vault changed between discovery and linked-account reads; retry the full snapshot")
        }
        val vault = decode("Vault", repeatedVaultAccount)
        if (vault != initialVault) {
            throw ChainReadException("VAULT_CHANGED_DURING_READ", "Decoded Vault changed during the coherent read")
        }
        val blockTime = rpc.getBlockTime(batch.context.slot)

        val blockers = mutableListOf<String>()
        if (vault.intValue("status") != VAULT_STATUS_ACTIVE) blockers += "VAULT_NOT_ACTIVE"
        val programDeployment = decodeProgramDeployment(
            required(accounts[ColoyondAddresses.PROGRAM_ID], "PROGRAM_MISSING", "Coloyond executable account is missing"),
            required(accounts[ColoyondAddresses.programData()], "PROGRAM_DATA_MISSING", "ProgramData account is missing"),
        )
        if (programDeployment.upgradeAuthority != null) blockers += "PROGRAM_UPGRADE_AUTHORITY_PRESENT"

        val governance = decodeOptional("GovernanceAccount", accounts[ColoyondAddresses.governance(vaultAddress)])
        val policy = decodeOptional("AuctionPolicy", accounts[ColoyondAddresses.auctionPolicy(vaultAddress)])
        val pendingPolicy = decodeOptional("PendingAuctionPolicy", accounts[ColoyondAddresses.pendingPolicy(vaultAddress)])
        val condition = decodeOptional("ConditionState", accounts[ColoyondAddresses.conditionState(vaultAddress)])
        val intent = decodeOptional("RebalanceIntent", accounts[ColoyondAddresses.rebalanceIntent(vaultAddress)])
        val policyFields = policy.presentValue()

        validateGovernance(governance, vault, vaultAddress, blockers)
        validatePolicy(policy, vault, vaultAddress, blockers)
        validatePendingPolicy(pendingPolicy, governance, vault, vaultAddress, blockers)
        validateConditionState(condition, vault, vaultAddress, batch.context.slot, blockTime, policyFields, blockers)
        validateIntent(intent, policy, vault, vaultAddress, batch.context.slot, blockers)

        val assetReads = vaultAssets.mapIndexed { index, asset ->
            if (asset.tokenProgram != ColoyondAddresses.TOKEN_PROGRAM_ID) {
                throw ChainReadException("UNSUPPORTED_TOKEN_PROGRAM", "Asset ${index + 1} is not owned by the classic SPL Token program")
            }
            if (ColoyondAddresses.associatedToken(vaultAddress, asset.mint) != asset.custody) {
                throw ChainReadException("CUSTODY_PDA_MISMATCH", "Vault custody address is not the canonical associated token account")
            }
            val mintAccount = required(accounts[asset.mint], "MINT_MISSING", "Asset mint account is missing")
            if (mintAccount.executable) throw ChainReadException("MINT_IS_EXECUTABLE", "Asset mint account is unexpectedly executable")
            val mintState = decodeMint(mintAccount)
            if (mintState.decimals != asset.decimals) throw ChainReadException("MINT_DECIMALS_MISMATCH", "Asset mint decimals differ from Vault configuration")
            val profileDecimals = if (asset.mint == ColoyondAddresses.WSOL_MINT) 9 else 6
            if (asset.decimals != profileDecimals) throw ChainReadException("ASSET_PROFILE_DECIMALS_MISMATCH", "Asset decimals do not match the pinned WSOL/USDC profile")
            val custodyState = decodeToken(
                required(accounts[asset.custody], "CUSTODY_MISSING", "Vault custody account is missing"),
                expectedMint = asset.mint,
                expectedAuthority = vaultAddress,
            )
            val actual = BigInteger(custodyState.amount)
            val accounted = BigInteger(vault.longArray("accounted_amounts")[index])
            val reserve = BigInteger(vault.longArray("bootstrap_reserve")[index])
            val liability = BigInteger(vault.longArray("bounty_liabilities")[index])
            val reconciliation = when {
                liability > accounted || reserve < liability || reserve > accounted -> CustodyReconciliation.Status.INVALID_ACCOUNTING
                actual < liability -> CustodyReconciliation.Status.LIABILITY_UNCOVERED
                actual < accounted -> CustodyReconciliation.Status.DEFICIT
                actual > accounted -> CustodyReconciliation.Status.SURPLUS
                else -> CustodyReconciliation.Status.MATCH
            }
            if (reconciliation != CustodyReconciliation.Status.MATCH) blockers += "CUSTODY_${index}_$reconciliation"
            if (custodyState.delegate != null || custodyState.delegatedAmount != "0" || custodyState.closeAuthority != null) {
                blockers += "CUSTODY_${index}_UNEXPECTED_AUTHORITY"
            }
            VaultAssetRead(
                mint = asset.mint,
                tokenProgram = asset.tokenProgram,
                custody = asset.custody,
                decimals = asset.decimals,
                targetBps = asset.targetBps,
                mintState = mintState,
                custodyState = custodyState,
                custodyReconciliation = CustodyReconciliation(
                    actualAmount = custodyState.amount,
                    accountedAmount = accounted.toString(),
                    bootstrapReserve = reserve.toString(),
                    bountyLiability = liability.toString(),
                    actualMinusAccounted = (actual - accounted).toString(),
                    status = reconciliation,
                ),
            )
        }

        val shareMintAddress = vault.text("share_mint")
        val shareMint = decodeMint(required(accounts[shareMintAddress], "SHARE_MINT_MISSING", "Share mint account is missing"))
        if (shareMint.decimals != SHARE_MINT_DECIMALS || shareMint.mintAuthority != vaultAddress || shareMint.freezeAuthority != null) {
            throw ChainReadException("INVALID_SHARE_MINT", "Share mint authority, decimals, or freeze authority violates the pinned token policy")
        }
        if (shareMint.supply != vault.text("total_shares")) {
            throw ChainReadException("SHARE_SUPPLY_MISMATCH", "Share mint supply differs from the Vault share accounting")
        }

        if (policyFields == null) blockers += "AUCTION_POLICY_ABSENT"
        if (blockTime == null) blockers += "RPC_BLOCK_TIME_UNAVAILABLE"
        val oracles = listOf(
            oracleRead(accounts, ColoyondAddresses.SOL_USD_FEED, SOL_USD_FEED_ID, blockTime, policyFields, isUsdc = false),
            oracleRead(accounts, ColoyondAddresses.USDC_USD_FEED, USDC_USD_FEED_ID, blockTime, policyFields, isUsdc = true),
        )
        oracles.flatMap { it.blockers }.forEach { blockers += it }

        val walletAccounts = if (walletAddress == null) emptyMap() else buildMap {
            vaultAssets.forEach { asset ->
                val address = ColoyondAddresses.associatedToken(walletAddress, asset.mint)
                put(address, decodeWalletToken(accounts[address], asset.mint, walletAddress))
            }
            val shares = ColoyondAddresses.associatedToken(walletAddress, shareMintAddress)
            put(shares, decodeWalletToken(accounts[shares], shareMintAddress, walletAddress))
        }

        return ColoyondChainSnapshot(
            endpoint = rpc.endpoint,
            genesisHash = genesisHash,
            contextSlot = batch.context.slot,
            blockTime = blockTime,
            vault = vault,
            assets = assetReads,
            shareMint = shareMint,
            governance = governance,
            auctionPolicy = policy,
            pendingPolicy = pendingPolicy,
            conditionState = condition,
            rebalanceIntent = intent,
            programDeployment = programDeployment,
            oracles = oracles,
            walletTokenAccounts = walletAccounts,
            riskBlockers = blockers.distinct(),
            clientRetrievedAt = clock.instant(),
        )
    }

    /** Reads and decodes a confirmed transaction without signing, rebuilding, or resending it. */
    suspend fun observeTransaction(signature: String): DecodedTransactionObservation? {
        val observation = rpc.getTransaction(signature) ?: return null
        if (observation.requestedSignature != signature) {
            throw ChainReadException("TRANSACTION_SIGNATURE_MISMATCH", "RPC observation is not bound to the requested signature")
        }
        return try {
            TransactionObservationDecoder.decode(observation)
        } catch (error: IllegalArgumentException) {
            throw ChainReadException("INVALID_TRANSACTION_OBSERVATION", "Confirmed RPC transaction could not be decoded safely", error)
        }
    }

    private fun decode(accountName: String, account: RpcAccountInfo): Map<String, Any?> = try {
        if (account.executable) throw ChainReadException("ACCOUNT_IS_EXECUTABLE", "$accountName state account is unexpectedly executable")
        idl.decode(accountName, account.owner, account.data)
    } catch (error: IllegalArgumentException) {
        throw ChainReadException("INVALID_${accountName.uppercase()}", "On-chain $accountName account failed the pinned IDL checks", error)
    }

    private fun decodeOptional(name: String, account: RpcAccountInfo?): AccountPresence<Map<String, Any?>> =
        if (account == null) AccountPresence.Absent else AccountPresence.Present(decode(name, account))

    private fun validateVault(vault: Map<String, Any?>, address: String) {
        if (vault.intValue("version") != VAULT_VERSION) throw ChainReadException("VAULT_VERSION_UNSUPPORTED", "Vault version is not supported")
        if (vault.intValue("status") !in 0..2) throw ChainReadException("VAULT_STATUS_UNSUPPORTED", "Vault status is not defined by the pinned program")
        if (vault.text("authority") != address) throw ChainReadException("VAULT_AUTHORITY_MISMATCH", "Vault authority does not match its canonical PDA")
        if (BigInteger(vault.text("configuration_revision")) == BigInteger.ZERO ||
            BigInteger(vault.text("minimum_locked_shares")) == BigInteger.ZERO ||
            BigInteger(vault.text("total_shares")) <= BigInteger(vault.text("minimum_locked_shares"))
        ) throw ChainReadException("VAULT_SHARE_STATE_INVALID", "Vault share supply or configuration revision is not initialized")
        val assets = vault.assetConfigurations()
        if (assets.size != ASSET_COUNT || assets.map { it.mint }.distinct().size != ASSET_COUNT) {
            throw ChainReadException("INVALID_VAULT_ASSETS", "Vault must contain exactly two distinct assets")
        }
        if (assets.any { it.targetBps <= 0 } || assets.sumOf { it.targetBps } != BPS_DENOMINATOR) {
            throw ChainReadException("INVALID_VAULT_TARGETS", "Vault asset targets must be positive and total 10,000 bps")
        }
        val feedIndices = assets.map { asset ->
            when (asset.mint) {
                ColoyondAddresses.WSOL_MINT -> 0
                ColoyondAddresses.DEVNET_USDC_MINT -> 1
                else -> throw ChainReadException("UNSUPPORTED_ASSET_MINT", "Vault contains an asset outside the pinned WSOL/USDC profile")
            }
        }
        if (feedIndices.distinct().size != ASSET_COUNT) {
            throw ChainReadException("INVALID_ASSET_PAIR", "Vault must contain one WSOL mint and one supported USDC mint")
        }
        if (assets.none { it.mint == ColoyondAddresses.DEVNET_USDC_MINT }) {
            throw ChainReadException("CLUSTER_ASSET_MISMATCH", "Devnet and Localnet vaults must use the pinned Devnet USDC mint")
        }
        if (vault.intValue("bump") != VAULT_BUMP) {
            throw ChainReadException("VAULT_BUMP_MISMATCH", "Vault account bump does not match the canonical global PDA")
        }
        if (vault.text("share_mint") == address || vault.text("share_mint") == "11111111111111111111111111111111") {
            throw ChainReadException("INVALID_SHARE_MINT", "Vault has an invalid share mint address")
        }
    }

    private fun validateGovernance(
        presence: AccountPresence<Map<String, Any?>>,
        vault: Map<String, Any?>,
        vaultAddress: String,
        blockers: MutableList<String>,
    ) {
        val governance = presence.presentValue() ?: run {
            blockers += "GOVERNANCE_ABSENT"
            return
        }
        if (governance.intValue("version") != GOVERNANCE_VERSION || governance.text("vault") != vaultAddress) {
            throw ChainReadException("GOVERNANCE_LINK_MISMATCH", "Governance account version or vault link is invalid")
        }
        if (governance.text("share_mint") != vault.text("share_mint") ||
            governance.stringArray("allowed_mints") != vault.assetConfigurations().map { it.mint } ||
            governance.intArray("target_bps") != vault.assetConfigurations().map { it.targetBps } ||
            governance.text("configuration_revision") != vault.text("configuration_revision")
        ) throw ChainReadException("GOVERNANCE_CONFIG_MISMATCH", "Governance account does not match the current Vault configuration")
        if (governance.booleanValue("risk_paused")) blockers += "RISK_PAUSED"
        if (governance["pending"] != null) blockers += "GOVERNANCE_PROPOSAL_PENDING"
    }

    private fun validatePolicy(
        presence: AccountPresence<Map<String, Any?>>,
        vault: Map<String, Any?>,
        vaultAddress: String,
        blockers: MutableList<String>,
    ) {
        val policy = presence.presentValue() ?: return
        if (policy.intValue("version") != AUCTION_POLICY_VERSION || policy.text("vault") != vaultAddress ||
            policy.text("configuration_revision") != vault.text("configuration_revision")
        ) throw ChainReadException("POLICY_LINK_MISMATCH", "Auction policy version, vault, or revision is stale")
        val indexes = policy.intArray("asset_feed_indices")
        val expectedIndexes = vault.assetConfigurations().map { if (it.mint == ColoyondAddresses.WSOL_MINT) 0 else 1 }
        if (indexes != expectedIndexes) {
            throw ChainReadException("POLICY_FEED_MAPPING_INVALID", "Auction policy feed mapping does not match the pinned asset order")
        }
        val maxAge = BigInteger(policy.text("maximum_age_seconds"))
        val maxConfidence = policy.intValue("maximum_confidence_bps")
        val maxDeviation = policy.intValue("maximum_usdc_deviation_bps")
        val minimumDrift = policy.intValue("minimum_drift_bps")
        val maximumTradeValue = BigInteger(policy.text("maximum_trade_value_q9"))
        val cooldown = BigInteger(policy.text("cooldown_slots"))
        val curveStart = policy.intValue("curve_start_rate_bps")
        val curveEnd = policy.intValue("curve_end_rate_bps")
        val duration = BigInteger(policy.text("duration_slots"))
        val fee = policy.intValue("fee_bps")
        val maximumFee = policy.intValue("maximum_fee_bps")
        val feeReserveShare = policy.intValue("fee_reserve_share_bps")
        val maximumNavLoss = policy.intValue("maximum_nav_loss_bps")
        val maximumCumulativeNavLoss = policy.intValue("maximum_cumulative_nav_loss_bps")
        val maxBps = BPS_DENOMINATOR
        if (maxAge <= BigInteger.ZERO || maxAge > BigInteger.valueOf(Long.MAX_VALUE) ||
            maxConfidence !in 0..maxBps || maxDeviation !in 0..maxBps ||
            minimumDrift !in 1..maxBps || maximumTradeValue <= BigInteger.ZERO || cooldown <= BigInteger.ZERO ||
            curveStart < curveEnd || curveEnd <= 0 || duration <= BigInteger.ZERO ||
            fee !in 0..maximumFee || maximumFee !in 0..maxBps || feeReserveShare !in 0..maxBps ||
            maximumNavLoss !in 0..maxBps || maximumCumulativeNavLoss !in maximumNavLoss..maxBps
        ) throw ChainReadException("POLICY_VALUES_INVALID", "Auction policy contains values rejected by the pinned on-chain validator")

        val reserveFloors = policy.longArray("reserve_floor").map { BigInteger(it) }
        val epochBudgets = policy.longArray("epoch_bounty_budget").map { BigInteger(it) }
        val reserves = vault.longArray("bootstrap_reserve").map { BigInteger(it) }
        val liabilities = vault.longArray("bounty_liabilities").map { BigInteger(it) }
        if (reserveFloors.size != ASSET_COUNT || epochBudgets.size != ASSET_COUNT ||
            reserves.size != ASSET_COUNT || liabilities.size != ASSET_COUNT
        ) throw ChainReadException("POLICY_RESERVE_LAYOUT_INVALID", "Policy or Vault reserve arrays have the wrong asset count")
        for (index in 0 until ASSET_COUNT) {
            val freeReserve = reserves[index] - liabilities[index]
            if (freeReserve < BigInteger.ZERO || reserveFloors[index] > freeReserve || epochBudgets[index] > freeReserve) {
                throw ChainReadException("POLICY_RESERVE_EXCEEDS_FREE", "Policy reserve floor or bounty budget exceeds the free Vault reserve")
            }
        }
    }

    private fun validatePendingPolicy(
        presence: AccountPresence<Map<String, Any?>>,
        governance: AccountPresence<Map<String, Any?>>,
        vault: Map<String, Any?>,
        vaultAddress: String,
        blockers: MutableList<String>,
    ) {
        val pending = presence.presentValue() ?: return
        val version = pending.intValue("version")
        if (version == 0) return
        if (version != 1 || pending.text("vault") != vaultAddress) {
            throw ChainReadException("PENDING_POLICY_INVALID", "Pending policy version or vault link is invalid")
        }
        if (pending.intValue("bump") != PENDING_POLICY_BUMP) {
            throw ChainReadException("PENDING_POLICY_BUMP_MISMATCH", "Pending policy bump does not match its canonical PDA")
        }
        val governanceFields = governance.presentValue()
        if (governanceFields != null && pending.text("governance_authority") != governanceFields.text("governance_authority")) {
            throw ChainReadException("PENDING_GOVERNANCE_MISMATCH", "Pending policy governance authority differs from the current governance account")
        }
        if (pending.text("configuration_revision") != vault.text("configuration_revision") ||
            pending.text("vault_sequence") != vault.text("sequence")
        ) blockers += "PENDING_POLICY_STALE"
        blockers += "POLICY_CHANGE_PENDING"
    }

    private fun validateConditionState(
        presence: AccountPresence<Map<String, Any?>>,
        vault: Map<String, Any?>,
        vaultAddress: String,
        contextSlot: ULong,
        blockTime: Long?,
        policy: Map<String, Any?>?,
        blockers: MutableList<String>,
    ) {
        val state = presence.presentValue() ?: return
        if (state.intValue("version") != CONDITION_STATE_VERSION || state.text("vault") != vaultAddress) {
            throw ChainReadException("CONDITION_LINK_MISMATCH", "Condition state version or vault link is invalid")
        }
        if (state.intValue("bump") != CONDITION_STATE_BUMP) {
            throw ChainReadException("CONDITION_BUMP_MISMATCH", "Condition state bump does not match its canonical PDA")
        }
        val rule = state["active_rule"] as? Map<*, *>
        if (rule != null) {
            val revisions = rule["expected_revisions"] as? Map<*, *>
            if (revisions != null && (revisions["target"]?.toString() != vault.text("configuration_revision") ||
                revisions["configuration"]?.toString() != vault.text("configuration_revision"))
            ) blockers += "CONDITION_RULE_STALE"
            val expectedTarget = revisions?.get("target")?.toString()?.toBigIntegerOrNull()
            val authorizedTarget = rule["authorized_target_revision"]?.toString()?.toBigIntegerOrNull()
            val ruleVersion = (rule["version"] as? Number)?.toInt()
            val nonce = rule["nonce"]?.toString()?.toBigIntegerOrNull()
            val targetBps = (rule["target_bps"] as? List<*>)?.mapNotNull { (it as? Number)?.toInt() }
            if (ruleVersion != 1 || nonce == null || nonce <= BigInteger.ZERO || rule["pending_activation"] != false ||
                expectedTarget == null || expectedTarget >= U64_MAX || authorizedTarget != expectedTarget + BigInteger.ONE ||
                targetBps == null || targetBps.size != ASSET_COUNT || targetBps.any { it <= 0 } || targetBps.sum() != BPS_DENOMINATOR
            ) blockers += "CONDITION_RULE_INVALID"

            val createdAt = rule["created_at"]?.toString()?.toLongOrNull()
            val expiresAt = rule["expires_at"]?.toString()?.toLongOrNull()
            val createdSlot = rule["created_slot"]?.toString()?.toBigIntegerOrNull()
            val expiresSlot = rule["expires_slot"]?.toString()?.toBigIntegerOrNull()
            if (createdAt == null || expiresAt == null || createdAt < 0 || expiresAt <= createdAt ||
                createdSlot == null || expiresSlot == null || expiresSlot <= createdSlot ||
                createdSlot > BigInteger(contextSlot.toString()) || (blockTime != null && createdAt > blockTime)
            ) blockers += "CONDITION_RULE_INVALID"

            val bounds = state["active_bounds"] as? Map<*, *>
            if (bounds == null) {
                blockers += "CONDITION_BOUNDS_MISSING"
            } else {
                val maximumAge = bounds.u64("maximum_observation_age_seconds")
                val minimumSeconds = bounds.u64("minimum_observation_separation_seconds")
                val minimumSlots = bounds.u64("minimum_observation_separation_slots")
                val maximumLifeSeconds = bounds.u64("maximum_rule_lifetime_seconds")
                val maximumLifeSlots = bounds.u64("maximum_rule_lifetime_slots")
                val maximumHysteresis = bounds.number("maximum_hysteresis_bps")
                val policyMaxAge = policy?.get("maximum_age_seconds")?.toString()?.toBigIntegerOrNull()
                val lifeSeconds = if (createdAt != null && expiresAt != null && expiresAt >= createdAt) {
                    BigInteger.valueOf(expiresAt - createdAt)
                } else null
                val lifeSlots = if (createdSlot != null && expiresSlot != null && expiresSlot >= createdSlot) expiresSlot - createdSlot else null
                if (maximumAge == null || minimumSeconds == null || minimumSlots == null || maximumLifeSeconds == null ||
                    maximumLifeSlots == null || maximumHysteresis == null || policyMaxAge == null ||
                    maximumAge <= BigInteger.ZERO || maximumAge > policyMaxAge ||
                    minimumSeconds <= BigInteger.ZERO || minimumSlots <= BigInteger.ZERO ||
                    maximumLifeSeconds <= BigInteger.ZERO || maximumLifeSlots <= BigInteger.ZERO ||
                    maximumHysteresis !in 1 until BPS_DENOMINATOR ||
                    lifeSeconds == null || lifeSeconds > maximumLifeSeconds || lifeSlots == null || lifeSlots > maximumLifeSlots
                ) blockers += "CONDITION_BOUNDS_INVALID"
            }

            val predicate = rule["predicate"] as? AnchorIdlAccountDecoder.EnumValue
            val predicateFields = predicate?.fields.orEmpty()
            val assetIndex = predicateFields["asset_index"]?.let { (it as? Number)?.toInt() }
            if (predicate == null || predicate.variant !in setOf("Schedule", "PriceCross") || assetIndex == null || assetIndex !in 0 until ASSET_COUNT) {
                blockers += "CONDITION_PREDICATE_INVALID"
            } else if (predicate.variant == "PriceCross") {
                val threshold = predicateFields["threshold_q18"]?.toString()?.toBigIntegerOrNull()
                val hysteresis = (predicateFields["hysteresis_bps"] as? Number)?.toInt()
                val maximumHysteresis = (state["active_bounds"] as? Map<*, *>)?.number("maximum_hysteresis_bps")
                if (threshold == null || threshold <= BigInteger.ZERO || hysteresis == null || hysteresis <= 0 ||
                    hysteresis >= BPS_DENOMINATOR || maximumHysteresis == null || hysteresis > maximumHysteresis
                ) blockers += "CONDITION_PREDICATE_INVALID"
            } else if (predicate.variant == "Schedule") {
                val notBeforeAt = predicateFields["not_before_unix_timestamp"]?.toString()?.toLongOrNull()
                val notBeforeSlot = predicateFields["not_before_slot"]?.toString()?.toBigIntegerOrNull()
                val maxDelayAt = (state["active_bounds"] as? Map<*, *>)?.u64("maximum_schedule_delay_seconds")
                val maxDelaySlot = (state["active_bounds"] as? Map<*, *>)?.u64("maximum_schedule_delay_slots")
                val delayAt = if (notBeforeAt != null && createdAt != null && notBeforeAt >= createdAt) {
                    BigInteger.valueOf(notBeforeAt - createdAt)
                } else null
                val delaySlot = if (notBeforeSlot != null && createdSlot != null && notBeforeSlot >= createdSlot) notBeforeSlot - createdSlot else null
                if (notBeforeAt == null || notBeforeSlot == null || createdAt == null || expiresAt == null ||
                    createdSlot == null || expiresSlot == null || notBeforeAt < createdAt || notBeforeAt >= expiresAt ||
                    notBeforeSlot < createdSlot || notBeforeSlot >= expiresSlot || maxDelayAt == null || maxDelaySlot == null ||
                    delayAt == null || delayAt > maxDelayAt || delaySlot == null || delaySlot > maxDelaySlot
                ) blockers += "CONDITION_PREDICATE_INVALID"
            }

            if (expiresAt == null || expiresSlot == null || blockTime == null) blockers += "CONDITION_RULE_EXPIRY_UNKNOWN"
            else if (blockTime >= expiresAt || BigInteger(contextSlot.toString()) >= expiresSlot) blockers += "CONDITION_RULE_EXPIRED"
            if (rule["enabled"] != true) blockers += "CONDITION_RULE_DISABLED"
        }
        if (state["pending"] != null) blockers += "CONDITION_RULE_PENDING"
    }

    private fun validateIntent(
        presence: AccountPresence<Map<String, Any?>>,
        policyPresence: AccountPresence<Map<String, Any?>>,
        vault: Map<String, Any?>,
        vaultAddress: String,
        contextSlot: ULong,
        blockers: MutableList<String>,
    ) {
        val intent = presence.presentValue() ?: return
        if (intent.intValue("version") != REBALANCE_INTENT_VERSION || intent.text("vault") != vaultAddress) {
            throw ChainReadException("INTENT_LINK_MISMATCH", "Rebalance intent version or vault link is invalid")
        }
        val policy = policyPresence.presentValue()
        val initialSell = BigInteger(intent.text("initial_sell_amount"))
        val remainingSell = BigInteger(intent.text("remaining_sell_amount"))
        val startSlot = BigInteger(intent.text("start_slot"))
        val endSlot = BigInteger(intent.text("end_slot"))
        if (intent.text("sequence") != vault.text("sequence") ||
            intent.text("target_revision") != vault.text("configuration_revision") ||
            policy == null || intent.text("policy_revision") != policy.text("configuration_revision") ||
            intent.intValue("sell_asset") !in 0 until ASSET_COUNT ||
            initialSell <= BigInteger.ZERO || remainingSell > initialSell || endSlot <= startSlot
        ) {
            blockers += "INTENT_STALE_OR_INVALID"
        } else {
            val currentSlot = BigInteger(contextSlot.toString())
            if (remainingSell == BigInteger.ZERO) blockers += "INTENT_COMPLETE_AWAITING_FINALIZATION"
            if (currentSlot > endSlot) blockers += "INTENT_EXPIRED_AWAITING_FINALIZATION"
            if (currentSlot < startSlot) blockers += "INTENT_START_SLOT_IN_FUTURE"
        }
    }

    private fun oracleRead(
        accounts: Map<String, RpcAccountInfo?>,
        address: String,
        feedId: String,
        blockTime: Long?,
        policy: Map<String, Any?>?,
        isUsdc: Boolean,
    ): OracleRead {
        val account = required(accounts[address], "ORACLE_MISSING", "Pinned Pyth account $address is missing")
        if (account.executable) throw ChainReadException("ORACLE_IS_EXECUTABLE", "Pinned oracle account is unexpectedly executable")
        val update = try {
            PythPriceUpdateV2Decoder.decode(account.data, account.owner, feedId)
        } catch (error: IllegalArgumentException) {
            throw ChainReadException("INVALID_ORACLE", "Pinned Pyth account failed owner, feed, or layout checks", error)
        }
        val blockers = mutableListOf<String>()
        if (update.verificationLevel !is PythPriceUpdateV2Decoder.VerificationLevel.Full) blockers += "ORACLE_NOT_FULLY_VERIFIED"
        val priceInteger = BigInteger(update.price)
        if (priceInteger <= BigInteger.ZERO) blockers += "ORACLE_NONPOSITIVE_PRICE"
        val priceQ18 = fixed18(priceInteger, update.exponent)
        val confidenceQ18 = fixed18(BigInteger(update.confidence), update.exponent)
        if (priceQ18 == null || confidenceQ18 == null) blockers += "ORACLE_UNSUPPORTED_PRECISION"
        if (priceQ18 != null && priceQ18 > U128_MAX || confidenceQ18 != null && confidenceQ18 > U128_MAX) {
            blockers += "ORACLE_ARITHMETIC_OVERFLOW"
        }
        val age = blockTime?.let { now -> (BigInteger.valueOf(now) - BigInteger(update.publishTime)).let { if (it.bitLength() < 63) it.toLong() else null } }
        if (age == null) blockers += "ORACLE_AGE_UNKNOWN"
        else if (age < 0) blockers += "ORACLE_PUBLISH_TIME_IN_FUTURE"
        val confidenceNumerator = BigInteger(update.confidence) * BigInteger.valueOf(BPS_DENOMINATOR.toLong())
        val confidenceBps = if (priceInteger > BigInteger.ZERO) {
            ((confidenceNumerator + priceInteger - BigInteger.ONE) / priceInteger).toString()
        } else null
        val maxAge = policy?.get("maximum_age_seconds")?.toString()?.toBigIntegerOrNull()
        val maxConfidence = policy?.get("maximum_confidence_bps")?.toString()?.toBigIntegerOrNull()
        val maxDeviation = policy?.get("maximum_usdc_deviation_bps")?.toString()?.toBigIntegerOrNull()
        if (policy == null) blockers += "ORACLE_POLICY_UNAVAILABLE"
        if (age != null && maxAge != null && BigInteger.valueOf(age) > maxAge) blockers += "ORACLE_STALE"
        if (confidenceBps != null && maxConfidence != null && BigInteger(confidenceBps) > maxConfidence) blockers += "ORACLE_CONFIDENCE_TOO_WIDE"
        val deviationBps = if (isUsdc && priceInteger > BigInteger.ZERO && priceQ18 != null && priceQ18 <= U128_MAX) {
            run {
                val fixedPrice = priceQ18
                val oneUsd = BigInteger.TEN.pow(USD_FIXED_DECIMALS)
                val numerator = (fixedPrice - oneUsd).abs() * BigInteger.valueOf(BPS_DENOMINATOR.toLong())
                ((numerator + oneUsd - BigInteger.ONE) / oneUsd).toString()
            }
        } else null
        if (isUsdc && deviationBps != null && maxDeviation != null && BigInteger(deviationBps) > maxDeviation) blockers += "USDC_DEPEG_OUTSIDE_POLICY"
        return OracleRead(
            address = address,
            feedIdHex = update.feedIdHex,
            verificationLevel = update.verificationLevel,
            price = update.price,
            confidence = update.confidence,
            exponent = update.exponent,
            priceQ18 = priceQ18?.toString(),
            confidenceQ18 = confidenceQ18?.toString(),
            publishTime = update.publishTime,
            postedSlot = update.postedSlot,
            ageSeconds = age,
            confidenceBps = confidenceBps,
            usdDeviationBps = deviationBps,
            blockers = blockers,
        )
    }

    private fun fixed18(mantissa: BigInteger, exponent: Int): BigInteger? {
        val shift = exponent.toLong() + USD_FIXED_DECIMALS
        if (shift !in -38L..38L) return null
        val factor = BigInteger.TEN.pow(kotlin.math.abs(shift).toInt())
        if (shift >= 0) return mantissa * factor
        val division = mantissa.divideAndRemainder(factor)
        return division[0].takeIf { division[1] == BigInteger.ZERO }
    }

    private fun decodeProgramDeployment(program: RpcAccountInfo, programData: RpcAccountInfo): ProgramDeploymentRead {
        if (program.owner != ColoyondAddresses.UPGRADEABLE_LOADER_ID || !program.executable || program.data.size != 36) {
            throw ChainReadException("INVALID_PROGRAM_ACCOUNT", "Program account is not the expected executable upgradeable-loader account")
        }
        if (program.data.u32(0) != LOADER_PROGRAM_TAG) throw ChainReadException("INVALID_PROGRAM_ACCOUNT", "Program account has an invalid loader state tag")
        val linkedProgramData = Base58.encodeToString(program.data.copyOfRange(4, 36))
        if (linkedProgramData != ColoyondAddresses.programData()) throw ChainReadException("PROGRAM_DATA_LINK_MISMATCH", "Executable program links to a different ProgramData address")
        if (programData.owner != ColoyondAddresses.UPGRADEABLE_LOADER_ID || programData.executable || programData.data.size < 13) {
            throw ChainReadException("INVALID_PROGRAM_DATA", "ProgramData account has an invalid owner, executable flag, or length")
        }
        if (programData.data.u32(0) != LOADER_PROGRAM_DATA_TAG) throw ChainReadException("INVALID_PROGRAM_DATA", "ProgramData account has an invalid loader state tag")
        val slot = programData.data.u64Decimal(4)
        val option = programData.data[12].toUByte().toInt()
        val authority: String?
        val codeOffset: Int
        when (option) {
            0 -> { authority = null; codeOffset = 13 }
            1 -> {
                if (programData.data.size < 45) throw ChainReadException("INVALID_PROGRAM_DATA", "ProgramData upgrade authority is truncated")
                authority = Base58.encodeToString(programData.data.copyOfRange(13, 45))
                codeOffset = 45
            }
            else -> throw ChainReadException("INVALID_PROGRAM_DATA", "ProgramData has an invalid upgrade-authority option tag")
        }
        if (programData.data.size <= codeOffset) throw ChainReadException("INVALID_PROGRAM_DATA", "ProgramData has no deployed program bytes")
        return ProgramDeploymentRead(slot, authority)
    }

    private fun decodeMint(account: RpcAccountInfo): ClassicMintAccount = try {
        ClassicSplDecoder.decodeMint(account.data, account.owner)
    } catch (error: IllegalArgumentException) {
        throw ChainReadException("INVALID_SPL_MINT", "Mint account failed classic SPL Token validation", error)
    }

    private fun decodeToken(account: RpcAccountInfo, expectedMint: String, expectedAuthority: String): ClassicTokenAccount = try {
        ClassicSplDecoder.decodeTokenAccount(account.data, account.owner, expectedMint, expectedAuthority)
    } catch (error: IllegalArgumentException) {
        throw ChainReadException("INVALID_SPL_TOKEN_ACCOUNT", "Token account failed classic SPL Token validation", error)
    }

    private fun decodeWalletToken(account: RpcAccountInfo?, mint: String, wallet: String): AccountPresence<ClassicTokenAccount> =
        if (account == null) AccountPresence.Absent else AccountPresence.Present(decodeToken(account, mint, wallet))

    private fun sameAccount(first: RpcAccountInfo, second: RpcAccountInfo): Boolean =
        first.owner == second.owner && first.lamports == second.lamports && first.executable == second.executable && first.data.contentEquals(second.data)

    private fun <T : Any> required(value: T?, code: String, message: String): T =
        value ?: throw ChainReadException(code, message)

    private data class AssetConfig(val mint: String, val tokenProgram: String, val custody: String, val decimals: Int, val targetBps: Int)

    private fun Map<String, Any?>.assetConfigurations(): List<AssetConfig> = listValue("assets").map { item ->
        val asset = item as? Map<*, *> ?: throw ChainReadException("INVALID_VAULT_ASSETS", "Vault asset configuration is malformed")
        AssetConfig(
            mint = asset.text("mint"), tokenProgram = asset.text("token_program"), custody = asset.text("custody"),
            decimals = asset.intValue("decimals"), targetBps = asset.intValue("target_bps"),
        )
    }

    private fun Map<*, *>.text(key: String): String = this[key] as? String
        ?: throw ChainReadException("INVALID_IDL_VALUE", "Decoded on-chain field $key is not text")
    @Suppress("UNCHECKED_CAST")
    private fun AccountPresence<Map<String, Any?>>.presentValue(): Map<String, Any?>? =
        (this as? AccountPresence.Present<*>)?.value as? Map<String, Any?>
    private fun Map<*, *>.u64(key: String): BigInteger? = this[key]?.toString()?.toBigIntegerOrNull()
    private fun Map<*, *>.number(key: String): Int? = (this[key] as? Number)?.toInt()
    private fun Map<String, Any?>.intValue(key: String): Int = (this[key] as? Number)?.toInt()
        ?: throw ChainReadException("INVALID_IDL_VALUE", "Decoded on-chain field $key is not an integer")
    private fun Map<String, Any?>.booleanValue(key: String): Boolean = this[key] as? Boolean
        ?: throw ChainReadException("INVALID_IDL_VALUE", "Decoded on-chain field $key is not a boolean")
    private fun Map<String, Any?>.listValue(key: String): List<Any?> = this[key] as? List<Any?>
        ?: throw ChainReadException("INVALID_IDL_VALUE", "Decoded on-chain field $key is not a list")
    private fun Map<String, Any?>.stringArray(key: String): List<String> = listValue(key).map { it as? String
        ?: throw ChainReadException("INVALID_IDL_VALUE", "Decoded on-chain field $key contains a non-text value") }
    private fun Map<String, Any?>.intArray(key: String): List<Int> = listValue(key).map { (it as? Number)?.toInt()
        ?: throw ChainReadException("INVALID_IDL_VALUE", "Decoded on-chain field $key contains a non-integer value") }
    private fun Map<String, Any?>.longArray(key: String): List<String> = listValue(key).map { it as? String
        ?: throw ChainReadException("INVALID_IDL_VALUE", "Decoded on-chain field $key contains a non-string integer") }

    private fun ByteArray.u32(offset: Int): Int = (this[offset].toInt() and 0xff) or
        ((this[offset + 1].toInt() and 0xff) shl 8) or ((this[offset + 2].toInt() and 0xff) shl 16) or
        ((this[offset + 3].toInt() and 0xff) shl 24)

    private fun ByteArray.u64Decimal(offset: Int): String =
        BigInteger(1, copyOfRange(offset, offset + 8).reversedArray()).toString()

    private companion object {
        const val ASSET_COUNT = 2
        const val BPS_DENOMINATOR = 10_000
        const val VAULT_VERSION = 1
        const val GOVERNANCE_VERSION = 1
        const val AUCTION_POLICY_VERSION = 2
        const val CONDITION_STATE_VERSION = 1
        const val REBALANCE_INTENT_VERSION = 2
        const val VAULT_STATUS_ACTIVE = 1
        const val SHARE_MINT_DECIMALS = 6
        // Canonical bumps derived from the pinned program ID and exact Rust seed tuples.
        const val VAULT_BUMP = 254
        const val PENDING_POLICY_BUMP = 254
        const val CONDITION_STATE_BUMP = 255
        const val USD_FIXED_DECIMALS = 18
        val U64_MAX: BigInteger = BigInteger.ONE.shiftLeft(64).subtract(BigInteger.ONE)
        val U128_MAX: BigInteger = BigInteger.ONE.shiftLeft(128).subtract(BigInteger.ONE)
        const val LOADER_PROGRAM_TAG = 2
        const val LOADER_PROGRAM_DATA_TAG = 3
        const val SOL_USD_FEED_ID = "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d"
        const val USDC_USD_FEED_ID = "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a"
    }
}
