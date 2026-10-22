package app.pawsitivemileage.data

import app.pawsitivemileage.api.ApiClient
import app.pawsitivemileage.api.UpdateBodyConverterFactory
import app.pawsitivemileage.api.call
import app.pawsitivemileage.api.generated.models.FillupCreate
import app.pawsitivemileage.api.generated.models.FillupUpdate
import app.pawsitivemileage.api.generated.models.MaintenanceCreate
import app.pawsitivemileage.api.generated.models.MaintenanceUpdate
import app.pawsitivemileage.api.generated.models.UploadType
import app.pawsitivemileage.sync.SyncOutcome
import kotlinx.coroutines.flow.Flow
import java.io.File
import java.util.UUID

/**
 * Everything created on the device goes through here, so entering a fill-up, a maintenance
 * record or a receipt never needs a connection (#24, #38). [sync] sends the queue in order.
 */
class OpQueue(
    private val api: () -> ApiClient,
    private val dao: PendingOpDao,
    private val uploader: Uploader,
    private val scheduleSync: () -> Unit,
    private val now: () -> Long = System::currentTimeMillis,
) {
    fun pending(vehicleId: String): Flow<List<PendingOp>> = dao.observe(vehicleId)

    suspend fun addFillup(vehicleId: String, body: FillupCreate, receipt: Attachment? = null): String =
        enqueue(OpKind.FILLUP_CREATE, vehicleId, ApiClient.json.encodeToString(FillupCreate.serializer(), body), null, receipt)

    suspend fun addMaintenance(vehicleId: String, body: MaintenanceCreate, receipt: Attachment? = null): String =
        enqueue(OpKind.MAINTENANCE_CREATE, vehicleId, ApiClient.json.encodeToString(MaintenanceCreate.serializer(), body), null, receipt)

    /** Attach a receipt to a fill-up or maintenance record that already exists */
    suspend fun attachReceipt(kind: OpKind, vehicleId: String, recordId: String, receipt: Attachment): String {
        require(kind == OpKind.FILLUP_RECEIPT || kind == OpKind.MAINTENANCE_RECEIPT)
        return enqueue(kind, vehicleId, "", recordId, receipt)
    }

    /** Drop everything queued, with its files (account deletion) */
    suspend fun clear() {
        dao.all().forEach { op -> op.attachmentPath?.let { File(it).delete() } }
        dao.deleteAll()
    }

    suspend fun discard(id: String) {
        dao.get(id)?.attachmentPath?.let { File(it).delete() }
        dao.delete(id)
    }

    private suspend fun enqueue(kind: OpKind, vehicleId: String, body: String, targetId: String?, receipt: Attachment?): String {
        val id = UUID.randomUUID().toString()
        dao.insert(
            PendingOp(
                id = id, kind = kind, vehicleId = vehicleId, body = body, createdAt = now(), targetId = targetId,
                attachmentPath = receipt?.path, attachmentType = receipt?.contentType, attachmentName = receipt?.name,
            ),
        )
        scheduleSync()
        return id
    }

    /**
     * Send every unsent operation once, oldest first. Returns true when something should be
     * retried later. Operations that keep failing transiently are given up on after [MAX_ATTEMPTS].
     */
    suspend fun sync(): Boolean {
        var retry = false
        for (op in dao.unsent()) {
            val error = runCatching { send(op) }.exceptionOrNull()
            when (SyncOutcome.of(error)) {
                SyncOutcome.DONE -> {
                    op.attachmentPath?.let { File(it).delete() }
                    dao.delete(op.id)
                }
                SyncOutcome.FAILED -> dao.markFailed(op.id, error?.message ?: "Rejected by the server")
                SyncOutcome.RETRY -> {
                    dao.countAttempt(op.id)
                    if (op.attempts + 1 >= MAX_ATTEMPTS) dao.markFailed(op.id, "Couldn't send after $MAX_ATTEMPTS tries: ${error?.message}")
                    else retry = true
                }
            }
        }
        return retry
    }

    private suspend fun send(op: PendingOp) {
        // Upload first; the key is saved so a retry after a failed create doesn't upload again
        val receiptKey = op.uploadedKey ?: op.attachmentPath?.let { path ->
            uploader.upload(op.vehicleId, UploadType.RECEIPT_PHOTO, Attachment(path, op.attachmentType!!, op.attachmentName!!))
                .also { dao.setUploadedKey(op.id, it) }
        }
        val client = api()
        when (op.kind) {
            OpKind.FILLUP_CREATE -> {
                val body = ApiClient.json.decodeFromString(FillupCreate.serializer(), op.body)
                call { client.fillups.createFillup(op.vehicleId, body.copy(receiptPhotoKey = receiptKey ?: body.receiptPhotoKey), idempotencyKey = op.id) }
            }
            OpKind.MAINTENANCE_CREATE -> {
                val body = ApiClient.json.decodeFromString(MaintenanceCreate.serializer(), op.body)
                call { client.maintenance.createMaintenance(op.vehicleId, body.copy(receiptPhotoKey = receiptKey ?: body.receiptPhotoKey), idempotencyKey = op.id) }
            }
            // Only the receipt changes; the other fields are left as they are on the server
            OpKind.FILLUP_RECEIPT -> call {
                client.fillups.updateFillup(op.vehicleId, op.targetId!!, UpdateBodyConverterFactory.partial(FillupUpdate(receiptPhotoKey = receiptKey)))
            }
            OpKind.MAINTENANCE_RECEIPT -> call {
                client.maintenance.updateMaintenance(op.vehicleId, op.targetId!!, UpdateBodyConverterFactory.partial(MaintenanceUpdate(receiptPhotoKey = receiptKey)))
            }
        }
    }

    companion object {
        const val MAX_ATTEMPTS = 25
    }
}
