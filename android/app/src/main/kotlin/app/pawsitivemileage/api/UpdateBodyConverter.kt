package app.pawsitivemileage.api

import app.pawsitivemileage.api.generated.models.FillupUpdate
import app.pawsitivemileage.api.generated.models.MaintenanceUpdate
import app.pawsitivemileage.api.generated.models.VehicleUpdate
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody
import retrofit2.Converter
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.lang.reflect.Type

/**
 * Update bodies keep their nulls: on an update, `null` clears a field (and `receiptPhotoKey: null`
 * removes the receipt), while an absent field is left unchanged. Everything else omits nulls.
 * A queued receipt attach sends an update with only `receiptPhotoKey` set, so absent fields
 * still matter there: [partial] bodies are encoded without nulls.
 */
object UpdateBodyConverterFactory : Converter.Factory() {
    // encodeDefaults too: the generated models default optional fields to null, which would be skipped
    private val explicit = Json(ApiClient.json) { explicitNulls = true; encodeDefaults = true }.asConverterFactory("application/json".toMediaType())
    private val types: Set<Type> = setOf(FillupUpdate::class.java, MaintenanceUpdate::class.java, VehicleUpdate::class.java)

    override fun requestBodyConverter(
        type: Type,
        parameterAnnotations: Array<out Annotation>,
        methodAnnotations: Array<out Annotation>,
        retrofit: Retrofit,
    ): Converter<*, RequestBody>? {
        if (type !in types) return null
        val full = explicit.requestBodyConverter(type, parameterAnnotations, methodAnnotations, retrofit) ?: return null
        val sparse = retrofit.nextRequestBodyConverter<Any>(this, type, parameterAnnotations, methodAnnotations)
        return Converter<Any, RequestBody> { value -> if (value in partial) sparse.convert(value) else (full as Converter<Any, RequestBody>).convert(value) }
    }

    /** Bodies to send without nulls (only their set fields): see OpQueue receipt attaches */
    private val partial = java.util.Collections.newSetFromMap(java.util.WeakHashMap<Any, Boolean>())

    fun <T : Any> partial(body: T): T = body.also { partial.add(it) }
}
