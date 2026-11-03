# YouTube Music mode — design

Status: **approved** by the owner 2026-11-03 · built on branch `youtube-music` (plan `docs/superpowers/plans/2026-11-03-youtube-music.md`), not merged, not deployed.
Mockups: https://claude.ai/artifact/8yTf8MWLVBU9TQqsDvfcWm (board A was chosen).

## Intent

The owner wants a **second world inside ECHO for whole listening sessions**. Flip a switch and ECHO
becomes a YouTube Music app: YouTube Music's screens, search, recommendations and your own
YouTube Music library. Flip it back and you are in ECHO's Navidrome library again.

Earlier today Spotify was removed and a YouTube Music *provider* was ruled out (see
`echo-spotify-removed`: no fitting audio API, terms of service, fragility). The owner has now asked
for it, knowing the trade-off below, so this design replaces that call.

## Owner decisions (2026-11-03)

- **A separate UI, used for whole sessions**, reached by a switch. It is not a fallback for songs
  Navidrome lacks.
- **It plays like Navidrome, through yt-dlp.** The server fetches each song's audio with yt-dlp and
  streams it through ECHO, so it uses ECHO's player and queue, keeps playing in the background on a
  phone, and shows on the lock screen. The owner chose this over YouTube's embedded player and
  accepted that it breaks YouTube's terms and needs yt-dlp kept current.
- **Sign in with your own YouTube Music account**, so your likes, playlists and recommendations
  show up.
- **Looks like YouTube Music** (mockup board A): black background, a left menu with Home, Explore
  and Library, mood chips, shelves, and a full-width player bar with a thin red progress line. It
  carries ECHO's name, not YouTube's logo.
- **The full-screen player is YouTube Music's own**: big artwork, with Up next, Lyrics and Related
  tabs. It is not ECHO's Stage.

## Calls made in the design (the owner can veto any)

1. **yt-dlp as the standalone Linux binary** (`yt-dlp_linux`; the runtime image has no shell and no
   Python), with Node as its JavaScript runtime (`--js-runtimes node:/nodejs/bin/node`). A pinned
   copy ships in the image. On first start it is copied to `/data/bin/`, and from then on it updates
   itself daily with `yt-dlp -U` (which checks the release checksums). When YouTube breaks yt-dlp,
   the fix arrives within a day without a redeploy.
2. **Browsing and search use the endpoint the YouTube Music website uses** (InnerTube, client
   `WEB_REMIX`), with no API key and no quota. This is so the Spotify quota outage cannot happen
   again. The suggested library is `youtubei.js`; the builder may hand-roll the few calls instead.
3. **Signing in means pasting a cookie.** In Settings → YouTube Music, you paste the `Cookie` header
   from a logged-in music.youtube.com tab (DevTools → Network). Google offers no proper login for
   this, and this method is the dependable one. ECHO stores the cookie encrypted in `connections`
   (provider `youtube`), the way it stores the Navidrome secret, and never sends it back to the
   browser. ECHO checks the cookie on save (an authenticated call must return the account's name)
   and shows that name. When Google rotates the cookie and calls start failing as signed-out, ECHO
   says "Sign in to YouTube Music again".
4. **Audio downloads never carry the cookie.** yt-dlp's own documentation warns that accounts used
   with it can be banned. The cost is that age-restricted and members-only songs do not play; they
   show a clear message and are skipped.
5. **YouTube plays stay out of ECHO's play history, mixes and Wrapped.** Those are built from
   Navidrome song ids. Instead, each play is added to the user's **YouTube** history (the same ping
   the website sends, only when signed in), so YouTube's Home learns. *This corrects a guess made
   earlier in the conversation, that YouTube plays would count in Wrapped.*
6. **Who gets it:** everyone on the server. An admin switch `youtube.enabled` (on by default) hides
   it from everyone. The admin page also shows yt-dlp's version and the result of its last update.
7. **The switch is visible whenever the admin switch is on**, even before signing in. Signed out,
   YouTube mode offers Search, Explore, a general Home and playback. Library, likes and the
   personalised Home ask you to sign in.
8. **The switch is remembered per device** (localStorage, like volume and quality), so a phone can
   stay in YouTube mode while the desktop stays in Navidrome mode.
9. **One queue across both modes. Flipping the switch keeps playing.** Playing something replaces the
   queue as it does today; "Play next" and "Add to queue" may mix the two sources.
10. **Lyrics tab:** ECHO's lyrics engine looks the song up by title, artist and duration (LRCLIB,
    NetEase) and highlights synced lines. When it finds nothing, YouTube's own plain lyrics show.
11. **Radio:** when the queue runs out in YouTube mode, YouTube's radio for the last song follows
    (YouTube's "Up next" automix). This obeys the existing Autoplay preference.
12. **Images come through ECHO's server.** A thumbnail proxy allows only YouTube's image hosts. The
    CSP stays `'self'`, and the browser never talks to Google.
13. **On a phone, it uses YouTube Music's phone layout**: a bottom tab bar (Home, Explore, Library),
    search in the top bar, and a mini player above the tabs. The switch sits in the account menu, as
    the old source switch did.
14. **Web only.** The Android app gets nothing new (see the queue-sync constraint below).
15. **In YouTube mode, ECHO behaves the way YouTube Music does.**
    - Tapping a single song (in search, a Home shelf or Related) starts **that song's radio**.
      Up next fills at once with YouTube's automix, so the next song can be resolved ahead.
    - Tapping a song in an album, a playlist or Liked music plays **that list** from that song.
    - Call 11 still covers a list that runs out.
16. **Saving the queue.**
    - A queue of Navidrome songs only is saved where it is today, which is where Android reads it.
    - A queue that holds any YouTube song is saved to a **separate, web-only slot** on the server.
    - The web restores whichever of the two was saved last.
    - Android never sees YouTube songs, so there's no new APK, and a YouTube session survives a
      reload.
17. **A song from the other mode.**
    - **A YouTube song in Navidrome mode** plays in the dock with its title and artwork.
      - The Stage and the lyrics view work: the lyrics come by title and artist, and the Stage
        uses its default colours, because the palette service only reads Navidrome covers.
      - The dock's artist and album links and the heart are hidden for it.
    - **A Navidrome song in YouTube mode** shows in the player bar. Thumbs-up and Related are
      hidden; Up next and Lyrics work.
    - Autoplay at the end of a queue follows the source of the last song.
18. **Roboto is self-hosted**, like Selawik, because the CSP blocks Google Fonts.
19. **Which Google account:** the cookie's first signed-in account (`X-Goog-AuthUser: 0`).
    - Its name shows on save, so a wrong account is visible at once.
    - Picking a brand account comes later, if it's ever needed.

## Goals

1. A **Navidrome | YouTube Music** switch in the top bar (on a phone, in the account menu). YouTube
   mode lives under its own routes (for example `/yt/...`), so every page is a deep link and the
   browser's Back button works.
2. **Search**: suggestions as you type, then results with tabs for Songs, Albums, Artists and
   Playlists. Any song plays from there.
3. **Home**: YouTube Music's shelves (Quick picks, Listen again, mixes, and so on). They are
   personalised when signed in and general when signed out.
4. **Explore**: new releases, charts, and moods and genres.
5. **Library** (signed in): your playlists, Liked music, albums and artists.
6. **Pages** for an album, an artist (top songs, albums, singles) and a playlist, each playable and
   shuffleable.
7. **The player bar** as in mockup A: previous, play/pause and next, time, the song, a like
   (thumbs up), volume, repeat and shuffle. It opens the **full-screen player** with Up next,
   Lyrics and Related tabs.
8. **Like** (signed in) likes the song on the user's real YouTube Music account, and the button shows
   the current state.
9. **It plays like Navidrome**: background play on phones, the Media Session (lock screen and media
   keys), seeking, and ECHO's volume. The next song is resolved ahead of time, so it starts without a
   wait.
10. **First sound within about 6 seconds** of pressing play on a song nobody has played lately
    (extraction alone measured 4 s on the dev box).
11. **Settings → YouTube Music**: sign in (paste the cookie), see the account name, sign out.
    Admin: the on/off switch, yt-dlp's version and its last update.
12. **Failures stay contained.** If yt-dlp breaks, YouTube answers with a bot check, a song is
    unavailable or the cookie expired, YouTube mode shows a plain message (and skips a song that
    will not play). Navidrome mode is never affected.

## Non-goals

- Android.
- Video. Music videos play as audio only.
- Podcasts, uploads, downloads or offline play.
- Creating or editing playlists, saving to playlists, and subscribing to artists (possible later).
- ECHO's Stage, visuals or lyrics view in YouTube mode.
- YouTube results inside Navidrome pages, or Navidrome results inside YouTube pages.
- Premium-quality (256 kbps) formats. These need the cookie for audio, which decision 4 rules out.

## Anti-goals (a failure even if it works)

- The user's Google account gets flagged because of ECHO.
- Navidrome mode changes or gets slower: playback, the Stage, lyrics and the queue as they are today.
- The cookie appears in a log, in the browser, or anywhere except requests to YouTube's own hosts.
- The browser contacts Google directly, or the CSP gets loosened for YouTube.
- ECHO wears YouTube's logo or brand marks. It copies the layout and colours, under ECHO's name.
- A YouTube breakage takes down ECHO, or blocks the server's start-up.
- Live blur or `backdrop-filter` (see `echo-no-glass`).

## Constraints (measured on the dev box, 2026-11-03)

- **yt-dlp 2026.10.21 with `--js-runtimes node`** resolves a song in about 4 s (2.6 s of CPU on the
  i7-3770). Concurrent resolves need a small limit so they don't starve the box.
- **The audio URLs are bound to the server's IP** (`ip=` in the URL) and expire after about 6 hours.
  The audio must therefore flow through ECHO. A resolved URL can be reused until shortly before it
  expires.
- **googlevideo answers 403 to an HTTP `Range` header** but serves the `&range=start-end` query
  parameter (200). The stream route must translate the browser's Range requests into that
  parameter and answer 206 itself (the file size comes from yt-dlp's `-j` output). The alternative
  is to download the whole file to a bounded disk cache first (a 5.5 MB song took about 1 s) and
  serve it with ordinary Range. The builder chooses.
- **Format 140** (AAC in m4a, about 130 kbps) is the target format, because it plays in Safari and
  iOS too; Opus/WebM (251) does not everywhere. YouTube's m4a is fragmented DASH. Check that
  `<audio>` seeks in it in Chromium, Firefox and WebKit.
- **The runtime image is distroless** (`gcr.io/distroless/nodejs24-debian13`): no shell, no Python.
  The standalone binary unpacks itself into `TMPDIR`. Verify there is a writable `/tmp` in the
  image, or point `TMPDIR` into `/data`.
- **ECHO's structure**: a Hono server (`src/server/`) and a React client (`src/client/`).
  `PlaybackController` drives one provider. `NavidromeProvider` plays `<audio>` through
  `/api/v1/navidrome/stream/:id` (`pipe()` in `src/server/navidrome/routes.ts`). `ProviderId` is
  only `'navidrome'` today and becomes `'navidrome' | 'youtube'`. Navidrome scrobbles (which also
  feed ECHO's plays) must fire only for Navidrome songs.
- **Queue sync** (`queueSync.ts`) stores the queue on the server, and the Android app reads it. A
  queue holding YouTube songs must not break Android: either Android skips them, or YouTube songs
  stay out of the synced queue.
- **The CSP** is `default-src 'self'` with `img-src`, `media-src` and `connect-src` set to `'self'`.
  It stays that way.
- **Anonymous downloads from a busy IP can hit YouTube's "Sign in to confirm you're not a bot"**
  check. ECHO shows that clearly and does not fall back to the cookie.
- Deploying needs the owner's explicit word (`echo-deployment`). The repo has no remote.

## Left to the builder

- `youtubei.js` or hand-rolled InnerTube calls, and how browse responses are cached.
- Stream-through with `range` translation, or a bounded download cache.
- How YouTube tracks ride the player: a second provider, or the existing `<audio>` provider choosing
  its stream URL by `track.provider`.
- Route names, the component layout, and the visual details within mockup A, using ECHO's existing
  spring-motion helpers where they fit.
- The exact concurrency limit for resolves, and how far ahead to resolve.
- Tests in the project's style: unit tests with recorded InnerTube and yt-dlp fixtures, e2e tests
  against a mock (no live YouTube in CI).
