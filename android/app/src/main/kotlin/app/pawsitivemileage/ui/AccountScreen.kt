package app.pawsitivemileage.ui

import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import app.pawsitivemileage.BuildConfig
import app.pawsitivemileage.api.ApiClient
import app.pawsitivemileage.api.call
import app.pawsitivemileage.api.generated.models.User
import kotlinx.coroutines.launch

/** What the typed confirmation must be before the account can be deleted */
const val DELETE_CONFIRMATION = "DELETE"

fun canDelete(typed: String) = typed.trim() == DELETE_CONFIRMATION

/** Your profile, sign-out, and account deletion (Google Play requires deletion in the app) */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccountScreen(api: ApiClient, siteUrl: String, onSignOut: () -> Unit, onDeleteAccount: suspend () -> Unit, onBack: () -> Unit) {
    var profile by remember { mutableStateOf<User?>(null) }
    var confirming by remember { mutableStateOf(false) }
    var typed by remember { mutableStateOf("") }
    var deleting by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    LaunchedEffect(Unit) { runCatching { call { api.profile.getProfile() }.`data` }.onSuccess { profile = it } }

    Scaffold(topBar = { TopAppBar(title = { Text("Account") }, navigationIcon = { TextButton(onClick = onBack) { Text("Back") } }) }) { padding ->
        Column(
            Modifier.padding(padding).padding(16.dp).verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            profile?.let {
                Column {
                    Text(it.displayName, style = MaterialTheme.typography.titleMedium)
                    Text(it.email, style = MaterialTheme.typography.bodyMedium)
                }
            }
            OutlinedButton(onClick = onSignOut, modifier = Modifier.fillMaxWidth()) { Text("Sign out") }
            HorizontalDivider()
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Delete account", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.error)
                    Text(
                        "Permanently deletes your account and sign-in, all your vehicles with their fill-ups and maintenance, " +
                            "photos and receipts, and vehicle shares. This can't be undone.",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    TextButton(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, "$siteUrl/delete-account".toUri())) }) {
                        Text("What's deleted and kept")
                    }
                    Button(
                        onClick = { typed = ""; problem = null; confirming = true },
                        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                    ) { Text("Delete account") }
                }
            }
            problem?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Text("Version ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.bodySmall)
        }
    }

    if (confirming) {
        AlertDialog(
            onDismissRequest = { if (!deleting) confirming = false },
            title = { Text("Delete your account?") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Everything is deleted right away, including entries waiting to sync on this phone. Type $DELETE_CONFIRMATION to confirm.")
                    OutlinedTextField(typed, { typed = it }, singleLine = true, label = { Text("Type $DELETE_CONFIRMATION") })
                }
            },
            confirmButton = {
                TextButton(enabled = canDelete(typed) && !deleting, onClick = {
                    deleting = true
                    scope.launch {
                        runCatching { onDeleteAccount() }
                            .onFailure { problem = friendlyError(it, "You're offline. Connect to delete your account."); confirming = false }
                        deleting = false
                    }
                }) { Text(if (deleting) "Deleting…" else "Delete", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(enabled = !deleting, onClick = { confirming = false }) { Text("Cancel") } },
        )
    }
}
