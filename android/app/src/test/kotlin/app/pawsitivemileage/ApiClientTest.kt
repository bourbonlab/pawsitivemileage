package app.pawsitivemileage

import app.pawsitivemileage.api.ApiClient
import app.pawsitivemileage.api.ApiException
import app.pawsitivemileage.api.call
import app.pawsitivemileage.api.generated.apis.FillUpsApi
import app.pawsitivemileage.api.generated.models.FillupCreate
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

const val VID = "01KHKHBG12P5BK5724XW7X0D30"

fun fillupJson(id: String, date: String, extra: String = "") = """
    {"vehicleId":"$VID","fillupId":"$id","userId":"11111111-aaaa-4bbb-8ccc-222222222222","date":"$date",
     "currencySpent":41.2,"gallonsAdded":12.4,"odometerReading":52310,"isPartialFill":false,"isBusiness":false,
     "pricePerGallon":3.32,"milesSinceLastFillup":null,"mpg":null,"costPerMile":null,"daysSinceLastFillup":null,
     "stationName":null,"createdAt":"2026-10-21T12:00:00.000Z","updatedAt":"2026-10-21T12:00:00.000Z"$extra}
""".trimIndent()

class ApiClientTest {
    private lateinit var server: MockWebServer
    private var token: String? = "access-token"
    private lateinit var api: ApiClient

    @Before
    fun setUp() {
        server = MockWebServer().apply { start() }
        api = ApiClient(server.url("/").toString(), "1.0.0", accessToken = { token })
    }

    @After
    fun tearDown() = server.shutdown()

    @Test
    fun `sends the access token and X-Client, and decodes a page leniently`() = runTest {
        server.enqueue(MockResponse().setBody("""{"data":[${fillupJson("01KS5M8EYJ5VP2GYMBBEQZ5VPH", "2026-10-21", ""","futureField":{"x":1}""")}],"requestId":"r","nextCursor":"abc"}"""))
        val page = call { api.fillups.listFillups(VID, limit = 20, order = FillUpsApi.OrderListFillups.DESC) }
        assertEquals(1, page.`data`.size)
        assertEquals("abc", page.nextCursor)
        assertNull(page.`data`[0].mpg)
        val request = server.takeRequest()
        assertEquals("/v1/vehicles/$VID/fillups?limit=20&order=desc", request.path)
        assertEquals("Bearer access-token", request.getHeader("Authorization"))
        assertEquals("android/1.0.0", request.getHeader("X-Client"))
    }

    @Test
    fun `meta is public and never carries the token`() = runTest {
        server.enqueue(MockResponse().setBody("""{"data":{"apiVersion":"v1","minimumVersions":{},"features":{},"links":{"privacyPolicy":"https://x/p","terms":"https://x/t","accountDeletion":"https://x/a"},"serverTime":"2026-10-21T22:00:00.000Z"},"requestId":"r"}"""))
        call { api.meta.getMeta() }
        assertNull(server.takeRequest().getHeader("Authorization"))
    }

    @Test
    fun `creates send the Idempotency-Key`() = runTest {
        server.enqueue(MockResponse().setResponseCode(201).setBody("""{"data":${fillupJson("01KS5M8EYJ5VP2GYMBBEQZ5VPH", "2026-10-21")},"requestId":"r"}"""))
        call { api.fillups.createFillup(VID, FillupCreate("2026-10-21", 41.2, 12.4, 52310.0), idempotencyKey = "key-1") }
        val request = server.takeRequest()
        assertEquals("key-1", request.getHeader("Idempotency-Key"))
        assertTrue(request.body.readUtf8().contains("\"odometerReading\":52310.0"))
    }

    @Test
    fun `errors become ApiException with the API's code and request ID`() = runTest {
        server.enqueue(MockResponse().setResponseCode(400).setBody("""{"error":"gallonsAdded must be at least 0.01","code":"VALIDATION_ERROR","requestId":"req-9"}"""))
        try {
            call { api.fillups.createFillup(VID, FillupCreate("2026-10-21", 41.2, 0.0, 52310.0)) }
            fail("expected ApiException")
        } catch (e: ApiException) {
            assertEquals(400, e.status)
            assertEquals("VALIDATION_ERROR", e.code)
            assertEquals("gallonsAdded must be at least 0.01", e.message)
            assertEquals("req-9", e.requestId)
            assertTrue(e.isPermanent)
        }
    }
}
