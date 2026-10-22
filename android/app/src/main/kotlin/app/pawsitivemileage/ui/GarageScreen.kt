package app.pawsitivemileage.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import app.pawsitivemileage.data.GarageVehicle
import app.pawsitivemileage.data.Vehicles
import coil3.compose.AsyncImage

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GarageScreen(vehicles: Vehicles, onOpen: (GarageVehicle) -> Unit, onAddVehicle: () -> Unit, onAccount: () -> Unit) {
    var garage by remember { mutableStateOf<List<GarageVehicle>?>(null) }
    var offlineSince by remember { mutableStateOf<Long?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    var showArchived by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(reload) {
        error = null
        runCatching { vehicles.garage() }
            .onSuccess { garage = it.value; offlineSince = it.offlineSince }
            .onFailure { error = friendlyError(it, OFFLINE_GARAGE) }
    }
    Scaffold(
        topBar = {
            TopAppBar(title = { Text("Garage") }, actions = {
                TextButton(onClick = { reload++ }) { Text("Refresh") }
                TextButton(onClick = onAccount) { Text("Account") }
            })
        },
        floatingActionButton = { ExtendedFloatingActionButton(onClick = onAddVehicle) { Text("Add vehicle") } },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            val all = garage
            val archivedCount = all?.count { it.isArchived } ?: 0
            val list = all?.filter { showArchived || !it.isArchived }
            when {
                error != null && list == null -> Text(error!!, Modifier.align(Alignment.Center).padding(24.dp))
                list == null -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                list.isEmpty() && archivedCount == 0 -> Text("No vehicles yet. Add your first one.", Modifier.align(Alignment.Center).padding(24.dp))
                else -> LazyColumn(contentPadding = PaddingValues(16.dp)) {
                    offlineSince?.let { item { Text(Format.offline(it), style = MaterialTheme.typography.labelMedium) } }
                    items(list, key = { it.vehicleId }) { v -> VehicleCard(v) { onOpen(v) } }
                    if (archivedCount > 0) item {
                        TextButton(onClick = { showArchived = !showArchived }) {
                            Text(if (showArchived) "Hide archived" else "Show archived ($archivedCount)")
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun VehicleCard(v: GarageVehicle, onClick: () -> Unit) {
    Card(Modifier.fillMaxWidth().padding(vertical = 6.dp).clickable(onClick = onClick)) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            if (v.photoUrl != null) {
                AsyncImage(v.photoUrl, null, contentScale = ContentScale.Crop, modifier = Modifier.size(64.dp).clip(RoundedCornerShape(8.dp)))
                Spacer(Modifier.width(12.dp))
            }
            Column {
                Text(v.nickname, style = MaterialTheme.typography.titleMedium)
                Text(v.description, style = MaterialTheme.typography.bodyMedium)
                v.sharedBy?.let { Text("Shared by $it", style = MaterialTheme.typography.labelMedium) }
                if (v.isArchived) Text("Archived", style = MaterialTheme.typography.labelMedium)
            }
        }
    }
}
