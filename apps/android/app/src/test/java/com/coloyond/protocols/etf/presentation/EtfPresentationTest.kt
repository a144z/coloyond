package com.coloyond.protocols.etf.presentation

import org.junit.Assert.assertEquals
import org.junit.Test

class EtfPresentationTest {
    @Test
    fun missingValuesStayUnknownAndNumericZeroStaysZero() {
        assertEquals("Unknown", EtfPresentationText.weightBps(null))
        assertEquals("Unknown", EtfPresentationText.tokenAmount(null, 9))
        assertEquals("0", EtfPresentationText.tokenAmount("0", 9))
        assertEquals("Unknown", EtfPresentationText.optional(null))
        assertEquals("0", EtfPresentationText.optional("0"))
    }

    @Test
    fun bpsAndTokenAmountsFormatWithoutFloatingPoint() {
        assertEquals("0.00%", EtfPresentationText.weightBps(0))
        assertEquals("40.00%", EtfPresentationText.weightBps(4_000))
        assertEquals("100.00%", EtfPresentationText.weightBps(10_000))
        assertEquals("1.23456789", EtfPresentationText.tokenAmount("1234567890", 9))
        assertEquals("18446744073.709551615", EtfPresentationText.tokenAmount("18446744073709551615", 9))
    }

    @Test
    fun malformedOrOutOfRangeValuesAreNotRenderedAsValidNumbers() {
        assertEquals("Invalid", EtfPresentationText.weightBps(-1))
        assertEquals("Invalid", EtfPresentationText.weightBps(10_001))
        assertEquals("Invalid", EtfPresentationText.tokenAmount("-1", 6))
        assertEquals("Invalid", EtfPresentationText.tokenAmount("1.2", 6))
        assertEquals("Invalid", EtfPresentationText.tokenAmount("1", 19))
        assertEquals("Invalid", EtfPresentationText.usd("not-a-number"))
        assertEquals("Invalid", EtfPresentationText.usd("-0.01"))
        assertEquals("Invalid", EtfPresentationText.ageSeconds(-1))
        assertEquals("Unknown", EtfPresentationText.ageSeconds(null))
        assertEquals("0 seconds", EtfPresentationText.ageSeconds(0))
    }

    @Test
    fun oracleModesDoNotInventReceiverVerificationForPushFeeds() {
        assertEquals("Receiver · Full verification", EtfPresentationText.oracleMode(EtfOracleMode.RECEIVER_FULL))
        assertEquals(
            "Push Feed · owner/layout/update evidence",
            EtfPresentationText.oracleMode(EtfOracleMode.PUSH_FEED),
        )
        assertEquals("Unknown oracle mode", EtfPresentationText.oracleMode(EtfOracleMode.UNKNOWN))
    }

    @Test
    fun transactionStatesKeepSubmittedUnknownAndConfirmedDistinct() {
        assertEquals("Submitted · confirmation not established", EtfPresentationText.walletAction(EtfWalletActionState.SUBMITTED))
        assertEquals("Confirmed · verify against RPC", EtfPresentationText.walletAction(EtfWalletActionState.CONFIRMED))
        assertEquals("Unknown · do not resend automatically", EtfPresentationText.walletAction(EtfWalletActionState.UNKNOWN))
        assertEquals("Rejected", EtfPresentationText.walletAction(EtfWalletActionState.REJECTED))
    }

    @Test
    fun everyScreenStateCarriesAnUnambiguousSyntheticWarning() {
        assertEquals("SYNTHETIC FIXTURE · NO RPC · NO WALLET ACTIONS", EtfPresentationText.SYNTHETIC_NOTICE)
    }
}
