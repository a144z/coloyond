package com.coloyond.protocols.coloyond.transactions.reader

import android.content.res.AssetManager
import java.math.BigInteger
import java.security.MessageDigest
import org.json.JSONArray
import org.json.JSONObject

/** Decodes only accounts described by the bundled, version-pinned Anchor IDL. */
class AnchorIdlAccountDecoder(idlJson: String) {
    private val idl = JSONObject(idlJson)
    private val accountSpecs = idl.getJSONArray("accounts")
    private val typeSpecs = idl.getJSONArray("types")

    val programAddress: String = idl.getString("address")

    init {
        val actualHash = MessageDigest.getInstance("SHA-256")
            .digest(idlJson.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it.toInt() and 0xff) }
        if (actualHash != PINNED_IDL_SHA256 || programAddress != PINNED_PROGRAM_ADDRESS ||
            idl.getJSONObject("metadata").getString("version") != PINNED_IDL_VERSION
        ) {
            throw DecodeException("Bundled IDL does not match the pinned Coloyond v$PINNED_IDL_VERSION contract")
        }
    }

    class DecodeException(message: String, cause: Throwable? = null) : IllegalArgumentException(message, cause)

    fun decode(accountName: String, ownerProgramId: String, data: ByteArray): Map<String, Any?> {
        if (ownerProgramId != programAddress) {
            throw DecodeException("$accountName account owner does not match the IDL program address")
        }
        val spec = (0 until accountSpecs.length())
            .map(accountSpecs::getJSONObject)
            .firstOrNull { it.getString("name") == accountName }
            ?: throw DecodeException("IDL does not define account $accountName")
        if (data.size < DISCRIMINATOR_SIZE) throw DecodeException("$accountName account is shorter than its discriminator")
        val expectedDiscriminator = spec.getJSONArray("discriminator").toByteArray("$accountName discriminator")
        if (!data.copyOfRange(0, DISCRIMINATOR_SIZE).contentEquals(expectedDiscriminator)) {
            throw DecodeException("$accountName discriminator does not match the checked-in IDL")
        }

        val definition = findType(accountName)
        if (definition.getString("kind") != "struct") throw DecodeException("IDL account $accountName is not a struct")
        val expectedAccountSize = expectedAllocationSize(accountName)
        if (data.size != expectedAccountSize) {
            throw DecodeException("$accountName allocation size does not match its checked-in IDL size")
        }
        val reader = BorshReader(data.copyOfRange(DISCRIMINATOR_SIZE, data.size))
        val decoded = decodeStruct(reader, definition, accountName)
        // GovernanceAccount has an optional proposal in a fixed-size Anchor account.
        // Clearing Some -> None shortens Borsh serialization and Anchor leaves the
        // old proposal bytes in the allocation tail; those bytes are not decoded state.
        val staleGovernanceProposalTail = accountName == "GovernanceAccount" && decoded["pending"] == null
        if (!staleGovernanceProposalTail && reader.remainingBytes().any { it != 0.toByte() }) {
            throw DecodeException("$accountName contains nonzero data beyond its IDL layout")
        }
        return decoded
    }

    /** Fixed Anchor allocation size derived from the pinned IDL's maximum Borsh layout. */
    fun expectedAllocationSize(accountName: String): Int {
        val definition = findType(accountName)
        if (definition.getString("kind") != "struct") throw DecodeException("IDL account $accountName is not a struct")
        return Math.addExact(DISCRIMINATOR_SIZE, maximumTypeSize(accountName, mutableSetOf()))
    }

    private fun maximumTypeSize(name: String, visiting: MutableSet<String>): Int {
        if (!visiting.add(name)) throw DecodeException("IDL type cycle at $name")
        val type = findType(name)
        val size = when (type.getString("kind")) {
            "struct" -> {
                val fields = type.getJSONArray("fields")
                (0 until fields.length()).sumOf { index -> maximumFieldSize(fields.getJSONObject(index).get("type"), visiting) }
            }
            "enum" -> {
                val variants = type.getJSONArray("variants")
                1 + (0 until variants.length()).maxOfOrNull { index ->
                    val fields = variants.getJSONObject(index).optJSONArray("fields") ?: return@maxOfOrNull 0
                    (0 until fields.length()).sumOf { fieldIndex ->
                        maximumFieldSize(fields.getJSONObject(fieldIndex).get("type"), visiting)
                    }
                }.orZero()
            }
            else -> throw DecodeException("IDL type $name has an unsupported kind")
        }
        visiting.remove(name)
        return size
    }

    private fun maximumFieldSize(type: Any, visiting: MutableSet<String>): Int {
        if (type is String) return when (type) {
            "u8", "i8", "bool" -> 1
            "u16", "i16" -> 2
            "u32", "i32" -> 4
            "u64", "i64" -> 8
            "u128", "i128" -> 16
            "pubkey" -> PUBKEY_SIZE
            else -> throw DecodeException("Unsupported IDL primitive $type")
        }
        if (type !is JSONObject) throw DecodeException("Malformed IDL type while computing allocation size")
        return when {
            type.has("array") -> {
                val array = type.getJSONArray("array")
                Math.multiplyExact(maximumFieldSize(array.get(0), visiting), array.getInt(1))
            }
            type.has("option") -> Math.addExact(1, maximumFieldSize(type.get("option"), visiting))
            type.has("defined") -> {
                val defined = type.get("defined")
                val name = if (defined is String) defined else (defined as? JSONObject)?.getString("name")
                    ?: throw DecodeException("Malformed defined IDL type")
                maximumTypeSize(name, visiting)
            }
            else -> throw DecodeException("Unsupported IDL type while computing allocation size")
        }
    }

    private fun Int?.orZero(): Int = this ?: 0

    private fun findType(name: String): JSONObject =
        (0 until typeSpecs.length())
            .map(typeSpecs::getJSONObject)
            .firstOrNull { it.getString("name") == name }
            ?.getJSONObject("type")
            ?: throw DecodeException("IDL does not define type $name")

    private fun decodeStruct(reader: BorshReader, definition: JSONObject, field: String): Map<String, Any?> {
        val fields = definition.optJSONArray("fields") ?: throw DecodeException("$field has no IDL fields")
        return buildMap {
            for (index in 0 until fields.length()) {
                val property = fields.getJSONObject(index)
                val name = property.getString("name")
                put(name, decodeType(reader, property.get("type"), "$field.$name"))
            }
        }
    }

    private fun decodeType(reader: BorshReader, idlType: Any, field: String): Any? {
        if (idlType is String) return reader.readPrimitive(idlType, field)
        if (idlType !is JSONObject) throw DecodeException("Unsupported IDL type for $field")
        when {
            idlType.has("array") -> {
                val array = idlType.getJSONArray("array")
                val elementType = array.get(0)
                val length = array.getInt(1)
                if (length < 0) throw DecodeException("$field has a negative IDL array length")
                return List(length) { index -> decodeType(reader, elementType, "$field[$index]") }
            }
            idlType.has("option") -> {
                return when (val tag = reader.readU8("$field option tag")) {
                    0 -> null
                    1 -> decodeType(reader, idlType.get("option"), field)
                    else -> throw DecodeException("$field has invalid Borsh option tag $tag")
                }
            }
            idlType.has("defined") -> {
                val defined = idlType.get("defined")
                val name = when (defined) {
                    is String -> defined
                    is JSONObject -> defined.getString("name")
                    else -> throw DecodeException("$field has malformed defined IDL type")
                }
                val definition = findType(name)
                return when (definition.getString("kind")) {
                    "struct" -> decodeStruct(reader, definition, field)
                    "enum" -> decodeEnum(reader, definition, field)
                    else -> throw DecodeException("$field uses unsupported IDL type $name")
                }
            }
            else -> throw DecodeException("Unsupported IDL type for $field")
        }
    }

    private fun decodeEnum(reader: BorshReader, definition: JSONObject, field: String): EnumValue {
        val variants = definition.getJSONArray("variants")
        val index = reader.readU8("$field enum tag")
        if (index >= variants.length()) throw DecodeException("$field has unknown enum tag $index")
        val variant = variants.getJSONObject(index)
        val name = variant.getString("name")
        val variantFields = variant.optJSONArray("fields") ?: return EnumValue(name, emptyMap())
        val values = buildMap {
            for (fieldIndex in 0 until variantFields.length()) {
                val property = variantFields.getJSONObject(fieldIndex)
                val propertyName = property.getString("name")
                put(propertyName, decodeType(reader, property.get("type"), "$field.$name.$propertyName"))
            }
        }
        return EnumValue(name, values)
    }

    data class EnumValue(val variant: String, val fields: Map<String, Any?>)

    private class BorshReader(private val data: ByteArray) {
        private var offset = 0

        private fun take(size: Int, field: String): ByteArray {
            if (size < 0 || offset + size > data.size) throw DecodeException("$field is truncated")
            return data.copyOfRange(offset, offset + size).also { offset += size }
        }

        fun readU8(field: String): Int = take(1, field)[0].toUByte().toInt()

        fun readPrimitive(type: String, field: String): Any = when (type) {
            "u8" -> readU8(field)
            "u16" -> unsignedInteger(2, field).toInt()
            "u32" -> unsignedInteger(4, field).toLong()
            "u64" -> unsignedInteger(8, field).toString()
            "u128" -> unsignedInteger(16, field).toString()
            "i8" -> take(1, field)[0].toInt()
            "i16" -> signedInteger(2, field).toInt()
            "i32" -> signedInteger(4, field).toInt()
            "i64" -> signedInteger(8, field).toString()
            "i128" -> signedInteger(16, field).toString()
            "bool" -> when (val value = readU8(field)) {
                0 -> false
                1 -> true
                else -> throw DecodeException("$field has invalid Borsh bool $value")
            }
            "pubkey" -> encodeBase58(take(PUBKEY_SIZE, field))
            else -> throw DecodeException("Unsupported IDL primitive $type for $field")
        }

        private fun unsignedInteger(size: Int, field: String): BigInteger =
            BigInteger(1, take(size, field).reversedArray())

        private fun signedInteger(size: Int, field: String): BigInteger =
            BigInteger(take(size, field).reversedArray())

        fun remainingBytes(): ByteArray = data.copyOfRange(offset, data.size)
    }

    private fun JSONArray.toByteArray(field: String): ByteArray = ByteArray(length()) { index ->
        val value = getInt(index)
        if (value !in 0..255) throw DecodeException("$field contains a byte outside 0..255")
        value.toByte()
    }

    private fun encodeBase58(input: ByteArray): String {
        var zeros = 0
        while (zeros < input.size && input[zeros] == 0.toByte()) zeros++
        if (zeros == input.size) return "1".repeat(zeros)
        val digits = mutableListOf(0)
        for (index in zeros until input.size) {
            var carry = input[index].toUByte().toInt()
            for (digitIndex in digits.indices) {
                carry += digits[digitIndex] shl 8
                digits[digitIndex] = carry % BASE58_RADIX
                carry /= BASE58_RADIX
            }
            while (carry > 0) {
                digits.add(carry % BASE58_RADIX)
                carry /= BASE58_RADIX
            }
        }
        return "1".repeat(zeros) + digits.asReversed().joinToString("") { BASE58_ALPHABET[it].toString() }
    }

    companion object {
        private const val DISCRIMINATOR_SIZE = 8
        private const val PUBKEY_SIZE = 32
        private const val BASE58_RADIX = 58
        private const val BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
        private const val PINNED_IDL_VERSION = "0.3.0"
        private const val PINNED_PROGRAM_ADDRESS = "FN7uGX34qyijmVX69gqEkMugWjE5Sjso8Pe7gWU6B2N6"
        private const val PINNED_IDL_SHA256 = "ca10e5608bf937033d082cf6464cd4fc6e719d1340bd0b86cd752221dee68c34"

        /** Loads the canonical IDL packaged from the repository's `idl/` directory. */
        fun fromAssets(assets: AssetManager): AnchorIdlAccountDecoder =
            AnchorIdlAccountDecoder(assets.open("coloyond_vault.json").bufferedReader().use { it.readText() })
    }
}
