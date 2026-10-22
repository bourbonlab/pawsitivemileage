package app.pawsitivemileage.data

import app.pawsitivemileage.api.ApiClient
import app.pawsitivemileage.api.call
import app.pawsitivemileage.api.generated.apis.VehiclesApi
import app.pawsitivemileage.api.generated.models.UploadType
import app.pawsitivemileage.api.generated.models.Vehicle
import app.pawsitivemileage.api.generated.models.VehicleArchive
import app.pawsitivemileage.api.generated.models.VehicleCreate
import app.pawsitivemileage.api.generated.models.VehicleUpdate
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import java.util.UUID

/** A row in the garage: the user's own vehicles and those shared with them */
@Serializable
data class GarageVehicle(
    val vehicleId: String,
    val nickname: String,
    val description: String,
    /** Who shared it; null for your own vehicles */
    val sharedBy: String? = null,
    /** readonly | fuel | maintenance | full for shared vehicles; null for your own */
    val permission: String? = null,
    val isArchived: Boolean = false,
    val photoUrl: String? = null,
) {
    val isOwner get() = permission == null
    /** Fill-ups: owners and fuel/full shares ("maintenance" is legacy and behaves like fuel) */
    val canEditFuel get() = isOwner || permission in setOf("fuel", "maintenance", "full")
    val canEditMaintenance get() = canEditFuel
}

/**
 * The garage and vehicle changes. The garage (with archived vehicles) is kept on the device for
 * offline viewing; adding and editing vehicles needs a connection.
 */
class Vehicles(private val api: () -> ApiClient, private val uploader: Uploader, private val snapshots: SnapshotCache? = null) {
    suspend fun garage(): Loaded<List<GarageVehicle>> {
        val fetch: suspend () -> List<GarageVehicle> = {
            val owned = call { api().vehicles.listVehicles(VehiclesApi.StatusListVehicles.ALL) }.`data`
            val shared = call { api().sharing.listSharedVehicles() }.`data`
            owned.map { GarageVehicle(it.vehicleId, it.nickname, describe(it.year, it.make, it.model), isArchived = it.isArchived, photoUrl = it.photoUrl) } +
                shared.map { s ->
                    GarageVehicle(s.vehicle.vehicleId, s.vehicle.nickname, describe(s.vehicle.year, s.vehicle.make, s.vehicle.model), s.ownerDisplayName, s.permission.value, photoUrl = s.vehicle.photoUrl)
                }
        }
        return if (snapshots != null) snapshots.load("garage", ListSerializer(GarageVehicle.serializer()), fetch) else Loaded(fetch())
    }

    suspend fun get(vehicleId: String): Vehicle = call { api().vehicles.getVehicle(vehicleId) }.`data`

    suspend fun create(body: VehicleCreate): Vehicle =
        call { api().vehicles.createVehicle(body, idempotencyKey = UUID.randomUUID().toString()) }.`data`

    suspend fun update(current: Vehicle, update: VehicleUpdate): Vehicle =
        call { api().vehicles.updateVehicle(current.vehicleId, update, ifMatch = Records.etag(current.updatedAt)) }.`data`

    suspend fun setArchived(current: Vehicle, archived: Boolean): Vehicle =
        call { api().vehicles.archiveVehicle(current.vehicleId, VehicleArchive(archived), ifMatch = Records.etag(current.updatedAt)) }.`data`

    /** Upload a new vehicle photo and set it (owner only; needs a connection) */
    suspend fun setPhoto(current: Vehicle, photo: Attachment): Vehicle {
        val key = uploader.upload(current.vehicleId, UploadType.VEHICLE_PHOTO, photo)
        return update(current, vehicleUpdateFrom(current).copy(photoKey = key))
    }

    companion object {
        fun describe(year: Int, make: String, model: String) = "$year $make $model"

        /** An update that keeps every field as it is (the base for edits, since nulls clear fields) */
        fun vehicleUpdateFrom(v: Vehicle) = VehicleUpdate(
            nickname = v.nickname, make = v.make, model = v.model, year = v.year, trim = v.trim, color = v.color,
            vin = v.vin, licensePlate = v.licensePlate, tankSize = v.tankSize, fuelType = v.fuelType, photoKey = v.photoKey,
        )
    }
}
