package app.pawsitivemileage

import app.pawsitivemileage.api.ApiClient
import app.pawsitivemileage.api.ApiException
import app.pawsitivemileage.api.call
import app.pawsitivemileage.data.Records
import app.pawsitivemileage.ui.FillupForm
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonObject
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

class UpdateBodyTest {
    private lateinit var server: MockWebServer
    private lateinit var api: FakeApi
    private lateinit var records: Records

    @Before
    fun setUp() {
        server = MockWebServer().apply { start() }
        api = FakeApi(server)
        val client = ApiClient(server.url("/").toString(), "1.0.0", accessToken = { "t" })
        records = Records({ client })
    }

    @After
    fun tearDown() = server.shutdown()

    @Test
    fun `edits send If-Match and explicit nulls, so cleared fields and removed receipts clear`() = runTest {
        val current = ApiClientTestData.fillup().copy(receiptPhotoKey = "k", stationName = "Shell")
        api.on("PUT /v1/vehicles/$VID/fillups/$FID", ok(200, fillupJson(FID, "2026-10-21")))
        val update = FillupForm.of(current).let { it.copy(place = it.place.copy(station = "")) }.toUpdate(null).getOrThrow()
        records.updateFillup(current, update)
        val (request, body) = api.calls("PUT /v1/vehicles/$VID/fillups/$FID").single()
        assertEquals("\"2026-10-21T12:00:00.000Z\"", request.getHeader("If-Match"))
        val json = ApiClient.json.parseToJsonElement(body).jsonObject
        assertEquals(JsonNull, json["receiptPhotoKey"])
        assertEquals(JsonNull, json["stationName"])
        assertTrue(json.containsKey("notes"))
    }

    @Test
    fun `a stale edit comes back as a 409`() = runTest {
        api.on("PUT /v1/vehicles/$VID/fillups/$FID", apiError(409, "This record was changed after you loaded it", "CONFLICT"))
        try {
            records.updateFillup(ApiClientTestData.fillup(), FillupForm.of(ApiClientTestData.fillup()).toUpdate(null).getOrThrow())
            fail("expected 409")
        } catch (e: ApiException) {
            assertEquals(409, e.status)
        }
    }

    @Test
    fun `creates still omit nulls`() = runTest {
        val client = ApiClient(server.url("/").toString(), "1.0.0", accessToken = { "t" })
        api.on("POST /v1/vehicles/$VID/fillups", ok(201, fillupJson(FID, "2026-10-21")))
        call { client.fillups.createFillup(VID, FillupForm("2026-10-21", "12.4", "41.2", "52310").toCreate().getOrThrow()) }
        val json = ApiClient.json.parseToJsonElement(api.calls("POST /v1/vehicles/$VID/fillups").single().second).jsonObject
        assertTrue("stationName" !in json && "receiptPhotoKey" !in json)
    }
}
