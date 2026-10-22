package app.pawsitivemileage.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.pawsitivemileage.data.OpKind
import app.pawsitivemileage.data.OpQueue
import app.pawsitivemileage.data.Records
import app.pawsitivemileage.location.Locations
import app.pawsitivemileage.location.nearbyStationName
import app.pawsitivemileage.media.Attachments
import app.pawsitivemileage.ui.components.ConfirmDialog
import app.pawsitivemileage.ui.components.ConflictDialog
import app.pawsitivemileage.ui.components.DecimalKeyboard
import app.pawsitivemileage.ui.components.Field
import app.pawsitivemileage.ui.components.LocationSection
import app.pawsitivemileage.ui.components.ReceiptSection
import app.pawsitivemileage.ui.components.ReceiptState
import kotlinx.coroutines.launch

/** Add a fill-up (queued, works offline) or edit one (`fillupId`; needs a connection) */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FillupFormScreen(
    vehicleId: String,
    fillupId: String?,
    records: Records,
    queue: OpQueue,
    attachments: Attachments,
    locations: Locations,
    onDone: () -> Unit,
) {
    val current = remember(fillupId) { fillupId?.let(records::fillup) }
    var form by remember { mutableStateOf(current?.let(FillupForm::of) ?: FillupForm()) }
    var receipt by remember { mutableStateOf(ReceiptState(existingUrl = current?.receiptPhotoUrl)) }
    var problem by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    var conflict by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    if (fillupId != null && current == null) {
        // Opened after the app was restarted: the list reloads it
        LaunchedEffectOnce(onDone)
        return
    }

    fun save() = scope.launch {
        problem = null
        saving = true
        if (current == null) {
            form.toCreate()
                .onSuccess { queue.addFillup(vehicleId, it, receipt.added); onDone() }
                .onFailure { problem = it.message }
        } else {
            val keep = if (receipt.removeExisting) null else current.receiptPhotoKey
            val update = form.toUpdate(keep).getOrElse { problem = it.message; saving = false; return@launch }
            val unchanged = FillupForm.of(current).toUpdate(current.receiptPhotoKey).getOrNull()
            val result = if (update == unchanged) SaveResult.Saved else runEdit { records.updateFillup(current, update) }
            // A new receipt is queued either way: it's attached when there's a connection
            receipt.added?.let { queue.attachReceipt(OpKind.FILLUP_RECEIPT, vehicleId, current.fillupId, it) }
            when (result) {
                SaveResult.Saved -> onDone()
                SaveResult.Conflict -> conflict = true
                is SaveResult.Problem -> problem = result.message + if (receipt.added != null) " The new receipt will be attached when you're online." else ""
            }
        }
        saving = false
    }

    Scaffold(topBar = {
        TopAppBar(
            title = { Text(if (current == null) "Add fill-up" else "Edit fill-up") },
            navigationIcon = { TextButton(onClick = onDone) { Text("Cancel") } },
            actions = { if (current != null) TextButton(onClick = { confirmDelete = true }) { Text("Delete") } },
        )
    }) { padding ->
        Column(
            Modifier.padding(padding).padding(16.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Field(form.date, { form = form.copy(date = it) }, "Date (YYYY-MM-DD)")
            Field(form.gallons, { form = form.copy(gallons = it) }, "Gallons", DecimalKeyboard)
            Field(form.cost, { form = form.copy(cost = it) }, "Total cost", DecimalKeyboard)
            Field(form.odometer, { form = form.copy(odometer = it) }, "Odometer", DecimalKeyboard)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(form.partial, { form = form.copy(partial = it) })
                Text("Partial fill (tank not full)")
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(form.business, { form = form.copy(business = it) })
                Text("Business trip")
            }
            Field(form.notes, { form = form.copy(notes = it) }, "Notes", singleLine = false)
            HorizontalDivider()
            LocationSection(form.place, { form = form.copy(place = it) }, locations) { here ->
                nearbyStationName(here.lat, here.lng, records.stations(vehicleId))
            }
            HorizontalDivider()
            ReceiptSection(receipt, { receipt = it }, attachments)
            problem?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            if (current == null) Text("Saved on this device first, then sent when you're online.", style = MaterialTheme.typography.bodySmall)
            Button(onClick = { save() }, enabled = !saving, modifier = Modifier.fillMaxWidth()) { Text(if (saving) "Saving…" else "Save") }
        }
    }

    if (conflict) ConflictDialog(onReload = { conflict = false; onDone() })
    if (confirmDelete && current != null) {
        ConfirmDialog(
            title = "Delete this fill-up?",
            text = "${current.date} · ${Format.gallons(current.gallonsAdded)} · ${Format.money(current.currencySpent)}. Metrics for later fill-ups are recalculated.",
            confirm = "Delete",
            onConfirm = {
                confirmDelete = false
                scope.launch {
                    when (val r = runEdit { records.deleteFillup(current) }) {
                        SaveResult.Saved -> onDone()
                        SaveResult.Conflict -> conflict = true
                        is SaveResult.Problem -> problem = r.message
                    }
                }
            },
            onDismiss = { confirmDelete = false },
        )
    }
}

@Composable
internal fun LaunchedEffectOnce(block: () -> Unit) {
    androidx.compose.runtime.LaunchedEffect(Unit) { block() }
}
