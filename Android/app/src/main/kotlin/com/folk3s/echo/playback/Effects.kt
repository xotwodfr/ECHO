package com.folk3s.echo.playback

import android.media.audiofx.Equalizer
import androidx.media3.common.C
import com.folk3s.echo.Prefs
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** What the phone's equalizer offers: its bands' centre frequencies (Hz) and how far they move (dB). */
data class EqInfo(val bands: List<Int> = AudioMath.DEFAULT_DEVICE_BANDS, val minDb: Float = -AudioMath.EQ_MAX_DB, val maxDb: Float = AudioMath.EQ_MAX_DB, val available: Boolean = false)

/**
 * The equalizer, crossfade and Karaoke's key, from this device's Prefs to the players
 * (docs/ANDROID_CLIENT.md, v0.8). The equalizer is Android's own (android.media.audiofx), on the
 * audio session both players share, so it keeps working across a crossfade.
 */
object Effects {
  private val _info = MutableStateFlow(EqInfo())
  /** For Settings → Equalizer: the phone's bands, once the playback service has opened them. */
  val info: StateFlow<EqInfo> = _info

  private var eq: Equalizer? = null
  private var session = C.AUDIO_SESSION_ID_UNSET

  /** Opens the equalizer on [audioSession] (C.AUDIO_SESSION_ID_UNSET: none yet, try again later). */
  fun attach(audioSession: Int) {
    if (audioSession == C.AUDIO_SESSION_ID_UNSET || audioSession == session) return
    release()
    // Some phones have no equalizer, or refuse one to apps: then the screen says so.
    val e = runCatching { Equalizer(0, audioSession) }.getOrNull() ?: return
    session = audioSession
    eq = e
    runCatching {
      val range = e.bandLevelRange
      _info.value =
        EqInfo(
          bands = (0 until e.numberOfBands).map { e.getCenterFreq(it.toShort()) / 1000 },
          minDb = range[0] / 100f,
          maxDb = range[1] / 100f,
          available = true,
        )
    }
  }

  /** The levels in dB for the phone's bands, from the prefs. */
  fun levels(p: Prefs, bands: List<Int> = _info.value.bands): List<Float> =
    AudioMath.eqLevels(AudioMath.eqPoints(p.eqPreset, p.eqCustomHz, p.eqCustom), bands)

  /** Applies the prefs to the equalizer, the crossfader and the key. */
  fun apply(p: Prefs, crossfader: Crossfader) {
    crossfader.seconds = p.crossfadeSec.coerceIn(0, AudioMath.MAX_CROSSFADE_S)
    crossfader.pitch = AudioMath.semitoneRatio(AudioMath.effectiveKey(p.karaoke, p.karaokeKey))
    val e = eq
    val info = _info.value
    val levels = levels(p)
    val on = p.eqOn && e != null && levels.any { it != 0f }
    crossfader.gain = if (on) AudioMath.eqHeadroom(levels) else 1f
    if (e == null) return
    runCatching {
      if (on)
        levels.forEachIndexed { i, db ->
          e.setBandLevel(i.toShort(), (db.coerceIn(info.minDb, info.maxDb) * 100).toInt().toShort())
        }
      e.enabled = on
    }
  }

  fun release() {
    runCatching { eq?.release() }
    eq = null
    session = C.AUDIO_SESSION_ID_UNSET
  }
}
