package app.pawsitivemileage.auth

import app.pawsitivemileage.api.generated.models.Meta

/**
 * Sign-in settings for this app, from GET /v1/meta (#22, #23): the Hosted UI domain, the Android
 * client and its redirect URI. Nothing environment-specific is compiled in except the API URL.
 */
data class AuthConfig(
    val clientId: String,
    val redirectUri: String,
    val logoutUri: String,
    val scopes: List<String>,
    val authorizationEndpoint: String,
    val tokenEndpoint: String,
    val revocationEndpoint: String,
    val logoutEndpoint: String,
) {
    companion object {
        const val PLATFORM = "android"

        /** Null when this environment doesn't offer Android sign-in */
        fun from(meta: Meta): AuthConfig? {
            val auth = meta.auth ?: return null
            val client = auth.clients[PLATFORM] ?: return null
            val base = "https://${auth.domain}"
            return AuthConfig(
                clientId = client.clientId,
                redirectUri = client.redirectUri,
                logoutUri = client.logoutUri,
                scopes = auth.scopes,
                authorizationEndpoint = "$base/oauth2/authorize",
                tokenEndpoint = "$base/oauth2/token",
                revocationEndpoint = "$base/oauth2/revoke",
                logoutEndpoint = "$base/logout",
            )
        }
    }
}

/** Version gating against /v1/meta's minimumVersions.android */
object Versions {
    /** True when `version` (e.g. "1.0.0" or "1.0.0-staging") is below `minimum` */
    fun isOlder(version: String, minimum: String): Boolean {
        val a = parts(version)
        val b = parts(minimum)
        for (i in 0 until 3) {
            if (a[i] != b[i]) return a[i] < b[i]
        }
        return false
    }

    private fun parts(v: String): List<Int> =
        v.substringBefore('-').split('.').map { it.toIntOrNull() ?: 0 }.plus(listOf(0, 0, 0)).take(3)
}
