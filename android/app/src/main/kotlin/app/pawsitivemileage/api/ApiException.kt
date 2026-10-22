package app.pawsitivemileage.api

import kotlinx.serialization.Serializable

/** A non-2xx API response */
class ApiException(
    val status: Int,
    val code: String,
    message: String,
    val requestId: String?,
) : Exception(message) {

    /** The request can never succeed as sent (validation, permissions, not found) */
    val isPermanent: Boolean get() = status in 400..499 && status != 401 && status != 408 && status != 429

    @Serializable
    private data class Envelope(val error: String? = null, val code: String? = null, val requestId: String? = null)

    companion object {
        fun fromResponse(status: Int, body: String?): ApiException {
            val envelope = body?.let { runCatching { ApiClient.json.decodeFromString(Envelope.serializer(), it) }.getOrNull() }
            return ApiException(
                status = status,
                code = envelope?.code ?: if (status >= 500) "INTERNAL_ERROR" else "HTTP_$status",
                message = envelope?.error ?: "HTTP $status",
                requestId = envelope?.requestId,
            )
        }
    }
}
