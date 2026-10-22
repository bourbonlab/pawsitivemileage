package app.pawsitivemileage.ui.components

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.core.net.toUri
import app.pawsitivemileage.data.Attachment
import app.pawsitivemileage.location.Locations
import app.pawsitivemileage.location.Place
import app.pawsitivemileage.media.Attachments
import app.pawsitivemileage.ui.PlaceFields
import coil3.compose.AsyncImage
import kotlinx.coroutines.launch
import java.io.File

val DecimalKeyboard = KeyboardOptions(keyboardType = KeyboardType.Decimal)
val NumberKeyboard = KeyboardOptions(keyboardType = KeyboardType.Number)

@Composable
fun Field(value: String, onChange: (String) -> Unit, label: String, keyboard: KeyboardOptions = KeyboardOptions.Default, singleLine: Boolean = true) {
    OutlinedTextField(value, onChange, label = { Text(label) }, singleLine = singleLine, keyboardOptions = keyboard, modifier = Modifier.fillMaxWidth())
}

/**
 * "Use my location": asks for the location permission on first tap, then fills coordinates,
 * address and, when you've been near here before, the station name.
 */
@Composable
fun LocationSection(
    place: PlaceFields,
    onChange: (PlaceFields) -> Unit,
    locations: Locations,
    stationNear: (Place) -> String? = { null },
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }

    fun capture() {
        busy = true
        problem = null
        scope.launch {
            val found = runCatching { locations.current() }.getOrNull()
            busy = false
            if (found == null) {
                problem = "Couldn't get a location. Is location turned on?"
            } else {
                onChange(
                    place.copy(
                        lat = found.lat, lng = found.lng,
                        address = found.address ?: place.address,
                        station = place.station.ifBlank { stationNear(found).orEmpty() },
                    ),
                )
            }
        }
    }

    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        if (granted.values.any { it }) capture() else problem = "Location permission was not given"
    }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Location", style = MaterialTheme.typography.titleSmall)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedButton(enabled = !busy, onClick = {
                val has = listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
                    .any { ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED }
                if (has) capture() else permission.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
            }) { Text(if (place.lat != null) "Update location" else "Use my location") }
            if (busy) CircularProgressIndicator(Modifier.height(24.dp))
            if (place.lat != null && !busy) TextButton(onClick = { onChange(place.copy(lat = null, lng = null, address = "")) }) { Text("Clear") }
        }
        if (place.lat != null) {
            Text(place.address.ifBlank { "%.5f, %.5f".format(place.lat, place.lng) }, style = MaterialTheme.typography.bodySmall)
        }
        problem?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
        Field(place.station, { onChange(place.copy(station = it)) }, "Station or shop")
    }
}

/** What happens to the receipt when the form is saved */
data class ReceiptState(
    /** The receipt already on the record (URL to show), if any */
    val existingUrl: String? = null,
    val removeExisting: Boolean = false,
    /** A new receipt picked or taken on this screen; uploaded with the save (queued if offline) */
    val added: Attachment? = null,
)

/** Camera or file (photo/PDF) receipt picker, with a preview of what will be saved */
@Composable
fun ReceiptSection(state: ReceiptState, onChange: (ReceiptState) -> Unit, attachments: Attachments) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var problem by remember { mutableStateOf<String?>(null) }
    var cameraUri by remember { mutableStateOf<Uri?>(null) }

    fun import(uri: Uri) = scope.launch {
        problem = null
        runCatching { attachments.import(uri) }
            .onSuccess { onChange(state.copy(added = it)) }
            .onFailure { problem = it.message ?: "Couldn't use that file" }
    }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok -> if (ok) cameraUri?.let(::import) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> uri?.let(::import) }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Receipt", style = MaterialTheme.typography.titleSmall)
        val added = state.added
        when {
            added != null -> {
                Preview(added.path.takeIf { added.contentType.startsWith("image/") }?.let { File(it) }, added.name)
                TextButton(onClick = { File(added.path).delete(); onChange(state.copy(added = null)) }) { Text("Don't attach") }
            }
            state.existingUrl != null && !state.removeExisting -> {
                Preview(state.existingUrl.takeUnless { it.endsWith(".pdf", ignoreCase = true) }, "Receipt attached")
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, state.existingUrl.toUri())) }) { Text("View") }
                    TextButton(onClick = { onChange(state.copy(removeExisting = true)) }) { Text("Remove") }
                }
            }
            state.removeExisting -> TextButton(onClick = { onChange(state.copy(removeExisting = false)) }) { Text("Receipt will be removed · Undo") }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { cameraUri = attachments.newCameraUri(); camera.launch(cameraUri!!) }) { Text("Take photo") }
            OutlinedButton(onClick = { picker.launch(arrayOf("image/*", "application/pdf")) }) { Text("Choose file") }
        }
        problem?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
    }
}

@Composable
private fun Preview(model: Any?, caption: String) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(8.dp)) {
            if (model != null) {
                AsyncImage(model = model, contentDescription = caption, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxWidth().height(180.dp))
            }
            Text(caption, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
fun ConfirmDialog(title: String, text: String, confirm: String, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(text) },
        confirmButton = { TextButton(onClick = onConfirm) { Text(confirm) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

/** Shown on a 409: someone else changed the record after it was loaded */
@Composable
fun ConflictDialog(onReload: () -> Unit) {
    AlertDialog(
        onDismissRequest = onReload,
        title = { Text("Changed somewhere else") },
        text = { Text("This record was changed after you opened it, so your edit wasn't saved. Reload to see the latest version, then make your change again.") },
        confirmButton = { TextButton(onClick = onReload) { Text("Reload") } },
    )
}
