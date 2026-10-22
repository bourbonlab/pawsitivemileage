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
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import app.pawsitivemileage.auth.SessionState
import app.pawsitivemileage.ui.AddFillupScreen
import app.pawsitivemileage.ui.GarageScreen
import app.pawsitivemileage.ui.SignInScreen
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

                NavHost(nav, startDestination = "garage") {
                    composable("garage") {
                        GarageScreen(
                            api = container.api,
                            snapshots = container.snapshots,
                            onOpen = { nav.navigate("vehicle/${it.vehicleId}?name=${Uri.encode(it.nickname)}") },
                            onSignOut = { scope.launch { container.signOut() } },
                        )
                    }
                    composable(
                        "vehicle/{vehicleId}?name={name}",
                        arguments = listOf(navArgument("vehicleId") { type = NavType.StringType }, navArgument("name") { defaultValue = "" }),
                    ) { entry ->
                        val vehicleId = entry.arguments?.getString("vehicleId").orEmpty()
                        VehicleScreen(
                            vehicleId = vehicleId,
                            nickname = entry.arguments?.getString("name").orEmpty(),
                            repo = container.fillups,
                            onAdd = { nav.navigate("vehicle/$vehicleId/add") },
                            onBack = { nav.popBackStack() },
                        )
                    }
                    composable("vehicle/{vehicleId}/add") { entry ->
                        AddFillupScreen(entry.arguments?.getString("vehicleId").orEmpty(), container.fillups, onDone = { nav.popBackStack() })
                    }
                }
            }
        }
    }
}
