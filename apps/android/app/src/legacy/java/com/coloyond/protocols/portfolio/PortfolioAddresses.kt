package com.coloyond.protocols.portfolio

import com.solana.publickey.ProgramDerivedAddress
import com.solana.publickey.SolanaPublicKey
import kotlinx.coroutines.runBlocking

/**
 * Canonical addresses and PDA derivations for the v2 `coloyond-portfolio` program,
 * mirroring [com.coloyond.protocols.coloyond.transactions.ColoyondAddresses] on the v0.3.0 side.
 */
object PortfolioAddresses {
    const val PROGRAM_ID = "5oHukWBWXvySZipAd6DHSq1KHN8HLFYa38yTJdvx2V7N"
    const val OWNER_REGISTRY_SEED = "portfolio_owner_registry_v2"
    const val VAULT_SEED = "portfolio_vault_v2"
    const val AUTHORITY_SEED = "portfolio_authority_v2"
    const val CUSTODY_SEED = "portfolio_custody_v2"
    const val CONTROLLER_SEED = "portfolio_controller_v2"
    const val TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
    const val ASSOCIATED_TOKEN_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
    const val SYSTEM_PROGRAM_ID = "11111111111111111111111111111111"

    private val programKey get() = key(PROGRAM_ID)
    private val tokenProgramKey get() = key(TOKEN_PROGRAM_ID)
    private val associatedTokenProgramKey get() = key(ASSOCIATED_TOKEN_PROGRAM_ID)

    fun registry(owner: String): String = pda(
        listOf(OWNER_REGISTRY_SEED.toByteArray(), key(owner).bytes),
        programKey,
    )

    fun vault(owner: String, generation: ULong): String = pda(
        listOf(VAULT_SEED.toByteArray(), key(owner).bytes, u64Le(generation)),
        programKey,
    )

    fun authority(vaultAddress: String): String = pda(
        listOf(AUTHORITY_SEED.toByteArray(), key(vaultAddress).bytes),
        programKey,
    )

    fun custody(vaultAddress: String, mint: String): String = pda(
        listOf(CUSTODY_SEED.toByteArray(), key(vaultAddress).bytes, key(mint).bytes),
        programKey,
    )

    fun controller(vaultAddress: String, generation: ULong): String = pda(
        listOf(CONTROLLER_SEED.toByteArray(), key(vaultAddress).bytes, u64Le(generation)),
        programKey,
    )

    fun associatedToken(owner: String, mint: String): String = pda(
        listOf(key(owner).bytes, tokenProgramKey.bytes, key(mint).bytes),
        associatedTokenProgramKey,
    )

    internal fun key(address: String): SolanaPublicKey = SolanaPublicKey.from(address)

    internal fun pda(seeds: List<ByteArray>, programId: SolanaPublicKey): String =
        runBlocking { ProgramDerivedAddress.find(seeds, programId) }.getOrThrow().base58()

    internal fun u64Le(value: ULong): ByteArray = ByteArray(8) { index ->
        (value shr (index * 8)).toByte()
    }
}
