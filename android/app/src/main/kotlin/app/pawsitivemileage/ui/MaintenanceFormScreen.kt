package app.pawsitivemileage.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.pawsitivemileage.api.generated.models.MaintenanceSchema
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

/** Add maintenance (queued, works offline) or edit it (`recordId`; needs a connection) */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MaintenanceFormScreen(
    vehicleId: String,
    recordId: String?,
    records: Records,
    queue: OpQueue,
    attachments: Attachments,
    locations: Locations,
    onDone: () -> Unit,
) {
    val current = remember(recordId) { recordId?.let(records::maintenanceRecord) }
    var form by remember { mutableStateOf(current?.let(MaintenanceForm::of) ?: MaintenanceForm()) }
    var receipt by remember { mutableStateOf(ReceiptState(existingUrl = current?.receiptPhotoUrl)) }
    var schemas by remember { mutableStateOf<List<MaintenanceSchema>>(emptyList()) }
    var problem by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    var conflict by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    if (recordId != null && current == null) {
        LaunchedEffectOnce(onDone)
        return
    }
    LaunchedEffect(vehicleId) { runCatching { records.schemas(vehicleId) }.onSuccess { schemas = it.value } }

    fun save() = scope.launch {
        problem = null
        saving = true
        if (current == null) {
            form.toCreate()
                .onSuccess { queue.addMaintenance(vehicleId, it, receipt.added); onDone() }
                .onFailure { problem = it.message }
        } else {
            val keep = if (receipt.removeExisting) null else current.receiptPhotoKey
            val update = form.toUpdate(keep).getOrElse { problem = it.message; saving = false; return@launch }
            val unchanged = MaintenanceForm.of(current).toUpdate(current.receiptPhotoKey).getOrNull()
            val result = if (update == unchanged) SaveResult.Saved else runEdit { records.updateMaintenance(current, update) }
            receipt.added?.let { queue.attachReceipt(OpKind.MAINTENANCE_RECEIPT, vehicleId, current.recordId, it) }
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
            title = { Text(if (current == null) "Add maintenance" else "Edit maintenance") },
            navigationIcon = { TextButton(onClick = onDone) { Text("Cancel") } },
            actions = { if (current != null) TextButton(onClick = { confirmDelete = true }) { Text("Delete") } },
        )
    }) { padding ->
        Column(
            Modifier.padding(padding).padding(16.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            TypePicker(form.type, schemas) { form = form.copy(type = it) }
            (form.type as? MaintenanceType.Custom)?.let { custom ->
                Field(custom.name, { form = form.copy(type = MaintenanceType.Custom(it)) }, "Custom type")
            }
            Field(form.date, { form = form.copy(date = it) }, "Date (YYYY-MM-DD)")
            Field(form.odometer, { form = form.copy(odometer = it) }, "Odometer", DecimalKeyboard)
            Field(form.cost, { form = form.copy(cost = it) }, "Cost", DecimalKeyboard)
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
            title = "Delete this record?",
            text = "${current.schemaName ?: current.customTypeName ?: "Maintenance"} on ${current.datePerformed} · ${Format.money(current.cost)}",
            confirm = "Delete",
            onConfirm = {
                confirmDelete = false
                scope.launch {
                    when (val r = runEdit { records.deleteMaintenance(current) }) {
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

/** The vehicle's maintenance schedules, plus "Custom…" for anything else */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TypePicker(selected: MaintenanceType?, schemas: List<MaintenanceSchema>, onSelect: (MaintenanceType) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val label = when (selected) {
        is MaintenanceType.Schedule -> selected.name
        is MaintenanceType.Custom -> "Custom…"
        null -> ""
    }
    ExposedDropdownMenuBox(expanded = open, onExpandedChange = { open = it }) {
        OutlinedTextField(
            value = label, onValueChange = {}, readOnly = true, label = { Text("Type") },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(open) },
            modifier = Modifier.fillMaxWidth().menuAnchor(MenuAnchorType.PrimaryNotEditable),
        )
        ExposedDropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            schemas.forEach { s ->
                DropdownMenuItem(text = { Text(s.name) }, onClick = { onSelect(MaintenanceType.Schedule(s.schemaId, s.name)); open = false })
            }
            DropdownMenuItem(text = { Text("Custom…") }, onClick = { onSelect(MaintenanceType.Custom((selected as? MaintenanceType.Custom)?.name.orEmpty())); open = false })
        }
    }
}
