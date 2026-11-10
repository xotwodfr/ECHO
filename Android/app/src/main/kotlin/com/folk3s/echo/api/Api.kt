package com.folk3s.echo.api

import android.os.Build
import com.folk3s.echo.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

val EchoJson = Json {
  ignoreUnknownKeys = true
  explicitNulls = false
  coerceInputValues = true
}

/** For what other clients read back (the saved queue): every field, defaults and empty lists too. */
val EchoJsonFull = Json(EchoJson) { encodeDefaults = true }

private const val RETRIES = 2

/** The wait before retry `attempt` (0, 1): 300 ms then 900 ms, each ×0.5–1.5 (retryDelay in api.ts). */
internal fun retryDelay(attempt: Int, rand: Double): Long = (300 * Math.pow(3.0, attempt.toDouble()) * (0.5 + rand)).toLong()

/** An answer other than 2xx: the HTTP status and ECHO's error code (`{ error }`), when it sent one. */
class ApiError(val status: Int, val code: String?) : Exception("HTTP $status${code?.let { " $it" } ?: ""}")

/**
 * ECHO's `/api/v1` with the device token as a bearer header (the Origin check exempts it). The
 * server is fixed: echo.folk3s.com (owner, 2026-10-29); debug builds can point elsewhere for testing.
 */
class Api(private val tokens: TokenStore) {
  val base: String = BuildConfig.ECHO_URL.trimEnd('/')
  private val host = base.toHttpUrl().host

  private val _revoked = MutableSharedFlow<Unit>(extraBufferCapacity = 1)

  /** The server refused the token (revoked in Sessions & devices, or idle 60 days). */
  val revoked: SharedFlow<Unit> = _revoked

  val http: OkHttpClient =
    OkHttpClient.Builder()
      .addInterceptor { chain ->
        val req = chain.request()
        val token = tokens.token.value
        val ours = req.url.host == host
        val out =
          if (token != null && ours && req.header("Authorization") == null) {
            req.newBuilder().header("Authorization", "Bearer $token").build()
          } else req
        val res = chain.proceed(out)
        if (res.code == 401 && token != null && ours && !req.url.encodedPath.endsWith("/auth/device")) {
          _revoked.tryEmit(Unit)
        }
        res
      }
      .build()

  /** A server path (as tracks keep their artwork) as a full URL. */
  fun url(path: String) = if (path.startsWith("http")) path else "$base$path"

  suspend fun get(path: String): JsonElement = call(Request.Builder().url(url("/api/v1$path")).build())

  suspend fun send(method: String, path: String, body: JsonElement? = null): JsonElement {
    val json = (body ?: JsonObject(emptyMap())).toString().toRequestBody(JSON)
    return call(Request.Builder().url(url("/api/v1$path")).method(method, json).build())
  }

  private suspend fun call(req: Request): JsonElement =
    withContext(Dispatchers.IO) {
      var attempt = 0
      while (true) {
        // A read that failed on the way is asked again, twice at most (src/client/api.ts); a write never.
        val again = req.method == "GET" && attempt < RETRIES
        val wait =
          try {
            http.newCall(req).execute().use { res ->
              val text = res.body.string()
              val json = runCatching { EchoJson.parseToJsonElement(text) }.getOrDefault(JsonNull)
              if (res.isSuccessful) return@withContext json
              val code = (json as? JsonObject)?.get("error")?.jsonPrimitive?.contentOrNull
              // ECHO's own 502 (Navidrome is down) carries a code and is an answer; a proxy's has none.
              val passing = res.code == 429 || (code == null && res.code in 502..504)
              if (!again || !passing) throw ApiError(res.code, code)
              if (res.code == 429) (res.header("Retry-After")?.toLongOrNull() ?: 0) * 1000 else 0
            }
          } catch (e: java.io.InterruptedIOException) {
            throw e // a timeout already took its time
          } catch (e: java.io.IOException) {
            if (!again) throw e
            0L
          }
        delay(wait + retryDelay(attempt++, Math.random()))
      }
      @Suppress("UNREACHABLE_CODE") JsonNull
    }

  /**
   * Signs this device in (`POST /auth/device`): credentials and, with two-factor on, the code in the
   * same request. Throws [ApiError]: 401 `totp_required`, `bad_code` or no code (wrong credentials).
   */
  suspend fun signIn(username: String, password: String, code: String?) {
    val res =
      send(
        "POST",
        "/auth/device",
        buildJsonObject {
          put("username", username)
          put("password", password)
          if (!code.isNullOrBlank()) put("code", code.trim())
          put("name", "ECHO for Android (${Build.MANUFACTURER} ${Build.MODEL})".take(64))
        },
      )
    tokens.set((res as JsonObject)["token"]!!.jsonPrimitive.content)
  }

  suspend fun signOut() {
    runCatching { send("POST", "/auth/logout") }
    tokens.set(null)
  }

  private companion object {
    val JSON = "application/json".toMediaType()
  }
}
