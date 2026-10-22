package app.pawsitivemileage.data

import app.pawsitivemileage.api.ApiClient
import app.pawsitivemileage.api.call
import app.pawsitivemileage.api.generated.apis.FillUpsApi
import app.pawsitivemileage.api.generated.apis.MaintenanceApi
import app.pawsitivemileage.api.generated.models.Fillup
import app.pawsitivemileage.api.generated.models.FillupUpdate
import app.pawsitivemileage.api.generated.models.MaintenanceRecord
import app.pawsitivemileage.api.generated.models.MaintenanceSchema
import app.pawsitivemileage.api.generated.models.MaintenanceUpdate
import app.pawsitivemileage.api.generated.models.Reminder
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer

@Serializable
data class FillupPage(val items: List<Fillup>, val nextCursor: String?)

@Serializable
data class MaintenancePage(val items: List<MaintenanceRecord>, val nextCursor: String?)

/**
 * Reading and editing a vehicle's fill-ups and maintenance. Lists are newest first, paged (#26);
 * the first page, reminders and maintenance types are kept on the device for offline viewing.
 * Edits and deletes need a connection and send If-Match (#25), so a record changed elsewhere
 * comes back as a 409 instead of being overwritten.
 */
class Records(private val api: () -> ApiClient, private val snapshots: SnapshotCache? = null) {
    // Records loaded so far, so an edit screen opens with what the list showed
    private val fillups = mutableMapOf<String, Fillup>()
    private val maintenance = mutableMapOf<String, MaintenanceRecord>()

    fun fillup(id: String): Fillup? = fillups[id]

    /** Station names used before on this vehicle, with where: for pre-filling the station field */
    fun stations(vehicleId: String): List<Triple<Double, Double, String>> =
        fillups.values.filter { it.vehicleId == vehicleId }.mapNotNull { f ->
            val name = f.stationName?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
            if (f.locationLat != null && f.locationLng != null) Triple(f.locationLat, f.locationLng, name) else null
        } + maintenance.values.filter { it.vehicleId == vehicleId }.mapNotNull { m ->
            val name = m.stationName?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
            if (m.locationLat != null && m.locationLng != null) Triple(m.locationLat, m.locationLng, name) else null
        }
    fun maintenanceRecord(id: String): MaintenanceRecord? = maintenance[id]

    suspend fun fillupPage(vehicleId: String, cursor: String? = null, limit: Int = 20): Loaded<FillupPage> {
        val fetch: suspend () -> FillupPage = {
            val r = call { api().fillups.listFillups(vehicleId, limit = limit, cursor = cursor, order = FillUpsApi.OrderListFillups.DESC) }
            FillupPage(r.`data`, r.nextCursor)
        }
        return cached(if (cursor == null) "fillups-$vehicleId" else null, FillupPage.serializer(), fetch)
            .also { page -> page.value.items.forEach { fillups[it.fillupId] = it } }
    }

    suspend fun maintenancePage(vehicleId: String, cursor: String? = null, limit: Int = 20): Loaded<MaintenancePage> {
        val fetch: suspend () -> MaintenancePage = {
            val r = call { api().maintenance.listMaintenance(vehicleId, limit = limit, cursor = cursor, order = MaintenanceApi.OrderListMaintenance.DESC) }
            MaintenancePage(r.`data`, r.nextCursor)
        }
        return cached(if (cursor == null) "maintenance-$vehicleId" else null, MaintenancePage.serializer(), fetch)
            .also { page -> page.value.items.forEach { maintenance[it.recordId] = it } }
    }

    suspend fun reminders(vehicleId: String): Loaded<List<Reminder>> =
        cached("reminders-$vehicleId", ListSerializer(Reminder.serializer())) { call { api().maintenance.listReminders(vehicleId) }.`data` }

    suspend fun schemas(vehicleId: String): Loaded<List<MaintenanceSchema>> =
        cached("schemas-$vehicleId", ListSerializer(MaintenanceSchema.serializer())) { call { api().maintenance.listVehicleSchemas(vehicleId) }.`data` }

    suspend fun updateFillup(current: Fillup, update: FillupUpdate): Fillup =
        call { api().fillups.updateFillup(current.vehicleId, current.fillupId, update, ifMatch = etag(current.updatedAt)) }.`data`
            .also { fillups[it.fillupId] = it }

    suspend fun deleteFillup(current: Fillup) {
        call { api().fillups.deleteFillup(current.vehicleId, current.fillupId) }
        fillups.remove(current.fillupId)
    }

    suspend fun updateMaintenance(current: MaintenanceRecord, update: MaintenanceUpdate): MaintenanceRecord =
        call { api().maintenance.updateMaintenance(current.vehicleId, current.recordId, update, ifMatch = etag(current.updatedAt)) }.`data`
            .also { maintenance[it.recordId] = it }

    suspend fun deleteMaintenance(current: MaintenanceRecord) {
        call { api().maintenance.deleteMaintenance(current.vehicleId, current.recordId) }
        maintenance.remove(current.recordId)
    }

    private suspend fun <T> cached(key: String?, serializer: kotlinx.serialization.KSerializer<T>, fetch: suspend () -> T): Loaded<T> =
        if (key != null && snapshots != null) snapshots.load(key, serializer, fetch) else Loaded(fetch())

    companion object {
        /** The ETag the API sends for a record is its updatedAt, quoted */
        fun etag(updatedAt: String) = "\"$updatedAt\""
    }
}
