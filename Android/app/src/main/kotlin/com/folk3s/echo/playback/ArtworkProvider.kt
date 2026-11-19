package com.folk3s.echo.playback

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import com.folk3s.echo.echo
import java.io.File
import java.io.FileNotFoundException
import java.security.MessageDigest
import okhttp3.Request

/**
 * Covers for other apps that show ECHO's browse tree and now playing (Android Auto above all).
 * They load artwork by URI themselves and cannot send the device token, so the artwork URIs the
 * session hands out are `content://` ones served here: fetched through the app's authed client,
 * kept in the cache. Only covers (`/api/v1/navidrome/cover/…`): nothing else of the API is reachable.
 */
class ArtworkProvider : ContentProvider() {
  override fun onCreate() = true

  override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
    if (mode != "r") throw SecurityException("read only")
    val path = pathOf(uri) ?: throw FileNotFoundException(uri.toString())
    val ctx = context ?: throw FileNotFoundException(uri.toString())
    val dir = File(ctx.cacheDir, "artwork").apply { mkdirs() }
    val file = File(dir, sha1(path))
    if (!file.exists() || file.length() == 0L) fetch(ctx, path, file)
    return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
  }

  private fun fetch(ctx: Context, path: String, file: File) {
    val api = ctx.echo.api
    try {
      api.http.newCall(Request.Builder().url(api.url(path)).build()).execute().use { res ->
        if (!res.isSuccessful) throw FileNotFoundException("HTTP ${res.code}")
        val tmp = File(file.parentFile, file.name + ".part")
        tmp.outputStream().use { res.body.byteStream().copyTo(it) }
        if (!tmp.renameTo(file)) tmp.delete()
      }
    } catch (e: java.io.IOException) {
      throw FileNotFoundException(e.message)
    }
    if (!file.exists()) throw FileNotFoundException(path)
  }

  override fun getType(uri: Uri) = "image/*"

  override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? = null

  override fun insert(uri: Uri, values: ContentValues?): Uri? = null

  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0

  override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?) = 0

  companion object {
    fun authority(ctx: Context) = "${ctx.packageName}.artwork"

    /** A cover's server path (or full URL on ECHO's server) as a URI anyone may open; null for anything else. */
    fun uriFor(ctx: Context, cover: String?): Uri? {
      val path = coverPath(cover, ctx.echo.api.base) ?: return null
      return Uri.Builder().scheme("content").authority(authority(ctx)).appendPath("cover").appendPath(path).build()
    }

    private fun pathOf(uri: Uri): String? {
      val seg = uri.pathSegments
      if (seg.size != 2 || seg[0] != "cover") return null
      return seg[1].takeIf { it.startsWith(CarTree.COVER_PREFIX) && ".." !in it }
    }

    private fun sha1(s: String) = MessageDigest.getInstance("SHA-1").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }
  }
}

/** The server path of an ECHO cover, from a path or a full URL on [base]; null for anything else. */
internal fun coverPath(cover: String?, base: String): String? {
  val p = when {
    cover == null -> return null
    cover.startsWith(CarTree.COVER_PREFIX) -> cover
    cover.startsWith(base + CarTree.COVER_PREFIX) -> cover.removePrefix(base)
    else -> return null
  }
  return p.takeIf { ".." !in it }
}
