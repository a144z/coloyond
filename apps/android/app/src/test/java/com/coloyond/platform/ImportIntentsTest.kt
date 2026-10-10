package com.coloyond.platform

import com.coloyond.platform.ImportIntents.readBounded
import java.io.ByteArrayInputStream
import java.io.InputStream
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ImportIntentsTest {

    @Test
    fun readsUpToTheLimitExactly() {
        val bytes = ByteArray(ImportIntents.MAX_IMPORT_BYTES) { it.toByte() }
        assertArrayEquals(bytes, ByteArrayInputStream(bytes).readBounded(ImportIntents.MAX_IMPORT_BYTES))
    }

    @Test
    fun rejectsOneByteOverTheLimit() {
        val bytes = ByteArray(ImportIntents.MAX_IMPORT_BYTES + 1)
        assertNull(ByteArrayInputStream(bytes).readBounded(ImportIntents.MAX_IMPORT_BYTES))
    }

    @Test
    fun handlesShortReads() {
        val bytes = ByteArray(1000) { (it % 251).toByte() }
        assertArrayEquals(bytes, OneByteAtATime(bytes).readBounded(1000))
        assertNull(OneByteAtATime(bytes).readBounded(999))
    }

    @Test
    fun readsAnEmptyStream() {
        assertArrayEquals(ByteArray(0), ByteArrayInputStream(ByteArray(0)).readBounded(10))
    }

    /** Returns at most one byte per read, as some content providers do. */
    private class OneByteAtATime(private val data: ByteArray) : InputStream() {
        private var pos = 0
        override fun read(): Int = if (pos < data.size) data[pos++].toInt() and 0xff else -1
        override fun read(b: ByteArray, off: Int, len: Int): Int {
            if (len == 0) return 0
            val c = read()
            if (c < 0) return -1
            b[off] = c.toByte()
            return 1
        }
    }
}
