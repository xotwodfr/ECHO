package com.folk3s.echo.playback

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.common.util.UnstableApi
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Karaoke mode's mixer (docs/KARAOKE.md). The server's karaoke files are 5.1, with the
 * instrumental on front left/right and the vocals on rear left/right. Here they become stereo
 * again, as `instrumental + level × vocals`, so the vocals slider works at once, without a gap.
 * The level glides over each buffer, so moving the slider never clicks.
 *
 * Any other 5.1 song (rare in a music library) gets an ordinary downmix instead, so it still
 * sounds right.
 */
object KaraokeMix {
  /** How much of the voice is left, 0 (none) to 1 (all). */
  @Volatile var level = 0f

  /** Whether what is playing is a karaoke file (Playback sets it as items change). */
  @Volatile var active = false

  /** The channel count the decoder last gave us: 2 for a karaoke file means it was downmixed. */
  @Volatile var inputChannels = 0
}

@OptIn(UnstableApi::class)
class VocalMixProcessor : BaseAudioProcessor() {
  private var last = KaraokeMix.level

  override fun onConfigure(input: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
    KaraokeMix.inputChannels = input.channelCount
    if (input.channelCount != 6) return AudioProcessor.AudioFormat.NOT_SET // pass through
    if (input.encoding != C.ENCODING_PCM_16BIT && input.encoding != C.ENCODING_PCM_FLOAT)
      throw AudioProcessor.UnhandledAudioFormatException(input)
    return AudioProcessor.AudioFormat(input.sampleRate, 2, input.encoding)
  }

  override fun queueInput(input: ByteBuffer) {
    val float = inputAudioFormat.encoding == C.ENCODING_PCM_FLOAT
    val bytes = if (float) 4 else 2
    val frames = input.remaining() / (6 * bytes)
    val out = replaceOutputBuffer(frames * 2 * bytes).order(ByteOrder.nativeOrder())
    val src = input.order(ByteOrder.nativeOrder())
    val karaoke = KaraokeMix.active
    val target = KaraokeMix.level.coerceIn(0f, 1f)
    val from = last
    val frame = FloatArray(6)
    val lr = FloatArray(2)
    for (f in 0 until frames) {
      for (ch in 0 until 6) frame[ch] = if (float) src.getFloat() else src.getShort() / 32768f
      if (karaoke) mixKaraoke(frame, from + (target - from) * (f + 1) / frames, lr) else downmix(frame, lr)
      val l = lr[0]
      val r = lr[1]
      if (float) {
        out.putFloat(l)
        out.putFloat(r)
      } else {
        out.putShort(toShort(l))
        out.putShort(toShort(r))
      }
    }
    last = target
    input.position(input.limit())
    out.flip()
  }

  override fun onReset() {
    last = KaraokeMix.level
  }

  companion object {
    /** FL FR FC LFE BL BR (Android's 5.1 order) → instrumental + g × vocals. */
    fun mixKaraoke(s: FloatArray, g: Float, out: FloatArray) {
      out[0] = s[0] + g * s[4]
      out[1] = s[1] + g * s[5]
    }

    /** An ordinary 5.1 → stereo downmix (ITU-R BS.775), scaled so it does not clip. */
    fun downmix(s: FloatArray, out: FloatArray) {
      val k = 0.7071f
      val n = 1f / (1f + 2 * k)
      out[0] = (s[0] + k * s[2] + k * s[4]) * n
      out[1] = (s[1] + k * s[2] + k * s[5]) * n
    }

    private fun toShort(v: Float): Short = (v.coerceIn(-1f, 1f) * 32767f).toInt().toShort()
  }
}
