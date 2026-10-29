package com.folk3s.echo.playback

import android.os.SystemClock
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.audio.TeeAudioProcessor
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * The decoded audio on its way to the speaker (VISUALIZER_SPEC.md §3.2): a mono ring of the last
 * ~1.5 s, each write stamped with the time it was made. The Stage reads the window that is audible
 * now: what was written [LATENCY_MS] ago, the time ExoPlayer's AudioTrack buffer holds it.
 */
@OptIn(UnstableApi::class)
object AudioTap : TeeAudioProcessor.AudioBufferSink {
  // ponytail: a fixed output-latency estimate (DefaultAudioSink's ~250 ms PCM buffer plus the
  // device); AudioTrack timestamps would measure it, if the room ever looks late.
  const val LATENCY_MS = 280L
  private const val SIZE = 1 shl 16
  private const val STAMPS = 64

  private val ring = FloatArray(SIZE)
  private var written = 0L // mono frames since start
  private val stampFrames = LongArray(STAMPS)
  private val stampNs = LongArray(STAMPS)
  private var stamp = 0

  @Volatile var sampleRate = 44_100
    private set
  private var channels = 2
  private var encoding = C.ENCODING_PCM_16BIT

  @Volatile var lastWriteNs = 0L
    private set

  override fun flush(sampleRateHz: Int, channelCount: Int, encoding: Int) {
    synchronized(this) {
      sampleRate = sampleRateHz
      channels = channelCount
      this.encoding = encoding
    }
  }

  override fun handleBuffer(buffer: ByteBuffer) {
    val b = buffer.duplicate().order(ByteOrder.nativeOrder())
    synchronized(this) {
      val ch = channels.coerceAtLeast(1)
      when (encoding) {
        C.ENCODING_PCM_16BIT -> {
          val frames = b.remaining() / (2 * ch)
          for (f in 0 until frames) {
            var sum = 0f
            for (c in 0 until ch) sum += b.short / 32768f
            ring[(written and (SIZE - 1).toLong()).toInt()] = sum / ch
            written++
          }
        }
        C.ENCODING_PCM_FLOAT -> {
          val frames = b.remaining() / (4 * ch)
          for (f in 0 until frames) {
            var sum = 0f
            for (c in 0 until ch) sum += b.float
            ring[(written and (SIZE - 1).toLong()).toInt()] = sum / ch
            written++
          }
        }
        else -> return // 24/32-bit integer PCM: no features (the room stays Ambient)
      }
      val now = SystemClock.elapsedRealtimeNanos()
      stampFrames[stamp] = written
      stampNs[stamp] = now
      stamp = (stamp + 1) % STAMPS
      lastWriteNs = now
    }
  }

  /**
   * The [out].size frames that end at what is audible now, or false while there is nothing (no
   * audio yet, or it stopped flowing more than a second ago: paused, or a stream that bypasses this).
   */
  fun window(out: FloatArray): Boolean {
    synchronized(this) {
      val now = SystemClock.elapsedRealtimeNanos()
      if (written < out.size || now - lastWriteNs > 1_000_000_000L + LATENCY_MS * 1_000_000L) return false
      val at = now - LATENCY_MS * 1_000_000L
      // The newest write made before `at`, and the frames played since it at the sample rate.
      var best = -1
      for (i in 0 until STAMPS) if (stampNs[i] in 1..at && (best < 0 || stampNs[i] > stampNs[best])) best = i
      val end =
        if (best < 0) written - (LATENCY_MS * sampleRate / 1000)
        else minOf(written, stampFrames[best] + (at - stampNs[best]) * sampleRate / 1_000_000_000L)
      if (end < out.size || written - end > SIZE - out.size) return false
      val start = end - out.size
      for (i in out.indices) out[i] = ring[((start + i) and (SIZE - 1).toLong()).toInt()]
      return true
    }
  }
}
