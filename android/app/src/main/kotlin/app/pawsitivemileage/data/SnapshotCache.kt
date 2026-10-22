package app.pawsitivemileage.data

import app.pawsitivemileage.api.ApiClient
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import java.io.File
import java.io.IOException

/** Data to show, and when it came from the device instead of the API, when that was */
data class Loaded<T>(val value: T, val offlineSince: Long? = null)

/**
 * The last data the app loaded (the garage, each vehicle's newest fill-ups), kept as JSON files
 * so it can still show something offline. Cleared on sign-out, so the next account never sees it.
 */
class SnapshotCache(private val dir: File, private val now: () -> Long = System::currentTimeMillis) {
    @Serializable
    private data class Entry(val savedAt: Long, val json: String)

    /** Load from the API and keep a copy; when offline, fall back to the copy if there is one */
    suspend fun <T> load(key: String, serializer: KSerializer<T>, fetch: suspend () -> T): Loaded<T> =
        try {
            fetch().also { write(key, ApiClient.json.encodeToString(serializer, it)) }.let { Loaded(it) }
        } catch (e: IOException) {
            val entry = read(key) ?: throw e
            Loaded(ApiClient.json.decodeFromString(serializer, entry.json), offlineSince = entry.savedAt)
        }

    fun clear() {
        dir.listFiles()?.forEach { it.delete() }
    }

    private fun file(key: String) = File(dir, key.replace(Regex("[^A-Za-z0-9_-]"), "_") + ".json")

    private fun write(key: String, json: String) {
        dir.mkdirs()
        val tmp = File(dir, "${file(key).name}.tmp")
        tmp.writeText(ApiClient.json.encodeToString(Entry.serializer(), Entry(now(), json)))
        tmp.renameTo(file(key)) // atomic: a crash mid-write never leaves half a snapshot
    }

    private fun read(key: String): Entry? =
        runCatching { ApiClient.json.decodeFromString(Entry.serializer(), file(key).readText()) }.getOrNull()
}
