package com.coloyond.protocols.symmetry

import java.lang.reflect.Modifier
import java.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

/**
 * Checks [AccountDecoder] against fixtures written by
 * `tools/symmetry-fixtures/dump-fixtures.mjs`, which decodes the same mainnet
 * accounts with the pinned `@symmetry-hq/sdk`. Every field must match.
 */
class AccountDecoderTest {

    private fun fixture(name: String): JSONObject {
        val stream = requireNotNull(javaClass.classLoader?.getResourceAsStream("symmetry/$name.json")) {
            "missing fixture symmetry/$name.json"
        }
        return JSONObject(stream.bufferedReader().use { it.readText() })
    }

    private fun bytes(fixture: JSONObject): ByteArray = Base64.getDecoder().decode(fixture.getString("dataBase64"))

    @Test
    fun vaultsMatchSdkDecode() {
        for (name in VAULT_FIXTURES) {
            val f = fixture(name)
            assertEquals(SymmetryLayout.PROGRAM_ID, f.getString("owner"))
            assertEquals(SymmetryLayout.VAULT_SPAN, f.getInt("layoutSpan"))
            val vault = AccountDecoder.decodeVault(bytes(f))
            assertMatches(name, f.getJSONObject("decoded"), vault)
            assertEquals(f.getString("pubkey"), vault.ownAddress)
        }
    }

    @Test
    fun globalConfigMatchesSdkDecode() {
        val f = fixture("global-config")
        assertEquals(SymmetryLayout.GLOBAL_CONFIG_SPAN, f.getInt("layoutSpan"))
        assertMatches("global-config", f.getJSONObject("decoded"), AccountDecoder.decodeGlobalConfig(bytes(f)))
    }

    @Test
    fun wrongLengthFailsClosed() {
        val data = bytes(fixture(VAULT_FIXTURES.first()))
        assertThrows(AccountDecodeException::class.java) { AccountDecoder.decodeVault(data.copyOf(data.size - 1)) }
        assertThrows(AccountDecodeException::class.java) { AccountDecoder.decodeVault(data.copyOf(data.size + 1)) }
        assertThrows(AccountDecodeException::class.java) { AccountDecoder.decodeGlobalConfig(data) }
    }

    @Test
    fun comparisonDetectsAChangedField() {
        val f = fixture(VAULT_FIXTURES.first())
        val data = bytes(f)
        // supplyOutstanding follows the discriminator, version and two pubkeys.
        data[SymmetryLayout.DISCRIMINATOR_SIZE + 1 + 32 + 32] = (data[SymmetryLayout.DISCRIMINATOR_SIZE + 1 + 32 + 32] + 1).toByte()
        assertThrows(AssertionError::class.java) {
            assertMatches("mutated", f.getJSONObject("decoded"), AccountDecoder.decodeVault(data))
        }
    }

    /** Compares a decoded Kotlin value with the SDK's plain-JSON decode, field by field. */
    private fun assertMatches(path: String, expected: Any?, actual: Any?) {
        when (expected) {
            is JSONObject -> {
                requireNotNull(actual) { "$path: null" }
                val fields = actual.javaClass.declaredFields.filter { !Modifier.isStatic(it.modifiers) }
                assertEquals("$path: field names", expected.keys().asSequence().toSet(), fields.map { it.name }.toSet())
                for (field in fields) {
                    field.isAccessible = true
                    assertMatches("$path.${field.name}", expected.get(field.name), field.get(actual).asUnsigned())
                }
            }
            is JSONArray -> {
                val list = actual as List<*>
                assertEquals("$path: size", expected.length(), list.size)
                for (i in 0 until expected.length()) assertMatches("$path[$i]", expected.get(i), list[i].asUnsigned())
            }
            is Number -> assertEquals(path, expected.toLong(), (actual as Number).toLong())
            // u64 values are decimal strings in the fixture; pubkeys are base58.
            is String -> assertEquals(path, expected, actual.toString())
            else -> error("$path: unexpected fixture value $expected")
        }
    }

    /** ULong fields read through Java reflection arrive as raw signed longs. */
    private fun Any?.asUnsigned(): Any? = if (this is Long) java.lang.Long.toUnsignedString(this) else this

    companion object {
        val VAULT_FIXTURES = listOf(
            "vault-cmbqqVLbsmQ3QCVa27wnGLMwz6WBTtADH7xN2yyYZh1",
            "vault-C2SpNsmPB91ne4JdQRYZZdTJXkMLWyHfMSaZCS9nB33J",
        )
    }
}
