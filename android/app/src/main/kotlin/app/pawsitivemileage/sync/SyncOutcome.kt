package app.pawsitivemileage.sync

import app.pawsitivemileage.api.ApiException
import java.io.IOException

/** What to do with a queued fill-up after an attempt to send it */
enum class SyncOutcome {
    /** Created (or already created: the Idempotency-Key replayed the first response) */
    DONE,
    /** Can't succeed as sent; keep it so the user can fix or discard it */
    FAILED,
    /** Offline, signed out, rate-limited or a server error: try again later with the same key */
    RETRY;

    companion object {
        fun of(error: Throwable?): SyncOutcome = when (error) {
            null -> DONE
            is IOException -> RETRY
            // 409 here is "the first request with this key is still running": retry, same key
            is ApiException -> if (error.isPermanent && error.status != 409) FAILED else RETRY
            else -> RETRY
        }
    }
}
