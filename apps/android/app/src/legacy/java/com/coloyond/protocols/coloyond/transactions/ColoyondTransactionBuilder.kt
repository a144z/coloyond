package com.coloyond.protocols.coloyond.transactions

import com.coloyond.protocols.coloyond.VaultAccountDecoder
import com.solana.transaction.AccountMeta
import com.solana.transaction.Message
import com.solana.transaction.Transaction
import com.solana.transaction.TransactionInstruction
import java.io.ByteArrayOutputStream

data class AssetAmounts(val a: ULong, val b: ULong)

data class TargetWeights(val aBps: Int, val bBps: Int)

data class VaultBinding(
    val network: SolanaNetwork,
    val programId: String,
    val vaultAddress: String,
    val configurationRevision: ULong,
    val mintA: String,
    val mintB: String,
    val shareMint: String,
    val custodyA: String,
    val custodyB: String,
    val targetWeights: TargetWeights,
)

data class VaultAccountSnapshot(
    val address: String,
    val ownerProgramId: String,
    val data: ByteArray,
)

data class TokenAccountSnapshot(
    val address: String,
    val owner: String,
    val mint: String,
    val amount: ULong,
    val initialized: Boolean,
    val accountOwnerProgramId: String,
)

data class WalletTokenBalances(
    val assetA: TokenAccountSnapshot,
    val assetB: TokenAccountSnapshot,
    val shares: TokenAccountSnapshot,
)

data class InitializeVaultRequest(
    val network: SolanaNetwork,
    val seeder: String,
    val bootstrapAuthority: String,
    val governanceAuthority: String,
    val emergencyAuthority: String,
    val shareMint: String,
    val custodyA: String,
    val custodyB: String,
    val mintA: String,
    val mintB: String,
    val configurationRevision: ULong,
    val targetWeights: TargetWeights,
    val seedAmounts: AssetAmounts,
    val reserveContributions: AssetAmounts,
    val minimumLockedShares: ULong,
    val minDelaySlots: ULong,
    val maximumAgeSeconds: ULong,
    val maximumConfidenceBps: Int,
    val maximumUsdcDeviationBps: Int,
)

data class InstructionAccountMeta(
    val name: String,
    val address: String,
    val isSigner: Boolean,
    val isWritable: Boolean,
)

/** A deterministic, wallet-independent instruction and fee-payer review plan. */
class ColoyondTransactionPlan internal constructor(
    val network: SolanaNetwork,
    val feePayer: String,
    val configurationRevision: ULong,
    accountMetas: List<InstructionAccountMeta>,
    instructionData: ByteArray,
    val protocolFeeLamports: ULong = 0uL,
) {
    val accountMetas: List<InstructionAccountMeta> = accountMetas.toList()
    private val encodedData = instructionData.copyOf()
    val instructionData: ByteArray get() = encodedData.copyOf()

    val instruction: TransactionInstruction = TransactionInstruction(
        ColoyondAddresses.key(ColoyondAddresses.PROGRAM_ID),
        this.accountMetas.map { meta ->
            AccountMeta(
                ColoyondAddresses.key(meta.address),
                isSigner = meta.isSigner,
                isWritable = meta.isWritable,
            )
        },
        encodedData.copyOf(),
    )

    fun unsignedTransaction(recentBlockhash: String): ByteArray {
        ColoyondAddresses.key(recentBlockhash)
        return Transaction(
            Message.Builder()
                .addInstruction(instruction)
                .setRecentBlockhash(recentBlockhash)
                .build(),
        ).serialize()
    }
}

/**
 * Builds only the Anchor v0.3.0 initialize, proportional deposit and in-kind
 * redemption instructions. The caller must fetch the genesis hash from this exact
 * RPC endpoint, then fetch snapshots and quote inputs at a displayed commitment
 * before asking for a wallet signature. Required mint
 * and token accounts must already exist; WSOL must already be wrapped in its
 * explicit SPL token account. Entry and exit instructions do not accept an
 * expected configuration revision, so callers must recheck the account snapshot
 * immediately before wallet approval.
 */
object ColoyondTransactionBuilder {
    private val initializeDiscriminator = byteArrayOf(48, 191.toByte(), 163.toByte(), 44, 71, 129.toByte(), 63, 164.toByte())
    private val depositDiscriminator = byteArrayOf(63, 57, 128.toByte(), 46, 164.toByte(), 238.toByte(), 143.toByte(), 133.toByte())
    private val redeemDiscriminator = byteArrayOf(102, 58, 189.toByte(), 252.toByte(), 192.toByte(), 219.toByte(), 140.toByte(), 89)

    private val initializeOrder = listOf(
        "vault", "governance", "share_mint", "seeder", "bootstrap_authority",
        "governance_authority", "emergency_authority", "program", "program_data",
        "seeder_shares", "seeder_asset_a", "seeder_asset_b", "custody_a", "custody_b",
        "mint_a", "mint_b", "sol_usd", "usdc_usd", "token_program", "system_program",
    )
    private fun entryExitOrder(signerName: String) = listOf(
        "vault", "governance", "share_mint", "user_shares", signerName, "custody_a",
        "custody_b", "user_asset_a", "user_asset_b", "mint_a", "mint_b", "token_program",
    )

    fun initializeAndSeed(request: InitializeVaultRequest): ColoyondTransactionPlan {
        ColoyondAddresses.validateNetwork(request.network)
        requireSupportedMints(request.network, request.mintA, request.mintB)
        require(request.configurationRevision > 0uL) { "Configuration revision must be positive" }
        requireTargets(request.targetWeights)
        require(request.seedAmounts.a > 0uL && request.seedAmounts.b > 0uL) { "Both seed assets must be positive" }
        require(request.reserveContributions.a <= request.seedAmounts.a && request.reserveContributions.b <= request.seedAmounts.b) {
            "Reserve contribution cannot exceed its seed asset amount"
        }
        require(request.minimumLockedShares > 0uL) { "Minimum locked shares must be positive" }
        require(request.minDelaySlots > 0uL) { "Governance delay must be positive" }
        require(request.maximumAgeSeconds > 0uL) { "Seed oracle age bound must be positive" }
        require(request.maximumConfidenceBps in 0..10_000) { "Confidence bound must be within 0–10,000 bps" }
        require(request.maximumUsdcDeviationBps in 0..10_000) { "USDC deviation bound must be within 0–10,000 bps" }

        val seeder = checkedSigner(request.seeder, "seeder")
        val bootstrapAuthority = checkedSigner(request.bootstrapAuthority, "bootstrap authority")
        val governanceAuthority = checkedSigner(request.governanceAuthority, "governance authority")
        val emergencyAuthority = checkedSigner(request.emergencyAuthority, "emergency authority")
        require(setOf(seeder, bootstrapAuthority, governanceAuthority, emergencyAuthority).size == 4) {
            "Seeder, bootstrap, governance, and emergency roles must use distinct signers"
        }

        val vault = ColoyondAddresses.vault()
        val shareMint = checkedKey(request.shareMint, "share mint")
        val custodyA = checkedKey(request.custodyA, "custody A")
        val custodyB = checkedKey(request.custodyB, "custody B")
        require(custodyA != custodyB) { "Custody accounts must be distinct" }
        val mintA = checkedKey(request.mintA, "mint A")
        val mintB = checkedKey(request.mintB, "mint B")
        val governance = ColoyondAddresses.governance(vault)
        val data = BorshWriter().apply {
            bytes(initializeDiscriminator)
            u64(request.configurationRevision)
            u16(request.targetWeights.aBps)
            u16(request.targetWeights.bBps)
            u64(request.seedAmounts.a)
            u64(request.seedAmounts.b)
            u64(request.reserveContributions.a)
            u64(request.reserveContributions.b)
            u64(request.minimumLockedShares)
            pubkey(request.governanceAuthority)
            pubkey(request.emergencyAuthority)
            u64(request.minDelaySlots)
            u64(request.maximumAgeSeconds)
            u16(request.maximumConfidenceBps)
            u16(request.maximumUsdcDeviationBps)
        }.toByteArray()

        return plan(
            network = request.network,
            feePayer = seeder,
            revision = request.configurationRevision,
            order = initializeOrder,
            signerNames = setOf("seeder", "bootstrap_authority", "governance_authority", "emergency_authority"),
            writableNames = setOf(
                "vault", "governance", "share_mint", "seeder", "seeder_shares", "seeder_asset_a",
                "seeder_asset_b", "custody_a", "custody_b",
            ),
            data = data,
            accounts = listOf(
                meta("vault", vault),
                meta("governance", governance),
                meta("share_mint", shareMint),
                meta("seeder", seeder),
                meta("bootstrap_authority", bootstrapAuthority),
                meta("governance_authority", governanceAuthority),
                meta("emergency_authority", emergencyAuthority),
                meta("program", ColoyondAddresses.PROGRAM_ID),
                meta("program_data", ColoyondAddresses.programData()),
                meta("seeder_shares", ColoyondAddresses.associatedToken(seeder, shareMint)),
                meta("seeder_asset_a", ColoyondAddresses.associatedToken(seeder, mintA)),
                meta("seeder_asset_b", ColoyondAddresses.associatedToken(seeder, mintB)),
                meta("custody_a", custodyA),
                meta("custody_b", custodyB),
                meta("mint_a", mintA),
                meta("mint_b", mintB),
                meta("sol_usd", ColoyondAddresses.SOL_USD_FEED),
                meta("usdc_usd", ColoyondAddresses.USDC_USD_FEED),
                meta("token_program", ColoyondAddresses.TOKEN_PROGRAM_ID),
                meta("system_program", ColoyondAddresses.SYSTEM_PROGRAM_ID),
            ),
        )
    }

    fun depositProportional(
        binding: VaultBinding,
        vaultSnapshot: VaultAccountSnapshot,
        depositor: String,
        balances: WalletTokenBalances,
        maxAmounts: AssetAmounts,
        minSharesOut: ULong,
    ): ColoyondTransactionPlan {
        val vault = validateBinding(binding, vaultSnapshot, requireActive = true)
        require(maxAmounts.a > 0uL && maxAmounts.b > 0uL) { "Both proportional max inputs must be positive" }
        require(minSharesOut > 0uL) { "Minimum shares out must be positive" }
        val signer = checkedSigner(depositor, "depositor")
        validateWalletBalances(binding, signer, balances)
        require(maxAmounts.a <= balances.assetA.amount && maxAmounts.b <= balances.assetB.amount) {
            "Maximum inputs exceed the fetched wallet token balances"
        }

        val data = BorshWriter().apply {
            bytes(depositDiscriminator)
            u64(maxAmounts.a)
            u64(maxAmounts.b)
            u64(minSharesOut)
        }.toByteArray()
        return plan(
            network = binding.network,
            feePayer = signer,
            revision = binding.configurationRevision,
            order = entryExitOrder("depositor"),
            signerNames = setOf("depositor"),
            writableNames = setOf("vault", "share_mint", "user_shares", "custody_a", "custody_b", "user_asset_a", "user_asset_b"),
            data = data,
            accounts = entryExitAccounts(binding, vault, signer, balances, "depositor"),
        )
    }

    fun redeemInKind(
        binding: VaultBinding,
        vaultSnapshot: VaultAccountSnapshot,
        holder: String,
        balances: WalletTokenBalances,
        sharesToBurn: ULong,
        minAmountsOut: AssetAmounts,
    ): ColoyondTransactionPlan {
        val vault = validateBinding(binding, vaultSnapshot, requireActive = false)
        require(sharesToBurn > 0uL) { "Shares to burn must be positive" }
        val signer = checkedSigner(holder, "holder")
        validateWalletBalances(binding, signer, balances)
        require(sharesToBurn <= balances.shares.amount) { "Shares to burn exceed the fetched share balance" }

        val data = BorshWriter().apply {
            bytes(redeemDiscriminator)
            u64(sharesToBurn)
            u64(minAmountsOut.a)
            u64(minAmountsOut.b)
        }.toByteArray()
        return plan(
            network = binding.network,
            feePayer = signer,
            revision = binding.configurationRevision,
            order = entryExitOrder("holder"),
            signerNames = setOf("holder"),
            writableNames = setOf("vault", "share_mint", "user_shares", "custody_a", "custody_b", "user_asset_a", "user_asset_b"),
            data = data,
            accounts = entryExitAccounts(binding, vault, signer, balances, "holder"),
        )
    }

    private fun validateBinding(
        binding: VaultBinding,
        snapshot: VaultAccountSnapshot,
        requireActive: Boolean,
    ): VaultAccountDecoder.Vault {
        ColoyondAddresses.validateNetwork(binding.network)
        require(binding.programId == ColoyondAddresses.PROGRAM_ID) { "Program ID does not match IDL ${ColoyondAddresses.IDL_VERSION}" }
        require(binding.vaultAddress == ColoyondAddresses.vault()) { "Vault address does not match the v0.3.0 global vault PDA" }
        require(binding.configurationRevision > 0uL) { "Configuration revision must be positive" }
        require(snapshot.address == binding.vaultAddress) { "Fetched vault address does not match the selected vault" }
        require(snapshot.ownerProgramId == binding.programId) { "Fetched vault owner does not match the selected program" }
        requireSupportedMints(binding.network, binding.mintA, binding.mintB)
        require(binding.mintA != binding.mintB) { "Vault mints must be distinct" }
        val vault = VaultAccountDecoder.decode(snapshot.data, snapshot.ownerProgramId)
        require(vault.configurationRevision.toULongOrNull() == binding.configurationRevision) {
            "Fetched vault configuration revision is stale"
        }
        require(vault.assets.map { it.mint } == listOf(binding.mintA, binding.mintB)) { "Fetched vault mints do not match the selected vault" }
        require(vault.assets.all { it.tokenProgram == ColoyondAddresses.TOKEN_PROGRAM_ID }) { "Only the classic SPL Token program is supported" }
        require(vault.shareMint == binding.shareMint) { "Fetched share mint does not match the selected vault" }
        require(vault.assets.map { it.custody } == listOf(binding.custodyA, binding.custodyB)) { "Fetched custody accounts do not match the selected vault" }
        require(vault.assets.map { it.decimals } == binding.mintDecimals()) { "Fetched mint decimals do not match the admitted WSOL/USDC pair" }
        require(vault.assets.map { it.targetBps } == listOf(binding.targetWeights.aBps, binding.targetWeights.bBps)) {
            "Fetched target weights do not match the selected configuration"
        }
        if (requireActive) require(vault.status == "active") { "Deposits require an active vault" }
        return vault
    }

    private fun validateWalletBalances(binding: VaultBinding, owner: String, balances: WalletTokenBalances) {
        validateTokenBalance(balances.assetA, owner, binding.mintA, "asset A")
        validateTokenBalance(balances.assetB, owner, binding.mintB, "asset B")
        validateTokenBalance(balances.shares, owner, binding.shareMint, "shares")
    }

    private fun validateTokenBalance(account: TokenAccountSnapshot, owner: String, mint: String, label: String) {
        require(account.initialized) { "$label token account is missing or uninitialized" }
        require(account.accountOwnerProgramId == ColoyondAddresses.TOKEN_PROGRAM_ID) {
            "$label token account must be owned by the classic SPL Token program"
        }
        require(account.owner == owner && account.mint == mint) { "$label token account owner or mint does not match" }
        require(account.address == ColoyondAddresses.associatedToken(owner, mint)) { "$label token account is not the canonical associated token account" }
    }

    private fun entryExitAccounts(
        binding: VaultBinding,
        vault: VaultAccountDecoder.Vault,
        signer: String,
        balances: WalletTokenBalances,
        signerName: String,
    ): List<InstructionAccountMeta> = listOf(
        meta("vault", binding.vaultAddress),
        meta("governance", ColoyondAddresses.governance(binding.vaultAddress), writable = false),
        meta("share_mint", binding.shareMint),
        meta("user_shares", balances.shares.address),
        meta(signerName, signer),
        meta("custody_a", vault.assets[0].custody),
        meta("custody_b", vault.assets[1].custody),
        meta("user_asset_a", balances.assetA.address),
        meta("user_asset_b", balances.assetB.address),
        meta("mint_a", binding.mintA),
        meta("mint_b", binding.mintB),
        meta("token_program", ColoyondAddresses.TOKEN_PROGRAM_ID),
    )

    private fun VaultBinding.mintDecimals(): List<Int> = listOf(mintA, mintB).map { mint ->
        when (mint) {
            ColoyondAddresses.WSOL_MINT -> 9
            ColoyondAddresses.DEVNET_USDC_MINT -> 6
            else -> error("Unsupported mint $mint")
        }
    }

    private fun requireSupportedMints(network: SolanaNetwork, mintA: String, mintB: String) {
        val expectedUsdc = when (network.cluster) {
            SolanaCluster.DEVNET -> ColoyondAddresses.DEVNET_USDC_MINT
            // The local validator must clone the Devnet USDC mint at its canonical address.
            SolanaCluster.LOCALNET -> ColoyondAddresses.DEVNET_USDC_MINT
        }
        require(setOf(mintA, mintB) == setOf(ColoyondAddresses.WSOL_MINT, expectedUsdc)) {
            "Only the canonical WSOL/USDC mint pair is supported on this cluster"
        }
    }

    private fun requireTargets(targets: TargetWeights) {
        require(targets.aBps in 1..9_999 && targets.bBps in 1..9_999 && targets.aBps + targets.bBps == 10_000) {
            "Target weights must be positive and sum to 10,000 bps"
        }
    }

    private fun checkedSigner(address: String, role: String): String {
        val checked = checkedKey(address, role)
        require(checked != ColoyondAddresses.SYSTEM_PROGRAM_ID) { "$role cannot be the default public key" }
        return checked
    }

    private fun checkedKey(address: String, role: String): String {
        require(address.isNotBlank()) { "$role address is required" }
        return ColoyondAddresses.key(address).base58()
    }

    private fun plan(
        network: SolanaNetwork,
        feePayer: String,
        revision: ULong,
        order: List<String>,
        signerNames: Set<String>,
        writableNames: Set<String>,
        data: ByteArray,
        accounts: List<InstructionAccountMeta>,
    ): ColoyondTransactionPlan {
        ColoyondAddresses.validateNetwork(network)
        require(accounts.map { it.name } == order) { "Account list does not match the v0.3.0 IDL order" }
        require(accounts.map { it.name }.distinct().size == accounts.size) { "Instruction account names must be unique" }
        require(accounts.filter { it.isSigner }.map { it.name }.toSet() == signerNames) { "Signer flags do not match the v0.3.0 IDL" }
        require(accounts.filter { it.isWritable }.map { it.name }.toSet() == writableNames) { "Writable flags do not match the v0.3.0 IDL" }
        require(accounts.any { it.address == feePayer && it.isSigner }) { "Fee payer must be an instruction signer" }
        require(accounts.firstOrNull { it.isSigner }?.address == feePayer) {
            "Fee payer must be the first instruction signer so the unsigned message assigns it as payer"
        }
        accounts.forEach { checkedKey(it.address, "${it.name} account") }
        return ColoyondTransactionPlan(network, feePayer, revision, accounts, data)
    }

    private fun meta(name: String, address: String, writable: Boolean? = null): InstructionAccountMeta {
        val policy = when (name) {
            "vault", "governance", "share_mint", "user_shares", "seeder_shares", "seeder_asset_a", "seeder_asset_b",
            "custody_a", "custody_b", "user_asset_a", "user_asset_b" -> true to false
            "seeder" -> true to true
            "bootstrap_authority", "governance_authority", "emergency_authority", "depositor", "holder" -> false to true
            else -> false to false
        }
        return InstructionAccountMeta(name, address, isSigner = policy.second, isWritable = writable ?: policy.first)
    }

    private class BorshWriter {
        private val output = ByteArrayOutputStream()

        fun bytes(value: ByteArray) { output.write(value) }

        fun u16(value: Int) {
            require(value in 0..0xffff)
            bytes(byteArrayOf(value.toByte(), (value ushr 8).toByte()))
        }

        fun u64(value: ULong) { bytes(ColoyondAddresses.u64Le(value)) }

        fun pubkey(value: String) { bytes(ColoyondAddresses.key(value).bytes) }

        fun toByteArray(): ByteArray = output.toByteArray()
    }
}
