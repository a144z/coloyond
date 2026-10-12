package com.coloyond.protocols.coloyond.transactions.reader

import java.io.File
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.math.BigInteger
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class AnchorIdlAccountDecoderTest {
    private val idlJson = repositoryFile("idl/coloyond_vault.json").readText()
    private val idl = JSONObject(idlJson)
    private val decoder = AnchorIdlAccountDecoder(idlJson)

    @Test
    fun decodesTheCheckedInVaultFixtureAndPreservesU64Strings() {
        val decoded = decoder.decode("Vault", decoder.programAddress, hexFixture("packages/coloyond-client/fixtures/vault-account-v1.hex"))
        assertEquals(1, decoded["version"])
        assertEquals("7", decoded["configuration_revision"])
        assertEquals("42", decoded["sequence"])
        val assets = decoded["assets"] as List<*>
        assertEquals(2, assets.size)
        assertEquals(5_500, (assets[0] as Map<*, *>)["target_bps"])
        assertEquals("123456789", (decoded["accounted_amounts"] as List<*>)[0])
    }

    @Test
    fun decodesVariableOptionFieldsAndEnumVariantsFromTheIdl() {
        val bytes = conditionState(activeRule = true)
        val decoded = decoder.decode("ConditionState", decoder.programAddress, bytes)
        val rule = decoded["active_rule"] as Map<*, *>
        assertEquals("PriceCross", ((rule["predicate"] as AnchorIdlAccountDecoder.EnumValue).variant))
        assertEquals("Above", ((rule["predicate"] as AnchorIdlAccountDecoder.EnumValue).fields["direction"] as AnchorIdlAccountDecoder.EnumValue).variant)
        assertNull(decoded["active_bounds"])
        assertNull(decoded["pending"])
    }

    @Test
    fun preservesUnsigned128ValuesAndRejectsMalformedData() {
        val data = rebalanceIntent(
            startNav = BigInteger("18446744073709551617"),
            cumulativeLoss = BigInteger("340282366920938463463374607431768211455"),
        )
        val decoded = decoder.decode("RebalanceIntent", decoder.programAddress, data)
        assertEquals("18446744073709551617", decoded["start_nav_q9"])
        assertEquals("340282366920938463463374607431768211455", decoded["cumulative_nav_loss_q9"])

        val wrongDiscriminator = data.copyOf().also { it[0] = (it[0].toInt() xor 0xff).toByte() }
        assertThrows(AnchorIdlAccountDecoder.DecodeException::class.java) {
            decoder.decode("RebalanceIntent", decoder.programAddress, wrongDiscriminator)
        }
        val wrongOwner = assertThrows(AnchorIdlAccountDecoder.DecodeException::class.java) {
            decoder.decode("RebalanceIntent", "11111111111111111111111111111111", data)
        }
        assertEquals(true, wrongOwner.message!!.contains("owner"))
    }

    @Test
    fun rejectsInvalidOptionTagsAndNonzeroAllocationPadding() {
        val condition = conditionState(activeRule = false)
        val invalidOption = condition.copyOf().also { it[58] = 2 }
        assertThrows(AnchorIdlAccountDecoder.DecodeException::class.java) {
            decoder.decode("ConditionState", decoder.programAddress, invalidOption)
        }
        val vault = hexFixture("packages/coloyond-client/fixtures/vault-account-v1.hex") + byteArrayOf(1)
        assertThrows(AnchorIdlAccountDecoder.DecodeException::class.java) {
            decoder.decode("Vault", decoder.programAddress, vault)
        }
        val oversizedZeroPadding = hexFixture("packages/coloyond-client/fixtures/vault-account-v1.hex") + byteArrayOf(0)
        assertThrows(AnchorIdlAccountDecoder.DecodeException::class.java) {
            decoder.decode("Vault", decoder.programAddress, oversizedZeroPadding)
        }
        assertThrows(AnchorIdlAccountDecoder.DecodeException::class.java) {
            decoder.decode("ConditionState", decoder.programAddress, conditionState(activeRule = false).dropLast(1).toByteArray())
        }
    }

    @Test
    fun acceptsRetainedProposalBytesOnlyInClearedGovernanceOptionTail() {
        val account = governanceAccountWithoutPending().also { it[it.lastIndex] = 0x5a }

        val decoded = decoder.decode("GovernanceAccount", decoder.programAddress, account)

        assertNull(decoded["pending"])
        assertEquals(false, decoded["risk_paused"])
    }

    @Test
    fun rejectsIdlDriftEvenWhenTheProgramAddressIsUnchanged() {
        val changedIdl = idlJson.replace("\"maximum_age_seconds\"", "\"max_age_seconds\"")
        assertThrows(AnchorIdlAccountDecoder.DecodeException::class.java) {
            AnchorIdlAccountDecoder(changedIdl)
        }
    }

    private fun conditionState(activeRule: Boolean): ByteArray {
        val output = ByteArrayOutputStream()
        output.write(discriminator("ConditionState"))
        output.write(byteArrayOf(1, 2))
        output.write(ByteArray(32) { 9 })
        output.write(u64(7))
        output.write(u64(8))
        if (!activeRule) {
            output.write(byteArrayOf(0, 0, 0))
            return output.toByteArray()
        }

        output.write(1) // active_rule = Some
        output.write(byteArrayOf(1, 1)) // rule version and enabled
        output.write(u64(3)) // rule nonce
        output.write(u64(4) + u64(5)) // ConditionRevisions
        output.write(u64(7)) // authorized target revision
        output.write(u16(5_500) + u16(4_500))
        output.write(i64(1_700_000_000))
        output.write(u64(9))
        output.write(i64(1_700_000_600))
        output.write(u64(10))
        output.write(byteArrayOf(1, 0, 0)) // PriceCross, asset 0, direction Above
        output.write(u128(BigInteger("1000000000000000000")))
        output.write(u16(25))
        output.write(0) // no last observation
        output.write(0) // pending_activation = false
        output.write(byteArrayOf(0, 0)) // no active bounds or pending rule
        return output.toByteArray().copyOf(decoder.expectedAllocationSize("ConditionState"))
    }

    private fun rebalanceIntent(startNav: BigInteger, cumulativeLoss: BigInteger): ByteArray {
        val output = ByteArrayOutputStream()
        output.write(discriminator("RebalanceIntent"))
        output.write(1)
        output.write(ByteArray(32) { 1 })
        output.write(u64(2) + u64(3) + u64(4))
        output.write(0)
        output.write(u64(5) + u64(6) + u64(7) + u64(8))
        output.write(i64(-9) + i64(-10))
        output.write(i64(-11) + i64(-12))
        output.write(u64(13) + u64(14))
        output.write(u128(startNav) + u128(cumulativeLoss))
        output.write(u16(10_100) + u16(10_000) + u16(20) + u16(50) + u16(5_000))
        output.write(u64(15) + u64(16) + u64(17) + u64(18))
        output.write(u64(19))
        output.write(u16(100) + u16(25))
        return output.toByteArray()
    }

    private fun governanceAccountWithoutPending(): ByteArray = ByteArrayOutputStream().apply {
        write(discriminator("GovernanceAccount"))
        write(1)
        write(ByteArray(32) { 1 }) // vault
        write(ByteArray(32) { 2 }) // share mint
        write(ByteArray(64) { 3 }) // allowed mints
        write(ByteArray(32) { 4 }) // governance authority
        write(ByteArray(32) { 5 }) // emergency authority
        write(u64(32)) // minimum delay slots
        write(u64(1)) // configuration revision
        write(u16(5_000) + u16(5_000)) // targets
        write(u64(0)) // proposal nonce
        write(0) // no pending proposal
        write(0) // risk_paused
    }.toByteArray().copyOf(decoder.expectedAllocationSize("GovernanceAccount"))

    private fun discriminator(accountName: String): ByteArray {
        val accounts = idl.getJSONArray("accounts")
        val spec = (0 until accounts.length()).map(accounts::getJSONObject).first { it.getString("name") == accountName }
        val values = spec.getJSONArray("discriminator")
        return ByteArray(values.length()) { values.getInt(it).toByte() }
    }

    private fun hexFixture(path: String): ByteArray =
        repositoryFile(path).readText().trim().chunked(2).map { it.toInt(16).toByte() }.toByteArray()

    private fun repositoryFile(path: String): File {
        var directory: File? = File(requireNotNull(System.getProperty("user.dir"))).canonicalFile
        while (directory != null) {
            File(directory, path).takeIf(File::isFile)?.let { return it }
            directory = directory.parentFile
        }
        error("Cannot find $path from ${System.getProperty("user.dir")}")
    }

    private fun u16(value: Int) = ByteBuffer.allocate(2).order(ByteOrder.LITTLE_ENDIAN).putShort(value.toShort()).array()
    private fun u64(value: Long) = ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN).putLong(value).array()
    private fun i64(value: Long) = ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN).putLong(value).array()
    private fun u128(value: BigInteger): ByteArray = value.toByteArray().let { encoded ->
        val littleEndian = ByteArray(16)
        val source = if (encoded.size > 16) encoded.copyOfRange(encoded.size - 16, encoded.size) else encoded
        for (index in source.indices) littleEndian[index] = source[source.lastIndex - index]
        littleEndian
    }
}
