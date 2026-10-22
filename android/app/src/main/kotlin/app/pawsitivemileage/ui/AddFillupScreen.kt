package app.pawsitivemileage.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import app.pawsitivemileage.api.generated.models.FillupCreate
import app.pawsitivemileage.data.FillupRepository
import kotlinx.coroutines.launch
import java.time.LocalDate

/** Form input → FillupCreate, or the first problem to show. Pure, so it is unit-tested. */
fun fillupFromForm(date: String, gallons: String, cost: String, odometer: String, partial: Boolean, notes: String): Result<FillupCreate> {
    val parsedDate = runCatching { LocalDate.parse(date.trim()) }.getOrNull()
        ?: return Result.failure(IllegalArgumentException("Date must be YYYY-MM-DD"))
    val g = Format.parse(gallons)?.takeIf { it > 0 } ?: return Result.failure(IllegalArgumentException("Gallons must be a number above 0"))
    val c = Format.parse(cost)?.takeIf { it > 0 } ?: return Result.failure(IllegalArgumentException("Cost must be a number above 0"))
    val o = Format.parse(odometer)?.takeIf { it > 0 } ?: return Result.failure(IllegalArgumentException("Odometer must be a number above 0"))
    return Result.success(
        FillupCreate(
            date = parsedDate.toString(),
            currencySpent = c,
            gallonsAdded = g,
            odometerReading = o,
            isPartialFill = partial,
            isBusiness = false,
            notes = notes.trim().ifEmpty { null },
        ),
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddFillupScreen(vehicleId: String, repo: FillupRepository, onDone: () -> Unit) {
    var date by remember { mutableStateOf(LocalDate.now().toString()) }
    var gallons by remember { mutableStateOf("") }
    var cost by remember { mutableStateOf("") }
    var odometer by remember { mutableStateOf("") }
    var partial by remember { mutableStateOf(false) }
    var notes by remember { mutableStateOf("") }
    var problem by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val decimal = KeyboardOptions(keyboardType = KeyboardType.Decimal)

    Scaffold(topBar = {
        TopAppBar(title = { Text("Add fill-up") }, navigationIcon = { TextButton(onClick = onDone) { Text("Cancel") } })
    }) { padding ->
        Column(
            Modifier.padding(padding).padding(16.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            OutlinedTextField(date, { date = it }, label = { Text("Date") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(gallons, { gallons = it }, label = { Text("Gallons") }, singleLine = true, keyboardOptions = decimal, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(cost, { cost = it }, label = { Text("Total cost") }, singleLine = true, keyboardOptions = decimal, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(odometer, { odometer = it }, label = { Text("Odometer") }, singleLine = true, keyboardOptions = decimal, modifier = Modifier.fillMaxWidth())
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(partial, { partial = it })
                Text("Partial fill (tank not full)")
            }
            OutlinedTextField(notes, { notes = it }, label = { Text("Notes") }, modifier = Modifier.fillMaxWidth())
            problem?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Text("Saved on this device first, then sent when you're online.", style = MaterialTheme.typography.bodySmall)
            Button(
                onClick = {
                    fillupFromForm(date, gallons, cost, odometer, partial, notes)
                        .onSuccess { body -> scope.launch { repo.add(vehicleId, body); onDone() } }
                        .onFailure { problem = it.message }
                },
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Save") }
        }
    }
}
