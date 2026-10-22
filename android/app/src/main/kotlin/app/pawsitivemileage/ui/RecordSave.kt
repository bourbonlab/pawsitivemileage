package app.pawsitivemileage.ui

import app.pawsitivemileage.api.ApiException
import java.io.IOException

/** How saving an edit ended, for the form to show */
sealed interface SaveResult {
    data object Saved : SaveResult
    /** 409: the record changed elsewhere since it was opened */
    data object Conflict : SaveResult
    data class Problem(val message: String) : SaveResult
}

/**
 * Runs an online edit (update or delete) and maps failures for the form. Offline, edits aren't
 * queued (to avoid conflicting changes); a new receipt is queued separately by the caller.
 */
suspend fun runEdit(action: suspend () -> Unit): SaveResult = try {
    action()
    SaveResult.Saved
} catch (e: ApiException) {
    if (e.status == 409) SaveResult.Conflict else SaveResult.Problem(e.message ?: "The server rejected the change")
} catch (e: IOException) {
    SaveResult.Problem(OFFLINE_EDIT)
} catch (e: IllegalArgumentException) {
    SaveResult.Problem(e.message ?: "Check the form")
}

const val OFFLINE_EDIT = "You're offline. Editing needs a connection; nothing was changed."
