package app.pawsitivemileage.sync

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import app.pawsitivemileage.PawsitiveApp
import java.util.concurrent.TimeUnit

/** Sends queued fill-ups when there is a network; WorkManager retries with backoff */
class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val retry = (applicationContext as PawsitiveApp).container.fillups.sync()
        return if (retry) Result.retry() else Result.success()
    }

    companion object {
        private const val NAME = "sync-fillups"

        fun schedule(context: Context) {
            val request = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            // APPEND_OR_REPLACE: an entry queued while a sync runs is picked up by a follow-up run
            WorkManager.getInstance(context).enqueueUniqueWork(NAME, ExistingWorkPolicy.APPEND_OR_REPLACE, request)
        }
    }
}
