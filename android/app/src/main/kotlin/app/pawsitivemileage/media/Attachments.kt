package app.pawsitivemileage.media

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import androidx.core.content.FileProvider
import androidx.core.graphics.scale
import app.pawsitivemileage.data.Attachment
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.util.UUID

/** The API's upload limit (PresignRequest.fileSize) */
const val MAX_UPLOAD_BYTES = 10L * 1024 * 1024

/** How a picked file is stored for upload: images become JPEG, PDFs are kept, anything else is refused */
fun uploadTypeFor(mimeType: String?): String? = when {
    mimeType == null -> null
    mimeType.startsWith("image/") -> "image/jpeg"
    mimeType == "application/pdf" -> "application/pdf"
    else -> null
}

/** Scale (w, h) down to fit within maxEdge, keeping the aspect ratio */
fun fitWithin(width: Int, height: Int, maxEdge: Int): Pair<Int, Int> {
    val longest = maxOf(width, height)
    if (longest <= maxEdge) return width to height
    val scale = maxEdge.toDouble() / longest
    return maxOf(1, (width * scale).toInt()) to maxOf(1, (height * scale).toInt())
}

/**
 * Receipts and photos picked or taken on the device, copied into app storage so they survive
 * until uploaded (the queue holds the path). Photos are re-encoded as JPEG, at most 2560 px on
 * the long edge, which keeps receipts readable and well under the 10 MB limit.
 */
class Attachments(private val context: Context) {
    private val dir get() = File(context.filesDir, "attachments").apply { mkdirs() }

    /** A content:// URI the camera can write a new photo to (TakePicture) */
    fun newCameraUri(): Uri {
        val file = File(File(context.cacheDir, "camera").apply { mkdirs() }, "${UUID.randomUUID()}.jpg")
        return FileProvider.getUriForFile(context, "${context.packageName}.files", file)
    }

    suspend fun import(uri: Uri): Attachment = withContext(Dispatchers.IO) {
        val resolver = context.contentResolver
        val mime = resolver.getType(uri) ?: if (uri.path?.endsWith(".jpg") == true) "image/jpeg" else null
        val type = uploadTypeFor(mime) ?: throw IllegalArgumentException("Choose a photo or a PDF")
        // Camera shots come from our FileProvider with a random name; call them what they are
        val fromCamera = uri.authority == "${context.packageName}.files"
        val baseName = if (fromCamera) "receipt-${java.time.LocalDate.now()}" else displayName(uri)?.substringBeforeLast('.')?.ifBlank { null } ?: "receipt"
        val out = File(dir, "${UUID.randomUUID()}.${if (type == "image/jpeg") "jpg" else "pdf"}")
        if (type == "image/jpeg") {
            val bitmap = decode(uri)
            val (w, h) = fitWithin(bitmap.width, bitmap.height, 2560)
            val scaled = if (w != bitmap.width) bitmap.scale(w, h) else bitmap
            out.outputStream().use { scaled.compress(Bitmap.CompressFormat.JPEG, 85, it) }
        } else {
            resolver.openInputStream(uri)!!.use { input -> out.outputStream().use { input.copyTo(it) } }
        }
        if (out.length() > MAX_UPLOAD_BYTES) {
            out.delete()
            throw IllegalArgumentException("That file is over 10 MB")
        }
        Attachment(out.absolutePath, type, "$baseName.${out.extension}")
    }

    private fun decode(uri: Uri): Bitmap =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            ImageDecoder.decodeBitmap(ImageDecoder.createSource(context.contentResolver, uri)) { decoder, info, _ ->
                decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                val (w, h) = fitWithin(info.size.width, info.size.height, 2560)
                decoder.setTargetSize(w, h)
            }
        } else {
            context.contentResolver.openInputStream(uri)!!.use { BitmapFactory.decodeStream(it) }
                ?: throw IllegalArgumentException("Couldn't read that image")
        }

    private fun displayName(uri: Uri): String? =
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        }
}
