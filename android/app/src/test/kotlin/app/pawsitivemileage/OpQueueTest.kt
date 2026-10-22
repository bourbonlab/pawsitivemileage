package app.pawsitivemileage

import app.pawsitivemileage.api.ApiClient
import app.pawsitivemileage.api.generated.models.FillupCreate
import app.pawsitivemileage.api.generated.models.MaintenanceCreate
import app.pawsitivemileage.data.Attachment
import app.pawsitivemileage.data.OpKind
import app.pawsitivemileage.data.OpQueue
import app.pawsitivemileage.data.PendingOp
import app.pawsitivemileage.data.PendingOpDao
import app.pawsitivemileage.data.Uploader
import app.pawsitivemileage.sync.SyncOutcome
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.IOException
import java.util.concurrent.CopyOnWriteArrayList

/** In-memory stand-in for the Room DAO */
class FakeDao : PendingOpDao {
    val rows = MutableStateFlow<List<PendingOp>>(emptyList())
    private fun edit(id: String, f: (PendingOp) -> PendingOp) { rows.value = rows.value.map { if (it.id == id) f(it) else it } }
    override suspend fun insert(op: PendingOp) { rows.value = rows.value + op }
    override fun observe(vehicleId: String): Flow<List<PendingOp>> = rows.map { list -> list.filter { it.vehicleId == vehicleId } }
    override suspend fun unsent() = rows.value.filter { it.failure == null }.sortedBy { it.createdAt }
    override suspend fun get(id: String) = rows.value.firstOrNull { it.id == id }
    override suspend fun countAttempt(id: String) = edit(id) { it.copy(attempts = it.attempts + 1) }
    override suspend fun setUploadedKey(id: String, key: String) = edit(id) { it.copy(uploadedKey = key) }
    override suspend fun markFailed(id: String, failure: String) = edit(id) { it.copy(failure = failure) }
    override suspend fun delete(id: String) { rows.value = rows.value.filterNot { it.id == id } }
    override suspend fun all() = rows.value
    override suspend fun deleteAll() { rows.value = emptyList() }
}

/**
 * A scripted API: each path+method answers from a queue of responses (the last one repeats).
 * S3 uploads go to /s3/... on the same server.
 */
class FakeApi(private val server: MockWebServer) {
    val requests = CopyOnWriteArrayList<Pair<RecordedRequest, String>>()
    private val scripts = mutableMapOf<String, ArrayDeque<MockResponse>>()
    fun on(methodAndPath: String, vararg responses: MockResponse) { scripts[methodAndPath] = ArrayDeque(responses.toList()) }
    fun calls(methodAndPath: String) = requests.filter { "${it.first.method} ${it.first.path?.substringBefore('?')}" == methodAndPath }

    init {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                requests += request to request.body.readUtf8()
                val key = "${request.method} ${request.path?.substringBefore('?')}"
                val q = scripts[key] ?: return MockResponse().setResponseCode(404).setBody("""{"error":"no script for $key","code":"NOT_FOUND"}""")
                return if (q.size > 1) q.removeFirst() else q.first()
            }
        }
    }
}

fun ok(status: Int, data: String) = MockResponse().setResponseCode(status).setBody("""{"data":$data,"requestId":"r"}""")
fun apiError(status: Int, message: String, code: String = "VALIDATION_ERROR") =
    MockResponse().setResponseCode(status).setBody("""{"error":"$message","code":"$code","requestId":"r"}""")

const val FID = "01KS5M8EYJ5VP2GYMBBEQZ5VPH"
const val RID = "01KS5M8EYJ5VP2GYMBBEQZ5VPJ"

fun maintenanceJson(id: String) = """
    {"vehicleId":"$VID","recordId":"$id","userId":"u","datePerformed":"2026-10-21","odometerAtService":52310,"cost":65,
     "createdAt":"2026-10-21T12:00:00.000Z","updatedAt":"2026-10-21T12:00:00.000Z","customTypeName":"Wipers"}
""".trimIndent()

class OpQueueTest {
    @get:Rule val tmp = TemporaryFolder()
    private lateinit var server: MockWebServer
    private lateinit var api: FakeApi
    private lateinit var dao: FakeDao
    private lateinit var queue: OpQueue
    private var clock = 0L
    private val fillup = FillupCreate("2026-10-21", 41.2, 12.4, 52310.0, isPartialFill = false, isBusiness = false)
    private val maintenance = MaintenanceCreate("2026-10-21", 52310.0, 65.0, customTypeName = "Wipers")

    @Before
    fun setUp() {
        server = MockWebServer().apply { start() }
        api = FakeApi(server)
        dao = FakeDao()
        val client = ApiClient(server.url("/").toString(), "1.0.0", accessToken = { "t" })
        queue = OpQueue({ client }, dao, Uploader({ client }), scheduleSync = {}, now = { ++clock })
        api.on("POST /v1/upload/presign", ok(200, """{"url":"${server.url("/s3/upload")}","key":"owner/$VID/receipt-photo/K1-receipt.jpg","expiresIn":300}"""))
        api.on("PUT /s3/upload", MockResponse().setResponseCode(200))
    }

    @After
    fun tearDown() = server.shutdown()

    private fun receipt(): Attachment {
        val f = tmp.newFile("r.jpg").apply { writeBytes(ByteArray(2048) { 7 }) }
        return Attachment(f.absolutePath, "image/jpeg", "receipt.jpg")
    }

    @Test
    fun `fill-up and maintenance creates go out in order, each with its own Idempotency-Key`() = runTest {
        val a = queue.addFillup(VID, fillup)
        val b = queue.addMaintenance(VID, maintenance)
        api.on("POST /v1/vehicles/$VID/fillups", ok(201, fillupJson(FID, "2026-10-21")))
        api.on("POST /v1/vehicles/$VID/maintenance", ok(201, maintenanceJson(RID)))
        assertFalse(queue.sync())
        assertTrue(dao.rows.value.isEmpty())
        assertEquals(listOf("POST /v1/vehicles/$VID/fillups", "POST /v1/vehicles/$VID/maintenance"), api.requests.map { "${it.first.method} ${it.first.path}" })
        assertEquals(listOf(a, b), api.requests.map { it.first.getHeader("Idempotency-Key") })
    }

    @Test
    fun `a receipt is uploaded first, its key sent with the create, and the local file deleted`() = runTest {
        val r = receipt()
        queue.addFillup(VID, fillup, r)
        api.on("POST /v1/vehicles/$VID/fillups", ok(201, fillupJson(FID, "2026-10-21")))
        queue.sync()
        val presign = ApiClient.json.parseToJsonElement(api.calls("POST /v1/upload/presign").single().second).jsonObject
        assertEquals("receipt-photo", presign["uploadType"]!!.jsonPrimitive.content)
        assertEquals("image/jpeg", presign["contentType"]!!.jsonPrimitive.content)
        assertEquals(2048.0, presign["fileSize"]!!.jsonPrimitive.content.toDouble(), 0.0)
        assertEquals("image/jpeg", api.calls("PUT /s3/upload").single().first.getHeader("Content-Type"))
        val created = ApiClient.json.parseToJsonElement(api.calls("POST /v1/vehicles/$VID/fillups").single().second).jsonObject
        assertEquals("owner/$VID/receipt-photo/K1-receipt.jpg", created["receiptPhotoKey"]!!.jsonPrimitive.content)
        assertFalse(File(r.path).exists())
    }

    @Test
    fun `when the create fails after the upload, the retry reuses the uploaded key instead of uploading again`() = runTest {
        val id = queue.addMaintenance(VID, maintenance, receipt())
        api.on("POST /v1/vehicles/$VID/maintenance", MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START), ok(201, maintenanceJson(RID)))
        assertTrue(queue.sync())
        assertEquals("owner/$VID/receipt-photo/K1-receipt.jpg", dao.rows.value.single { it.id == id }.uploadedKey)
        assertFalse(queue.sync())
        assertEquals(1, api.calls("PUT /s3/upload").size)
        assertEquals(1, api.calls("POST /v1/upload/presign").size)
        assertTrue(dao.rows.value.isEmpty())
    }

    @Test
    fun `attaching a receipt to an existing record sends only receiptPhotoKey`() = runTest {
        queue.attachReceipt(OpKind.FILLUP_RECEIPT, VID, FID, receipt())
        api.on("PUT /v1/vehicles/$VID/fillups/$FID", ok(200, fillupJson(FID, "2026-10-21")))
        assertFalse(queue.sync())
        val body = ApiClient.json.parseToJsonElement(api.calls("PUT /v1/vehicles/$VID/fillups/$FID").single().second).jsonObject
        assertEquals(setOf("receiptPhotoKey"), body.keys) // nothing else is cleared
    }

    @Test
    fun `a rejected entry stays marked failed, and offline means retry later`() = runTest {
        queue.addFillup(VID, fillup)
        api.on("POST /v1/vehicles/$VID/fillups", apiError(400, "odometerReading must be greater than the previous fill-up"))
        assertFalse(queue.sync())
        assertEquals("odometerReading must be greater than the previous fill-up", dao.rows.value.single().failure)

        server.shutdown() // offline
        val other = dao.rows.value.single().copy(id = "x", failure = null)
        dao.insert(other)
        assertTrue(queue.sync())
        assertEquals(1, dao.rows.value.single { it.id == "x" }.attempts)
    }

    @Test
    fun `gives up after MAX_ATTEMPTS transient failures, and discarding deletes the local file`() = runTest {
        val r = receipt()
        val id = queue.addFillup(VID, fillup, r)
        dao.rows.value = dao.rows.value.map { it.copy(attempts = OpQueue.MAX_ATTEMPTS - 1) }
        api.on("POST /v1/upload/presign", MockResponse().setResponseCode(503).setBody("{}"))
        assertFalse(queue.sync())
        assertNotNull(dao.rows.value.single().failure)
        queue.discard(id)
        assertTrue(dao.rows.value.isEmpty())
        assertFalse(File(r.path).exists())
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

class OpQueueClearTest {
    @get:Rule val tmp = TemporaryFolder()

    @Test
    fun `clearing the queue drops every entry and its files (account deletion)`() = runTest {
        val dao = FakeDao()
        val client = ApiClient("http://localhost/", "1.0.0", accessToken = { "t" })
        val queue = OpQueue({ client }, dao, Uploader({ client }), scheduleSync = {})
        val file = tmp.newFile("r.jpg")
        queue.addFillup(VID, FillupCreate("2026-10-21", 1.0, 1.0, 1.0), Attachment(file.absolutePath, "image/jpeg", "r.jpg"))
        queue.addMaintenance(VID, MaintenanceCreate("2026-10-21", 1.0, 0.0, customTypeName = "x"))
        queue.clear()
        assertTrue(dao.rows.value.isEmpty())
        assertFalse(file.exists())
    }
}
