package com.coloyond.core.storage

import java.math.BigInteger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PendingActionRecordTest {
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
        reviewedMessageDigest = "a".repeat(64),
        expectedEffects = listOf(expectedEffect),
    )

    @Test
    fun codecPreservesTypedIntentAndLargeAmountsAcrossRestart() {
        val reconciled = prepared.handedOff().withSignature("sig")
            .reconcile(ReconciliationObservation(
                signatureStatus = ObservedSignatureStatus.CONFIRMED,
                signature = "sig",
                accountEffects = listOf(ObservedAccountEffect(
                    "token-account", "mint", BigInteger("905000000000000000"), BigInteger("18446744073709551615"),
                )),
            ))

        assertEquals(reconciled, PendingActionCodec.decode(PendingActionCodec.encode(reconciled)))
        val encoded = PendingActionCodec.encode(reconciled)
        assertTrue(encoded.contains("\"configurationRevision\":\"18446744073709551615\""))
        assertTrue(encoded.contains("\"slot\":\"18446744073709551615\""))
    }

    @Test
    fun signatureAloneNeverConfirmsVaultAccountEffects() {
        val action = prepared.handedOff().withSignature("sig").reconcile(
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
        val action = prepared.handedOff().withSignature("sig").reconcile(
            ReconciliationObservation(
                ObservedSignatureStatus.FINALIZED,
                "sig",
                listOf(ObservedAccountEffect(
                    "token-account", "mint", BigInteger("999999999999999999"), BigInteger("88"),
                )),
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
}
