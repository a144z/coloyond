package com.coloyond.wallet

import com.solana.publickey.SolanaPublicKey
import com.solana.transaction.Transaction
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class MemoTransactionTest {

    private val payer = SolanaPublicKey.from("Ho5vmods3ZvjAegHJ8mZTnDa1zbp2Rw4HDNy8Ni2bjfU")
    private val blockhash = "EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N"

    @Test
    fun hasOneEmptySignatureSlotForThePayer() {
        val bytes = memoTransaction(payer, "Coloyond demo transaction", blockhash)
        assertEquals(1, bytes[0].toInt())
        assertArrayEquals(ByteArray(64), bytes.copyOfRange(1, 65))
    }

    @Test
    fun messageCarriesPayerBlockhashAndMemo() {
        val transaction = Transaction.from(memoTransaction(payer, "hello", blockhash))
        val message = transaction.message
        assertEquals(payer, message.accounts.first())
        assertEquals(blockhash, message.blockhash.base58())
        assertEquals("hello", message.instructions.single().data.decodeToString())
    }
}
