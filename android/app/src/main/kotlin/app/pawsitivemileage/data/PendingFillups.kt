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
import kotlinx.coroutines.flow.Flow

/**
 * A fill-up entered on the device and not yet confirmed by the API. `id` doubles as the
 * Idempotency-Key, so however many times it is sent (retries, app restarts), the API records
 * it once (#24). `body` is the FillupCreate JSON exactly as it will be sent.
 */
@Entity(tableName = "pending_fillups")
data class PendingFillup(
    @PrimaryKey val id: String,
    val vehicleId: String,
    val body: String,
    val createdAt: Long,
    val attempts: Int = 0,
    /** Set when the API rejected it for good; the entry stays until the user discards it */
    val failure: String? = null,
)

@Dao
interface PendingFillupDao {
    @Insert
    suspend fun insert(entry: PendingFillup)

    @Query("SELECT * FROM pending_fillups WHERE vehicleId = :vehicleId ORDER BY createdAt DESC")
    fun observe(vehicleId: String): Flow<List<PendingFillup>>

    @Query("SELECT * FROM pending_fillups WHERE failure IS NULL ORDER BY createdAt")
    suspend fun unsent(): List<PendingFillup>

    @Query("UPDATE pending_fillups SET attempts = attempts + 1 WHERE id = :id")
    suspend fun countAttempt(id: String)

    @Query("UPDATE pending_fillups SET failure = :failure WHERE id = :id")
    suspend fun markFailed(id: String, failure: String)

    @Query("DELETE FROM pending_fillups WHERE id = :id")
    suspend fun delete(id: String)
}

@Database(entities = [PendingFillup::class], version = 1, exportSchema = true)
abstract class AppDatabase : RoomDatabase() {
    abstract fun pendingFillups(): PendingFillupDao

    companion object {
        fun create(context: Context): AppDatabase =
            Room.databaseBuilder(context.applicationContext, AppDatabase::class.java, "pawsitivemileage.db").build()
    }
}
