package com.coloyond.protocols.portfolio

import org.junit.Assert.assertEquals
import org.junit.Test

class PortfolioAddressesTest {
    @Test
    fun programIdMatchesTheRustDeclareId() {
        assertEquals(
            "5oHukWBWXvySZipAd6DHSq1KHN8HLFYa38yTJdvx2V7N",
            PortfolioAddresses.PROGRAM_ID,
        )
    }

    @Test
    fun seedConstantsMatchTheRustPdaSeeds() {
        assertEquals("etf_pool", PortfolioAddresses.POOL_SEED)
        assertEquals("etf_vault", PortfolioAddresses.VAULT_SEED)
    }

    @Test
    fun u64LeEncodesLittleEndian() {
        assertEquals(0u.toByte(), PortfolioAddresses.u64Le(0uL)[0])
        assertEquals(1u.toByte(), PortfolioAddresses.u64Le(1uL)[0])
        assertEquals(0u.toByte(), PortfolioAddresses.u64Le(1uL)[1])
        assertEquals(0u.toByte(), PortfolioAddresses.u64Le(256uL)[0])
        assertEquals(1u.toByte(), PortfolioAddresses.u64Le(256uL)[1])
        assertEquals(8, PortfolioAddresses.u64Le(0uL).size)
    }

    @Test
    fun poolPdaDerivesOffAdminAndPoolId() {
        // Cross-checked against `coloyond_portfolio::pda::pool` for the same
        // admin bytes (base58 of `[7u8; 32]`) and little-endian pool ids.
        val admin = "US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx"
        assertEquals("F9pNCkgH1t9C2QtVeK2bHbmm8gZAAyuMdYkazkhaWbCB", PortfolioAddresses.pool(admin, 0uL))
        assertEquals("27U7xR8rPUSQCd2TDvHN6XSkHBAcwj4k76YKeBTZeUwf", PortfolioAddresses.pool(admin, 1uL))
    }

    @Test
    fun vaultPdaDerivesFromPool() {
        val poolAddress = "F9pNCkgH1t9C2QtVeK2bHbmm8gZAAyuMdYkazkhaWbCB"
        assertEquals("z4gRugwGrxQLtss31qrL3kKxcu3jki3789gPUfmSxVx", PortfolioAddresses.vault(poolAddress))
    }
}