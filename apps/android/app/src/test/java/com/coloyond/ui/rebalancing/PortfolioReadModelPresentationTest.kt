package com.coloyond.ui.rebalancing

import org.junit.Assert.assertEquals
import org.junit.Test

class PortfolioReadModelPresentationTest {
    @Test
    fun fixtureSourceIsUnmistakablyLabeled() {
        assertEquals("FIXTURE · sample data", PortfolioReadModelPresentation.sourceLabel(ReadModelV1.SourceKind.FIXTURE))
        assertEquals("RPC snapshot", PortfolioReadModelPresentation.sourceLabel(ReadModelV1.SourceKind.RPC))
    }

    @Test
    fun nullableFactsStayUnknownAndZeroStaysZero() {
        assertEquals("Unknown", PortfolioReadModelPresentation.optional(null))
        assertEquals("0", PortfolioReadModelPresentation.optional("0"))
        assertEquals("Unknown", PortfolioReadModelPresentation.bps(null))
        assertEquals("0.00%", PortfolioReadModelPresentation.bps(0))
        assertEquals("5.05%", PortfolioReadModelPresentation.bps(505))
        assertEquals("Unknown", PortfolioReadModelPresentation.yesNoUnknown(null))
        assertEquals("No", PortfolioReadModelPresentation.yesNoUnknown(false))
        assertEquals("18446744073709551615", PortfolioReadModelPresentation.optional("18446744073709551615"))
    }

    @Test
    fun phaseLabelsReflectOnlyExplicitModelValues() {
        assertEquals("Auction", PortfolioReadModelPresentation.phaseLabel(ReadModelV1.Phase.AUCTION))
        assertEquals("Unknown", PortfolioReadModelPresentation.phaseLabel(ReadModelV1.Phase.UNKNOWN))
        assertEquals("Unavailable", PortfolioReadModelPresentation.phaseLabel(ReadModelV1.Phase.UNAVAILABLE))
    }

    @Test
    fun oracleAndExitStatesAreReadableWithoutFillingUnknowns() {
        assertEquals("Depegged", PortfolioReadModelPresentation.oracleStateLabel(ReadModelV1.OracleState.DEPEGGED))
        assertEquals("Unknown", PortfolioReadModelPresentation.verificationLabel(ReadModelV1.OracleVerification.UNKNOWN))
        assertEquals("In kind", PortfolioReadModelPresentation.exitModeLabel(ReadModelV1.ExitMode.IN_KIND))
        assertEquals("Unknown", PortfolioReadModelPresentation.exitModeLabel(ReadModelV1.ExitMode.UNKNOWN))
    }

    @Test
    fun absentTransitionIsNotPresentedAsAConfirmation() {
        assertEquals("No confirmed transition available", PortfolioReadModelPresentation.confirmedTransitionLabel(null))
        assertEquals(
            "Confirmed · rebalance",
            PortfolioReadModelPresentation.confirmedTransitionLabel(
                ReadModelV1.ConfirmedTransition("sig", "rebalance", "18446744073709551615"),
            ),
        )
    }

    @Test
    fun cardKindsRemainSeparateFromLiveVaultFacts() {
        assertEquals(
            "Allocation draft · desired target",
            PortfolioReadModelPresentation.cardKindLabel(CardTargetSnapshot.Kind.ALLOCATION_DRAFT),
        )
        assertEquals(
            "Historical or imported · saved target",
            PortfolioReadModelPresentation.cardKindLabel(CardTargetSnapshot.Kind.HISTORICAL_OR_IMPORTED),
        )
    }
}
