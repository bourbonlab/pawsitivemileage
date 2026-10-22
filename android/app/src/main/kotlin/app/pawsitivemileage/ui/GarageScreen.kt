package app.pawsitivemileage.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.pawsitivemileage.api.ApiClient
import app.pawsitivemileage.api.call

/** A row in the garage: the user's own vehicles and those shared with them */
data class GarageVehicle(val vehicleId: String, val nickname: String, val description: String, val sharedBy: String?)

suspend fun loadGarage(api: ApiClient): List<GarageVehicle> {
    val owned = call { api.vehicles.listVehicles() }.`data`
    val shared = call { api.sharing.listSharedVehicles() }.`data`
    return owned.map { GarageVehicle(it.vehicleId, it.nickname, "${it.year} ${it.make} ${it.model}", null) } +
        shared.map { GarageVehicle(it.vehicle.vehicleId, it.vehicle.nickname, "${it.vehicle.year} ${it.vehicle.make} ${it.vehicle.model}", it.ownerDisplayName) }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GarageScreen(api: ApiClient, onOpen: (GarageVehicle) -> Unit, onSignOut: () -> Unit) {
    var vehicles by remember { mutableStateOf<List<GarageVehicle>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var reload by remember { mutableStateOf(0) }
    LaunchedEffect(reload) {
        error = null
        runCatching { loadGarage(api) }.onSuccess { vehicles = it }.onFailure { error = friendlyError(it, OFFLINE_GARAGE) }
    }
    Scaffold(topBar = {
        TopAppBar(title = { Text("Garage") }, actions = {
            TextButton(onClick = { reload++ }) { Text("Refresh") }
            TextButton(onClick = onSignOut) { Text("Sign out") }
        })
    }) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            val list = vehicles
            when {
                error != null && list == null -> Text(error!!, Modifier.align(Alignment.Center).padding(24.dp))
                list == null -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                list.isEmpty() -> Text("No vehicles yet. Add one at pawsitivemileage.app.", Modifier.align(Alignment.Center).padding(24.dp))
                else -> LazyColumn(contentPadding = PaddingValues(16.dp)) {
                    items(list, key = { it.vehicleId }) { v ->
                        Card(Modifier.fillMaxWidth().padding(vertical = 6.dp).clickable { onOpen(v) }) {
                            Column(Modifier.padding(16.dp)) {
                                Text(v.nickname, style = MaterialTheme.typography.titleMedium)
                                Text(v.description, style = MaterialTheme.typography.bodyMedium)
                                v.sharedBy?.let { Text("Shared by $it", style = MaterialTheme.typography.labelMedium) }
                            }
                        }
                    }
                }
            }
        }
    }
}
