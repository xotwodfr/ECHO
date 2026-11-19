package com.folk3s.echo.offline

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network as AndroidNetwork
import android.net.NetworkCapabilities
import com.folk3s.echo.EchoApp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.Request

/**
 * Whether ECHO can be used online (v0.8): the phone has a network and the server answered the
 * last request. While it can't, the app shows the downloads; once the network is back (or every
 * 20 s while it seems up), ECHO's health check is asked again.
 */
class Network(private val app: EchoApp) {
  private val cm = app.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
  private val _connected = MutableStateFlow(true)
  private val _unmetered = MutableStateFlow(false)

  /** A network with internet access, whatever it is. */
  val connected: StateFlow<Boolean> = _connected

  /** Wi-Fi or another network that isn't metered ("Download only on Wi-Fi"). */
  val unmetered: StateFlow<Boolean> = _unmetered

  /** The phone has a network and ECHO answers. */
  val online: StateFlow<Boolean> =
    combine(_connected, app.api.reachable) { c, r -> c && r }.stateIn(app.scope, SharingStarted.Eagerly, true)

  init {
    read(cm.getNetworkCapabilities(cm.activeNetwork))
    runCatching {
      cm.registerDefaultNetworkCallback(
        object : ConnectivityManager.NetworkCallback() {
          override fun onCapabilitiesChanged(network: AndroidNetwork, caps: NetworkCapabilities) = read(caps)

          override fun onLost(network: AndroidNetwork) = read(null)
        },
      )
    }
    // While the server seems away but the phone has a network: ask again now and then.
    app.scope.launch {
      combine(_connected, app.api.reachable) { c, r -> c && !r }.collectLatest { away ->
        while (away) {
          probe()
          delay(20_000)
        }
      }
    }
  }

  private fun read(caps: NetworkCapabilities?) {
    _connected.value = caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
    _unmetered.value = caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) == true
  }

  /** ECHO's health check: any answer counts as reachable (the API client notes it). */
  suspend fun probe() {
    withContext(Dispatchers.IO) {
      runCatching { app.api.http.newCall(Request.Builder().url(app.api.url("/api/v1/health")).build()).execute().close() }
    }
  }
}
