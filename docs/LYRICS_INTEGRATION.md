# ECHO — Lyrics Integration

Status: **Draft 2** · Last reviewed 2026-10-22
Related: [Lyrics experience](LYRICS_EXPERIENCE.md) (how lyrics are shown) · [Settings & security](SETTINGS_AND_SECURITY.md) §6.3 (Spicy Lyrics key) · [Playback](PLAYBACK_ARCHITECTURE.md) §4.6 (gate G2 for Spotify tracks)

Labels: **[C]** confirmed in a primary source (`DESIGN_RESEARCH.md` §5), **[R]** reported, **[A]**
assumption to verify in the named milestone.

---

## 1. Sources

| # | Source | Sync levels | Keyed by | Auth | Licence / terms | Role in ECHO |
|---|---|---|---|---|---|---|
| S1 | **Navidrome / OpenSubsonic** `getLyricsBySongId` (`enhanced=true`) | line; word/syllable via `cueLine` (songLyrics v2) [C: spec]. **Navidrome 0.64 fills cues from enhanced LRC (inline `<mm:ss.xx>` markers, plus a non-standard `[bg:]` line for backing vocals) and from TTML (timed spans, agents, backing vocals as `bg`-role agents), embedded or sidecar** [C: Navidrome v0.64.0 `model/lyrics_lrc.go`, `model/lyrics_ttml.go`; M6] | Navidrome song id | Navidrome credentials (server-side) | The user's own files (embedded tags, sidecar `.lrc`) | **First choice** for Navidrome tracks |
| S2 | **Spicy Lyrics API** `GET https://api.spicylyrics.org/v1/lyrics/{trackId}` [C] | `Syllable` (word/syllable + background vocals + duet alignment), `Line`, `Static` [C] | **Spotify track ID only** (22 base62 chars) [C] | `Authorization: Bearer <key>`. Secret keys `sl_sk_…` are server-side only. Publishable keys `sl_pk_…` need an origin allow-list [C] | Terms (2026-10-01) permit third-party players (§4), require attribution (§6), refetch or discard cached lyrics within 30 days (§7), forbid redistribution as a public source (§5), and grant no rights to lyrics (§8) [C] | Word-timed source for Spotify-identified tracks |
| S3 | **LRCLIB** `GET https://lrclib.net/api/get?track_name&artist_name&album_name&duration` [C] | line (LRC). Some entries flag `hasWordSync` with a `lyricsfile` field [C: live response]; its format is undocumented [A] | metadata + duration | none | Server code MIT [C]. Data licence and rate limits not confirmed [A] | Open fallback for line-timed and plain lyrics |
| S4 | Navidrome legacy `getLyrics?artist&title` | plain text | metadata | Navidrome | own files | Last fallback for Navidrome tracks |

**Not used:** Musixmatch (commercial licence required for synced lyrics [R]); Apple TTML (no public
third-party API found); scraping of any service.

The Spicy Lyrics **code** (AGPL-3.0 [C]) is not used. ECHO only calls the hosted API, as its terms
allow.

---

## 2. Spicy Lyrics access model

- **Key handling:** ECHO uses a **secret key** (`sl_sk_…`). It is a **server-wide** setting entered
  by the admin, stored encrypted (`SETTINGS_AND_SECURITY.md` §3, §6.3), and used only by the ECHO
  server. No client (web, desktop, mobile) ever calls `api.spicylyrics.org` or sees the key.
- **Key provisioning:** ECHO does not ship a key. **The owner already has one** (2026-10-22), so
  Spicy Lyrics is in scope for M6. Operators of other ECHO servers create their own at
  `developers.spicylyrics.org`. Without a key, Spicy Lyrics is disabled and S1/S3 carry the
  experience.
- **Response envelope (re-checked against the live docs, M6):** every answer, errors included, is
  `{ Body, Status, Type }`. `Body.Type` is `Syllable` / `Line` / `Static`; `Body.source` is
  `spicy_lyrics` (community), `apple_music`, `spotify` or `unknown`; `UploadAttribution` (with
  `Uploader` and an optional `Maker`, each with a profile `url`) exists only for community syncs.
  Errors carry `Body.error` codes (`lyrics_not_found`, `rate_limited`, `key_revoked`, …).
- **Rate limits:** no published numbers. Responses carry `RateLimit-*` headers and `Retry-After` on
  `429` [C]. ECHO honours them (§6) and makes **at most one request per track play** (cache first).
- **Spotify ID requirement:** for Spotify tracks the ID is native. For Navidrome tracks, see §4.3.
  Without a Spotify ID, S2 is skipped.

---

## 3. Inputs to a lookup

`GET /api/v1/lyrics?trackKey=&title=&artist=&album=&durationMs=`. Provider ids are derived from the track key on the server (`navidrome:<id>`, `spotify:<id>`), never taken from free-form parameters, and the normalised metadata is part of the shared cache key, so one user's request cannot fill another track's entry (M6 security review). The server
resolves and returns a `LyricsDoc` (§5) or `404 { tried: [{ source, outcome }] }`.

Normalisation for matching (server-side):
- Lower-case and NFKC; strip `feat.`/`ft.`/`with …` artist suffixes from titles; remove bracketed
  qualifiers like `(Remastered 2011)`, `- Radio Edit` and `[Live]` for **comparison only** (the
  original strings go to the APIs).
- The primary artist is the first artist.

---

## 4. Resolution pipeline

### 4.1 Order and selection

All eligible sources are queried **in parallel** (each with its own timeout, §6). The result is:

1. the candidate with the **highest sync level** (`word` > `line` > `none`) among those passing match
   validation (§4.2);
2. at equal level, the **precedence**: S1 (the user's own files) > S2 > S3 > S4;
3. the user's per-track **pin** overrides both (Settings: "Use this source for this track", from the
   ⓘ menu on the stage).

The response is returned as soon as the best possible candidate is known: either the
highest-precedence source returned `word`, or all sources have settled or timed out. A cache hit
returns immediately (§7).

Late improvements (a better candidate arriving after the first response) are pushed to the cache.
The stage swaps only under the rules in `LYRICS_EXPERIENCE.md` §9.5.

### 4.2 Match validation

A candidate is accepted only if:

- **Duration:** `|candidate.duration − track.duration| ≤ 3 s` when the source reports a duration
  (LRCLIB does; Spicy reports `EndTime`, accepted if ≤ track duration + 3 s).
- **Text:** for metadata-keyed sources (S3, S4), normalised title similarity ≥ 0.85 and primary-artist
  similarity ≥ 0.8 (Jaro-Winkler).
- **Timing sanity:** last line start < track duration; ≥ 90% of line starts monotonic. Otherwise it
  is downgraded to `none` (static).
- ID-keyed sources (S1 by Navidrome id, S2 by Spotify id) skip the text check.

### 4.3 Spotify ID resolution for Navidrome tracks (enables S2)

Only when the user has connected Spotify (ECHO never uses Spotify credentials it doesn't have):

1. If the track has an ISRC: `GET /v1/search?q=isrc:<ISRC>&type=track&limit=1`.
2. Else: `q=track:"<title>" artist:"<primary artist>"&type=track&limit=5`. Accept the best result with
   duration within ±2 s and title similarity ≥ 0.9.
3. Cache the mapping (`navidromeId → spotifyId | none`) for 30 days.

This uses the **requesting user's** own Spotify connection, server-side (the server holds that user's
refresh token and can mint an access token). Users without a Spotify connection don't trigger lookups,
but they still benefit from mappings already in the shared cache. It is a lookup to fetch lyrics, not
a metadata service. Its fit with the Developer Terms (no "standalone metadata service") is recorded as
Q-LI-2. Per-user setting: "Use my Spotify account to find lyrics for my library" (default **off**,
explained in Settings).

### 4.4 Spotify tracks

S2 by native ID, S3 by metadata. S1/S4 don't apply. **Gate G2** (`PLAYBACK_ARCHITECTURE.md` §4.6;
**on** by owner decision) allows full word/line timing for Spotify tracks. If the admin switches G2
off, resolved docs are delivered with `sync` forced to `'none'` and the stage renders an untimed
sheet.

---

## 5. LyricsDoc (normative schema)

```ts
type SyncLevel = 'word' | 'line' | 'none';

interface Attribution {                // §8: the stage renders `text`; `links` mark the linked parts
  text: string;
  links?: { label: string; href: string }[];
}

interface LyricsDoc {
  version: 1;
  trackKey: string;
  sync: SyncLevel;
  source: 'navidrome' | 'spicy' | 'lrclib' | 'navidrome-plain' | 'fixture';  // fixture: M3 mock docs, development builds only
  attribution: Attribution;            // §8
  language?: string;                   // BCP-47 when known
  offsetMs: number;                    // source-declared offset (LRC [offset:], OpenSubsonic offset); 0 if none
  durationMs?: number;
  agents?: { id: string; name?: string; kind: 'person' | 'group' | 'other' }[];
  lines: LyricLine[];
  translations?: { lang: string; lines: string[] }[];       // same indexing as lines
  romanisation?: { lines: LyricLine[] };                     // OpenSubsonic 'pronunciation' / Spicy TransliteratedText
  fetchedAt: string;                   // ISO; cache policy §7
}

interface LyricLine {
  text: string;                        // full display text (words joined)
  start: number;                       // ms from track start (sync != 'none'); 0 for static
  end?: number;                        // ms; optional for line-timed sources
  agent?: string;
  oppositeAligned?: boolean;
  words?: LyricWord[];                 // present iff sync === 'word'
  background?: { text: string; start?: number; end?: number; words?: LyricWord[] }[];
}

interface LyricWord {
  text: string;                        // as displayed, without trailing space
  start: number; end: number;          // ms
  isPartOfWord: boolean;               // true → no space before the next word (syllables)
}
```

**Validation and repair (server, before caching):**
- Times are converted to integer ms. Negative times are clamped to 0.
- Words are sorted by start within a line. `end < start` → `end = start + 60`. Overlapping words are
  trimmed to the next start.
- Line `end` defaults to the last word's end (word-timed), or is left undefined (line-timed;
  `LYRICS_EXPERIENCE.md` §9.2 derives it).
- Empty or whitespace-only lines are kept as gaps (with no words) only when timed; otherwise dropped.
- A document that fails validation twice is stored as a negative cache entry with the reason.

---

## 6. Timeouts, retries and failure handling

| Source | Timeout | Retry | Notes |
|---|---|---|---|
| S1 Navidrome | 1500 ms | 1× after 300 ms on network error/5xx | LAN-fast. Uses the Navidrome connection's reconnection state: no lookup while "unreachable" |
| S2 Spicy | 4000 ms | 1× after 500 ms ± 30% jitter on network error/5xx. **Never** on 4xx | `429` → respect `Retry-After`, mark S2 *cooling* until then (skipped, not failed) |
| S3 LRCLIB | 4000 ms | 1× after 500 ms ± 30% on network/5xx | Sends `User-Agent: ECHO/<version> (+https://github.com/<repo>)` |
| S4 legacy | 1500 ms | none | |

- **Circuit breaker:** 5 consecutive failures (network/5xx/timeout) for a source → skipped for
  10 minutes, with a quiet note in Admin → Server → Lyrics ("LRCLIB unreachable — retrying at
  22:41").
- **Overall deadline:** the server answers within **4.5 s** regardless. The client shows dots from
  600 ms and gives up at 6 s (`LYRICS_EXPERIENCE.md` §9.5).
- **Stale responses:** every request carries the track key. The client drops responses whose key is
  not the current track. The server still caches them.
- **Rapid skips:** the client debounces lookups 250 ms after a track change. Prefetch: when the next
  track is known and ≥ 20 s remain, the client requests its lyrics in the background (cache warm-up,
  low priority).

---

## 7. Caching

Server-side file cache (`TECHNICAL_ARCHITECTURE.md` §6.3), keyed by `sha1(trackKey)`, with the source
and `fetchedAt` stored:

| Entry | TTL | Why |
|---|---|---|
| Spicy Lyrics doc | **30 days, hard** (refetch or delete) | Spicy terms §7 [C] |
| LRCLIB doc | 30 days | Freshness; community data changes |
| Navidrome doc | 1 day, then revalidate | The user may edit their files |
| Negative ("not found") | 3 days per source (Spotify-ID mapping "none": 7 days) | Avoid hammering sources for instrumental tracks |
| Spotify ID mapping | 30 days | §4.3 |
| Per-track offset & source pin | never expires (per-user data in the `track_overrides` table, not cache) | |

- The lyric cache is **shared across the server's users** (lyrics are not user data). Fetching is
  keyed by track, so the first listener's lookup serves everyone.
- A daily sweep (at server start and every 24 h) deletes expired entries. Expired Spicy entries are
  deleted, not served stale.
- **No redistribution:** cached lyrics are served only to authenticated users of this ECHO server,
  only for display, and there is no export or public endpoint (Spicy terms §5).
- Cache size cap: 200 MB (LRU by access time).

---

## 8. Attribution

Shown on the stage (bottom-left, 12px `--faint`, visible with chrome) and in the ⓘ menu:

| Source | Text | Links |
|---|---|---|
| Spicy Lyrics, `source: spicy_lyrics` (a community sync) | "Lyrics from Spicy Lyrics · synced by {Maker} · uploaded by {Uploader}" (Maker only when present), plus "Written by …" when `SongWriters` is provided | "Spicy Lyrics" → spicylyrics.org; uploader and maker → their `url` (the API's attribution rule, part of the terms §6 [C: live docs 2026-10-24]) |
| Spicy Lyrics, `source: apple_music` / `spotify` | "Lyrics from Apple Music via Spicy Lyrics" (or Spotify); no uploader or maker: those fields are absent for commercial sources and an empty credit is a defect | "Spicy Lyrics" → spicylyrics.org |
| LRCLIB | "Lyrics from LRCLIB" | lrclib.net |
| Navidrome | "Lyrics from your library" | — |

Attribution is part of `LyricsDoc.attribution` and rendered by the stage. Removing it is a defect
(`ACCEPTANCE_CRITERIA.md` LI-05).

---

## 9. Rights and known concerns

- Spicy Lyrics serves data from community syncs and upstream services (`source`: `spicy_lyrics`,
  `apple_music`, `spotify`) [C]. Its terms grant no rights to lyrics. ECHO is a non-commercial,
  self-hosted player and displays lyrics, with attribution, only to the few authenticated users of
  one server. Lyric copyright for upstream sources is **unresolved** (Q-LI-1).
- Whether a multi-user private server counts as "redistribution" under Spicy's terms §5 is
  unresolved (Q-LI-6). ECHO's reading: no, because nothing is public or exportable.
- LRCLIB's data licence was not confirmed (Q-LI-3).
- The user's own lyric files (S1) carry no third-party concerns.
