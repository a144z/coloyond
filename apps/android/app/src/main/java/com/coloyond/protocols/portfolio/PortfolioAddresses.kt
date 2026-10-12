package com.coloyond.protocols.portfolio

import com.solana.publickey.ProgramDerivedAddress
import com.solana.publickey.SolanaPublicKey
import kotlinx.coroutines.runBlocking

/**
 * Canonical addresses and PDA derivations for the v2 `coloyond-portfolio`
 * program, mirroring `programs/coloyond-portfolio/src/pda.rs`.
 *
 * The design is a single `EtfPool` state account (seeds `[pool, admin,
 * pool_id_le]`) whose `vault` PDA (seeds `[vault, pool]`) is the only token
 * authority. The five callable handlers (initialize_pool, update_config,
 * deposit, withdraw, crank_rebalance) and their borsh argument buffers are not
 * mirrored here — they come from the anchor IDL on the client side.
 */
object PortfolioAddresses {
    const val PROGRAM_ID = "5oHukWBWXvySZipAd6DHSq1KHN8HLFYa38yTJdvx2V7N"
    const val POOL_SEED = "etf_pool"
    const val VAULT_SEED = "etf_vault"
    const val TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
    const val ASSOCIATED_TOKEN_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
    const val SYSTEM_PROGRAM_ID = "11111111111111111111111111111111"

    private val programKey get() = key(PROGRAM_ID)
    private val tokenProgramKey get() = key(TOKEN_PROGRAM_ID)
    private val associatedTokenProgramKey get() = key(ASSOCIATED_TOKEN_PROGRAM_ID)

    fun pool(admin: String, poolId: ULong): String = pda(
        listOf(POOL_SEED.toByteArray(), key(admin).bytes, u64Le(poolId)),
        programKey,
    )

    fun vault(poolAddress: String): String = pda(
        listOf(VAULT_SEED.toByteArray(), key(poolAddress).bytes),
        programKey,
    )

    /** Standard associated-token derivation, used for a user's own entry/exit accounts. */
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