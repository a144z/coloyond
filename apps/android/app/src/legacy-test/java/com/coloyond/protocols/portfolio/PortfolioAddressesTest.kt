package com.coloyond.protocols.portfolio

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
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
        assertEquals("portfolio_owner_registry_v2", PortfolioAddresses.OWNER_REGISTRY_SEED)
        assertEquals("portfolio_vault_v2", PortfolioAddresses.VAULT_SEED)
        assertEquals("portfolio_authority_v2", PortfolioAddresses.AUTHORITY_SEED)
        assertEquals("portfolio_custody_v2", PortfolioAddresses.CUSTODY_SEED)
        assertEquals("portfolio_controller_v2", PortfolioAddresses.CONTROLLER_SEED)
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
    fun vaultPdaChangesWithGeneration() {
        val owner = PortfolioAddresses.SYSTEM_PROGRAM_ID
        val first = PortfolioAddresses.vault(owner, 0uL)
        val second = PortfolioAddresses.vault(owner, 1uL)
        assertNotEquals(first, second)
        assertTrue(first.isNotBlank())
        assertTrue(second.isNotBlank())
    }

    @Test
    fun controllerPdaDerivesFromVaultNotOwner() {
        val owner = PortfolioAddresses.SYSTEM_PROGRAM_ID
        val vaultAddress = PortfolioAddresses.vault(owner, 0uL)
        val controller = PortfolioAddresses.controller(vaultAddress, 0uL)
        assertNotEquals(controller, vaultAddress)
        assertTrue(controller.isNotBlank())
    }
}
