package app.pawsitivemileage.ui

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import app.pawsitivemileage.api.generated.models.Vehicle
import app.pawsitivemileage.data.Attachment
import app.pawsitivemileage.data.Vehicles
import app.pawsitivemileage.media.Attachments
import app.pawsitivemileage.ui.components.ConfirmDialog
import app.pawsitivemileage.ui.components.ConflictDialog
import app.pawsitivemileage.ui.components.DecimalKeyboard
import app.pawsitivemileage.ui.components.Field
import app.pawsitivemileage.ui.components.NumberKeyboard
import coil3.compose.AsyncImage
import kotlinx.coroutines.launch
import java.io.File

/** Add a vehicle, or edit/archive one you own (`vehicleId`). Needs a connection. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VehicleFormScreen(vehicleId: String?, vehicles: Vehicles, attachments: Attachments, onDone: (String?) -> Unit) {
    var current by remember { mutableStateOf<Vehicle?>(null) }
    var form by remember { mutableStateOf(VehicleForm()) }
    var photo by remember { mutableStateOf<Attachment?>(null) }
    var loading by remember { mutableStateOf(vehicleId != null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    var conflict by remember { mutableStateOf(false) }
    var confirmArchive by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(vehicleId) {
        if (vehicleId != null) {
            runCatching { vehicles.get(vehicleId) }
                .onSuccess { current = it; form = VehicleForm.of(it) }
                .onFailure { problem = friendlyError(it, OFFLINE_EDIT) }
            loading = false
        }
    }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri: Uri? ->
        uri?.let { scope.launch { runCatching { attachments.import(it) }.onSuccess { photo = it }.onFailure { problem = it.message } } }
    }

    fun save() = scope.launch {
        problem = null
        saving = true
        val existing = current
        val result = runEdit {
            var saved = if (existing == null) {
                vehicles.create(form.toCreate().getOrElse { throw IllegalArgumentException(it.message) })
            } else {
                vehicles.update(existing, form.toUpdate(existing.photoKey).getOrElse { throw IllegalArgumentException(it.message) })
            }
            photo?.let { saved = vehicles.setPhoto(saved, it); File(it.path).delete() }
            current = saved
        }
        saving = false
        when (result) {
            SaveResult.Saved -> onDone(current?.vehicleId)
            SaveResult.Conflict -> conflict = true
            is SaveResult.Problem -> problem = result.message
        }
    }

    Scaffold(topBar = {
        TopAppBar(
            title = { Text(if (vehicleId == null) "Add vehicle" else "Edit vehicle") },
            navigationIcon = { TextButton(onClick = { onDone(null) }) { Text("Cancel") } },
            actions = {
                current?.let { v -> TextButton(onClick = { confirmArchive = true }) { Text(if (v.isArchived) "Unarchive" else "Archive") } }
            },
        )
    }) { padding ->
        if (loading) {
            CircularProgressIndicator(Modifier.padding(padding).padding(32.dp))
            return@Scaffold
        }
        Column(
            Modifier.padding(padding).padding(16.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (vehicleId != null && current == null) {
                problem?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                return@Column
            }
            Field(form.nickname, { form = form.copy(nickname = it) }, "Nickname")
            Field(form.year, { form = form.copy(year = it) }, "Year", NumberKeyboard)
            Field(form.make, { form = form.copy(make = it) }, "Make")
            Field(form.model, { form = form.copy(model = it) }, "Model")
            Field(form.trim, { form = form.copy(trim = it) }, "Trim")
            Field(form.color, { form = form.copy(color = it) }, "Color")
            Field(form.licensePlate, { form = form.copy(licensePlate = it) }, "License plate")
            Field(form.vin, { form = form.copy(vin = it) }, "VIN")
            Field(form.tankSize, { form = form.copy(tankSize = it) }, "Tank size (gallons)", DecimalKeyboard)
            Field(form.fuelType, { form = form.copy(fuelType = it) }, "Fuel type")
            HorizontalDivider()
            Text("Photo", style = MaterialTheme.typography.titleSmall)
            val shown: Any? = photo?.path?.let(::File) ?: current?.photoUrl
            if (shown != null) AsyncImage(shown, "Vehicle photo", contentScale = ContentScale.Crop, modifier = Modifier.fillMaxWidth().height(180.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = {
                    picker.launch(androidx.activity.result.PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                }) { Text(if (shown != null) "Change photo" else "Add photo") }
            }
            problem?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Button(onClick = { save() }, enabled = !saving, modifier = Modifier.fillMaxWidth()) { Text(if (saving) "Saving…" else "Save") }
        }
    }

    if (conflict) ConflictDialog(onReload = { conflict = false; onDone(null) })
    current?.let { v ->
        if (confirmArchive) {
            ConfirmDialog(
                title = if (v.isArchived) "Unarchive ${v.nickname}?" else "Archive ${v.nickname}?",
                text = if (v.isArchived) "It moves back to your garage." else "It's hidden from your garage; its fill-ups and maintenance are kept.",
                confirm = if (v.isArchived) "Unarchive" else "Archive",
                onConfirm = {
                    confirmArchive = false
                    scope.launch {
                        when (val r = runEdit { current = vehicles.setArchived(v, !v.isArchived) }) {
                            SaveResult.Saved -> onDone(v.vehicleId)
                            SaveResult.Conflict -> conflict = true
                            is SaveResult.Problem -> problem = r.message
                        }
                    }
                },
                onDismiss = { confirmArchive = false },
            )
        }
    }
}
