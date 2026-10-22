package app.pawsitivemileage.auth

import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.net.toUri
import app.pawsitivemileage.api.ApiClient
import app.pawsitivemileage.api.call
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import net.openid.appauth.AuthState
import net.openid.appauth.AuthorizationException
import net.openid.appauth.AuthorizationRequest
import net.openid.appauth.AuthorizationResponse
import net.openid.appauth.AuthorizationService
import net.openid.appauth.AuthorizationServiceConfiguration
import net.openid.appauth.ResponseTypeValues
import okhttp3.FormBody
import okhttp3.OkHttpClient
import okhttp3.Request
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

sealed interface SessionState {
    data object Loading : SessionState
    data object SignedOut : SessionState
    data object SignedIn : SessionState
    /** /v1/meta says this version is no longer supported */
    data class UpdateRequired(val minimum: String) : SessionState
    data class Unavailable(val reason: String) : SessionState
}

/**
 * Sign-in with the Cognito Hosted UI: authorization code + PKCE through a Custom Tab (AppAuth).
 * The endpoints and client come from GET /v1/meta. Tokens are kept in [SecureStore] and the
 * access token is refreshed with the refresh token when it expires.
 */
class AuthManager(
    context: Context,
    private val api: () -> ApiClient,
    private val appVersion: String,
    private val okHttp: OkHttpClient = OkHttpClient(),
) {
    private val service = AuthorizationService(context.applicationContext)
    private val store = SecureStore(context.applicationContext)
    private val refreshLock = Mutex()
    private var config: AuthConfig? = null
    private var authState: AuthState? = store.get(KEY)?.let { runCatching { AuthState.jsonDeserialize(it) }.getOrNull() }

    private val _state = MutableStateFlow<SessionState>(SessionState.Loading)
    val state: StateFlow<SessionState> = _state

    /** Load the sign-in settings and decide the starting state. Safe to call again (retry). */
    suspend fun start() {
        _state.value = SessionState.Loading
        _state.value = try {
            val meta = call { api().meta.getMeta() }.`data`
            val minimum = meta.minimumVersions[AuthConfig.PLATFORM]
            when {
                minimum != null && Versions.isOlder(appVersion, minimum) -> SessionState.UpdateRequired(minimum)
                else -> {
                    config = AuthConfig.from(meta) ?: return run { _state.value = SessionState.Unavailable("Sign-in isn't available for this server") }
                    if (authState?.isAuthorized == true) SessionState.SignedIn else SessionState.SignedOut
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Loading /v1/meta failed", e)
            // Offline at launch: a stored session still works for queued entries
            if (authState?.isAuthorized == true) SessionState.SignedIn else SessionState.Unavailable(e.message ?: "Can't reach the server")
        }
    }

    /** Intent that opens the Hosted UI (straight to Google) in a Custom Tab */
    fun signInIntent(): Intent {
        val c = requireNotNull(config) { "start() first" }
        val request = AuthorizationRequest.Builder(serviceConfig(c), c.clientId, ResponseTypeValues.CODE, c.redirectUri.toUri())
            .setScopes(c.scopes)
            .setAdditionalParameters(mapOf("identity_provider" to "Google"))
            .build()
        return service.getAuthorizationRequestIntent(request)
    }

    /** Finish sign-in with the redirect the Custom Tab returned */
    suspend fun completeSignIn(data: Intent?) {
        val response = data?.let { AuthorizationResponse.fromIntent(it) }
        val error = data?.let { AuthorizationException.fromIntent(it) }
        if (response == null) {
            _state.value = SessionState.SignedOut
            if (error != null && error.code != AuthorizationException.GeneralErrors.USER_CANCELED_AUTH_FLOW.code) throw error
            return
        }
        val state = AuthState(response, null)
        val tokens = suspendCancellableCoroutine { cont ->
            service.performTokenRequest(response.createTokenExchangeRequest()) { tokenResponse, ex ->
                if (tokenResponse != null) cont.resume(tokenResponse) else cont.resumeWithException(ex ?: IllegalStateException("No token response"))
            }
        }
        state.update(tokens, null)
        save(state)
        // First sign-in creates the profile (from Cognito's userInfo, since this is an access token)
        call { api().profile.getProfile() }
        _state.value = SessionState.SignedIn
    }

    /** A fresh access token, or null when signed out. Refreshes at most one at a time. */
    suspend fun accessToken(): String? = refreshLock.withLock {
        val state = authState ?: return null
        if (!state.isAuthorized) return null
        try {
            suspendCancellableCoroutine { cont ->
                state.performActionWithFreshTokens(service) { token, _, ex ->
                    if (ex != null) cont.resumeWithException(ex) else cont.resume(token)
                }
            }.also { save(state) }
        } catch (e: AuthorizationException) {
            if (e.type == AuthorizationException.TYPE_OAUTH_TOKEN_ERROR) {
                clear() // refresh token expired or revoked: sign in again
                null
            } else {
                throw e
            }
        }
    }

    /** Revoke the refresh token (best effort) and forget the session */
    suspend fun signOut() {
        val refreshToken = authState?.refreshToken
        val c = config
        if (refreshToken != null && c != null) {
            withContext(Dispatchers.IO) {
                runCatching {
                    okHttp.newCall(
                        Request.Builder().url(c.revocationEndpoint)
                            .post(FormBody.Builder().add("token", refreshToken).add("client_id", c.clientId).build())
                            .build(),
                    ).execute().close()
                }
            }
        }
        clear()
    }

    private fun clear() {
        authState = null
        store.remove(KEY)
        _state.value = SessionState.SignedOut
    }

    private fun save(state: AuthState) {
        authState = state
        store.put(KEY, state.jsonSerializeString())
    }

    private fun serviceConfig(c: AuthConfig) = AuthorizationServiceConfiguration(
        c.authorizationEndpoint.toUri(),
        c.tokenEndpoint.toUri(),
        null,
        c.logoutEndpoint.toUri(),
    )

    private companion object {
        const val KEY = "authState"
        const val TAG = "PawsitiveMileage"
    }
}
