package app.pawsitivemileage.data

import app.pawsitivemileage.api.ApiClient
import app.pawsitivemileage.api.call
import app.pawsitivemileage.api.generated.apis.FillUpsApi
import app.pawsitivemileage.api.generated.models.Fillup
import app.pawsitivemileage.api.generated.models.FillupCreate
import app.pawsitivemileage.sync.SyncOutcome
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.Serializable
import java.util.UUID

@Serializable
data class FillupPage(val items: List<Fillup>, val nextCursor: String?)

/**
 * Fill-ups for a vehicle: pages from the API (newest first, #26) plus entries queued on the
 * device. New fill-ups always go through the queue, so entering one never needs a connection.
 */
class FillupRepository(
    private val api: () -> ApiClient,
    private val dao: PendingFillupDao,
    private val scheduleSync: () -> Unit,
    private val now: () -> Long = System::currentTimeMillis,
    private val snapshots: SnapshotCache? = null,
) {
    /** One page, newest first. The first page is kept on the device and shown when offline. */
    suspend fun page(vehicleId: String, cursor: String? = null, limit: Int = 20): Loaded<FillupPage> {
        val fetch: suspend () -> FillupPage = {
            val response = call { api().fillups.listFillups(vehicleId, limit = limit, cursor = cursor, order = FillUpsApi.OrderListFillups.DESC) }
            FillupPage(response.`data`, response.nextCursor)
        }
        return if (cursor == null && snapshots != null) snapshots.load("fillups-$vehicleId", FillupPage.serializer(), fetch) else Loaded(fetch())
    }

    fun pending(vehicleId: String): Flow<List<PendingFillup>> = dao.observe(vehicleId)

    suspend fun add(vehicleId: String, fillup: FillupCreate): String {
        val id = UUID.randomUUID().toString()
        dao.insert(PendingFillup(id, vehicleId, ApiClient.json.encodeToString(FillupCreate.serializer(), fillup), now()))
        scheduleSync()
        return id
    }

    suspend fun discard(id: String) = dao.delete(id)

    /**
     * Send every unsent entry once. Returns true when something should be retried later.
     * Entries that keep failing transiently are given up on after [MAX_ATTEMPTS].
     */
    suspend fun sync(): Boolean {
        var retry = false
        for (entry in dao.unsent()) {
            val error = runCatching {
                val body = ApiClient.json.decodeFromString(FillupCreate.serializer(), entry.body)
                call { api().fillups.createFillup(entry.vehicleId, body, idempotencyKey = entry.id) }
            }.exceptionOrNull()
            when (SyncOutcome.of(error)) {
                SyncOutcome.DONE -> dao.delete(entry.id)
                SyncOutcome.FAILED -> dao.markFailed(entry.id, error?.message ?: "Rejected by the server")
                SyncOutcome.RETRY -> {
                    dao.countAttempt(entry.id)
                    if (entry.attempts + 1 >= MAX_ATTEMPTS) dao.markFailed(entry.id, "Couldn't send after $MAX_ATTEMPTS tries: ${error?.message}")
                    else retry = true
                }
            }
        }
        return retry
    }

    companion object {
        const val MAX_ATTEMPTS = 25
    }
}
