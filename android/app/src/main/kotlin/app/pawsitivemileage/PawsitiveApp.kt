package app.pawsitivemileage

import android.app.Application
import app.pawsitivemileage.api.ApiClient
import app.pawsitivemileage.auth.AuthManager
import app.pawsitivemileage.data.AppDatabase
import app.pawsitivemileage.data.OpQueue
import app.pawsitivemileage.data.Records
import app.pawsitivemileage.data.SnapshotCache
import app.pawsitivemileage.data.Uploader
import app.pawsitivemileage.data.Vehicles
import app.pawsitivemileage.location.Locations
import app.pawsitivemileage.media.Attachments
import app.pawsitivemileage.sync.SyncWorker
import java.io.File

/** Wires the app together (no DI framework: the graph is small) */
class AppContainer(app: Application) {
    val api: ApiClient by lazy { ApiClient(BuildConfig.API_BASE_URL, BuildConfig.VERSION_NAME, accessToken = { auth.accessToken() }) }
    val auth: AuthManager by lazy { AuthManager(app, { api }, BuildConfig.VERSION_NAME) }
    private val db by lazy { AppDatabase.create(app) }
    val snapshots: SnapshotCache by lazy { SnapshotCache(File(app.filesDir, "snapshots")) }
    private val uploader by lazy { Uploader({ api }) }
    val queue: OpQueue by lazy { OpQueue({ api }, db.pendingOps(), uploader, scheduleSync = { SyncWorker.schedule(app) }) }
    val records: Records by lazy { Records({ api }, snapshots) }
    val vehicles: Vehicles by lazy { Vehicles({ api }, uploader, snapshots) }
    val attachments: Attachments by lazy { Attachments(app) }
    val locations: Locations by lazy { Locations(app) }

    /** Sign out and forget this account's data on the device (queued entries stay until sent or discarded) */
    suspend fun signOut() {
        auth.signOut()
        snapshots.clear()
    }

    /**
     * Delete the account on the server (everything, including the sign-in), then everything on
     * the device: queued entries and their files, offline copies, the session.
     */
    suspend fun deleteAccount() {
        app.pawsitivemileage.api.call { api.profile.deleteAccount() }
        queue.clear()
        snapshots.clear()
        auth.signOut()
    }
}

class PawsitiveApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        // Anything queued while the app was closed goes out once there's a network
        SyncWorker.schedule(this)
    }
}
