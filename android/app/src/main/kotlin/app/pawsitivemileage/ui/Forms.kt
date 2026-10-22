package app.pawsitivemileage.ui

import app.pawsitivemileage.api.generated.models.Fillup
import app.pawsitivemileage.api.generated.models.FillupCreate
import app.pawsitivemileage.api.generated.models.FillupUpdate
import app.pawsitivemileage.api.generated.models.MaintenanceCreate
import app.pawsitivemileage.api.generated.models.MaintenanceRecord
import app.pawsitivemileage.api.generated.models.MaintenanceUpdate
import app.pawsitivemileage.api.generated.models.Vehicle
import app.pawsitivemileage.api.generated.models.VehicleCreate
import app.pawsitivemileage.api.generated.models.VehicleUpdate
import java.time.LocalDate
import java.util.Locale

/*
 * Form state ↔ API bodies, kept free of Android so it is unit-tested. Each check returns the
 * first problem to show. Edits send the whole form: on an update, null clears a field.
 */

/** Where a record was: GPS coordinates, the geocoded address and the station name */
data class PlaceFields(val lat: Double? = null, val lng: Double? = null, val address: String = "", val station: String = "")

private fun text(s: String) = s.trim().ifEmpty { null }
private fun date(s: String) = runCatching { LocalDate.parse(s.trim()).toString() }.getOrNull()
private fun positive(s: String) = Format.parse(s)?.takeIf { it > 0 }
private fun nonNegative(s: String) = Format.parse(s)?.takeIf { it >= 0 }
private fun shown(d: Double?) = d?.let { if (it % 1.0 == 0.0) it.toLong().toString() else it.toString() }.orEmpty()

data class FillupForm(
    val date: String = LocalDate.now().toString(),
    val gallons: String = "",
    val cost: String = "",
    val odometer: String = "",
    val partial: Boolean = false,
    val business: Boolean = false,
    val notes: String = "",
    val place: PlaceFields = PlaceFields(),
) {
    private data class Valid(val date: String, val gallons: Double, val cost: Double, val odometer: Double)

    private fun validate(): Result<Valid> {
        val d = date(date) ?: return Result.failure(IllegalArgumentException("Date must be YYYY-MM-DD"))
        val g = positive(gallons) ?: return Result.failure(IllegalArgumentException("Gallons must be a number above 0"))
        val c = positive(cost) ?: return Result.failure(IllegalArgumentException("Cost must be a number above 0"))
        val o = positive(odometer) ?: return Result.failure(IllegalArgumentException("Odometer must be a number above 0"))
        return Result.success(Valid(d, g, c, o))
    }

    fun toCreate(): Result<FillupCreate> = validate().map { v ->
        FillupCreate(
            date = v.date, currencySpent = v.cost, gallonsAdded = v.gallons, odometerReading = v.odometer,
            isPartialFill = partial, isBusiness = business, notes = text(notes),
            locationLat = place.lat, locationLng = place.lng, address = text(place.address), stationName = text(place.station),
        )
    }

    /** `receiptKey`: the receipt to keep (null removes it) */
    fun toUpdate(receiptKey: String?): Result<FillupUpdate> = validate().map { v ->
        FillupUpdate(
            date = v.date, currencySpent = v.cost, gallonsAdded = v.gallons, odometerReading = v.odometer,
            isPartialFill = partial, isBusiness = business, notes = text(notes),
            locationLat = place.lat, locationLng = place.lng, address = text(place.address), stationName = text(place.station),
            receiptPhotoKey = receiptKey,
        )
    }

    companion object {
        fun of(f: Fillup) = FillupForm(
            date = f.date, gallons = shown(f.gallonsAdded), cost = "%.2f".format(Locale.US, f.currencySpent), odometer = shown(f.odometerReading),
            partial = f.isPartialFill, business = f.isBusiness, notes = f.notes.orEmpty(),
            place = PlaceFields(f.locationLat, f.locationLng, f.address.orEmpty(), f.stationName.orEmpty()),
        )
    }
}

/** A maintenance type: one of the vehicle's schedules, or a custom name */
sealed interface MaintenanceType {
    data class Schedule(val schemaId: String, val name: String) : MaintenanceType
    data class Custom(val name: String) : MaintenanceType
}

data class MaintenanceForm(
    val type: MaintenanceType? = null,
    val date: String = LocalDate.now().toString(),
    val odometer: String = "",
    val cost: String = "",
    val notes: String = "",
    val place: PlaceFields = PlaceFields(),
) {
    private data class Valid(val schemaId: String?, val customName: String?, val date: String, val odometer: Double, val cost: Double)

    private fun validate(): Result<Valid> {
        val (schemaId, custom) = when (val t = type) {
            is MaintenanceType.Schedule -> t.schemaId to null
            is MaintenanceType.Custom -> null to (text(t.name) ?: return Result.failure(IllegalArgumentException("Name the custom maintenance type")))
            null -> return Result.failure(IllegalArgumentException("Choose a maintenance type"))
        }
        val d = date(date) ?: return Result.failure(IllegalArgumentException("Date must be YYYY-MM-DD"))
        val o = nonNegative(odometer) ?: return Result.failure(IllegalArgumentException("Odometer must be a number"))
        val c = nonNegative(cost) ?: return Result.failure(IllegalArgumentException("Cost must be a number (0 is fine)"))
        return Result.success(Valid(schemaId, custom, d, o, c))
    }

    fun toCreate(): Result<MaintenanceCreate> = validate().map { v ->
        MaintenanceCreate(
            datePerformed = v.date, odometerAtService = v.odometer, cost = v.cost, schemaId = v.schemaId, customTypeName = v.customName,
            notes = text(notes), locationLat = place.lat, locationLng = place.lng, address = text(place.address), stationName = text(place.station),
        )
    }

    fun toUpdate(receiptKey: String?): Result<MaintenanceUpdate> = validate().map { v ->
        MaintenanceUpdate(
            schemaId = v.schemaId, customTypeName = v.customName, datePerformed = v.date, odometerAtService = v.odometer, cost = v.cost,
            notes = text(notes), locationLat = place.lat, locationLng = place.lng, address = text(place.address), stationName = text(place.station),
            receiptPhotoKey = receiptKey,
        )
    }

    companion object {
        fun of(r: MaintenanceRecord) = MaintenanceForm(
            type = r.schemaId?.let { MaintenanceType.Schedule(it, r.schemaName ?: "Maintenance") } ?: MaintenanceType.Custom(r.customTypeName.orEmpty()),
            date = r.datePerformed, odometer = shown(r.odometerAtService), cost = "%.2f".format(Locale.US, r.cost), notes = r.notes.orEmpty(),
            place = PlaceFields(r.locationLat, r.locationLng, r.address.orEmpty(), r.stationName.orEmpty()),
        )
    }
}

data class VehicleForm(
    val nickname: String = "",
    val year: String = "",
    val make: String = "",
    val model: String = "",
    val trim: String = "",
    val color: String = "",
    val vin: String = "",
    val licensePlate: String = "",
    val tankSize: String = "",
    val fuelType: String = "",
) {
    private fun problem(): String? {
        if (text(nickname) == null) return "Give the vehicle a nickname"
        val y = year.trim().toIntOrNull()
        val maxYear = LocalDate.now().year + 2
        if (y == null || y < 1900 || y > maxYear) return "Year must be between 1900 and $maxYear"
        if (text(make) == null) return "Make is required"
        if (text(model) == null) return "Model is required"
        if (tankSize.isNotBlank() && (Format.parse(tankSize) ?: 0.0) < 0.1) return "Tank size must be a number (gallons)"
        return null
    }

    fun toCreate(): Result<VehicleCreate> = problem()?.let { Result.failure(IllegalArgumentException(it)) } ?: Result.success(
        VehicleCreate(
            nickname = nickname.trim(), make = make.trim(), model = model.trim(), year = year.trim().toInt(),
            trim = text(trim), color = text(color), vin = text(vin), licensePlate = text(licensePlate),
            tankSize = text(tankSize)?.let(Format::parse), fuelType = text(fuelType),
        ),
    )

    fun toUpdate(photoKey: String?): Result<VehicleUpdate> = toCreate().map { c ->
        VehicleUpdate(
            nickname = c.nickname, make = c.make, model = c.model, year = c.year, trim = c.trim, color = c.color, vin = c.vin,
            licensePlate = c.licensePlate, tankSize = c.tankSize, fuelType = c.fuelType, photoKey = photoKey,
        )
    }

    companion object {
        fun of(v: Vehicle) = VehicleForm(
            v.nickname, v.year.toString(), v.make, v.model, v.trim.orEmpty(), v.color.orEmpty(), v.vin.orEmpty(),
            v.licensePlate.orEmpty(), v.tankSize?.let(::shown).orEmpty(), v.fuelType.orEmpty(),
        )
    }
}
