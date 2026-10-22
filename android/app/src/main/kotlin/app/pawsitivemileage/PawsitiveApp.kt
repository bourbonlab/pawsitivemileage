package app.pawsitivemileage

import android.app.Application
import app.pawsitivemileage.api.ApiClient
import app.pawsitivemileage.auth.AuthManager
import app.pawsitivemileage.data.AppDatabase
import app.pawsitivemileage.data.FillupRepository
import app.pawsitivemileage.sync.SyncWorker

/** Wires the app together (no DI framework: the graph is small) */
class AppContainer(app: Application) {
    val api: ApiClient by lazy { ApiClient(BuildConfig.API_BASE_URL, BuildConfig.VERSION_NAME, accessToken = { auth.accessToken() }) }
    val auth: AuthManager by lazy { AuthManager(app, { api }, BuildConfig.VERSION_NAME) }
    private val db by lazy { AppDatabase.create(app) }
    val fillups: FillupRepository by lazy { FillupRepository({ api }, db.pendingFillups(), scheduleSync = { SyncWorker.schedule(app) }) }
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
