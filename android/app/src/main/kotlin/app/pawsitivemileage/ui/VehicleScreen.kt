package app.pawsitivemileage.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.pawsitivemileage.api.ApiClient
import app.pawsitivemileage.api.generated.models.Fillup
import app.pawsitivemileage.api.generated.models.FillupCreate
import app.pawsitivemileage.api.generated.models.MaintenanceCreate
import app.pawsitivemileage.api.generated.models.MaintenanceRecord
import app.pawsitivemileage.api.generated.models.Reminder
import app.pawsitivemileage.data.GarageVehicle
import app.pawsitivemileage.data.OpKind
import app.pawsitivemileage.data.OpQueue
import app.pawsitivemileage.data.PendingOp
import app.pawsitivemileage.data.Records
import kotlinx.coroutines.launch

/** A vehicle: fill-ups and maintenance tabs, each newest first, with entries queued on the device */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VehicleScreen(
    vehicle: GarageVehicle,
    records: Records,
    queue: OpQueue,
    onAddFillup: () -> Unit,
    onEditFillup: (Fillup) -> Unit,
    onAddMaintenance: () -> Unit,
    onEditMaintenance: (MaintenanceRecord) -> Unit,
    onEditVehicle: () -> Unit,
    onBack: () -> Unit,
) {
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var refresh by remember { mutableIntStateOf(0) }
    val pending by queue.pending(vehicle.vehicleId).collectAsState(initial = emptyList())
    val scope = rememberCoroutineScope()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(vehicle.nickname) },
                navigationIcon = { TextButton(onClick = onBack) { Text("Back") } },
                actions = {
                    if (vehicle.isOwner) TextButton(onClick = onEditVehicle) { Text("Edit") }
                    TextButton(onClick = { refresh++ }) { Text("Refresh") }
                },
            )
        },
        floatingActionButton = {
            when {
                tab == 0 && vehicle.canEditFuel -> ExtendedFloatingActionButton(onClick = onAddFillup) { Text("Add fill-up") }
                tab == 1 && vehicle.canEditMaintenance -> ExtendedFloatingActionButton(onClick = onAddMaintenance) { Text("Add maintenance") }
            }
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            PrimaryTabRow(selectedTabIndex = tab) {
                Tab(selected = tab == 0, onClick = { tab = 0 }, text = { Text("Fill-ups") })
                Tab(selected = tab == 1, onClick = { tab = 1 }, text = { Text("Maintenance") })
            }
            val discard: (PendingOp) -> Unit = { op -> scope.launch { queue.discard(op.id) } }
            if (tab == 0) {
                FillupsTab(vehicle, records, pending.filter { it.kind == OpKind.FILLUP_CREATE || it.kind == OpKind.FILLUP_RECEIPT }, refresh, onEditFillup, discard)
            } else {
                MaintenanceTab(vehicle, records, pending.filter { it.kind == OpKind.MAINTENANCE_CREATE || it.kind == OpKind.MAINTENANCE_RECEIPT }, refresh, onEditMaintenance, discard)
            }
        }
    }
}

/** Shared paging state for one tab: first page (cached offline), then "Load more" */
private class Paged<T> {
    val items = mutableStateListOf<T>()
    var cursor by mutableStateOf<String?>(null)
    var loading by mutableStateOf(true)
    var error by mutableStateOf<String?>(null)
    var offlineSince by mutableStateOf<Long?>(null)

    suspend fun load(first: Boolean, fetch: suspend (String?) -> app.pawsitivemileage.data.Loaded<Pair<List<T>, String?>>) {
        loading = true
        error = null
        runCatching { fetch(if (first) null else cursor) }
            .onSuccess { loaded ->
                if (first) items.clear()
                items.addAll(loaded.value.first)
                offlineSince = loaded.offlineSince
                cursor = if (loaded.offlineSince == null) loaded.value.second else null
            }
            .onFailure { error = friendlyError(it, OFFLINE_FILLUPS) }
        loading = false
    }
}

@Composable
private fun FillupsTab(
    vehicle: GarageVehicle,
    records: Records,
    pending: List<PendingOp>,
    refresh: Int,
    onEdit: (Fillup) -> Unit,
    onDiscard: (PendingOp) -> Unit,
) {
    val paged = remember(vehicle.vehicleId) { Paged<Fillup>() }
    val scope = rememberCoroutineScope()
    val fetch: suspend (String?) -> app.pawsitivemileage.data.Loaded<Pair<List<Fillup>, String?>> = { cursor ->
        records.fillupPage(vehicle.vehicleId, cursor).let { app.pawsitivemileage.data.Loaded(it.value.items to it.value.nextCursor, it.offlineSince) }
    }
    // Reload when queued entries finish syncing (the queue shrinks)
    LaunchedEffect(vehicle.vehicleId, refresh, pending.count { it.failure == null }) { paged.load(true, fetch) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        pendingSection(pending, onDiscard)
        paged.offlineSince?.let { item { Text(Format.offline(it), style = MaterialTheme.typography.labelMedium) } }
        items(paged.items, key = { it.fillupId }) { f ->
            Card(Modifier.fillMaxWidth().clickable(enabled = vehicle.canEditFuel) { onEdit(f) }) {
                Column(Modifier.padding(12.dp)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(f.date, style = MaterialTheme.typography.titleSmall)
                        Text(Format.mpg(f.mpg) + if (f.isPartialFill) " (partial)" else "")
                    }
                    Text("${Format.miles(f.odometerReading)} · ${Format.gallons(f.gallonsAdded)} · ${Format.money(f.currencySpent)}", style = MaterialTheme.typography.bodyMedium)
                    listOfNotNull(f.stationName, if (f.receiptPhotoKey != null) "Receipt" else null, if (f.isBusiness) "Business" else null)
                        .takeIf { it.isNotEmpty() }?.let { Text(it.joinToString(" · "), style = MaterialTheme.typography.bodySmall) }
                }
            }
        }
        footer(paged, emptyText = "No fill-ups yet.", hasPending = pending.isNotEmpty()) { scope.launch { paged.load(false, fetch) } }
    }
}

@Composable
private fun MaintenanceTab(
    vehicle: GarageVehicle,
    records: Records,
    pending: List<PendingOp>,
    refresh: Int,
    onEdit: (MaintenanceRecord) -> Unit,
    onDiscard: (PendingOp) -> Unit,
) {
    val paged = remember(vehicle.vehicleId) { Paged<MaintenanceRecord>() }
    var reminders by remember { mutableStateOf<List<Reminder>>(emptyList()) }
    val scope = rememberCoroutineScope()
    val fetch: suspend (String?) -> app.pawsitivemileage.data.Loaded<Pair<List<MaintenanceRecord>, String?>> = { cursor ->
        records.maintenancePage(vehicle.vehicleId, cursor).let { app.pawsitivemileage.data.Loaded(it.value.items to it.value.nextCursor, it.offlineSince) }
    }
    LaunchedEffect(vehicle.vehicleId, refresh, pending.count { it.failure == null }) {
        paged.load(true, fetch)
        runCatching { records.reminders(vehicle.vehicleId) }.onSuccess { reminders = it.value }
    }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (reminders.isNotEmpty()) item { RemindersCard(reminders) }
        pendingSection(pending, onDiscard)
        paged.offlineSince?.let { item { Text(Format.offline(it), style = MaterialTheme.typography.labelMedium) } }
        items(paged.items, key = { it.recordId }) { m ->
            Card(Modifier.fillMaxWidth().clickable(enabled = vehicle.canEditMaintenance) { onEdit(m) }) {
                Column(Modifier.padding(12.dp)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(m.schemaName ?: m.customTypeName ?: "Maintenance", style = MaterialTheme.typography.titleSmall)
                        Text(Format.money(m.cost))
                    }
                    Text("${m.datePerformed} · ${Format.miles(m.odometerAtService)}", style = MaterialTheme.typography.bodyMedium)
                    listOfNotNull(m.stationName, if (m.receiptPhotoKey != null) "Receipt" else null)
                        .takeIf { it.isNotEmpty() }?.let { Text(it.joinToString(" · "), style = MaterialTheme.typography.bodySmall) }
                }
            }
        }
        footer(paged, emptyText = "No maintenance yet.", hasPending = pending.isNotEmpty()) { scope.launch { paged.load(false, fetch) } }
    }
}

@Composable
private fun RemindersCard(reminders: List<Reminder>) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.tertiaryContainer), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("Coming up", style = MaterialTheme.typography.titleSmall)
            reminders.forEach { r -> Text("${r.schemaName}: ${reminderText(r)}", style = MaterialTheme.typography.bodyMedium) }
        }
    }
}

/** "overdue by 300 mi", "in 12 days", or both */
fun reminderText(r: Reminder): String {
    val parts = listOfNotNull(
        r.mileageRemaining?.let { if (it < 0) "${Format.miles(-it)} overdue" else "in ${Format.miles(it)}" },
        r.daysRemaining?.let { val d = it.toLong(); if (d < 0) "${-d} days overdue" else "in $d days" },
    )
    return parts.joinToString(", ").ifEmpty { if (r.isOverdue) "overdue" else "due soon" }
}

private fun LazyListScope.pendingSection(pending: List<PendingOp>, onDiscard: (PendingOp) -> Unit) {
    if (pending.isEmpty()) return
    item { Text("On this device", style = MaterialTheme.typography.titleSmall) }
    items(pending, key = { it.id }) { op -> PendingRow(op) { onDiscard(op) } }
    item { HorizontalDivider(Modifier.padding(vertical = 8.dp)) }
}

private fun LazyListScope.footer(paged: Paged<*>, emptyText: String, hasPending: Boolean, onMore: () -> Unit) {
    item {
        when {
            paged.error != null -> Text(paged.error!!, color = MaterialTheme.colorScheme.error)
            paged.loading -> Text("Loading…")
            paged.cursor != null -> OutlinedButton(onClick = onMore, Modifier.fillMaxWidth()) { Text("Load more") }
            paged.items.isEmpty() && !hasPending -> Text(emptyText)
        }
    }
}

/** What a queued entry is, in words */
fun describePending(op: PendingOp): String = when (op.kind) {
    OpKind.FILLUP_CREATE -> runCatching { ApiClient.json.decodeFromString(FillupCreate.serializer(), op.body) }.getOrNull()
        ?.let { "${it.date} · ${Format.miles(it.odometerReading)} · ${Format.gallons(it.gallonsAdded)} · ${Format.money(it.currencySpent)}" } ?: "Fill-up"
    OpKind.MAINTENANCE_CREATE -> runCatching { ApiClient.json.decodeFromString(MaintenanceCreate.serializer(), op.body) }.getOrNull()
        ?.let { "${it.customTypeName ?: "Maintenance"} · ${it.datePerformed} · ${Format.money(it.cost)}" } ?: "Maintenance"
    OpKind.FILLUP_RECEIPT -> "Receipt for a fill-up"
    OpKind.MAINTENANCE_RECEIPT -> "Receipt for a maintenance record"
} + if (op.attachmentPath != null && (op.kind == OpKind.FILLUP_CREATE || op.kind == OpKind.MAINTENANCE_CREATE)) " · with receipt" else ""

@Composable
private fun PendingRow(op: PendingOp, onDiscard: () -> Unit) {
    val failed = op.failure != null
    Card(
        Modifier.fillMaxWidth(),
        colors = if (failed) CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer) else CardDefaults.cardColors(),
    ) {
        Column(Modifier.padding(12.dp)) {
            Text(describePending(op), style = MaterialTheme.typography.bodyMedium)
            Text(op.failure ?: "Waiting to sync", style = MaterialTheme.typography.bodySmall)
            if (failed) TextButton(onClick = onDiscard) { Text("Discard") }
        }
    }
}
