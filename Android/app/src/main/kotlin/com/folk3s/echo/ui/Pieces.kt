package com.folk3s.echo.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import com.materialkolor.PaletteStyle
import com.materialkolor.dynamiccolor.ColorSpec
import com.materialkolor.rememberDynamicColorScheme
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.folk3s.echo.api.Track
import com.folk3s.echo.echo
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

// The v0.2 pieces (2026-11-17): the large title, the centred page header, Play and Shuffle as pill
// buttons, the numbered track row and the library's category rows.

/** The account button at the top right of a tab: the user's initial in the accent. */
@Composable
fun Avatar(onClick: () -> Unit) {
  val app = LocalContext.current.echo
  val (me, _) = load("me") { app.api.get("/me").jsonObject["username"]?.jsonPrimitive?.contentOrNull ?: "" }
  val initial = (me as? Load.Ok)?.value?.firstOrNull()?.uppercase() ?: ""
  Box(
    Modifier.size(36.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primaryContainer).clickable(onClick = onClick)
      .semantics { contentDescription = "Profile and settings" },
    contentAlignment = Alignment.Center,
  ) {
    if (initial.isEmpty()) Icon(EchoIcons.user, null, tint = MaterialTheme.colorScheme.onPrimaryContainer, modifier = Modifier.size(20.dp))
    else Text(initial, color = MaterialTheme.colorScheme.onPrimaryContainer, style = MaterialTheme.typography.titleMedium)
  }
}

/** A tab's large bold title, with what sits at its right (the account button, an action). */
@Composable
fun LargeTitle(text: String, trailing: @Composable () -> Unit = {}) {
  Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 16.dp, top = 12.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
    Text(text, style = MaterialTheme.typography.displaySmall, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) { trailing() }
  }
}

/** A section's title over a shelf or a list. */
@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier) {
  Text(text, style = MaterialTheme.typography.headlineSmall, modifier = modifier.padding(start = 20.dp, end = 20.dp, top = 20.dp, bottom = 10.dp))
}

/** The back button and the "…" on a page: round, tonal, over the page. */
@Composable
fun PageBar(nav: Nav, trailing: @Composable () -> Unit = {}) {
  Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
    if (nav.stack.size > 1)
      Box(
        Modifier.size(40.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceContainerHigh).clickable { nav.back() }
          .semantics { contentDescription = "Back" },
        contentAlignment = Alignment.Center,
      ) { Icon(EchoIcons.chevronLeft, null, tint = Chamber.text, modifier = Modifier.size(24.dp)) }
    Spacer(Modifier.weight(1f))
    trailing()
  }
}

/** A page's centred header: the art with a soft shadow, the title, the subtitle in the accent, facts. */
@Composable
fun PageHeader(art: @Composable () -> Unit, title: String, subtitle: String?, meta: String?, onSubtitle: (() -> Unit)? = null) {
  Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
    Box(Modifier.padding(top = 4.dp).size(260.dp).coverTo().shadow(28.dp, RoundedCornerShape(look.page), clip = false, ambientColor = MaterialTheme.colorScheme.scrim, spotColor = MaterialTheme.colorScheme.scrim)) {
      art()
    }
    Spacer(Modifier.height(18.dp))
    Text(title, style = MaterialTheme.typography.headlineMedium, textAlign = TextAlign.Center, maxLines = 2, overflow = TextOverflow.Ellipsis)
    if (subtitle != null)
      Text(
        subtitle,
        color = MaterialTheme.colorScheme.primary,
        style = MaterialTheme.typography.titleLarge,
        textAlign = TextAlign.Center,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier.padding(top = 2.dp).then(if (onSubtitle != null) Modifier.clip(RoundedCornerShape(8.dp)).clickable(onClick = onSubtitle) else Modifier),
      )
    if (meta != null) Text(meta.uppercase(), color = Chamber.muted, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(top = 6.dp))
  }
}

/** Play and Shuffle side by side: a filled pill and a tonal one. Play pauses its context while it plays. */
@Composable
fun PlayShuffle(label: String, live: Boolean, playing: Boolean, onPlay: () -> Unit, onShuffle: () -> Unit) {
  val app = LocalContext.current.echo
  Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
    val haptics = rememberHaptics()
    Button(
      onClick = {
        haptics.toggle(!playing)
        if (live) app.playback.toggle() else onPlay()
      },
      modifier = Modifier.weight(1f).height(52.dp).semantics { contentDescription = if (playing) "Pause $label" else "Play $label" },
      shape = RoundedCornerShape(look.button.coerceAtMost(26.dp)),
    ) {
      Icon(if (playing) EchoIcons.pause else EchoIcons.play, null, modifier = Modifier.size(20.dp))
      Spacer(Modifier.width(8.dp))
      Text(if (playing) "Pause" else "Play", style = MaterialTheme.typography.titleMedium)
    }
    FilledTonalButton(
      onClick = {
        haptics.tap()
        onShuffle()
      },
      modifier = Modifier.weight(1f).height(52.dp).semantics { contentDescription = "Shuffle $label" },
      shape = RoundedCornerShape(look.button.coerceAtMost(26.dp)),
      // The accent on a faint wash of itself: readable whatever the theme's accent.
      colors = ButtonDefaults.filledTonalButtonColors(containerColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.14f), contentColor = MaterialTheme.colorScheme.primary),
    ) {
      Icon(EchoIcons.shuffle, null, modifier = Modifier.size(20.dp))
      Spacer(Modifier.width(8.dp))
      Text("Shuffle", style = MaterialTheme.typography.titleMedium)
    }
  }
}

/** An album's track: the number (or the playing bars), the title, the artist when it differs, ⋯. */
@Composable
fun NumberedRow(n: Int, t: Track, albumArtist: String?, nowPlaying: Boolean, onPlay: () -> Unit, menu: List<Pair<String, () -> Unit>>) {
  Column(Modifier.padding(start = 20.dp)) {
    Row(
      Modifier.fillMaxWidth().combinedClickable(onClick = onPlay, onLongClick = { if (menu.isNotEmpty()) Menus.open = "More for ${t.title}" to menu })
        .padding(vertical = 6.dp).padding(end = 8.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Box(Modifier.width(28.dp), contentAlignment = Alignment.CenterStart) {
        if (nowPlaying) NowPlayingBars() else Text("$n", color = Chamber.muted, style = MaterialTheme.typography.bodyLarge)
      }
      Column(Modifier.weight(1f).padding(start = 6.dp)) {
        Text(t.title, color = if (nowPlaying) MaterialTheme.colorScheme.primary else Chamber.text, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (albumArtist != null && t.artist != albumArtist)
          Text(t.artist, color = Chamber.muted, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
      }
      MoreMenu("More for ${t.title}", menu)
    }
    HorizontalDivider(Modifier.padding(start = 34.dp), color = Chamber.line.copy(alpha = 0.5f))
  }
}

/** A row of the library's list: the icon in the accent, the label, a chevron. */
@Composable
fun CategoryRow(icon: ImageVector, label: String, onClick: () -> Unit) {
  Column(Modifier.clickable(onClick = onClick).padding(start = 20.dp)) {
    Row(Modifier.fillMaxWidth().height(54.dp).padding(end = 16.dp), verticalAlignment = Alignment.CenterVertically) {
      Icon(icon, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(24.dp))
      Text(label, style = MaterialTheme.typography.titleLarge.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Normal), modifier = Modifier.weight(1f).padding(start = 16.dp))
      Icon(EchoIcons.chevronRight, null, tint = Chamber.muted, modifier = Modifier.size(20.dp))
    }
    HorizontalDivider(Modifier.padding(start = 40.dp), color = Chamber.line.copy(alpha = 0.5f))
  }
}

// ---- Album colour on pages ----

/** An album's accent from its palette, once known (null while loading or without one). */
@Composable
fun rememberAlbumAccent(albumKey: String?): Color? {
  val app = LocalContext.current.echo
  val accent by produceState<Color?>(null, albumKey) { value = albumKey?.let { app.palette.forAlbum(it) }?.accentColor }
  return accent
}

/**
 * A page in its album's colour: on the ECHO theme the page's accent (buttons, the artist) is the
 * album's own; on the others the theme's accent stays.
 */
@Composable
fun AlbumAccent(accent: Color?, content: @Composable () -> Unit) {
  val app = LocalContext.current.echo
  if (accent == null || ThemePreset.of(app.prefs.state.value.theme) != ThemePreset.Echo) return content()
  val cs = MaterialTheme.colorScheme
  val dark = cs.surface.luminance() < 0.5f
  val s = rememberDynamicColorScheme(seedColor = accent, isDark = dark, style = PaletteStyle.Content, specVersion = ColorSpec.SpecVersion.SPEC_2025)
  MaterialTheme(
    cs.copy(
      primary = s.primary,
      onPrimary = s.onPrimary,
      primaryContainer = s.primaryContainer,
      onPrimaryContainer = s.onPrimaryContainer,
      secondaryContainer = s.secondaryContainer,
      onSecondaryContainer = s.onSecondaryContainer,
    ),
    typography = MaterialTheme.typography,
    content = content,
  )
}

/** The top of a page washed in the album's colour, fading into the page as it scrolls away. */
@Composable
fun AlbumWash(accent: Color?, content: @Composable () -> Unit) {
  val dark = MaterialTheme.colorScheme.surface.luminance() < 0.5f
  val wash by animateColorAsState(accent?.let { headerTone(it).copy(alpha = if (dark) 0.7f else 0.32f) } ?: Color.Transparent, tween(600), label = "wash")
  Column(Modifier.fillMaxWidth().background(Brush.verticalGradient(0f to wash, 0.75f to wash.copy(alpha = wash.alpha * 0.35f), 1f to Color.Transparent))) { content() }
}
