package app.pawsitivemileage

import app.pawsitivemileage.api.ApiException
import app.pawsitivemileage.ui.OFFLINE_FILLUPS
import app.pawsitivemileage.ui.friendlyError
import org.junit.Assert.assertEquals
import org.junit.Test
import java.net.SocketTimeoutException
import java.net.UnknownHostException

class FriendlyErrorTest {
    @Test
    fun `network failures read as offline, API errors keep their message`() {
        assertEquals(OFFLINE_FILLUPS, friendlyError(UnknownHostException("Unable to resolve host \"api-staging.pawsitivemileage.app\""), OFFLINE_FILLUPS))
        assertEquals(OFFLINE_FILLUPS, friendlyError(SocketTimeoutException("timeout"), OFFLINE_FILLUPS))
        assertEquals("Vehicle not found", friendlyError(ApiException(404, "NOT_FOUND", "Vehicle not found", "r"), OFFLINE_FILLUPS))
    }
}
