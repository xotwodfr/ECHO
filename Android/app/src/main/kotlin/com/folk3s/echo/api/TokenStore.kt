package com.folk3s.echo.api

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * The device token (SETTINGS_AND_SECURITY.md §4.6), sealed with AES-GCM under an Android Keystore
 * key that never leaves the device. Lost on reinstall, which only means signing in again.
 */
class TokenStore(context: Context) {
  private val prefs = context.getSharedPreferences("echo.auth", Context.MODE_PRIVATE)
  private val _token = MutableStateFlow(runCatching { read() }.getOrNull())
  val token: StateFlow<String?> = _token

  fun set(value: String?) {
    if (value == null) prefs.edit().remove(KEY).apply()
    else {
      val c = Cipher.getInstance(CIPHER).apply { init(Cipher.ENCRYPT_MODE, key()) }
      val sealed = c.iv + c.doFinal(value.toByteArray())
      prefs.edit().putString(KEY, Base64.encodeToString(sealed, Base64.NO_WRAP)).apply()
    }
    _token.value = value
  }

  private fun read(): String? {
    val sealed = Base64.decode(prefs.getString(KEY, null) ?: return null, Base64.NO_WRAP)
    val c = Cipher.getInstance(CIPHER)
    c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, sealed, 0, IV))
    return String(c.doFinal(sealed, IV, sealed.size - IV))
  }

  private fun key(): SecretKey {
    val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (ks.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
    val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    gen.init(
      KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build(),
    )
    return gen.generateKey()
  }

  private companion object {
    const val KEY = "device_token"
    const val ALIAS = "echo.device-token"
    const val CIPHER = "AES/GCM/NoPadding"
    const val IV = 12
  }
}
