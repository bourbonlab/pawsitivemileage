package app.pawsitivemileage

import app.pawsitivemileage.api.ApiClient
import app.pawsitivemileage.data.GarageVehicle
import app.pawsitivemileage.data.Uploader
import app.pawsitivemileage.data.Vehicles
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** Family vehicles shared with you appear in the garage, and what you can do follows the share */
class SharedVehiclesTest {
    private lateinit var server: MockWebServer
    private lateinit var api: FakeApi
    private lateinit var vehicles: Vehicles

    @Before
    fun setUp() {
        server = MockWebServer().apply { start() }
        api = FakeApi(server)
        val client = ApiClient(server.url("/").toString(), "1.0.0", accessToken = { "t" })
        vehicles = Vehicles({ client }, Uploader({ client }))
    }

    @After
    fun tearDown() = server.shutdown()

    @Test
    fun `the garage lists your vehicles, archived ones, and vehicles shared with you`() = runTest {
        api.on("GET /v1/vehicles", ok(200, """[
            {"userId":"u","vehicleId":"V1","nickname":"Daily","make":"Subaru","model":"Outback","year":2019,"isArchived":false,"createdAt":"t","updatedAt":"t"},
            {"userId":"u","vehicleId":"V2","nickname":"Old Civic","make":"Honda","model":"Civic","year":2008,"isArchived":true,"createdAt":"t","updatedAt":"t"}]"""))
        api.on("GET /v1/vehicles/shared", ok(200, """[
            {"vehicle":{"vehicleId":"V3","nickname":"Mom's Van","make":"Honda","model":"Odyssey","year":2020,"photoUrl":"https://x/p.jpg"},"ownerDisplayName":"Mom","permission":"fuel","shareId":"S1"},
            {"vehicle":{"vehicleId":"V4","nickname":"Dad's Truck","make":"Ford","model":"F-150","year":2018},"ownerDisplayName":"Dad","permission":"readonly","shareId":"S2"}]"""))
        val garage = vehicles.garage().value
        assertEquals(listOf("Daily", "Old Civic", "Mom's Van", "Dad's Truck"), garage.map { it.nickname })
        assertEquals("all", api.calls("GET /v1/vehicles").single().first.requestUrl!!.queryParameter("status"))
        val van = garage.single { it.vehicleId == "V3" }
        assertEquals("Mom", van.sharedBy)
        assertEquals("https://x/p.jpg", van.photoUrl)
        assertTrue(garage.single { it.vehicleId == "V2" }.isArchived)
    }

    @Test
    fun `permissions follow the share`() {
        val owner = GarageVehicle("V1", "Daily", "2019 Subaru Outback")
        assertTrue(owner.isOwner && owner.canEditFuel && owner.canEditMaintenance)
        for (p in listOf("fuel", "maintenance", "full")) {
            val shared = GarageVehicle("V", "n", "d", sharedBy = "Mom", permission = p)
            assertFalse(shared.isOwner) // vehicle details stay the owner's
            assertTrue(p, shared.canEditFuel && shared.canEditMaintenance)
        }
        val readonly = GarageVehicle("V", "n", "d", sharedBy = "Dad", permission = "readonly")
        assertFalse(readonly.canEditFuel || readonly.canEditMaintenance || readonly.isOwner)
    }
}
