package app.pawsitivemileage.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.pawsitivemileage.api.ApiClient
import app.pawsitivemileage.api.generated.models.Fillup
import app.pawsitivemileage.api.generated.models.FillupCreate
import app.pawsitivemileage.data.FillupRepository
import app.pawsitivemileage.data.PendingFillup
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VehicleScreen(vehicleId: String, nickname: String, repo: FillupRepository, onAdd: () -> Unit, onBack: () -> Unit) {
    val fillups = remember(vehicleId) { mutableStateListOf<Fillup>() }
    var cursor by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var refresh by remember { mutableStateOf(0) }
    val pending by repo.pending(vehicleId).collectAsState(initial = emptyList())
    val scope = rememberCoroutineScope()

    suspend fun load(next: String?) {
        loading = true
        error = null
        runCatching { repo.page(vehicleId, next) }
            .onSuccess { page ->
                if (next == null) fillups.clear()
                fillups.addAll(page.items)
                cursor = page.nextCursor
            }
            .onFailure { error = it.message ?: "Couldn't load fill-ups" }
        loading = false
    }

    // Reload the first page when entries finish syncing (the queue shrinks)
    LaunchedEffect(vehicleId, refresh, pending.count { it.failure == null }) { load(null) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(nickname) },
                navigationIcon = { TextButton(onClick = onBack) { Text("Back") } },
                actions = { TextButton(onClick = { refresh++ }) { Text("Refresh") } },
            )
        },
        floatingActionButton = { ExtendedFloatingActionButton(onClick = onAdd) { Text("Add fill-up") } },
    ) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (pending.isNotEmpty()) {
                item { Text("On this device", style = MaterialTheme.typography.titleSmall) }
                items(pending, key = { it.id }) { entry -> PendingRow(entry, onDiscard = { scope.launch { repo.discard(entry.id) } }) }
                item { HorizontalDivider(Modifier.padding(vertical = 8.dp)) }
            }
            items(fillups, key = { it.fillupId }) { FillupRow(it) }
            item {
                when {
                    error != null -> Text(error!!, color = MaterialTheme.colorScheme.error)
                    loading -> Text("Loading…")
                    cursor != null -> OutlinedButton(onClick = { scope.launch { load(cursor) } }, Modifier.fillMaxWidth()) { Text("Load more") }
                    fillups.isEmpty() && pending.isEmpty() -> Text("No fill-ups yet.")
                }
            }
        }
    }
}

@Composable
private fun FillupRow(f: Fillup) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(f.date, style = MaterialTheme.typography.titleSmall)
                Text(Format.mpg(f.mpg) + if (f.isPartialFill) " (partial)" else "")
            }
            Text("${Format.miles(f.odometerReading)} · ${Format.gallons(f.gallonsAdded)} · ${Format.money(f.currencySpent)}", style = MaterialTheme.typography.bodyMedium)
            f.stationName?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        }
    }
}

@Composable
private fun PendingRow(entry: PendingFillup, onDiscard: () -> Unit) {
    val body = remember(entry.body) { runCatching { ApiClient.json.decodeFromString(FillupCreate.serializer(), entry.body) }.getOrNull() }
    val failed = entry.failure != null
    Card(
        Modifier.fillMaxWidth(),
        colors = if (failed) CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer) else CardDefaults.cardColors(),
    ) {
        Column(Modifier.padding(12.dp)) {
            Text(body?.date ?: "Fill-up", style = MaterialTheme.typography.titleSmall)
            body?.let { Text("${Format.miles(it.odometerReading)} · ${Format.gallons(it.gallonsAdded)} · ${Format.money(it.currencySpent)}") }
            Text(entry.failure ?: "Waiting to sync", style = MaterialTheme.typography.bodySmall)
            if (failed) TextButton(onClick = onDiscard) { Text("Discard") }
        }
    }
}
