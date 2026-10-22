package app.pawsitivemileage.location

import android.annotation.SuppressLint
import android.content.Context
import android.location.Geocoder
import android.location.Location
import android.location.LocationManager
import android.os.Build
import androidx.core.content.getSystemService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.util.Locale
import kotlin.coroutines.resume
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

data class Place(val lat: Double, val lng: Double, val address: String?)

/** Distance in meters between two coordinates (haversine) */
fun distanceMeters(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
    val r = 6_371_000.0
    val dLat = Math.toRadians(lat2 - lat1)
    val dLng = Math.toRadians(lng2 - lng1)
    val a = sin(dLat / 2).pow(2) + cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLng / 2).pow(2)
    return 2 * r * atan2(sqrt(a), sqrt(1 - a))
}

/** A station name used before within [maxMeters] of here, closest first; null when none */
fun nearbyStationName(lat: Double, lng: Double, earlier: List<Triple<Double, Double, String>>, maxMeters: Double = 200.0): String? =
    earlier.map { (la, ln, name) -> distanceMeters(lat, lng, la, ln) to name }
        .filter { it.first <= maxMeters }
        .minByOrNull { it.first }?.second

/**
 * The phone's current position and its street address, using only the platform: the
 * LocationManager and the built-in Geocoder. No Play Services, no API key. Callers ask for the
 * location permission first.
 */
class Locations(private val context: Context) {
    @SuppressLint("MissingPermission")
    suspend fun current(): Place? {
        val manager = context.getSystemService<LocationManager>() ?: return null
        val provider = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER).firstOrNull { manager.isProviderEnabled(it) }
            ?: return null
        val location: Location? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            withTimeoutOrNull(20_000) {
                suspendCancellableCoroutine { cont ->
                    manager.getCurrentLocation(provider, null, context.mainExecutor) { cont.resume(it) }
                }
            }
        } else {
            null
        } ?: manager.getLastKnownLocation(provider)
        return location?.let { Place(it.latitude, it.longitude, address(it.latitude, it.longitude)) }
    }

    private suspend fun address(lat: Double, lng: Double): String? {
        if (!Geocoder.isPresent()) return null
        val geocoder = Geocoder(context, Locale.getDefault())
        return runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                withTimeoutOrNull(10_000) {
                    suspendCancellableCoroutine<String?> { cont ->
                        geocoder.getFromLocation(lat, lng, 1, object : Geocoder.GeocodeListener {
                            override fun onGeocode(addresses: MutableList<android.location.Address>) = cont.resume(addresses.firstOrNull()?.getAddressLine(0))
                            override fun onError(errorMessage: String?) = cont.resume(null)
                        })
                    }
                }
            } else {
                @Suppress("DEPRECATION")
                withContext(Dispatchers.IO) { geocoder.getFromLocation(lat, lng, 1)?.firstOrNull()?.getAddressLine(0) }
            }
        }.getOrNull()
    }
}
