package com.folk3s.echo.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.folk3s.echo.api.ApiError
import com.folk3s.echo.echo
import kotlinx.coroutines.launch

/**
 * Sign in (S0): this device gets its own token, listed in Sessions & devices. With two-factor on,
 * the server answers `totp_required` and the code field appears; both go in one request.
 */
@Composable
fun SignInScreen() {
  val app = LocalContext.current.echo
  val scope = rememberCoroutineScope()
  var username by remember { mutableStateOf("") }
  var password by remember { mutableStateOf("") }
  var code by remember { mutableStateOf("") }
  var needsCode by remember { mutableStateOf(false) }
  var busy by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf<String?>(null) }

  fun submit() {
    if (busy || username.isBlank() || password.isEmpty() || (needsCode && code.isBlank())) return
    busy = true
    error = null
    scope.launch {
      try {
        app.api.signIn(username.trim(), password, code.takeIf { needsCode })
      } catch (e: ApiError) {
        when {
          e.code == "totp_required" -> needsCode = true
          e.code == "bad_code" -> error = "That code did not work. Try the current one."
          e.status == 429 -> error = "Too many attempts. Wait a minute and try again."
          else -> error = "Username or password is incorrect."
        }
      } catch (e: java.io.IOException) {
        error = "ECHO didn't answer. Check the connection and try again."
      } finally {
        busy = false
      }
    }
  }

  Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
    Column(
      Modifier.safeDrawingPadding().imePadding().verticalScroll(rememberScrollState()).padding(24.dp).widthIn(max = 420.dp).fillMaxWidth(),
      verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
      Text("ECHO", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.titleLarge)
      Text(if (needsCode) "Two-factor code" else "Sign in", style = MaterialTheme.typography.headlineMedium)
      Text(app.api.base.substringAfter("://"), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
      OutlinedTextField(
        username,
        { username = it },
        label = { Text("Username") },
        singleLine = true,
        enabled = !needsCode,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii, imeAction = ImeAction.Next, autoCorrectEnabled = false),
        modifier = Modifier.fillMaxWidth(),
      )
      OutlinedTextField(
        password,
        { password = it },
        label = { Text("Password") },
        singleLine = true,
        enabled = !needsCode,
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = if (needsCode) ImeAction.Next else ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { submit() }),
        modifier = Modifier.fillMaxWidth(),
      )
      if (needsCode) {
        OutlinedTextField(
          code,
          { code = it },
          label = { Text("Code") },
          supportingText = { Text("The 6-digit code from your authenticator app, or a recovery code.") },
          singleLine = true,
          keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii, imeAction = ImeAction.Done, autoCorrectEnabled = false),
          keyboardActions = KeyboardActions(onDone = { submit() }),
          modifier = Modifier.fillMaxWidth(),
        )
      }
      error?.let {
        Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Assertive })
      }
      Button(onClick = ::submit, enabled = !busy, modifier = Modifier.align(Alignment.Start)) { Text(if (needsCode) "Verify" else "Sign in") }
    }
  }
}
