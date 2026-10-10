package com.coloyond.ui.rebalancing

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp

/** Read-only native presentation. It creates no wallet, transaction, or signing capability. */
@Composable
fun PortfolioStatusScreen(
    model: ReadModelV1,
    cardTarget: CardTargetSnapshot? = null,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Portfolio status", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.semantics { heading() })
        Text("Read-only snapshot · values are observations, not transaction instructions.", style = MaterialTheme.typography.bodyMedium)
        if (model.schema != ReadModelV1.SCHEMA) {
            FactSection("Read model") { Fact("Schema", model.schema, code = true) }
        }

        FactSection("Source and network") {
            Fact("Data source", PortfolioReadModelPresentation.sourceLabel(model.source.kind))
            Fact("Provider label", PortfolioReadModelPresentation.optional(model.source.providerLabel))
            Fact("Cluster", "Solana ${model.network.cluster.wireValue}")
            Fact("Genesis hash", PortfolioReadModelPresentation.optional(model.network.genesisHash), code = true)
            Fact("Observed at", PortfolioReadModelPresentation.optional(model.source.observedAt))
            Fact("Observation slot", PortfolioReadModelPresentation.optional(model.source.slot), code = true)
        }

        FactSection("Program") {
            Fact("Program ID", PortfolioReadModelPresentation.optional(model.program.programId), code = true)
            Fact("Binary hash", PortfolioReadModelPresentation.optional(model.program.binaryHash), code = true)
            Fact("Binary verification", if (model.program.verified) "Verified" else "Not verified")
        }

        cardTarget?.let { CardTargetSection(it) }

        FactSection("Current vault snapshot") {
            Fact("Vault address", PortfolioReadModelPresentation.optional(model.vault.address), code = true)
            Fact("Share mint", PortfolioReadModelPresentation.optional(model.vault.shareMint), code = true)
            Fact("Configuration revision", PortfolioReadModelPresentation.optional(model.vault.configRevision), code = true)
            Fact("Vault phase", PortfolioReadModelPresentation.phaseLabel(model.vault.phase))
            Fact("Total share supply · base units", PortfolioReadModelPresentation.optional(model.vault.totalSupply), code = true)
            Fact("Estimated NAV (USD) · not an execution quote", PortfolioReadModelPresentation.optional(model.vault.estimatedNavUsd))
            WeightList("Vault target · configured weights", model.vault.target)
            if (model.vault.actual == null) {
                Fact("Actual composition", "Unknown · not included in this snapshot")
            } else {
                WeightList("Actual composition · observed weights", model.vault.actual)
            }
        }

        FactSection("Oracle observations") {
            if (model.oracle.isEmpty()) Fact("Feeds", "No oracle rows in this snapshot")
            model.oracle.forEachIndexed { index, feed ->
                Text("Feed ${index + 1}", style = MaterialTheme.typography.titleSmall, modifier = Modifier.semantics { heading() })
                Fact("Feed ID", feed.feedId, code = true)
                Fact("State", PortfolioReadModelPresentation.oracleStateLabel(feed.state))
                Fact("Verification", PortfolioReadModelPresentation.verificationLabel(feed.verification))
                Fact("Publish time", PortfolioReadModelPresentation.optional(feed.publishTime))
                Fact("Age at snapshot", PortfolioReadModelPresentation.ageSeconds(feed.ageSeconds))
                Fact("Confidence", PortfolioReadModelPresentation.bps(feed.confidenceBps))
            }
        }

        FactSection("Rebalance lifecycle") {
            Fact("Vault phase", PortfolioReadModelPresentation.phaseLabel(model.vault.phase))
            val auction = model.auction
            if (auction == null) {
                Fact("Auction facts", "Unavailable · no auction data in this snapshot")
            } else {
                Fact("Auction sequence", PortfolioReadModelPresentation.optional(auction.sequence), code = true)
                Fact("Remaining", PortfolioReadModelPresentation.optional(auction.remaining), code = true)
                Fact("Expiry", PortfolioReadModelPresentation.optional(auction.expiresAt))
                Fact("Auction fee", PortfolioReadModelPresentation.bps(auction.feeBps))
            }
            val transition = model.lastConfirmedTransition
            Fact("Last confirmed transition", PortfolioReadModelPresentation.confirmedTransitionLabel(transition))
            if (transition != null) {
                Fact("Transition kind", transition.kind)
                Fact("Confirmed signature", transition.signature, code = true)
                Fact("Confirmed slot", transition.slot, code = true)
            }
        }

        FactSection("Fee reserve and bounty liability") {
            val reserve = model.reserve
            if (reserve == null) {
                Fact("Reserve state", "Unknown · not included in this snapshot")
            } else {
                AmountMap("Reserve amount · base units", reserve.amountByMint)
                AmountMap("Bounty liability · base units", reserve.bountyLiabilityByMint)
            }
        }

        FactSection("Exit") {
            Fact("Available", PortfolioReadModelPresentation.yesNoUnknown(model.vault.exit.available))
            Fact("Mode", PortfolioReadModelPresentation.exitModeLabel(model.vault.exit.mode))
        }
    }
}

@Composable
private fun CardTargetSection(card: CardTargetSnapshot) {
    FactSection("Card target · separate from current vault") {
        Fact(PortfolioReadModelPresentation.cardKindLabel(card.kind), card.recordId, code = true)
        Fact("Card network", PortfolioReadModelPresentation.optional(card.network))
        Fact("Card protocol", PortfolioReadModelPresentation.optional(card.protocol))
        Fact("Card vault reference", PortfolioReadModelPresentation.optional(card.vaultAddress), code = true)
        Fact("Card share mint", PortfolioReadModelPresentation.optional(card.shareMint), code = true)
        Fact("Card configuration revision", PortfolioReadModelPresentation.optional(card.configurationRevision), code = true)
        WeightList("Card target weights · saved configuration", card.target)
        Text(
            "These are saved card facts. They do not establish that the current vault is published, current, or matched to this card.",
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

@Composable
private fun WeightList(title: String, weights: List<ReadModelV1.Weight>) {
    Text(title, style = MaterialTheme.typography.titleSmall, modifier = Modifier.semantics { heading() })
    if (weights.isEmpty()) {
        Text("No rows in this snapshot", style = MaterialTheme.typography.bodyMedium)
    } else {
        weights.forEach { weight ->
            Column(modifier = Modifier.fillMaxWidth().padding(start = 8.dp, top = 3.dp, bottom = 3.dp)) {
                Text("${weight.symbol} · ${PortfolioReadModelPresentation.bps(weight.weightBps)}", style = MaterialTheme.typography.bodyMedium)
                Text(weight.mint, style = MaterialTheme.typography.bodySmall, fontFamily = FontFamily.Monospace)
            }
        }
    }
}

@Composable
private fun AmountMap(title: String, amounts: Map<String, String>) {
    Text(title, style = MaterialTheme.typography.titleSmall, modifier = Modifier.semantics { heading() })
    if (amounts.isEmpty()) {
        Text("No rows in this snapshot", style = MaterialTheme.typography.bodyMedium)
    } else {
        amounts.forEach { (mint, amount) ->
            Column(modifier = Modifier.fillMaxWidth().padding(start = 8.dp, top = 3.dp, bottom = 3.dp)) {
                Text(amount, style = MaterialTheme.typography.bodyMedium, fontFamily = FontFamily.Monospace)
                Text(mint, style = MaterialTheme.typography.bodySmall, fontFamily = FontFamily.Monospace)
            }
        }
    }
}

@Composable
private fun FactSection(title: String, content: @Composable ColumnScope.() -> Unit) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            content = {
                Text(title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { heading() })
                content()
            },
        )
    }
}

@Composable
private fun Fact(label: String, value: String, code: Boolean = false) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Text(label, style = MaterialTheme.typography.labelMedium)
        Text(
            value,
            style = MaterialTheme.typography.bodyMedium,
            fontFamily = if (code) FontFamily.Monospace else FontFamily.Default,
        )
    }
}
