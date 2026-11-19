package com.folk3s.echo.ui

import android.media.AudioAttributes
import android.media.SoundPool
import com.folk3s.echo.EchoApp
import com.folk3s.echo.R
import kotlin.random.Random

// The material sounds (v0.4, v0.6): in the Clay theme a press squishes and a toggle pops; in Yarn a press
// is a soft woollen thump and a toggle a knitting needle's tick; Liquid glass taps and chimes, Paper
// rustles and folds, Retro hi-fi thunks its switches and clicks its knobs. Synthesized for ECHO by
// scripts/android-sounds.py; quiet, with a touch of pitch variation so repeats don't sound
// mechanical. Played as UI sounds, so they follow the phone's system sound volume.

enum class Sound { Tap, Toggle, Yes, No }

class ThemeSounds(app: EchoApp) {
  private val pool =
    SoundPool.Builder().setMaxStreams(4).setAudioAttributes(
      AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build(),
    ).build()
  private val clay = mapOf(Sound.Tap to pool.load(app, R.raw.clay_press, 1), Sound.Toggle to pool.load(app, R.raw.clay_pop, 1), Sound.Yes to pool.load(app, R.raw.clay_yes, 1))
  private val yarn = mapOf(Sound.Tap to pool.load(app, R.raw.yarn_press, 1), Sound.Toggle to pool.load(app, R.raw.yarn_click, 1), Sound.Yes to pool.load(app, R.raw.yarn_yes, 1))
  private val glass = mapOf(Sound.Tap to pool.load(app, R.raw.glass_press, 1), Sound.Toggle to pool.load(app, R.raw.glass_click, 1), Sound.Yes to pool.load(app, R.raw.glass_yes, 1))
  private val paper = mapOf(Sound.Tap to pool.load(app, R.raw.paper_press, 1), Sound.Toggle to pool.load(app, R.raw.paper_click, 1), Sound.Yes to pool.load(app, R.raw.paper_yes, 1))
  private val hifi = mapOf(Sound.Tap to pool.load(app, R.raw.hifi_press, 1), Sound.Toggle to pool.load(app, R.raw.hifi_click, 1), Sound.Yes to pool.load(app, R.raw.hifi_yes, 1))

  fun play(material: Material, s: Sound) {
    val set = when (material) {
      Material.Clay -> clay
      Material.Yarn -> yarn
      Material.Glass -> glass
      Material.Paper -> paper
      Material.HiFi -> hifi
      Material.Flat -> return
    }
    // A wrong answer: the press sound, lower.
    val id = set[if (s == Sound.No) Sound.Tap else s] ?: return
    val rate = (if (s == Sound.No) 0.72f else 1f) * (0.94f + Random.nextFloat() * 0.12f)
    pool.play(id, 0.55f, 0.55f, 1, 0, rate)
  }
}
