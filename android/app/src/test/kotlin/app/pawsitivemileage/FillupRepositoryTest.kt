package app.pawsitivemileage

import app.pawsitivemileage.api.ApiClient
import app.pawsitivemileage.api.generated.models.FillupCreate
import app.pawsitivemileage.data.FillupRepository
import app.pawsitivemileage.data.PendingFillup
import app.pawsitivemileage.data.PendingFillupDao
import app.pawsitivemileage.sync.SyncOutcome
import app.pawsitivemileage.ui.fillupFromForm
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.IOException

/** In-memory stand-in for the Room DAO */
class FakeDao : PendingFillupDao {
    val rows = MutableStateFlow<List<PendingFillup>>(emptyList())
    override suspend fun insert(entry: PendingFillup) { rows.value = rows.value + entry }
    override fun observe(vehicleId: String): Flow<List<PendingFillup>> = rows.map { list -> list.filter { it.vehicleId == vehicleId } }
    override suspend fun unsent() = rows.value.filter { it.failure == null }
    override suspend fun countAttempt(id: String) { rows.value = rows.value.map { if (it.id == id) it.copy(attempts = it.attempts + 1) else it } }
    override suspend fun markFailed(id: String, failure: String) { rows.value = rows.value.map { if (it.id == id) it.copy(failure = failure) else it } }
    override suspend fun delete(id: String) { rows.value = rows.value.filterNot { it.id == id } }
}

class FillupRepositoryTest {
    private lateinit var server: MockWebServer
    private lateinit var dao: FakeDao
    private lateinit var repo: FillupRepository
    private var syncsScheduled = 0
    private val body = FillupCreate("2026-10-21", 41.2, 12.4, 52310.0, isPartialFill = false, isBusiness = false)
    private val created = """{"data":${fillupJson("01KS5M8EYJ5VP2GYMBBEQZ5VPH", "2026-10-21")},"requestId":"r"}"""

    @Before
    fun setUp() {
        server = MockWebServer().apply { start() }
        dao = FakeDao()
        val api = ApiClient(server.url("/").toString(), "1.0.0", accessToken = { "t" })
        repo = FillupRepository({ api }, dao, scheduleSync = { syncsScheduled++ }, now = { 1_000L })
    }

    @After
    fun tearDown() = server.shutdown()

    @Test
    fun `adding queues the fill-up and schedules a sync, without the network`() = runTest {
        val id = repo.add(VID, body)
        assertEquals(1, syncsScheduled)
        assertEquals(id, dao.rows.value.single().id)
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `a sent fill-up leaves the queue`() = runTest {
        repo.add(VID, body)
        server.enqueue(MockResponse().setResponseCode(201).setBody(created))
        assertFalse(repo.sync())
        assertTrue(dao.rows.value.isEmpty())
    }

    @Test
    fun `retries reuse the same Idempotency-Key, so the API records it once`() = runTest {
        val id = repo.add(VID, body)
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START)) // offline / dropped
        server.enqueue(MockResponse().setResponseCode(503).setBody("""{"error":"busy","code":"INTERNAL_ERROR","requestId":"r"}"""))
        server.enqueue(MockResponse().setResponseCode(201).setBody(created).setHeader("Idempotent-Replayed", "true"))
        assertTrue(repo.sync())
        assertTrue(repo.sync())
        assertFalse(repo.sync())
        assertTrue(dao.rows.value.isEmpty())
        // The dropped connection never reached the server; the 503 and the replayed 201 did, with one key
        val keys = (1..server.requestCount).mapNotNull { server.takeRequest().getHeader("Idempotency-Key") }
        assertTrue(keys.size >= 2)
        assertEquals(setOf(id), keys.toSet())
    }

    @Test
    fun `a rejected fill-up stays, marked failed with the API's message`() = runTest {
        repo.add(VID, body)
        server.enqueue(MockResponse().setResponseCode(400).setBody("""{"error":"odometerReading must be greater than the previous fill-up","code":"VALIDATION_ERROR","requestId":"r"}"""))
        assertFalse(repo.sync())
        val row = dao.rows.value.single()
        assertEquals("odometerReading must be greater than the previous fill-up", row.failure)
        assertFalse(repo.sync()) // failed entries aren't resent
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `gives up after MAX_ATTEMPTS transient failures`() = runTest {
        repo.add(VID, body)
        dao.rows.value = dao.rows.value.map { it.copy(attempts = FillupRepository.MAX_ATTEMPTS - 1) }
        server.enqueue(MockResponse().setResponseCode(500).setBody("{}"))
        assertFalse(repo.sync())
        assertNotNull(dao.rows.value.single().failure)
    }
}

class SyncOutcomeTest {
    @Test
    fun `maps results to queue actions`() {
        assertEquals(SyncOutcome.DONE, SyncOutcome.of(null))
        assertEquals(SyncOutcome.RETRY, SyncOutcome.of(IOException("offline")))
        assertEquals(SyncOutcome.FAILED, SyncOutcome.of(app.pawsitivemileage.api.ApiException(400, "VALIDATION_ERROR", "bad", null)))
        assertEquals(SyncOutcome.FAILED, SyncOutcome.of(app.pawsitivemileage.api.ApiException(403, "FORBIDDEN", "no", null)))
        assertEquals(SyncOutcome.RETRY, SyncOutcome.of(app.pawsitivemileage.api.ApiException(401, "UNAUTHORIZED", "signed out", null)))
        assertEquals(SyncOutcome.RETRY, SyncOutcome.of(app.pawsitivemileage.api.ApiException(409, "CONFLICT", "in flight", null)))
        assertEquals(SyncOutcome.RETRY, SyncOutcome.of(app.pawsitivemileage.api.ApiException(503, "INTERNAL_ERROR", "busy", null)))
    }
}

class AddFillupFormTest {
    @Test
    fun `parses typed values and reports the first problem`() {
        val ok = fillupFromForm("2026-10-21", "12.4", "$41.20", "52,310", partial = true, notes = "  ").getOrThrow()
        assertEquals(FillupCreate("2026-10-21", 41.2, 12.4, 52310.0, isPartialFill = true, isBusiness = false, notes = null), ok)
        assertEquals("Date must be YYYY-MM-DD", fillupFromForm("10/21/2026", "1", "1", "1", false, "").exceptionOrNull()?.message)
        assertEquals("Gallons must be a number above 0", fillupFromForm("2026-10-21", "0", "1", "1", false, "").exceptionOrNull()?.message)
        assertEquals("Cost must be a number above 0", fillupFromForm("2026-10-21", "1", "ten", "1", false, "").exceptionOrNull()?.message)
    }
}
