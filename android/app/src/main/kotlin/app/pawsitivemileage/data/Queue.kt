package app.pawsitivemileage.data

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import kotlinx.coroutines.flow.Flow

/** What a queued operation does once it is sent */
enum class OpKind {
    /** Create a fill-up; `body` is FillupCreate JSON */
    FILLUP_CREATE,
    /** Create a maintenance record; `body` is MaintenanceCreate JSON */
    MAINTENANCE_CREATE,
    /** Attach a receipt to an existing fill-up (`targetId` = fillupId) */
    FILLUP_RECEIPT,
    /** Attach a receipt to an existing maintenance record (`targetId` = recordId) */
    MAINTENANCE_RECEIPT,
}

/**
 * Something entered on the device and not yet confirmed by the API (#38). `id` doubles as the
 * Idempotency-Key for creates, so retries and restarts never record anything twice.
 *
 * An attachment (receipt photo or PDF) is uploaded first, via a presigned URL; its key is saved
 * in `uploadedKey` so a retry doesn't upload it again, then the record is created or updated
 * with it as `receiptPhotoKey`. The local file is deleted once the operation is done.
 */
@Entity(tableName = "pending_ops")
data class PendingOp(
    @PrimaryKey val id: String,
    val kind: OpKind,
    val vehicleId: String,
    val body: String = "",
    val createdAt: Long,
    val targetId: String? = null,
    val attachmentPath: String? = null,
    val attachmentType: String? = null,
    val attachmentName: String? = null,
    val uploadedKey: String? = null,
    val attempts: Int = 0,
    /** Set when the API rejected it for good; the entry stays until the user discards it */
    val failure: String? = null,
)

@Dao
interface PendingOpDao {
    @Insert
    suspend fun insert(op: PendingOp)

    @Query("SELECT * FROM pending_ops WHERE vehicleId = :vehicleId ORDER BY createdAt DESC")
    fun observe(vehicleId: String): Flow<List<PendingOp>>

    @Query("SELECT * FROM pending_ops WHERE failure IS NULL ORDER BY createdAt")
    suspend fun unsent(): List<PendingOp>

    @Query("SELECT * FROM pending_ops WHERE id = :id")
    suspend fun get(id: String): PendingOp?

    @Query("UPDATE pending_ops SET attempts = attempts + 1 WHERE id = :id")
    suspend fun countAttempt(id: String)

    @Query("UPDATE pending_ops SET uploadedKey = :key WHERE id = :id")
    suspend fun setUploadedKey(id: String, key: String)

    @Query("UPDATE pending_ops SET failure = :failure WHERE id = :id")
    suspend fun markFailed(id: String, failure: String)

    @Query("DELETE FROM pending_ops WHERE id = :id")
    suspend fun delete(id: String)

    @Query("SELECT * FROM pending_ops")
    suspend fun all(): List<PendingOp>

    @Query("DELETE FROM pending_ops")
    suspend fun deleteAll()
}

@Database(entities = [PendingOp::class], version = 2, exportSchema = true)
abstract class AppDatabase : RoomDatabase() {
    abstract fun pendingOps(): PendingOpDao

    companion object {
        /** v1 queued only fill-ups (pending_fillups); keep anything still waiting to be sent */
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """CREATE TABLE IF NOT EXISTS `pending_ops` (`id` TEXT NOT NULL, `kind` TEXT NOT NULL, `vehicleId` TEXT NOT NULL,
                       `body` TEXT NOT NULL, `createdAt` INTEGER NOT NULL, `targetId` TEXT, `attachmentPath` TEXT, `attachmentType` TEXT,
                       `attachmentName` TEXT, `uploadedKey` TEXT, `attempts` INTEGER NOT NULL, `failure` TEXT, PRIMARY KEY(`id`))""",
                )
                db.execSQL(
                    """INSERT INTO pending_ops (id, kind, vehicleId, body, createdAt, attempts, failure)
                       SELECT id, 'FILLUP_CREATE', vehicleId, body, createdAt, attempts, failure FROM pending_fillups""",
                )
                db.execSQL("DROP TABLE pending_fillups")
            }
        }

        fun create(context: Context): AppDatabase =
            Room.databaseBuilder(context.applicationContext, AppDatabase::class.java, "pawsitivemileage.db")
                .addMigrations(MIGRATION_1_2)
                .build()
    }
}
