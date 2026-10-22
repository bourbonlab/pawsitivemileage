package app.pawsitivemileage

import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.lifecycle.lifecycleScope
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import app.pawsitivemileage.api.ApiClient
import app.pawsitivemileage.auth.SessionState
import app.pawsitivemileage.data.GarageVehicle
import app.pawsitivemileage.ui.AccountScreen
import app.pawsitivemileage.ui.FillupFormScreen
import app.pawsitivemileage.ui.GarageScreen
import app.pawsitivemileage.ui.MaintenanceFormScreen
import app.pawsitivemileage.ui.SignInScreen
import app.pawsitivemileage.ui.VehicleFormScreen
import app.pawsitivemileage.ui.VehicleScreen
import app.pawsitivemileage.ui.theme.PawsitiveTheme
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val container by lazy { (application as PawsitiveApp).container }
    private val signInError = mutableStateOf<String?>(null)

    private val signIn = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        lifecycleScope.launch {
            runCatching { container.auth.completeSignIn(result.data) }
                .onFailure { signInError.value = it.message ?: "Sign-in failed" }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        lifecycleScope.launch { container.auth.start() }

        setContent {
            PawsitiveTheme {
                val session by container.auth.state.collectAsState()
                val error by signInError
                val scope = rememberCoroutineScope()
                val nav = rememberNavController()

                if (session != SessionState.SignedIn) {
                    SignInScreen(
                        state = session,
                        error = error,
                        onSignIn = { signInError.value = null; signIn.launch(container.auth.signInIntent()) },
                        onRetry = { scope.launch { container.auth.start() } },
                    )
                    return@PawsitiveTheme
                }
                LaunchedEffect(Unit) { signInError.value = null }

                // The vehicle travels in the route as JSON (nickname, permission), so screens need no lookup
                fun vehicleRoute(v: GarageVehicle) = "vehicle?v=${Uri.encode(ApiClient.json.encodeToString(GarageVehicle.serializer(), v))}"
                fun NavBackStackEntry.vehicle() = ApiClient.json.decodeFromString(GarageVehicle.serializer(), arguments?.getString("v").orEmpty())
                val vArg = listOf(navArgument("v") { type = NavType.StringType })
                val back: () -> Unit = { nav.popBackStack() }

                NavHost(nav, startDestination = "garage") {
                    composable("garage") {
                        GarageScreen(
                            vehicles = container.vehicles,
                            onOpen = { nav.navigate(vehicleRoute(it)) },
                            onAddVehicle = { nav.navigate("vehicle-form") },
                            onAccount = { nav.navigate("account") },
                        )
                    }
                    composable("account") {
                        AccountScreen(
                            api = container.api,
                            siteUrl = BuildConfig.SITE_URL,
                            onSignOut = { scope.launch { container.signOut() } },
                            onDeleteAccount = { container.deleteAccount(); signInError.value = "Your account was deleted." },
                            onBack = back,
                        )
                    }
                    composable("vehicle?v={v}", arguments = vArg) { entry ->
                        val v = entry.vehicle()
                        VehicleScreen(
                            vehicle = v,
                            records = container.records,
                            queue = container.queue,
                            onAddFillup = { nav.navigate("fillup?vehicleId=${v.vehicleId}") },
                            onEditFillup = { nav.navigate("fillup?vehicleId=${v.vehicleId}&id=${it.fillupId}") },
                            onAddMaintenance = { nav.navigate("maintenance?vehicleId=${v.vehicleId}") },
                            onEditMaintenance = { nav.navigate("maintenance?vehicleId=${v.vehicleId}&id=${it.recordId}") },
                            onEditVehicle = { nav.navigate("vehicle-form?id=${v.vehicleId}") },
                            onBack = back,
                        )
                    }
                    val recordArgs = listOf(
                        navArgument("vehicleId") { type = NavType.StringType },
                        navArgument("id") { type = NavType.StringType; nullable = true; defaultValue = null },
                    )
                    composable("fillup?vehicleId={vehicleId}&id={id}", arguments = recordArgs) { entry ->
                        FillupFormScreen(
                            entry.arguments?.getString("vehicleId").orEmpty(), entry.arguments?.getString("id"),
                            container.records, container.queue, container.attachments, container.locations, onDone = back,
                        )
                    }
                    composable("maintenance?vehicleId={vehicleId}&id={id}", arguments = recordArgs) { entry ->
                        MaintenanceFormScreen(
                            entry.arguments?.getString("vehicleId").orEmpty(), entry.arguments?.getString("id"),
                            container.records, container.queue, container.attachments, container.locations, onDone = back,
                        )
                    }
                    composable(
                        "vehicle-form?id={id}",
                        arguments = listOf(navArgument("id") { type = NavType.StringType; nullable = true; defaultValue = null }),
                    ) { entry ->
                        val id = entry.arguments?.getString("id")
                        VehicleFormScreen(id, container.vehicles, container.attachments) { saved ->
                            // A new vehicle, or one just archived, is best seen from the garage
                            if (saved != null && id != null) nav.popBackStack("garage", inclusive = false) else back()
                        }
                    }
                }
            }
        }
    }
}
