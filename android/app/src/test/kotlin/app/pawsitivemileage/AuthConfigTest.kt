package app.pawsitivemileage

import app.pawsitivemileage.api.ApiClient
import app.pawsitivemileage.api.generated.models.GetMetaResponse
import app.pawsitivemileage.auth.AuthConfig
import app.pawsitivemileage.auth.Versions
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AuthConfigTest {
    /** The shape GET /v1/meta returns on staging, plus a field this app doesn't know */
    private val metaJson = """
        {"data":{"apiVersion":"v1","minimumVersions":{"android":"1.0.0","ios":"1.0.0","cli":"0.1.0"},"features":{},
         "links":{"privacyPolicy":"https://staging.pawsitivemileage.app/privacy","terms":"https://staging.pawsitivemileage.app/terms","accountDeletion":"https://staging.pawsitivemileage.app/account"},
         "serverTime":"2026-10-21T22:00:00.000Z","somethingNew":true,
         "auth":{"issuer":"https://cognito-idp.us-east-1.amazonaws.com/us-east-1_geu3Uz3AV","domain":"auth-staging.pawsitivemileage.app","scopes":["openid","email","profile"],
          "clients":{"android":{"clientId":"4ea1ibkbg20t5kj7c0no6hvf7a","redirectUri":"app.pawsitivemileage.staging://callback","logoutUri":"app.pawsitivemileage.staging://signout"},
                     "cli":{"clientId":"4oquoe0ffo68dj4g4vkjco9196","redirectUri":"http://localhost:47815/callback","logoutUri":"http://localhost:47815/signout"}}}},
         "requestId":"r"}
    """.trimIndent()

    private fun meta() = ApiClient.json.decodeFromString(GetMetaResponse.serializer(), metaJson).`data`

    @Test
    fun `builds the Hosted UI endpoints and picks the android client`() {
        val config = AuthConfig.from(meta())!!
        assertEquals("4ea1ibkbg20t5kj7c0no6hvf7a", config.clientId)
        assertEquals("app.pawsitivemileage.staging://callback", config.redirectUri)
        assertEquals("https://auth-staging.pawsitivemileage.app/oauth2/authorize", config.authorizationEndpoint)
        assertEquals("https://auth-staging.pawsitivemileage.app/oauth2/token", config.tokenEndpoint)
        assertEquals("https://auth-staging.pawsitivemileage.app/oauth2/revoke", config.revocationEndpoint)
        assertEquals(listOf("openid", "email", "profile"), config.scopes)
    }

    @Test
    fun `no android client means no sign-in`() {
        val m = meta()
        assertNull(AuthConfig.from(m.copy(auth = m.auth!!.copy(clients = m.auth!!.clients - "android"))))
        assertNull(AuthConfig.from(m.copy(auth = null)))
    }

    @Test
    fun `compares versions numerically and ignores flavor suffixes`() {
        assertTrue(Versions.isOlder("0.9.0", "1.0.0"))
        assertTrue(Versions.isOlder("1.2.9", "1.10.0"))
        assertFalse(Versions.isOlder("1.0.0", "1.0.0"))
        assertFalse(Versions.isOlder("1.0.0-staging", "1.0.0"))
        assertFalse(Versions.isOlder("2.0", "1.9.9"))
    }
}
