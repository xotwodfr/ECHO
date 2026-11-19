package com.folk3s.echo.ui

import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionScope
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import com.folk3s.echo.echo
import java.util.UUID

// Motion and feel (v0.3, 2026-11-17): presses that squish with a spring and a light haptic tap,
// covers that fly from a list into their page, and the haptics the rest of the app asks for. All of
// it steps aside under reduced motion (the setting, or the system's Remove animations).

/**
 * Feedback for a press: a haptic if the user has them on, and in the Clay and Yarn themes the
 * material's sound (if theme sounds are on).
 */
class Haptics(private val on: Boolean, private val fire: (HapticFeedbackType) -> Unit, private val sound: (Sound) -> Unit) {
  fun tap() = go(HapticFeedbackType.ContextClick, Sound.Tap)
  fun toggle(on: Boolean) = go(if (on) HapticFeedbackType.ToggleOn else HapticFeedbackType.ToggleOff, Sound.Toggle)
  fun confirm() = go(HapticFeedbackType.Confirm, Sound.Yes)
  fun reject() = go(HapticFeedbackType.Reject, Sound.No)
  fun tick() = go(HapticFeedbackType.SegmentTick, Sound.Toggle)

  private fun go(t: HapticFeedbackType, s: Sound) {
    if (on) fire(t)
    sound(s)
  }
}

@Composable
fun rememberHaptics(): Haptics {
  val app = LocalContext.current.echo
  val h = LocalHapticFeedback.current
  val prefs = app.prefs.state.value
  val material = if (prefs.themeSounds) look.material else Material.Flat
  return remember(h, prefs.haptics, material) {
    Haptics(prefs.haptics, { h.performHapticFeedback(it) }) { s -> if (material != Material.Flat) app.sounds.play(material, s) }
  }
}

/** Whether motion is reduced right now. */
@Composable
fun reducedMotion(): Boolean {
  val app = LocalContext.current.echo
  return app.prefs.reducedMotion(app.prefs.state.value)
}

/**
 * A press that squishes: the element shrinks a little while held and springs back, with a light
 * haptic tap on the click. A long press, when given, opens a menu (with its own haptic).
 */
@OptIn(ExperimentalFoundationApi::class)
fun Modifier.bouncy(enabled: Boolean = true, scale: Float = 0.95f, label: String? = null, source: MutableInteractionSource? = null, onLongClick: (() -> Unit)? = null, onClick: () -> Unit): Modifier =
  composed {
    val source = source ?: remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val still = reducedMotion()
    val haptics = rememberHaptics()
    val k by animateFloatAsState(if (pressed && !still) scale else 1f, spring(dampingRatio = 0.55f, stiffness = 600f), label = "press")
    graphicsLayer {
      scaleX = k
      scaleY = k
    }.combinedClickable(
      interactionSource = source,
      indication = null,
      enabled = enabled,
      onClickLabel = label,
      onLongClick = onLongClick?.let { f -> { haptics.confirm(); f() } },
    ) {
      haptics.tap()
      onClick()
    }
  }

// ---- The cover's flight from a card to its page ----

/** The scopes a shared element needs, provided by the Shell around its pages. */
@OptIn(ExperimentalSharedTransitionApi::class)
class Flight(val shared: SharedTransitionScope, val visibility: AnimatedVisibilityScope)

val LocalFlight = compositionLocalOf<Flight?> { null }

/** The card whose cover is flying: only it and the page it opened take part, so repeats can't clash. */
object CoverFlight {
  var token by mutableStateOf<String?>(null)
}

/** A card's own token, kept across Back so the cover can fly home too. */
@Composable
fun rememberCoverToken(): String = rememberSaveable { UUID.randomUUID().toString() }

/** On a card's cover: takes part in the flight when this card was the one tapped. */
@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
fun Modifier.coverFrom(token: String): Modifier {
  val f = LocalFlight.current ?: return this
  if (CoverFlight.token != token || reducedMotion()) return this
  return with(f.shared) { this@coverFrom.sharedElement(rememberSharedContentState("cover"), f.visibility) }
}

/** On a page's cover: where the flight lands. */
@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
fun Modifier.coverTo(): Modifier {
  val f = LocalFlight.current ?: return this
  if (CoverFlight.token == null || reducedMotion()) return this
  return with(f.shared) { this@coverTo.sharedElement(rememberSharedContentState("cover"), f.visibility) }
}

/** A press source and whether it's held right now: for surfaces that sink in while pressed. */
@Composable
fun rememberPress(): Pair<MutableInteractionSource, Boolean> {
  val source = remember { MutableInteractionSource() }
  val down by source.collectIsPressedAsState()
  return source to down
}
