package app.pawsitivemileage.data

import app.pawsitivemileage.api.ApiClient
import app.pawsitivemileage.api.call
import app.pawsitivemileage.api.generated.models.PresignRequest
import app.pawsitivemileage.api.generated.models.UploadContentType
import app.pawsitivemileage.api.generated.models.UploadType
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import java.io.File
import java.io.IOException

/** A receipt or photo prepared on the device (see Attachments) */
data class Attachment(val path: String, val contentType: String, val name: String)

/** Uploads a file through a presigned S3 URL; returns the photo-bucket key to save on the record */
class Uploader(private val api: () -> ApiClient, private val http: OkHttpClient = OkHttpClient()) {
    suspend fun upload(vehicleId: String, type: UploadType, attachment: Attachment): String {
        val file = File(attachment.path)
        if (!file.exists()) throw IllegalStateException("The file to upload is missing from the device")
        val presigned = call {
            api().uploads.presignUpload(
                PresignRequest(
                    uploadType = type,
                    vehicleId = vehicleId,
                    filename = attachment.name,
                    contentType = UploadContentType.entries.first { it.value == attachment.contentType },
                    fileSize = file.length().toInt(), // at most 10 MB; signed into the URL, so the PUT must match
                ),
            )
        }.`data`
        withContext(Dispatchers.IO) {
            val request = Request.Builder().url(presigned.url)
                .put(file.asRequestBody(attachment.contentType.toMediaType()))
                .build()
            http.newCall(request).execute().use { response ->
                if (!response.isSuccessful) throw IOException("Upload failed: HTTP ${response.code}")
            }
        }
        return presigned.key
    }
}
