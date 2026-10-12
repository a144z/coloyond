package com.coloyond.core.storage

import java.math.BigInteger
import java.security.MessageDigest
import java.util.Base64
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class PendingActionRecordTest {
    private val reviewedBytes = byteArrayOf(1, 2, 3)
    private val reviewedBase64 = Base64.getEncoder().encodeToString(reviewedBytes)
    private val reviewedDigest = MessageDigest.getInstance("SHA-256").digest(reviewedBytes)
        .joinToString("") { "%02x".format(it.toInt() and 0xff) }
    private val expectedEffect = ExpectedAccountEffect(
        account = "token-account",
        mint = "mint",
        baselineAmountBaseUnits = BigInteger("1000000000000000000"),
        minimumDeltaBaseUnits = BigInteger("-100000000000000000"),
        maximumDeltaBaseUnits = BigInteger("-90000000000000000"),
    )
    private val prepared = PendingActionRecord(
        id = "action-1",
        kind = PendingActionKind.VAULT_DEPOSIT,
        state = PendingActionState.PREPARED,
        createdAtMillis = 12,
        cluster = "devnet",
        walletAddress = "wallet",
        programId = "program",
        vaultAddress = "vault",
        configurationRevision = BigInteger("18446744073709551615"),
        reviewedMessageDigest = reviewedDigest,
        reviewedMessageBase64 = reviewedBase64,
        reviewedAccountKeys = listOf("wallet", "vault", "token-account"),
        reviewedInstructionProgramId = "program",
        reviewedInstructionAccounts = listOf("vault", "token-account"),
        reviewedInstructionDataBase64 = Base64.getEncoder().encodeToString(byteArrayOf(4)),
        rpcEndpoint = "https://rpc.test",
        genesisHash = "devnet-genesis",
        recentBlockhash = "blockhash",
        lastValidBlockHeight = BigInteger("18446744073709551615"),
        reviewContextSlot = BigInteger("42"),
        expectedEffects = listOf(expectedEffect),
    )

    @Test
    fun codecPreservesTypedIntentAndLargeAmountsAcrossRestart() {
        val reconciled = prepared.handedOff().withSignedTransaction("d2lyZQ==", "sig")
            .reconcile(ReconciliationObservation(
                signatureStatus = ObservedSignatureStatus.CONFIRMED,
                signature = "sig",
                accountEffects = listOf(ObservedAccountEffect(
                    "token-account", "mint", BigInteger("905000000000000000"), BigInteger("18446744073709551615"),
                )),
                transactionMessageDigest = reviewedDigest,
                transactionProgramId = "program",
                transactionAccountKeys = prepared.reviewedAccountKeys,
                transactionInstructionAccounts = prepared.reviewedInstructionAccounts,
                transactionInstructionDataBase64 = prepared.reviewedInstructionDataBase64,
                transactionSlot = BigInteger("18446744073709551615"),
                metadataAvailable = true,
                preTokenBalancesAvailable = true,
                postTokenBalancesAvailable = true,
            ))

        assertEquals(reconciled, PendingActionCodec.decode(PendingActionCodec.encode(reconciled)))
        val encoded = PendingActionCodec.encode(reconciled)
        assertTrue(encoded.contains("\"configurationRevision\":\"18446744073709551615\""))
        assertTrue(encoded.contains("\"slot\":\"18446744073709551615\""))
        assertTrue(encoded.contains("\"signedTransactionBase64\":\"d2lyZQ==\""))
    }

    @Test
    fun signatureAloneNeverConfirmsVaultAccountEffects() {
        val action = prepared.handedOff().withSignedTransaction("d2lyZQ==", "sig").reconcile(
            ReconciliationObservation(ObservedSignatureStatus.CONFIRMED, "sig"),
        )

        assertEquals(PendingActionState.RECONCILIATION_REQUIRED, action.state)
        assertEquals("sig", action.signature)
    }

    @Test
    fun accountEffectsWithoutSignatureCannotConfirmAction() {
        val action = prepared.handedOff().reconcile(
            ReconciliationObservation(
                ObservedSignatureStatus.CONFIRMED,
                accountEffects = listOf(ObservedAccountEffect(
                    "token-account", "mint", BigInteger("905000000000000000"), BigInteger("88"),
                )),
            ),
        )

        assertEquals(PendingActionState.RECONCILIATION_REQUIRED, action.state)
        assertEquals(null, action.signature)
    }

    @Test
    fun mismatchedAccountDeltaRemainsUnresolved() {
        val action = prepared.handedOff().withSignedTransaction("d2lyZQ==", "sig").reconcile(
            ReconciliationObservation(
                ObservedSignatureStatus.FINALIZED,
                "sig",
                listOf(ObservedAccountEffect(
                    "token-account", "mint", BigInteger("999999999999999999"), BigInteger("88"),
                )),
                transactionMessageDigest = reviewedDigest,
                transactionProgramId = "program",
                transactionAccountKeys = prepared.reviewedAccountKeys,
                transactionInstructionAccounts = prepared.reviewedInstructionAccounts,
                transactionInstructionDataBase64 = prepared.reviewedInstructionDataBase64,
                transactionSlot = BigInteger("88"),
                metadataAvailable = true,
                preTokenBalancesAvailable = true,
                postTokenBalancesAvailable = true,
            ),
        )

        assertEquals(PendingActionState.RECONCILIATION_REQUIRED, action.state)
    }

    @Test
    fun unknownSignatureAfterHandoffDoesNotReturnToPrepared() {
        val action = prepared.handedOff().needsReconciliation("process stopped")

        assertEquals(PendingActionState.RECONCILIATION_REQUIRED, action.state)
        assertNotEquals(PendingActionState.PREPARED, action.state)
    }

    @Test(expected = IllegalArgumentException::class)
    fun cannotMarkWalletHandoffBeforeDurablePreparedState() {
        prepared.handedOff().handedOff()
    }

    @Test
    fun corruptStoredRecordBecomesUnresolvedLegacyAction() {
        val decoded = PendingActionCodec.decodeStored("{not-json", "recovery-id")

        assertTrue(decoded.wasCorrupt)
        assertEquals(PendingActionKind.UNKNOWN_LEGACY, decoded.record.kind)
        assertEquals(PendingActionState.RECONCILIATION_REQUIRED, decoded.record.state)
    }

    @Test(expected = IllegalArgumentException::class)
    fun observedTokenBalanceCannotBeNegative() {
        ObservedAccountEffect("token-account", "mint", BigInteger("-1"), BigInteger.ZERO)
    }

    @Test
    fun v1VaultRecordMigratesToUnresolvedLegacyInsteadOfBeingTrustedAsAReviewableAction() {
        val old = """{"version":1,"id":"old","kind":"VAULT_DEPOSIT","state":"SIGNATURE_KNOWN","createdAtMillis":1,"cluster":"devnet","walletAddress":"wallet","programId":"program","vaultAddress":"vault","configurationRevision":"7","reviewedMessageDigest":"${"a".repeat(64)}","signature":"sig","expectedEffects":[],"observedEffects":[],"lastError":null}"""

        val decoded = PendingActionCodec.decodeStored(old, "fallback")

        assertTrue(decoded.wasCorrupt)
        assertEquals(PendingActionKind.UNKNOWN_LEGACY, decoded.record.kind)
        assertEquals(PendingActionState.RECONCILIATION_REQUIRED, decoded.record.state)
        assertEquals("sig", decoded.record.signature)
    }

    @Test
    fun acceptsLoopbackRpcEndpointsForLocalnetAndRejectsNonTlsPublicRpc() {
        assertEquals("http://localhost:8899", prepared.copy(rpcEndpoint = "http://localhost:8899").rpcEndpoint)
        assertEquals("http://[::1]:8899", prepared.copy(rpcEndpoint = "http://[::1]:8899").rpcEndpoint)
        assertThrows(IllegalArgumentException::class.java) {
            prepared.copy(rpcEndpoint = "http://rpc.example.test")
        }
    }
}
