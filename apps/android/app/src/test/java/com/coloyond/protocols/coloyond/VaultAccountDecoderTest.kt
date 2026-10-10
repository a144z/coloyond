package com.coloyond.protocols.coloyond

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class VaultAccountDecoderTest {
    @Test
    fun decodesTheSharedSyntheticIdlLayoutFixtureWithoutLosingU64Precision() {
        val vault = VaultAccountDecoder.decode(fixture(), VaultAccountDecoder.PROGRAM_ID)
        assertEquals(1, vault.version)
        assertEquals(4, vault.bump)
        assertEquals("paused", vault.status)
        assertEquals("7", vault.configurationRevision)
        assertEquals(listOf(5500, 4500), vault.assets.map { it.targetBps })
        assertEquals(listOf(9, 6), vault.assets.map { it.decimals })
        assertEquals(listOf("123456789", "987654321"), vault.accountedAmounts)
        assertEquals(listOf("11", "22"), vault.bootstrapReserve)
        assertEquals(listOf("3", "4"), vault.bountyLiabilities)
        assertEquals("42", vault.sequence)
        assertEquals("11111111111111111111111111111111", vault.shareMint)
    }

    @Test
    fun rejectsIncorrectLengthDiscriminatorVersionAndStatus() {
        val data = fixture()
        assertThrows(VaultAccountDecoder.DecodeException::class.java) { VaultAccountDecoder.decode(data, "11111111111111111111111111111111") }
        assertThrows(VaultAccountDecoder.DecodeException::class.java) { VaultAccountDecoder.decode(data.copyOf(data.size - 1), VaultAccountDecoder.PROGRAM_ID) }
        val wrongDiscriminator = data.copyOf().also { it[0] = (it[0].toInt() xor 0xff).toByte() }
        assertThrows(VaultAccountDecoder.DecodeException::class.java) { VaultAccountDecoder.decode(wrongDiscriminator, VaultAccountDecoder.PROGRAM_ID) }
        val wrongVersion = data.copyOf().also { it[8] = 2 }
        assertThrows(VaultAccountDecoder.DecodeException::class.java) { VaultAccountDecoder.decode(wrongVersion, VaultAccountDecoder.PROGRAM_ID) }
        val wrongStatus = data.copyOf().also { it[10] = 9 }
        assertThrows(VaultAccountDecoder.DecodeException::class.java) { VaultAccountDecoder.decode(wrongStatus, VaultAccountDecoder.PROGRAM_ID) }
    }

    private fun fixture(): ByteArray {
        var directory: File? = File(requireNotNull(System.getProperty("user.dir"))).canonicalFile
        while (directory != null) {
            val fixture = File(directory, "packages/coloyond-client/fixtures/vault-account-v1.hex")
            if (fixture.isFile) return fixture.readText().trim().chunked(2).map { it.toInt(16).toByte() }.toByteArray()
            directory = directory.parentFile
        }
        error("Shared fixture packages/coloyond-client/fixtures/vault-account-v1.hex not found from ${System.getProperty("user.dir")}")
    }

}