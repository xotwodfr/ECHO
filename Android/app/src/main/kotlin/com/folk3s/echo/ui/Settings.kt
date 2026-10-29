package com.folk3s.echo.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
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
import com.folk3s.echo.echo
import kotlinx.coroutines.launch
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** Settings (S7): who is signed in, and signing this device out. */
@Composable
fun SettingsScreen() {
  val app = LocalContext.current.echo
  val scope = rememberCoroutineScope()
  var who by remember { mutableStateOf<String?>(null) }
  LaunchedEffect(Unit) {
    who =
      runCatching {
          val me = app.api.get("/me").jsonObject
          val name = me["username"]?.jsonPrimitive?.contentOrNull ?: ""
          val role = me["role"]?.jsonPrimitive?.contentOrNull
          "Signed in as $name${if (role == "admin") " (admin)" else ""}"
        }
        .getOrNull()
  }
  Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
    Text("Settings", style = MaterialTheme.typography.headlineMedium)
    Text("Account", style = MaterialTheme.typography.titleLarge)
    Text(who ?: app.api.base.substringAfter("://"), color = MaterialTheme.colorScheme.onSurfaceVariant)
    OutlinedButton(onClick = { scope.launch { app.api.signOut() } }) { Text("Sign out") }
  }
}
