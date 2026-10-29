package com.folk3s.echo.stage.lyrics

// Every lyric-field constant (src/client/stage/lyrics/lyricsConfig.ts, LYRICS_EXPERIENCE.md §15):
// the web's values, so both clients move the words alike. Change them there first.

object L {
  const val anchorY = 0.4
  const val unlitMix = 0.22
  const val maxWidth = 0.84 // the web's since the redesign (2026-10-29): lines start near the song header
  const val maxRows = 2
  const val shrinkMax = 0.12

  object Column {
    const val gap = 0.45
    const val dz = 0.25
    const val margin = 0.25
  }

  val opacity = listOf(0.0 to 1.0, 0.25 to 0.5, 0.5 to 0.42, 1.0 to 0.32)
  val blur = listOf(0.0 to 0.0, 0.25 to 1.2, 0.5 to 2.2, 0.75 to 3.2, 1.0 to 4.0)

  object Word {
    const val liftEm = 0.05
    const val peak = 1.07
    const val popMs = 140.0
    const val releaseMs = 300.0
  }

  object Sweep {
    const val edgeAhead = 0.35
    const val edgeBehind = 0.6
    const val holdGapMs = 300.0
    const val minWordMs = 60.0
  }

  object Glow {
    const val radius = 0.18
    const val radiusMax = 0.26
    const val alpha = 0.35
    const val alphaMax = 0.55
    const val decayMs = 220.0
    const val decayFastMs = 120.0
    const val riseMs = 90.0
    const val slewPerS = 1.5
    const val paused = 0.6
    const val pauseMs = 600.0
    const val resumeMs = 300.0
  }

  const val washMs = 420.0

  object Handover {
    const val leadMinMs = 120.0
    const val leadMaxMs = 300.0
    const val coalesceMs = 350.0
  }

  object Emphasis {
    const val minMs = 1000.0
    const val minG = 2
    const val maxG = 7
    const val anticipateMs = 400.0
    const val releaseMs = 250.0
    const val swellMax = 0.08
  }

  object Springs {
    const val fMin = 2.0
    const val fMax = 2.35
    const val zNormal = 1.0
    val slow = 1.45 to 1.0
    val lift = 1.2 to 0.75
    val impulse = 2.0 to 0.5
  }

  object Stagger {
    const val baseMs = 50.0
    const val decay = 1.05
  }

  object Decay {
    const val tauMs = 520.0
    const val dropMs = 120.0
  }

  object Interlude {
    const val minGapMs = 7000.0
    const val cycleMs = 4000.0
    const val leaveMs = 500.0
    const val enterMs = 750.0
    const val fadeMs = 250.0
    const val dotEm = 0.22
    const val dotStepMs = 80.0
  }

  object Build {
    const val fadeInMs = 400.0
    const val seekOutMs = 160.0
    const val recedeMs = 420.0
  }

  object Reduced {
    const val crossfadeMs = 180.0
    const val dotsAlpha = 0.6
  }

  object LineTimed {
    const val endGapMs = 100.0
    const val lastLineMs = 6000.0
  }

  object Beat {
    const val scaleMax = 0.012
    const val scaleCap = 0.015
    const val quietMs = 300.0
    const val bassForce = 0.022
    const val sustainAttackMs = 120.0
    const val sustainReleaseMs = 400.0
    const val intenseAbove = 0.75
    const val passageMs = 2000.0
    const val intenseGlow = 0.05
  }
}
