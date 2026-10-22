package app.pawsitivemileage.ui

import app.pawsitivemileage.api.ApiException
import java.io.IOException

/**
 * What to show for a failed load: a plain offline message for network failures (no DNS, no
 * route, timeouts), the API's own message for API errors.
 */
fun friendlyError(error: Throwable, offline: String): String = when (error) {
    is ApiException -> error.message ?: "The server returned an error (${error.status})"
    is IOException -> offline
    else -> error.message ?: "Something went wrong"
}

const val OFFLINE_GARAGE = "You're offline. Connect to load your garage."
const val OFFLINE_FILLUPS = "You're offline. Fill-ups you add are saved on this device and sent when you're back online."
