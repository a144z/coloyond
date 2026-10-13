package com.coloyond.protocols.coloyond.transactions

import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class ColoyondTransactionBuilderTest {
    @Test
    fun initializeSeedEncodesV030ArgsAndExactIdlAccountMetas() {
        val plan = ColoyondTransactionBuilder.initializeAndSeed(initializeRequest())

        assertEquals(
            "30bfa32c47813fa407000000000000007c15941100e1f5050000000080f0fa02000000000a0000000000000014000000000000006400000000000000030303030303030303030303030303030303030303030303030303030303030304040404040404040404040404040404040404040404040404040404040404044000000000000000400000000000000064006400",
            plan.instructionData.toHex(),
        )
        assertEquals(
            listOf(
                "vault", "governance", "share_mint", "seeder", "bootstrap_authority",
                "governance_authority", "emergency_authority", "program", "program_data",
                "seeder_shares", "seeder_asset_a", "seeder_asset_b", "custody_a", "custody_b",
                "mint_a", "mint_b", "sol_usd", "usdc_usd", "token_program", "system_program",
            ),
            plan.accountMetas.map { it.name },
        )
        assertEquals(
            listOf(
                meta("vault", "DVZ7tQAgko19RNUXKcMU1RXtcqff2kT415C6JA49NMMQ", writable = true),
                meta("governance", "HVXEcSutFXZQoJSbefeRHWwdwas7HBMWMvZYvzctddiF", writable = true),
                meta("share_mint", SHARE_MINT, writable = true),
                meta("seeder", SEEDER, signer = true, writable = true),
                meta("bootstrap_authority", BOOTSTRAP, signer = true),
                meta("governance_authority", GOVERNANCE_AUTHORITY, signer = true),
                meta("emergency_authority", EMERGENCY_AUTHORITY, signer = true),
                meta("program", ColoyondAddresses.PROGRAM_ID),
                meta("program_data", ColoyondAddresses.programData()),
                meta("seeder_shares", ColoyondAddresses.associatedToken(SEEDER, SHARE_MINT), writable = true),
                meta("seeder_asset_a", ColoyondAddresses.associatedToken(SEEDER, ColoyondAddresses.WSOL_MINT), writable = true),
                meta("seeder_asset_b", ColoyondAddresses.associatedToken(SEEDER, ColoyondAddresses.DEVNET_USDC_MINT), writable = true),
                meta("custody_a", CUSTODY_A, writable = true),
                meta("custody_b", CUSTODY_B, writable = true),
                meta("mint_a", ColoyondAddresses.WSOL_MINT),
                meta("mint_b", ColoyondAddresses.DEVNET_USDC_MINT),
                meta("sol_usd", ColoyondAddresses.SOL_USD_FEED),
                meta("usdc_usd", ColoyondAddresses.USDC_USD_FEED),
                meta("token_program", ColoyondAddresses.TOKEN_PROGRAM_ID),
                meta("system_program", ColoyondAddresses.SYSTEM_PROGRAM_ID),
            ),
            plan.accountMetas,
        )
        assertEquals(setOf("seeder", "bootstrap_authority", "governance_authority", "emergency_authority"), plan.accountMetas.filter { it.isSigner }.map { it.name }.toSet())
        assertEquals(setOf("vault", "governance", "share_mint", "seeder", "seeder_shares", "seeder_asset_a", "seeder_asset_b", "custody_a", "custody_b"), plan.accountMetas.filter { it.isWritable }.map { it.name }.toSet())
        assertEquals(ColoyondAddresses.vault(), plan.accountMetas.first().address)
        assertEquals(SEEDER, plan.feePayer)
        assertEquals(0uL, plan.protocolFeeLamports)
        assertEquals("seeder", plan.accountMetas[3].name)
        assertEquals(SEEDER, plan.accountMetas[3].address)
        assertTrue(plan.accountMetas[3].isSigner)
        assertTrue(plan.accountMetas[3].isWritable)
        assertFalse(plan.accountMetas[4].isWritable)
    }

    @Test
    fun proportionalDepositEncodesBoundsAndExactIdlAccountMetas() {
        val plan = ColoyondTransactionBuilder.depositProportional(
            binding(), activeVaultSnapshot(), DEPOSITOR, balances(),
            maxAmounts = AssetAmounts(5_000uL, 6_000uL),
            minSharesOut = 7_000uL,
        )

        assertEquals("3f39802ea4ee8f8588130000000000007017000000000000581b000000000000", plan.instructionData.toHex())
        assertEquals(
            listOf("vault", "governance", "share_mint", "user_shares", "depositor", "custody_a", "custody_b", "user_asset_a", "user_asset_b", "mint_a", "mint_b", "token_program"),
            plan.accountMetas.map { it.name },
        )
        assertEquals(expectedEntryExitMetas("depositor", DEPOSITOR), plan.accountMetas)
        assertEquals(setOf("depositor"), plan.accountMetas.filter { it.isSigner }.map { it.name }.toSet())
        assertEquals(setOf("vault", "share_mint", "user_shares", "custody_a", "custody_b", "user_asset_a", "user_asset_b"), plan.accountMetas.filter { it.isWritable }.map { it.name }.toSet())
        assertEquals(DEPOSITOR, plan.feePayer)
        assertEquals(ColoyondAddresses.associatedToken(DEPOSITOR, ColoyondAddresses.WSOL_MINT), plan.accountMetas[7].address)
        assertEquals(ColoyondAddresses.associatedToken(DEPOSITOR, ColoyondAddresses.DEVNET_USDC_MINT), plan.accountMetas[8].address)
    }

    @Test
    fun inKindRedemptionEncodesBoundsAndExactIdlAccountMetas() {
        val plan = ColoyondTransactionBuilder.redeemInKind(
            binding(), pausedVaultSnapshot(), HOLDER, balances(HOLDER),
            sharesToBurn = 200uL,
            minAmountsOut = AssetAmounts(100uL, 50uL),
        )

        assertEquals("663abdfcc0db8c59c80000000000000064000000000000003200000000000000", plan.instructionData.toHex())
        assertEquals(
            listOf("vault", "governance", "share_mint", "user_shares", "holder", "custody_a", "custody_b", "user_asset_a", "user_asset_b", "mint_a", "mint_b", "token_program"),
            plan.accountMetas.map { it.name },
        )
        assertEquals(expectedEntryExitMetas("holder", HOLDER), plan.accountMetas)
        assertEquals(setOf("holder"), plan.accountMetas.filter { it.isSigner }.map { it.name }.toSet())
        assertEquals(setOf("vault", "share_mint", "user_shares", "custody_a", "custody_b", "user_asset_a", "user_asset_b"), plan.accountMetas.filter { it.isWritable }.map { it.name }.toSet())
        assertEquals(HOLDER, plan.feePayer)
    }

    @Test
    fun derivesKnownVaultAndLifecycleReadRequests() {
        val network = devnet()
        val vault = "DVZ7tQAgko19RNUXKcMU1RXtcqff2kT415C6JA49NMMQ"
        assertEquals(vault, ColoyondAddresses.vault())
        assertEquals("GwaYMa1ep89ZAz4StTkkby2MbduH3udkFUBsN9UrTfnq", ColoyondAddresses.programData())
        assertEquals("CD1N3UBVk1juZRbrVcK9rxRkWQr1o1rbKqeAZSf2HKNs", ColoyondAddresses.associatedToken(SEEDER, SHARE_MINT))
        assertEquals("7i4VVk55NzhtekVjPg7EZzoSGznZYixPyd5cCeDxi7rW", ColoyondAddresses.associatedToken(SEEDER, ColoyondAddresses.WSOL_MINT))
        assertEquals("8n9SVoKx3Jtqdwm5Dx3wR3hVQPMgyNJPfJzXcntq2N7R", ColoyondAddresses.associatedToken(SEEDER, ColoyondAddresses.DEVNET_USDC_MINT))
        assertEquals(vault, ColoyondAddresses.lifecyclePdas(network).vault)
        assertEquals("HVXEcSutFXZQoJSbefeRHWwdwas7HBMWMvZYvzctddiF", ColoyondAddresses.governance(vault))

        val requests = ColoyondAddresses.lifecycleReadRequests(network)
        assertEquals(listOf("vault", "governance", "auction_policy", "pending_policy", "condition_state", "rebalance_intent", "program_data", "sol_usd", "usdc_usd"), requests.map { it.name })
        assertTrue(requests.take(6).all { it.expectedOwner == ColoyondAddresses.PROGRAM_ID && it.mayBeAbsent })
        assertEquals(ColoyondAddresses.UPGRADEABLE_LOADER_ID, requests[6].expectedOwner)
        assertFalse(requests[6].mayBeAbsent)
        assertTrue(requests.drop(7).all { it.expectedOwner == ColoyondAddresses.PYTH_RECEIVER_PROGRAM_ID && !it.mayBeAbsent })
    }

    @Test
    fun rejectsUnknownWrongAndPublicClusterGenesisHashes() {
        assertThrows(IllegalArgumentException::class.java) {
            ColoyondAddresses.validateNetwork(devnet().copy(genesisHash = "unknown-genesis"))
        }
        assertThrows(IllegalArgumentException::class.java) {
            ColoyondAddresses.validateNetwork(devnet().copy(genesisHash = MAINNET_GENESIS_HASH))
        }
        assertThrows(IllegalArgumentException::class.java) {
            ColoyondAddresses.validateNetwork(devnet().copy(rpcUrl = "http://api.devnet.solana.com"))
        }
        assertThrows(IllegalArgumentException::class.java) {
            ColoyondAddresses.validateNetwork(devnet().copy(rpcUrl = "https://"))
        }
        assertThrows(IllegalArgumentException::class.java) {
            ColoyondAddresses.validateNetwork(SolanaNetwork(SolanaCluster.LOCALNET, MAINNET_GENESIS_HASH, "http://127.0.0.1:8899"))
        }
        assertThrows(IllegalArgumentException::class.java) {
            ColoyondAddresses.validateNetwork(SolanaNetwork(SolanaCluster.LOCALNET, "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY", "http://127.0.0.1:8899"))
        }
        assertThrows(IllegalArgumentException::class.java) {
            ColoyondAddresses.validateNetwork(SolanaNetwork(SolanaCluster.LOCALNET, "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG", "http://127.0.0.1:8899"))
        }
        assertThrows(IllegalArgumentException::class.java) {
            ColoyondAddresses.validateNetwork(SolanaNetwork(SolanaCluster.LOCALNET, "local-genesis", "https://api.devnet.solana.com"))
        }
    }

    @Test
    fun rejectsUnsupportedMainnetUsdcEvenWhenClusterIsDevnet() {
        val exception = assertThrows(IllegalArgumentException::class.java) {
            binding().copy(mintB = ColoyondAddresses.MAINNET_USDC_MINT).let { unsupported ->
                ColoyondTransactionBuilder.depositProportional(unsupported, activeVaultSnapshot(), DEPOSITOR, balances(), AssetAmounts(1uL, 1uL), 1uL)
            }
        }
        assertTrue(exception.message.orEmpty().contains("canonical WSOL/USDC"))
    }

    @Test
    fun rejectsWrongProgramVaultRevisionSnapshotAndPausedDeposit() {
        assertThrows(IllegalArgumentException::class.java) {
            ColoyondTransactionBuilder.depositProportional(binding().copy(programId = SYSTEM_PROGRAM), activeVaultSnapshot(), DEPOSITOR, balances(), AssetAmounts(1uL, 1uL), 1uL)
        }
        assertThrows(IllegalArgumentException::class.java) {
            ColoyondTransactionBuilder.depositProportional(binding().copy(vaultAddress = SYSTEM_PROGRAM), activeVaultSnapshot(), DEPOSITOR, balances(), AssetAmounts(1uL, 1uL), 1uL)
        }
        assertThrows(IllegalArgumentException::class.java) {
            ColoyondTransactionBuilder.depositProportional(binding().copy(configurationRevision = 8uL), activeVaultSnapshot(), DEPOSITOR, balances(), AssetAmounts(1uL, 1uL), 1uL)
        }
        assertThrows(IllegalArgumentException::class.java) {
            ColoyondTransactionBuilder.depositProportional(binding(), pausedVaultSnapshot(), DEPOSITOR, balances(), AssetAmounts(1uL, 1uL), 1uL)
        }
    }

    @Test
    fun rejectsInputOutputShareAndWalletBalanceBounds() {
        assertThrows(IllegalArgumentException::class.java) {
            ColoyondTransactionBuilder.depositProportional(binding(), activeVaultSnapshot(), DEPOSITOR, balances(), AssetAmounts(10_001uL, 1uL), 1uL)
        }
        assertThrows(IllegalArgumentException::class.java) {
            ColoyondTransactionBuilder.depositProportional(binding(), activeVaultSnapshot(), DEPOSITOR, balances(), AssetAmounts(1uL, 1uL), 0uL)
        }
        assertThrows(IllegalArgumentException::class.java) {
            ColoyondTransactionBuilder.redeemInKind(binding(), pausedVaultSnapshot(), HOLDER, balances(HOLDER), 9_001uL, AssetAmounts(1uL, 1uL))
        }
        assertThrows(IllegalArgumentException::class.java) {
            ColoyondTransactionBuilder.redeemInKind(binding(), pausedVaultSnapshot(), HOLDER, balances(HOLDER), 0uL, AssetAmounts(0uL, 0uL))
        }
        assertThrows(IllegalArgumentException::class.java) {
            ColoyondTransactionBuilder.depositProportional(binding(), activeVaultSnapshot(), DEPOSITOR, balances().copy(assetA = balances().assetA.copy(initialized = false)), AssetAmounts(1uL, 1uL), 1uL)
        }
        assertThrows(IllegalArgumentException::class.java) {
            ColoyondTransactionBuilder.depositProportional(binding(), activeVaultSnapshot(), DEPOSITOR, balances().copy(assetB = balances().assetB.copy(accountOwnerProgramId = SYSTEM_PROGRAM)), AssetAmounts(1uL, 1uL), 1uL)
        }
    }

    @Test
    fun rejectsInvalidInitializationBounds() {
        val request = initializeRequest()
        assertThrows(IllegalArgumentException::class.java) {
            ColoyondTransactionBuilder.initializeAndSeed(request.copy(targetWeights = TargetWeights(5_000, 4_999)))
        }
        assertThrows(IllegalArgumentException::class.java) {
            ColoyondTransactionBuilder.initializeAndSeed(request.copy(reserveContributions = AssetAmounts(100_000_001uL, 1uL)))
        }
        assertThrows(IllegalArgumentException::class.java) {
            ColoyondTransactionBuilder.initializeAndSeed(request.copy(seedAmounts = AssetAmounts(0uL, 1uL)))
        }
        assertThrows(IllegalArgumentException::class.java) {
            ColoyondTransactionBuilder.initializeAndSeed(request.copy(maximumConfidenceBps = 10_001))
        }
    }

    @Test
    fun requiresExplicitCanonicalWsolTokenAccountWithoutImplicitWrapping() {
        val plan = ColoyondTransactionBuilder.depositProportional(
            binding(), activeVaultSnapshot(), DEPOSITOR, balances(), AssetAmounts(1uL, 1uL), 1uL,
        )

        assertEquals(12, plan.accountMetas.size)
        assertEquals(ColoyondAddresses.WSOL_MINT, plan.accountMetas.first { it.name == "mint_a" }.address)
        assertEquals(ColoyondAddresses.associatedToken(DEPOSITOR, ColoyondAddresses.WSOL_MINT), plan.accountMetas.first { it.name == "user_asset_a" }.address)
        assertFalse(plan.accountMetas.any { it.name.contains("wrap", ignoreCase = true) || it.name.contains("sync", ignoreCase = true) })
    }

    private fun initializeRequest() = InitializeVaultRequest(
        network = devnet(),
        seeder = SEEDER,
        bootstrapAuthority = BOOTSTRAP,
        governanceAuthority = GOVERNANCE_AUTHORITY,
        emergencyAuthority = EMERGENCY_AUTHORITY,
        shareMint = SHARE_MINT,
        custodyA = CUSTODY_A,
        custodyB = CUSTODY_B,
        mintA = ColoyondAddresses.WSOL_MINT,
        mintB = ColoyondAddresses.DEVNET_USDC_MINT,
        configurationRevision = 7uL,
        targetWeights = TargetWeights(5_500, 4_500),
        seedAmounts = AssetAmounts(100_000_000uL, 50_000_000uL),
        reserveContributions = AssetAmounts(10uL, 20uL),
        minimumLockedShares = 100uL,
        minDelaySlots = 64uL,
        maximumAgeSeconds = 64uL,
        maximumConfidenceBps = 100,
        maximumUsdcDeviationBps = 100,
    )

    private fun binding() = VaultBinding(
        network = devnet(),
        programId = ColoyondAddresses.PROGRAM_ID,
        vaultAddress = ColoyondAddresses.vault(),
        configurationRevision = 7uL,
        mintA = ColoyondAddresses.WSOL_MINT,
        mintB = ColoyondAddresses.DEVNET_USDC_MINT,
        shareMint = SHARE_MINT,
        custodyA = CUSTODY_A,
        custodyB = CUSTODY_B,
        targetWeights = TargetWeights(5_500, 4_500),
    )

    private fun balances(owner: String = DEPOSITOR) = WalletTokenBalances(
        assetA = tokenAccount(owner, ColoyondAddresses.WSOL_MINT, 10_000uL),
        assetB = tokenAccount(owner, ColoyondAddresses.DEVNET_USDC_MINT, 20_000uL),
        shares = tokenAccount(owner, SHARE_MINT, 9_000uL),
    )

    private fun tokenAccount(owner: String, mint: String, amount: ULong) = TokenAccountSnapshot(
        address = ColoyondAddresses.associatedToken(owner, mint),
        owner = owner,
        mint = mint,
        amount = amount,
        initialized = true,
        accountOwnerProgramId = ColoyondAddresses.TOKEN_PROGRAM_ID,
    )

    private fun expectedEntryExitMetas(signerName: String, signer: String): List<InstructionAccountMeta> {
        val vault = binding()
        val tokenBalances = balances(signer)
        return listOf(
            meta("vault", vault.vaultAddress, writable = true),
            meta("governance", ColoyondAddresses.governance(vault.vaultAddress)),
            meta("share_mint", vault.shareMint, writable = true),
            meta("user_shares", tokenBalances.shares.address, writable = true),
            meta(signerName, signer, signer = true),
            meta("custody_a", vault.custodyA, writable = true),
            meta("custody_b", vault.custodyB, writable = true),
            meta("user_asset_a", tokenBalances.assetA.address, writable = true),
            meta("user_asset_b", tokenBalances.assetB.address, writable = true),
            meta("mint_a", vault.mintA),
            meta("mint_b", vault.mintB),
            meta("token_program", ColoyondAddresses.TOKEN_PROGRAM_ID),
        )
    }

    private fun meta(name: String, address: String, signer: Boolean = false, writable: Boolean = false) =
        InstructionAccountMeta(name, address, isSigner = signer, isWritable = writable)

    private fun activeVaultSnapshot() = vaultSnapshot(status = 1)

    private fun pausedVaultSnapshot() = vaultSnapshot(status = 2)

    private fun vaultSnapshot(status: Int): VaultAccountSnapshot {
        val bytes = ByteBuffer.allocate(353).order(ByteOrder.LITTLE_ENDIAN).apply {
            put(byteArrayOf(211.toByte(), 8, 232.toByte(), 43, 2, 152.toByte(), 117, 119))
            put(1) // account version
            put(4) // fixture bump
            put(status.toByte())
            put(ColoyondAddresses.key(GOVERNANCE_AUTHORITY).bytes)
            putLong(7L)
            putAsset(ColoyondAddresses.WSOL_MINT, CUSTODY_A, 9, 5_500)
            putAsset(ColoyondAddresses.DEVNET_USDC_MINT, CUSTODY_B, 6, 4_500)
            put(ColoyondAddresses.key(SHARE_MINT).bytes)
            putLong(20_000L) // total shares
            putLong(1L) // minimum locked shares
            putLong(100L); putLong(200L) // accounted amounts
            putLong(10L); putLong(20L) // bootstrap reserve
            putLong(0L); putLong(0L) // bounty liabilities
            putLong(0L) // sequence
        }.array()
        return VaultAccountSnapshot(ColoyondAddresses.vault(), ColoyondAddresses.PROGRAM_ID, bytes)
    }

    private fun ByteBuffer.putAsset(mint: String, custody: String, decimals: Int, targetBps: Int) {
        put(ColoyondAddresses.key(mint).bytes)
        put(ColoyondAddresses.key(ColoyondAddresses.TOKEN_PROGRAM_ID).bytes)
        put(ColoyondAddresses.key(custody).bytes)
        put(decimals.toByte())
        putShort(targetBps.toShort())
    }

    private fun devnet() = SolanaNetwork(
        cluster = SolanaCluster.DEVNET,
        genesisHash = ColoyondAddresses.DEVNET_GENESIS_HASH,
        rpcUrl = "https://api.devnet.solana.com",
    )

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it.toInt() and 0xff) }

    companion object {
        private const val SEEDER = "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi"
        private const val BOOTSTRAP = "8qbHbw2BbbTHBW1sbeqakYXVKRQM8Ne7pLK7m6CVfeR"
        private const val GOVERNANCE_AUTHORITY = "CktRuQ2mttgRGkXJtyksdKHjUdc2C4TgDzyB98oEzy8"
        private const val EMERGENCY_AUTHORITY = "GgBaCs3NCBuZN12kCJgAW63ydqohFkHEdfdEXBPzLHq"
        private const val SHARE_MINT = "LbUiWL3xVV8hTFYBVdbTNrpDo41NKS6o3LHHuDzjfcY"
        private const val CUSTODY_A = "QWmroo4YnnMqYW3cnxWkFdaTxGD3P7vMSzwMHGbUzwF"
        private const val CUSTODY_B = "US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx"
        private const val DEPOSITOR = "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi"
        private const val HOLDER = "8qbHbw2BbbTHBW1sbeqakYXVKRQM8Ne7pLK7m6CVfeR"
        private const val SYSTEM_PROGRAM = "11111111111111111111111111111111"
        private const val MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"
    }
}
