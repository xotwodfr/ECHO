package com.folk3s.echo

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import com.folk3s.echo.playback.KaraokeMix
import com.folk3s.echo.playback.KaraokeState
import com.folk3s.echo.playback.KaraokeStatus
import com.folk3s.echo.playback.VocalMixProcessor
import com.folk3s.echo.ui.karaokeNote
import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// Karaoke mode's mixer (docs/KARAOKE.md): the server's 5.1 files carry the instrumental on front
// left/right and the vocals on rear left/right; the phone plays instrumental + level × vocals.
class KaraokeTest {
  @After fun reset() {
    KaraokeMix.level = 0f
    KaraokeMix.active = false
  }

  /** [frames] identical 5.1 frames in 16-bit PCM: FL FR FC LFE BL BR. */
  private fun six(frames: Int, vararg v: Float): ByteBuffer {
    val b = ByteBuffer.allocateDirect(frames * 12).order(ByteOrder.nativeOrder())
    repeat(frames) { for (x in v) b.putShort((x * 32767).toInt().toShort()) }
    b.flip()
    return b
  }

  private fun run(p: VocalMixProcessor, input: ByteBuffer): List<Pair<Float, Float>> {
    p.queueInput(input)
    val out = p.output.order(ByteOrder.nativeOrder())
    val lr = mutableListOf<Pair<Float, Float>>()
    while (out.remaining() >= 4) lr += out.getShort() / 32767f to out.getShort() / 32767f
    return lr
  }

  private fun processor(): VocalMixProcessor {
    val p = VocalMixProcessor()
    val out = p.configure(AudioProcessor.AudioFormat(44100, 6, C.ENCODING_PCM_16BIT))
    assertEquals(2, out.channelCount)
    p.flush(AudioProcessor.StreamMetadata.DEFAULT)
    return p
  }

  @Test
  fun `the level sets how much of the vocals is left in, from none to all`() {
    KaraokeMix.active = true
    KaraokeMix.level = 0f
    val p = processor()
    val none = run(p, six(64, 0.2f, -0.1f, 0f, 0f, 0.4f, 0.3f)).last()
    assertEquals(0.2f, none.first, 0.001f)
    assertEquals(-0.1f, none.second, 0.001f)
    KaraokeMix.level = 1f
    val all = run(p, six(64, 0.2f, -0.1f, 0f, 0f, 0.4f, 0.3f)).last()
    assertEquals(0.6f, all.first, 0.001f) // the song as recorded
    assertEquals(0.2f, all.second, 0.001f)
  }

  @Test
  fun `a moved slider glides over the buffer instead of jumping (no clicks)`() {
    KaraokeMix.active = true
    val p = processor()
    run(p, six(8, 0f, 0f, 0f, 0f, 0.5f, 0.5f))
    KaraokeMix.level = 1f
    val ramp = run(p, six(100, 0f, 0f, 0f, 0f, 0.5f, 0.5f)).map { it.first }
    assertTrue(ramp.first() < 0.05f)
    assertEquals(0.5f, ramp.last(), 0.001f)
    assertTrue(ramp.zipWithNext().all { (a, b) -> b >= a })
  }

  @Test
  fun `another 5_1 song is downmixed as usual, and stereo passes through untouched`() {
    KaraokeMix.active = false
    val p = processor()
    val (l, r) = run(p, six(4, 0.3f, 0.3f, 0.3f, 0f, 0.3f, 0.3f)).last()
    assertEquals(0.3f, l, 0.002f) // FL, centre and rear in, scaled so it cannot clip
    assertEquals(l, r, 0.0001f)
    val stereo = VocalMixProcessor()
    stereo.configure(AudioProcessor.AudioFormat(44100, 2, C.ENCODING_PCM_16BIT))
    assertFalse(stereo.isActive)
    assertEquals(2, KaraokeMix.inputChannels) // what the downmix check reads
  }

  @Test
  fun `the line under the slider says where the karaoke version is`() {
    assertNull(karaokeNote(KaraokeState(true, KaraokeStatus.Ready)))
    assertEquals(
      "Preparing the karaoke version… 3 songs before this one.",
      karaokeNote(KaraokeState(true, KaraokeStatus.Preparing, ahead = 3)),
    )
    assertTrue(karaokeNote(KaraokeState(false, KaraokeStatus.Unavailable))!!.contains("stem service"))
  }
}
