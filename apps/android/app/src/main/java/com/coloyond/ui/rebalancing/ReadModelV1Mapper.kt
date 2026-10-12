package com.coloyond.ui.rebalancing

import com.coloyond.protocols.coloyond.transactions.ColoyondAddresses
import com.coloyond.protocols.coloyond.transactions.SolanaCluster
import com.coloyond.protocols.coloyond.transactions.SolanaNetwork
import com.coloyond.protocols.coloyond.transactions.reader.AccountPresence
import com.coloyond.protocols.coloyond.transactions.reader.ColoyondChainSnapshot
import com.coloyond.protocols.coloyond.transactions.reader.OracleRead
import com.coloyond.protocols.coloyond.transactions.reader.PythPriceUpdateV2Decoder
import java.math.BigDecimal
import java.math.BigInteger
import java.math.RoundingMode
import java.net.URI
import java.time.Instant

/** Maps only fields read from the pinned v0.3.0 account set; unavailable facts stay unknown. */
object ReadModelV1Mapper {
    fun from(snapshot: ColoyondChainSnapshot, network: SolanaNetwork, walletAddress: String? = null): ReadModelV1 {
        val vault = snapshot.vault
        val assets = snapshot.assets
        val governance = (snapshot.governance as? AccountPresence.Present<*>)?.value as? Map<String, Any?>
        val intent = (snapshot.rebalanceIntent as? AccountPresence.Present<*>)?.value as? Map<String, Any?>
        val status = vault.number("status")
        val riskPaused = governance?.get("risk_paused") as? Boolean == true
        val phase = when {
            riskPaused || status == 2 -> ReadModelV1.Phase.PAUSED
            snapshot.riskBlockers.any {
                it == "INTENT_COMPLETE_AWAITING_FINALIZATION" || it == "INTENT_EXPIRED_AWAITING_FINALIZATION"
            } -> ReadModelV1.Phase.FINALIZATION_REQUIRED
            snapshot.riskBlockers.any { it == "INTENT_STALE_OR_INVALID" } -> ReadModelV1.Phase.UNKNOWN
            status == 1 && intent != null -> ReadModelV1.Phase.AUCTION
            status == 1 -> ReadModelV1.Phase.ACTIVE
            status == 0 -> ReadModelV1.Phase.UNAVAILABLE
            else -> ReadModelV1.Phase.UNKNOWN
        }
        val actualValues = actualValueWeights(assets, snapshot.oracles)
        val nav = totalValueUsd(assets, snapshot.oracles)
        val wallet = walletAddress?.let { address ->
            val balances = assets.mapIndexed { index, asset ->
                walletBalance(snapshot, address, asset.mint, displaySymbol(asset.mint, index), asset.decimals)
            } + walletBalance(
                snapshot,
                address,
                vault.string("share_mint").orEmpty(),
                "Shares",
                snapshot.shareMint.decimals,
            )
            ReadModelV1.Wallet(address = address, balances = balances)
        }
        val reserve = assets.associate { it.mint to it.custodyReconciliation.bootstrapReserve }
        val liabilities = assets.associate { it.mint to it.custodyReconciliation.bountyLiability }
        val auction = intent?.let {
            ReadModelV1.Auction(
                sequence = it.value("sequence"),
                remaining = it.value("remaining_sell_amount"),
                endSlot = it.value("end_slot"),
                feeBps = it.number("fee_bps"),
            )
        }
        val observedAt = snapshot.blockTime?.let { runCatching { Instant.ofEpochSecond(it).toString() }.getOrNull() }
        val provider = runCatching { URI(snapshot.endpoint).host }.getOrNull()

        return ReadModelV1(
            schema = ReadModelV1.SCHEMA,
            network = ReadModelV1.Network(
                cluster = when (network.cluster) {
                    SolanaCluster.DEVNET -> ReadModelV1.Cluster.DEVNET
                    SolanaCluster.LOCALNET -> ReadModelV1.Cluster.LOCALNET
                },
                genesisHash = snapshot.genesisHash,
            ),
            source = ReadModelV1.Source(
                kind = ReadModelV1.SourceKind.RPC,
                providerLabel = provider,
                observedAt = observedAt,
                slot = snapshot.contextSlot.toString(),
            ),
            program = ReadModelV1.Program(
                programId = ColoyondAddresses.PROGRAM_ID,
                binaryHash = null,
                verified = false,
            ),
            vault = ReadModelV1.Vault(
                address = ColoyondAddresses.vault(),
                shareMint = vault.string("share_mint"),
                configRevision = vault.value("configuration_revision"),
                phase = phase,
                target = assets.mapIndexed { index, asset ->
                    ReadModelV1.Weight(
                        mint = asset.mint,
                        symbol = displaySymbol(asset.mint, index),
                        weightBps = asset.targetBps,
                    )
                },
                actual = actualValues,
                totalSupply = snapshot.shareMint.supply,
                estimatedNavUsd = nav?.setScale(2, RoundingMode.HALF_UP)?.toPlainString(),
                exit = ReadModelV1.Exit(
                    available = status == 1 || status == 2,
                    mode = ReadModelV1.ExitMode.IN_KIND,
                ),
            ),
            wallet = wallet,
            oracle = snapshot.oracles.map(::toOracle),
            riskBlockers = snapshot.riskBlockers,
            auction = auction,
            reserve = ReadModelV1.Reserve(
                amountByMint = reserve,
                bountyLiabilityByMint = liabilities,
            ),
            // The account batch has no confirmed signature for the last transition.
            lastConfirmedTransition = null,
        )
    }

    private fun toOracle(value: OracleRead): ReadModelV1.OracleFeed {
        val blockers = value.blockers
        val state = when {
            blockers.any { it == "ORACLE_STALE" || it == "ORACLE_PUBLISH_TIME_IN_FUTURE" || it == "ORACLE_AGE_UNKNOWN" } ->
                ReadModelV1.OracleState.STALE
            blockers.any { it == "USDC_DEPEG_OUTSIDE_POLICY" } -> ReadModelV1.OracleState.DEPEGGED
            blockers.isEmpty() -> ReadModelV1.OracleState.FRESH
            else -> ReadModelV1.OracleState.UNKNOWN
        }
        val verification = when (value.verificationLevel) {
            is com.coloyond.protocols.coloyond.transactions.reader.PythPriceUpdateV2Decoder.VerificationLevel.Full ->
                ReadModelV1.OracleVerification.FULL
            is com.coloyond.protocols.coloyond.transactions.reader.PythPriceUpdateV2Decoder.VerificationLevel.Partial ->
                ReadModelV1.OracleVerification.PARTIAL
            else -> ReadModelV1.OracleVerification.UNKNOWN
        }
        return ReadModelV1.OracleFeed(
            feedId = value.feedIdHex,
            publishTime = value.publishTime,
            ageSeconds = value.ageSeconds,
            verification = verification,
            confidenceBps = value.confidenceBps?.toIntOrNull(),
            state = state,
        )
    }

    private fun actualValueWeights(
        assets: List<com.coloyond.protocols.coloyond.transactions.reader.VaultAssetRead>,
        oracles: List<OracleRead>,
    ): List<ReadModelV1.Weight>? {
        val values = assets.map { asset ->
            val feedAddress = when (asset.mint) {
                ColoyondAddresses.WSOL_MINT -> ColoyondAddresses.SOL_USD_FEED
                ColoyondAddresses.DEVNET_USDC_MINT -> ColoyondAddresses.USDC_USD_FEED
                else -> return null
            }
            val priceQ18 = valuationPriceQ18(feedAddress, oracles) ?: return null
            val amount = BigInteger(asset.custodyState.amount)
            val price = BigDecimal(priceQ18).movePointLeft(18)
            BigDecimal(amount).multiply(price).movePointLeft(asset.decimals)
        }
        val total = values.fold(BigDecimal.ZERO, BigDecimal::add)
        if (total <= BigDecimal.ZERO) return null
        var assignedBps = 0
        return assets.mapIndexed { index, asset ->
            val bps = if (index == assets.lastIndex) {
                10_000 - assignedBps
            } else {
                values[index].multiply(BigDecimal(10_000)).divide(total, 0, RoundingMode.DOWN).intValueExact()
                    .also { assignedBps += it }
            }
            ReadModelV1.Weight(asset.mint, displaySymbol(asset.mint, index), bps)
        }
    }

    private fun totalValueUsd(
        assets: List<com.coloyond.protocols.coloyond.transactions.reader.VaultAssetRead>,
        oracles: List<OracleRead>,
    ): BigDecimal? {
        if (assets.isEmpty()) return null
        val values = assets.map { asset ->
            val address = when (asset.mint) {
                ColoyondAddresses.WSOL_MINT -> ColoyondAddresses.SOL_USD_FEED
                ColoyondAddresses.DEVNET_USDC_MINT -> ColoyondAddresses.USDC_USD_FEED
                else -> return null
            }
            val priceQ18 = valuationPriceQ18(address, oracles) ?: return null
            BigDecimal(BigInteger(asset.custodyState.amount))
                .multiply(BigDecimal(priceQ18).movePointLeft(18))
                .movePointLeft(asset.decimals)
        }
        return values.fold(BigDecimal.ZERO, BigDecimal::add)
    }

    private fun valuationPriceQ18(address: String, oracles: List<OracleRead>): BigInteger? {
        val oracle = oracles.firstOrNull { it.address == address } ?: return null
        if (
            oracle.blockers.isNotEmpty() ||
            oracle.verificationLevel !is PythPriceUpdateV2Decoder.VerificationLevel.Full
        ) return null
        return oracle.priceQ18?.toBigIntegerOrNull()
    }

    private fun walletBalance(
        snapshot: ColoyondChainSnapshot,
        walletAddress: String,
        mint: String,
        symbol: String,
        decimals: Int,
    ): ReadModelV1.WalletBalance {
        val tokenAccount = ColoyondAddresses.associatedToken(walletAddress, mint)
        return when (val presence = snapshot.walletTokenAccounts[tokenAccount]) {
            is AccountPresence.Present -> ReadModelV1.WalletBalance(
                mint = mint,
                symbol = symbol,
                decimals = decimals,
                amountBaseUnits = presence.value.amount,
                tokenAccount = tokenAccount,
                accountExists = true,
            )
            AccountPresence.Absent -> ReadModelV1.WalletBalance(
                mint = mint,
                symbol = symbol,
                decimals = decimals,
                amountBaseUnits = "0",
                tokenAccount = tokenAccount,
                accountExists = false,
            )
            null -> ReadModelV1.WalletBalance(
                mint = mint,
                symbol = symbol,
                decimals = decimals,
                amountBaseUnits = null,
                tokenAccount = tokenAccount,
                accountExists = null,
            )
        }
    }

    private fun displaySymbol(mint: String, index: Int): String = when (mint) {
        ColoyondAddresses.WSOL_MINT -> "SOL"
        ColoyondAddresses.DEVNET_USDC_MINT -> "USDC"
        else -> "Asset ${index + 1}"
    }

    private fun Map<String, Any?>.number(name: String): Int? = (this[name] as? Number)?.toInt()
    private fun Map<String, Any?>.string(name: String): String? = (this[name] as? String)
    private fun Map<*, *>.value(name: String): String? = this[name]?.toString()
}
