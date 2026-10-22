package app.pawsitivemileage.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.pawsitivemileage.auth.SessionState

@Composable
fun SignInScreen(state: SessionState, error: String?, onSignIn: () -> Unit, onRetry: () -> Unit) {
    Column(
        Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("PawsitiveMileage", style = MaterialTheme.typography.headlineMedium)
        Text("Fuel and maintenance, tracked.", style = MaterialTheme.typography.bodyLarge)
        when (state) {
            SessionState.Loading -> CircularProgressIndicator()
            is SessionState.UpdateRequired -> Text(
                "This version is no longer supported. Update the app to ${state.minimum} or later.",
                textAlign = TextAlign.Center,
            )
            is SessionState.Unavailable -> {
                Text(state.reason, textAlign = TextAlign.Center)
                OutlinedButton(onClick = onRetry) { Text("Try again") }
            }
            else -> Button(onClick = onSignIn) { Text("Sign in with Google") }
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, textAlign = TextAlign.Center) }
    }
}
