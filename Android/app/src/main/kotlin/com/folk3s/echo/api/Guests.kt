package com.folk3s.echo.api

import android.os.Build
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

// Guest accounts (src/server/guests.ts): a code shown as a QR code by any user, scanned here to
// join as a guest; the guest's own state; the inviter's list of guests to keep or end.

@Serializable data class GuestCode(val code: String, val url: String, val expiresAt: Long, val durationMs: Long)

@Serializable data class GuestPeek(val invitedBy: String, val durationMs: Long)

@Serializable data class KeepRequest(val username: String, val requestedAt: Long? = null)

@Serializable data class GuestMe(val expiresAt: Long, val invitedBy: String? = null, val keep: KeepRequest? = null)

@Serializable
data class Guest(
  val id: Long,
  val username: String,
  val invitedBy: String? = null,
  val createdAt: Long,
  val expiresAt: Long,
  val keep: KeepRequest? = null,
)

/** The code in a scanned QR code, if it is a guest code for this server (`<origin>/guest#<code>`). */
fun guestCodeOf(scanned: String, base: String): String? {
  val origin = base.trimEnd('/')
  val prefix = "$origin/guest#"
  if (!scanned.startsWith(prefix)) return null
  return scanned.removePrefix(prefix).takeIf { Regex("^[\\w-]{16,64}$").matches(it) }
}

/** A duration as people say it: "1 hour", "1 day", "1 week"; "3 days" and the like for others. */
fun durationText(ms: Long): String {
  val h = ms / 3_600_000
  return when {
    h < 24 -> if (h == 1L) "1 hour" else "$h hours"
    h % (24 * 7) == 0L -> (h / (24 * 7)).let { if (it == 1L) "1 week" else "$it weeks" }
    else -> (h / 24).let { if (it == 1L) "1 day" else "$it days" }
  }
}

/** Time left, short: "18 h left", "42 min left", "3 days left". */
fun timeLeftText(ms: Long): String {
  val min = (ms / 60_000).coerceAtLeast(0)
  return when {
    min < 60 -> "$min min left"
    min < 48 * 60 -> "${min / 60} h left"
    else -> "${min / (24 * 60)} days left"
  }
}

suspend fun Api.createGuestCode(durationMs: Long): GuestCode =
  EchoJson.decodeFromJsonElement(send("POST", "/guests/codes", buildJsonObject { put("durationMs", durationMs) }))

suspend fun Api.peekGuestCode(code: String): GuestPeek =
  EchoJson.decodeFromJsonElement(send("POST", "/guests/peek", buildJsonObject { put("code", code) }))

/** Join as a guest: this phone keeps the guest's token until its time is up. */
suspend fun Api.redeemGuestCode(code: String) {
  val res =
    send(
      "POST",
      "/guests/redeem",
      buildJsonObject {
        put("code", code)
        put("name", "ECHO guest (${Build.MANUFACTURER} ${Build.MODEL})".take(64))
      },
    )
  tokens.set((res as JsonObject)["token"]!!.jsonPrimitive.content)
}

suspend fun Api.guestMe(): GuestMe? {
  val g = get("/guests/me").jsonObject["guest"] ?: return null
  return if (g is JsonObject) EchoJson.decodeFromJsonElement(g) else null
}

suspend fun Api.askToKeep(username: String, password: String) {
  send(
    "POST",
    "/guests/me/keep",
    buildJsonObject {
      put("username", username)
      put("password", password)
    },
  )
}

suspend fun Api.guests(): List<Guest> = EchoJson.decodeFromJsonElement(get("/guests"))

suspend fun Api.approveGuest(id: Long) {
  send("POST", "/guests/$id/approve", buildJsonObject {})
}

suspend fun Api.endGuest(id: Long) {
  send("POST", "/guests/$id/end", buildJsonObject {})
}

// ---- Sign in on a computer (src/server/qrlogin.ts) ----

@Serializable data class LinkPeek(val browser: String, val ip: String, val expiresAt: Long)

/** The request id in a scanned sign-in QR code, if it is for this server (`<origin>/link#<id>`). */
fun linkCodeOf(scanned: String, base: String): String? {
  val prefix = "${base.trimEnd('/')}/link#"
  if (!scanned.startsWith(prefix)) return null
  return scanned.removePrefix(prefix).takeIf { Regex("^[\\w-]{16,64}$").matches(it) }
}

suspend fun Api.peekLink(id: String): LinkPeek =
  EchoJson.decodeFromJsonElement(send("POST", "/auth/qr/peek", buildJsonObject { put("id", id) }))

suspend fun Api.approveLink(id: String) {
  send("POST", "/auth/qr/approve", buildJsonObject { put("id", id) })
}
