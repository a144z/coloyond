package com.coloyond.protocols.coloyond.transactions

import com.coloyond.protocols.coloyond.VaultAccountDecoder
import com.solana.publickey.ProgramDerivedAddress
import com.solana.publickey.SolanaPublicKey

enum class SolanaCluster { DEVNET, LOCALNET }

data class SolanaNetwork(
    val cluster: SolanaCluster,
    val genesisHash: String,
    val rpcUrl: String,
)

data class LifecyclePdas(
    val vault: String,
    val governance: String,
    val auctionPolicy: String,
    val pendingPolicy: String,
    val conditionState: String,
    val rebalanceIntent: String,
)

data class ReadOnlyAccountRequest(
    val name: String,
    val address: String,
    val expectedOwner: String,
    val mayBeAbsent: Boolean,
)

/** Canonical addresses and lifecycle PDA derivations for the v0.3.0 contract. */
object ColoyondAddresses {
    const val IDL_VERSION = "0.3.0"
    const val PROGRAM_ID = VaultAccountDecoder.PROGRAM_ID
    const val WSOL_MINT = "So11111111111111111111111111111111111111112"
    const val MAINNET_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
    const val DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
    const val TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
    const val ASSOCIATED_TOKEN_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
    const val SYSTEM_PROGRAM_ID = "11111111111111111111111111111111"
    const val UPGRADEABLE_LOADER_ID = "BPFLoaderUpgradeab1e11111111111111111111111"
    const val PYTH_RECEIVER_PROGRAM_ID = "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ"
    const val SOL_USD_FEED = "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE"
    const val USDC_USD_FEED = "Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX"
    // Confirmed by the Devnet and independent OnFinality RPCs on 2026-10-11.
    const val DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
    private const val MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d"
    private const val TESTNET_GENESIS_HASH = "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY"
    private val publicGenesisHashes = setOf(DEVNET_GENESIS_HASH, MAINNET_GENESIS_HASH, TESTNET_GENESIS_HASH)

    private val programKey get() = key(PROGRAM_ID)
    private val tokenProgramKey get() = key(TOKEN_PROGRAM_ID)
    private val associatedTokenProgramKey get() = key(ASSOCIATED_TOKEN_PROGRAM_ID)

    fun vault(): String = pda(listOf("vault".encodeToByteArray()), programKey)

    fun governance(vault: String): String = pda(
        listOf("governance".encodeToByteArray(), key(vault).bytes),
        programKey,
    )

    fun auctionPolicy(vault: String): String = pda(
        listOf("auction_policy".encodeToByteArray(), key(vault).bytes),
        programKey,
    )

    fun pendingPolicy(vault: String): String = pda(
        listOf("auction_policy_proposal".encodeToByteArray(), key(vault).bytes),
        programKey,
    )

    fun conditionState(vault: String): String = pda(
        listOf("condition_state".encodeToByteArray(), key(vault).bytes),
        programKey,
    )

    fun rebalanceIntent(vault: String): String = pda(
        listOf("rebalance_intent".encodeToByteArray(), key(vault).bytes),
        programKey,
    )

    fun bountyClaim(vault: String, intentSequence: ULong): String = pda(
        listOf("bounty_claim".encodeToByteArray(), key(vault).bytes, u64Le(intentSequence)),
        programKey,
    )

    fun programData(): String = pda(listOf(programKey.bytes), key(UPGRADEABLE_LOADER_ID))

    fun associatedToken(owner: String, mint: String): String = pda(
        listOf(key(owner).bytes, tokenProgramKey.bytes, key(mint).bytes),
        associatedTokenProgramKey,
    )

    fun lifecyclePdas(network: SolanaNetwork, vaultAddress: String = vault()): LifecyclePdas {
        validateNetwork(network)
        require(vaultAddress == vault()) { "Vault address does not match the v0.3.0 global vault PDA" }
        return LifecyclePdas(
            vault = vaultAddress,
            governance = governance(vaultAddress),
            auctionPolicy = auctionPolicy(vaultAddress),
            pendingPolicy = pendingPolicy(vaultAddress),
            conditionState = conditionState(vaultAddress),
            rebalanceIntent = rebalanceIntent(vaultAddress),
        )
    }

    fun lifecycleReadRequests(network: SolanaNetwork): List<ReadOnlyAccountRequest> {
        val pdas = lifecyclePdas(network)
        return listOf(
            ReadOnlyAccountRequest("vault", pdas.vault, PROGRAM_ID, mayBeAbsent = true),
            ReadOnlyAccountRequest("governance", pdas.governance, PROGRAM_ID, mayBeAbsent = true),
            ReadOnlyAccountRequest("auction_policy", pdas.auctionPolicy, PROGRAM_ID, mayBeAbsent = true),
            ReadOnlyAccountRequest("pending_policy", pdas.pendingPolicy, PROGRAM_ID, mayBeAbsent = true),
            ReadOnlyAccountRequest("condition_state", pdas.conditionState, PROGRAM_ID, mayBeAbsent = true),
            ReadOnlyAccountRequest("rebalance_intent", pdas.rebalanceIntent, PROGRAM_ID, mayBeAbsent = true),
            ReadOnlyAccountRequest("program_data", programData(), UPGRADEABLE_LOADER_ID, mayBeAbsent = false),
            ReadOnlyAccountRequest("sol_usd", SOL_USD_FEED, PYTH_RECEIVER_PROGRAM_ID, mayBeAbsent = false),
            ReadOnlyAccountRequest("usdc_usd", USDC_USD_FEED, PYTH_RECEIVER_PROGRAM_ID, mayBeAbsent = false),
        )
    }

    fun validateNetwork(network: SolanaNetwork) {
        require(network.genesisHash.isNotBlank()) { "RPC genesis hash is required" }
        val rpcUri = runCatching { java.net.URI(network.rpcUrl) }.getOrNull()
        when (network.cluster) {
            SolanaCluster.DEVNET -> {
                require(network.genesisHash == DEVNET_GENESIS_HASH) { "RPC genesis hash is not Solana Devnet" }
                require(rpcUri?.scheme == "https" && !rpcUri.host.isNullOrBlank()) { "Devnet RPC must be a valid HTTPS URL" }
            }
            SolanaCluster.LOCALNET -> {
                val host = rpcUri?.host
                require(host in setOf("localhost", "127.0.0.1", "::1", "[::1]")) {
                    "Localnet RPC must use localhost or a loopback address"
                }
                require(network.genesisHash !in publicGenesisHashes) {
                    "A public Solana cluster genesis hash cannot be labeled Localnet"
                }
            }
        }
    }

    internal fun key(address: String): SolanaPublicKey = SolanaPublicKey.from(address)

    internal fun pda(seeds: List<ByteArray>, programId: SolanaPublicKey): String =
        ProgramDerivedAddress.find(seeds, programId).getOrThrow().base58()

    internal fun u64Le(value: ULong): ByteArray = ByteArray(8) { index ->
        (value shr (index * 8)).toByte()
    }
}
