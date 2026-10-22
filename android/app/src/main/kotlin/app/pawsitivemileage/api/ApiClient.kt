package app.pawsitivemileage.api

import app.pawsitivemileage.api.generated.apis.FillUpsApi
import app.pawsitivemileage.api.generated.apis.MaintenanceApi
import app.pawsitivemileage.api.generated.apis.MetaApi
import app.pawsitivemileage.api.generated.apis.ProfileApi
import app.pawsitivemileage.api.generated.apis.SharingApi
import app.pawsitivemileage.api.generated.apis.UploadsApi
import app.pawsitivemileage.api.generated.apis.VehiclesApi
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * The PawsitiveMileage API, through the Retrofit interfaces generated from
 * packages/contracts/openapi.json (Gradle task generateApiClient). Responses are lenient about
 * fields the app doesn't know yet, so a newer API never breaks an installed app.
 */
class ApiClient(
    baseUrl: String,
    clientVersion: String,
    /** Current access token, refreshed if needed; null when signed out */
    private val accessToken: suspend () -> String?,
    okHttp: OkHttpClient = OkHttpClient(),
) {
    private val client = okHttp.newBuilder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .addInterceptor(Interceptor { chain ->
            val request = chain.request().newBuilder().header("X-Client", "android/$clientVersion")
            // GET /v1/meta is public; everything else carries the token when there is one.
            // OkHttp runs interceptors on its own threads, so blocking for the token is fine.
            if (!chain.request().url.encodedPath.endsWith("/v1/meta")) {
                tokenFor(accessToken)?.let { request.header("Authorization", "Bearer $it") }
            }
            chain.proceed(request.build())
        })
        .build()

    private val retrofit = Retrofit.Builder()
        .baseUrl(baseUrl.trimEnd('/') + "/")
        .client(client)
        .addConverterFactory(EnumQueryConverterFactory)
        .addConverterFactory(UpdateBodyConverterFactory)
        .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
        .build()

    val meta: MetaApi = retrofit.create(MetaApi::class.java)
    val profile: ProfileApi = retrofit.create(ProfileApi::class.java)
    val vehicles: VehiclesApi = retrofit.create(VehiclesApi::class.java)
    val sharing: SharingApi = retrofit.create(SharingApi::class.java)
    val fillups: FillUpsApi = retrofit.create(FillUpsApi::class.java)
    val maintenance: MaintenanceApi = retrofit.create(MaintenanceApi::class.java)
    val uploads: UploadsApi = retrofit.create(UploadsApi::class.java)

    companion object {
        val json = Json {
            ignoreUnknownKeys = true
            explicitNulls = false
            coerceInputValues = true
        }
    }
}

/**
 * The token for a request. A failed refresh (offline, Cognito unreachable) must surface as an
 * IOException: OkHttp treats any other exception from an interceptor as a bug and rethrows it on
 * its dispatcher thread, which crashes the app. As an IOException the call just fails, and the
 * screens show their offline state.
 */
internal fun tokenFor(accessToken: suspend () -> String?): String? =
    try {
        runBlocking { accessToken() }
    } catch (e: IOException) {
        throw e
    } catch (e: Exception) {
        throw IOException("Couldn't refresh the sign-in: ${e.message ?: e.javaClass.simpleName}", e)
    }

/**
 * Run an API call and return its body, or throw [ApiException] with the API's error code and
 * message (`{ error, code, requestId }`). Network failures surface as IOException.
 */
suspend fun <T : Any> call(block: suspend () -> Response<T>): T {
    val response = block()
    if (response.isSuccessful) {
        return response.body() ?: throw ApiException(response.code(), "CONTRACT_MISMATCH", "Empty response body", null)
    }
    throw ApiException.fromResponse(response.code(), response.errorBody()?.string())
}
