package app.pawsitivemileage

import app.pawsitivemileage.data.SnapshotCache
import app.pawsitivemileage.ui.Format
import app.pawsitivemileage.ui.GarageVehicle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.builtins.ListSerializer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.IOException
import java.net.UnknownHostException
import java.time.ZoneOffset

class SnapshotCacheTest {
    @get:Rule val tmp = TemporaryFolder()
    private val serializer = ListSerializer(GarageVehicle.serializer())
    private val garage = listOf(GarageVehicle(VID, "Adam Nissan", "2016 Nissan Xterra", null))
    private val offline: suspend () -> List<GarageVehicle> = { throw UnknownHostException("api-staging.pawsitivemileage.app") }

    @Test
    fun `online loads are kept, and shown offline with when they were saved`() = runTest {
        val cache = SnapshotCache(tmp.root, now = { 1_000L })
        val live = cache.load("garage", serializer) { garage }
        assertEquals(garage, live.value)
        assertNull(live.offlineSince)

        val saved = cache.load("garage", serializer, offline)
        assertEquals(garage, saved.value)
        assertEquals(1_000L, saved.offlineSince)
    }

    @Test
    fun `offline with nothing saved, and after sign-out, still fails`() = runTest {
        val cache = SnapshotCache(tmp.root)
        try { cache.load("garage", serializer, offline); fail() } catch (_: IOException) {}
        cache.load("garage", serializer) { garage }
        cache.clear()
        try { cache.load("garage", serializer, offline); fail() } catch (_: IOException) {}
    }

    @Test
    fun `API errors are not hidden behind the snapshot`() = runTest {
        val cache = SnapshotCache(tmp.root)
        cache.load("garage", serializer) { garage }
        try {
            cache.load("garage", serializer) { throw app.pawsitivemileage.api.ApiException(403, "FORBIDDEN", "no", null) }
            fail()
        } catch (_: app.pawsitivemileage.api.ApiException) {}
    }

    @Test
    fun `offline label`() {
        assertEquals("Offline · last updated Oct 21, 9:07 PM", Format.offline(1_761_080_820_000L, ZoneOffset.UTC))
    }
}
