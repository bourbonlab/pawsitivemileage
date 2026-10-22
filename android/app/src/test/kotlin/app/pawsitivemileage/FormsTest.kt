package app.pawsitivemileage

import app.pawsitivemileage.api.generated.models.FillupCreate
import app.pawsitivemileage.api.generated.models.Reminder
import app.pawsitivemileage.location.distanceMeters
import app.pawsitivemileage.location.nearbyStationName
import app.pawsitivemileage.media.fitWithin
import app.pawsitivemileage.media.uploadTypeFor
import app.pawsitivemileage.ui.FillupForm
import app.pawsitivemileage.ui.MaintenanceForm
import app.pawsitivemileage.ui.MaintenanceType
import app.pawsitivemileage.ui.PlaceFields
import app.pawsitivemileage.ui.VehicleForm
import app.pawsitivemileage.ui.reminderText
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FormsTest {
    @Test
    fun `fill-up form parses typed values, includes location, reports the first problem`() {
        val form = FillupForm("2026-10-21", "12.4", "$41.20", "52,310", partial = true, notes = "  ", place = PlaceFields(42.1, -87.9, "1 Main St", "Shell"))
        assertEquals(
            FillupCreate("2026-10-21", 41.2, 12.4, 52310.0, isPartialFill = true, isBusiness = false, notes = null, locationLat = 42.1, locationLng = -87.9, address = "1 Main St", stationName = "Shell"),
            form.toCreate().getOrThrow(),
        )
        assertEquals("Date must be YYYY-MM-DD", form.copy(date = "10/21/2026").toCreate().exceptionOrNull()?.message)
        assertEquals("Gallons must be a number above 0", form.copy(gallons = "0").toCreate().exceptionOrNull()?.message)
        assertEquals("Cost must be a number above 0", form.copy(cost = "ten").toCreate().exceptionOrNull()?.message)
    }

    @Test
    fun `fill-up edits round-trip, clear emptied fields, and keep or remove the receipt`() {
        val f = ApiClientTestData.fillup().copy(stationName = "Shell", receiptPhotoKey = "k", notes = "n")
        val form = FillupForm.of(f)
        assertEquals("41.20", form.cost)
        assertEquals("52310", form.odometer)
        val kept = form.toUpdate("k").getOrThrow()
        assertEquals("k", kept.receiptPhotoKey)
        assertEquals("Shell", kept.stationName)
        val cleared = form.copy(notes = "", place = form.place.copy(station = "")).toUpdate(null).getOrThrow()
        assertNull(cleared.notes)
        assertNull(cleared.stationName)
        assertNull(cleared.receiptPhotoKey)
    }

    @Test
    fun `maintenance needs a type, takes a schedule or a custom name, allows a zero cost`() {
        val base = MaintenanceForm(date = "2026-10-21", odometer = "52310", cost = "0")
        assertEquals("Choose a maintenance type", base.toCreate().exceptionOrNull()?.message)
        assertEquals("Name the custom maintenance type", base.copy(type = MaintenanceType.Custom(" ")).toCreate().exceptionOrNull()?.message)
        val scheduled = base.copy(type = MaintenanceType.Schedule("S1", "Oil Change")).toCreate().getOrThrow()
        assertEquals("S1", scheduled.schemaId)
        assertNull(scheduled.customTypeName)
        assertEquals(0.0, scheduled.cost, 0.0)
        assertEquals("Wipers", base.copy(type = MaintenanceType.Custom("Wipers")).toCreate().getOrThrow().customTypeName)
    }

    @Test
    fun `vehicle form checks the basics and year range`() {
        val ok = VehicleForm("Daily", "2019", "Subaru", "Outback", tankSize = "18.5")
        assertEquals(18.5, ok.toCreate().getOrThrow().tankSize!!, 0.0)
        assertEquals("Give the vehicle a nickname", ok.copy(nickname = " ").toCreate().exceptionOrNull()?.message)
        assertTrue(ok.copy(year = "1800").toCreate().exceptionOrNull()?.message!!.startsWith("Year must be between 1900"))
        assertEquals("photo-key", ok.toUpdate("photo-key").getOrThrow().photoKey)
    }

    @Test
    fun `attachments become JPEG or PDF and are scaled to fit`() {
        assertEquals("image/jpeg", uploadTypeFor("image/heic"))
        assertEquals("application/pdf", uploadTypeFor("application/pdf"))
        assertNull(uploadTypeFor("text/plain"))
        assertEquals(2560 to 1920, fitWithin(4032, 3024, 2560))
        assertEquals(800 to 600, fitWithin(800, 600, 2560))
    }

    @Test
    fun `station names come from the closest earlier stop within 200 m`() {
        assertEquals(111.2, distanceMeters(42.0, -87.0, 42.001, -87.0), 0.5)
        val earlier = listOf(Triple(42.0, -87.0, "Shell"), Triple(42.0005, -87.0, "BP"), Triple(43.0, -87.0, "Far away"))
        assertEquals("BP", nearbyStationName(42.0006, -87.0, earlier))
        assertNull(nearbyStationName(42.1, -87.0, earlier))
    }

    @Test
    fun `reminders read naturally`() {
        assertEquals("300 mi overdue, 12 days overdue", reminderText(Reminder("Oil", Reminder.Type.BOTH, -300.0, -12.0, true)))
        assertEquals("in 450 mi", reminderText(Reminder("Oil", Reminder.Type.MILEAGE, 450.0, null, false)))
    }
}

object ApiClientTestData {
    fun fillup() = app.pawsitivemileage.api.ApiClient.json.decodeFromString(
        app.pawsitivemileage.api.generated.models.Fillup.serializer(), fillupJson(FID, "2026-10-21"),
    )
}

class AccountDeletionTest {
    @Test
    fun `deletion needs the exact word`() {
        assertTrue(app.pawsitivemileage.ui.canDelete("DELETE"))
        assertTrue(app.pawsitivemileage.ui.canDelete(" DELETE "))
        assertTrue(!app.pawsitivemileage.ui.canDelete("delete") && !app.pawsitivemileage.ui.canDelete(""))
    }
}
