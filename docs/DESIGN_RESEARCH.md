# ECHO — Design Research

Status: **Draft 2** · Research conducted 2026-10-22 · open questions (§7) updated 2026-10-24
Related: [Design system](DESIGN_SYSTEM.md) · [Lyrics experience](LYRICS_EXPERIENCE.md) · [Technical architecture](TECHNICAL_ARCHITECTURE.md)

This document records what was researched, which skills and tools were **actually** used, where every
technical claim comes from, and what remains open. Claim labels: **[C]** confirmed in a primary
source (official docs, terms, source code, registry metadata), **[R]** reported by a secondary
source, **[U]** unverified (knowledge or inference).

---

## 1. Skill and tool discovery

### 1.1 Method

Inspected on 2026-10-22: `~/.claude/skills/`, `~/.claude/plugins/` (marketplaces, cache and synced
plugin skills), `~/.claude/CLAUDE.md` (it contains only RTK CLI-proxy instructions, irrelevant to
design), and the project directory (empty apart from a `.remember/` folder; no project `CLAUDE.md` or
`AGENTS.md`). `~/.codex/AGENTS.md` exists but belongs to a different tool and was not used. Skills
were found by searching every `SKILL.md` for design, taste, motion, shader, WebGL, audio, typography,
colour and accessibility terms.

### 1.2 Skills used (read and applied)

| Skill | What was read | How it was applied |
|---|---|---|
| **`design-taste-frontend`** (tasteskill v2, the requested `taste-skill`) | `SKILL.md`; `references/app-screens.md` (all of it), `colour.md`, `type.md`, `motion.md` (§1–2, §8–10), `critique.md` (§1), `tells.md` (§1) | **Ran `scripts/draw.mjs --app`** (kind `community`, dark, screens home/list/detail/settings). It dealt two styles; **True-black flat** was chosen (seed 128902345) because ECHO is a media product used in long dark sessions, and the alternative (*Data terminal*) suits monitoring. Applied: the style's tokens and move (elevation by lightness, inverted primary, colour only on the "data"), the "give the product a face" rules (`DESIGN_SYSTEM.md` §2), the app house rules for the Shell zone (no gradients, glow, monospace, tracked caps, icon tiles; its glass ban was lifted on 2026-10-28, `DESIGN_SYSTEM.md` §7.11), type and colour laws, state rules, motion rules (blur ≤ 8px, no bounce, reduced motion), and the idea sentence with the competitor test (`PRODUCT_SPEC.md` §1). **Redraws recorded:** gap 14 → 16px (4px grid), top bar dropped (nothing real to put in it), lime accent replaced by the album's accent and Sodium fallback (the sheet's own "face" option), #000 ground replaced by cool near-black #0A0B0D (the sheet's own "ground with the product's temperature" option). **Not run:** `lint.mjs` / `inspect.mjs` (there is no page yet). They are scheduled in M2 and M9 (`IMPLEMENTATION_PLAN.md`). |
| **`frontend-design`** (Anthropic official plugin) | `SKILL.md` | The two-pass plan-then-review method, its list of AI-default looks (checked against: ECHO avoids near-black + single acid accent by using a cover-derived accent), "spend your boldness in one place" (the lyric field), "the brief's own words always win" (used to resolve the taste-skill vs brief conflict, §2.2), and the writing guidance (error copy, action names) |
| **`design:design-system`** | `SKILL.md` | Structure of `DESIGN_SYSTEM.md`: token categories, components with variants/states/accessibility, a do/don't critique |
| **`design:design-critique`** | `SKILL.md` | The critique framework (first impression, hierarchy, consistency, accessibility, prioritised fixes) used for `DESIGN_SYSTEM.md` §14 and required as review write-ups in M2/M3/M6/M9 |
| **`design:accessibility-review`** | `SKILL.md` | WCAG AA checklist (contrast 1.4.3/1.4.11, keyboard, focus, targets, labels) turned into `ACCEPTANCE_CRITERIA.md` §9. ECHO targets WCAG **2.2** (newer than the skill's 2.1 baseline): 2.5.8 target size, 2.4.11 focus not obscured |
| **`ponytail`** (active in this session) | session instructions | Dependency minimalism: rejected R3F/drei, motion, a router, a colour library, Meyda/essentia, a database (`TECHNICAL_ARCHITECTURE.md` §3) |

### 1.3 Skills examined and not applied

| Skill | Why not |
|---|---|
| `engineering-skills:epic-design` | Scroll-storytelling for marketing sites ("never build a flat page"). ECHO is an app, and taste-skill's app rules forbid entrance choreography in the shell |
| `figma:figma-shaders` | Authoring WGSL shaders *inside Figma* through the Figma MCP. No Figma file in this project |
| `figma:figma-implement-motion` / `figma-use-motion` | Figma-bound workflows. Found, not read beyond their descriptions |
| `engineering-skills:senior-frontend`, `engineering-skills:tech-stack-evaluator`, `product-skills:ui-design-system` | Discovered in the skill list. Not read; the stack evaluation was done by research instead (§5.5) |
| `superpowers:brainstorming` | Not invoked: the brief already fixes the product scope; open decisions are listed in §7 instead |

### 1.4 Requested skills that are not installed

No installed skill covers **Three.js/WebGL/shaders/creative coding**, **audio analysis or music
visualisation**, **colour theory** or **typography** specifically. The best available alternatives
were used:
- four research subagents (§6.1) reading official documentation, terms and **prior-art source code**
  (AMLL, Spicy Lyrics, Beautiful Lyrics, Navidrome, LRCLIB);
- taste-skill's `type.md`/`colour.md` and frontend-design for type and colour;
- Google Fonts family metadata (axes and subsets, fetched 2026-10-22) for the typeface decision.

---

## 2. Design principles applied

### 2.1 Principles (with origin)

| # | Principle | Origin |
|---|---|---|
| 1 | The idea comes from the subject: an echo's arrival, peak and decay becomes the lyric life cycle | taste-skill step 4 (idea sentence and competitor test) |
| 2 | Time is depth; positions come from timestamps | brief + prior art (AMLL time-based layout) |
| 3 | Sound is the cause, light is the effect; silence is still | visual research (direction A) |
| 4 | The art is the colour; the chrome is neutral | taste-skill app rules (colour on data), Plexamp, Tidal |
| 5 | Every visual effect has a stated purpose, or it does not ship | brief + `DESIGN_SYSTEM.md` §7 |
| 6 | Clamp before you paint: constrain colours in OKLCH, interpolate in OKLab | colour research (§3.4) |
| 7 | Contrast is guaranteed against the worst case, not the average | colour research; implemented as the probe + solver |
| 8 | Dither always; grain by choice | rendering research (banding) |
| 9 | Two clocks: UI feedback fast, song motion slow, never mixed | visual research principle 9 |
| 10 | One family, one weight per role, no animated axes | taste-skill type laws + lyric research (reflow) |
| 11 | Spend boldness in one place: the lyric field | frontend-design |
| 12 | Honesty about capability: no fake beat sync, no fake word timing | brief ("do not assume…") + Spotify research |

### 2.2 Resolving conflicts between the skills and the brief

taste-skill bans gradients, glows and blur on all app screens. The brief requires artwork gradients,
"restrained bloom" and depth blur on the lyric stage. frontend-design states that "the brief's own
words always win". The resolution is **two zones** (`DESIGN_SYSTEM.md` §1): the Shell follows
taste-skill strictly, and the Stage may use only the enumerated light effects of
`DESIGN_SYSTEM.md` §7, each with a purpose and a cap. This keeps the bans meaningful where they
protect usability and keeps the brief's atmosphere where it is the product. (2026-10-28: the owner
lifted taste-skill's glass ban. Liquid glass is an approved effect in both zones, on floating
surfaces only, `DESIGN_SYSTEM.md` §7.11.)

---

## 3. Visual research

### 3.1 Reference products examined

From the visual-direction research track. Tags as reported. Items without a source are [U].

| Reference | What ECHO takes | What ECHO avoids | Source |
|---|---|---|---|
| Apple Music full-screen lyrics (macOS/iOS) | Blur and dim by distance from the active line; per-line staggered springs; word gradient sweep; colour-sampled background | Left-aligned column scroll (ECHO maps time to depth instead) | [C] 9to5mac 2023-10-11 (full-screen lyrics exist); look details [U] |
| AMLL (Apple Music-like Lyrics) | Spring and blur numbers, interlude dots, seek detection, mesh-gradient background idea | Copying code (licence unconfirmed) | [C] source read; README |
| Spicy Lyrics, Beautiful Lyrics (Spicetify) | Syllable emphasis curves, continuous sweep edge, text-shadow blur trick | AGPL code (Spicy) | [C] source read |
| Plexamp UltraBlur | **Build the background from extracted colours, not a blurred cover**, because covers carry text and borders | Glass over everything (ECHO's liquid glass, 2026-10-28, stays on floating controls and sheets: `DESIGN_SYSTEM.md` §7.11) | [R] Plex blog (Medium), Plex forum |
| MilkDrop / Butterchurn (MIT) | Feedback-buffer decay as literal "reverb" in Reverb mode | Preset screensaver look as default | [C] npm butterchurn |
| Nothing OS | Ration a signature face; neutral body | Dot-matrix gimmick | [R] Nothing community post |
| Teenage Engineering, Tidal, Roon, B&O, Sonos | Instrument honesty; neutral shell where art carries colour; Sonos as a warning (function regressed for looks) | — | [U] |
| Film titles (Saul Bass, Kyle Cooper, Elastic) | Slow cinematic timing (600–1200 ms), type and image as one composition | Jitter and flash frames | [U] |
| Stage visuals (Max Cooper, Tame Impala, Flume) | One dominant colour per song state, darkness as space, light as volume | — | [C] Place des Arts (Max Cooper); others [U] |

### 3.2 Prior-art lyric renderers: numbers extracted from source

Read from source code by the motion research track [C]. Used as reference values in
`LYRICS_EXPERIENCE.md`, not copied.

| Topic | AMLL | Spicy Lyrics | Beautiful Lyrics |
|---|---|---|---|
| Line spring | k 170–220 by line gap, ζ≈1.1; slow k 90 ζ≈0.83 | spr(f,ζ): Y f1.45 ζ0.4 | Y f1.25 ζ0.4 |
| Current line position | 35% of container | — | — |
| Stagger | 50 ms/line, ÷1.05 per step, off for seek/resize | — | — |
| Blur by distance | 1 + d px, cap 5 px, `filter` | 1.25 px × d, cap ~6.8 px, **text-shadow** (filter cost a pass per line) | 1.25 px × d, cap 5 px |
| Word wipe | `mask-image`, fade 0.5 × line height, dim alpha 0.4 | `background-clip:text`; refreshed mode one continuous edge per line, 0.55em | gradient −20%→100% |
| Emphasis | ≥ 1000 ms, 2–7 chars; scale up to ~+12%; lift −0.05em starting 400 ms early | ≥ 1000 ms; ends 250 ms before word end | ≥ 1 s, ≤ 12 chars |
| Interludes | dots at gaps ≥ 7 s, 4 s breathing | — | — |
| Seek detection | backwards, or > 150 ms off expected; dt clamp 100 ms | — | — |
| Background | 3×3 Hermite mesh from art; low-freq volume zoom/rotate/dim | — | — |

**Licences:** Spicy Lyrics is **AGPL-3.0** [C: repo LICENSE]. LRCLIB server is **MIT** [C].
AMLL's and Beautiful Lyrics' licence files were not found in the shallow clones (AMLL believed
AGPL-3.0 [U]). Rule: **no code from any of these may be copied into ECHO.**

### 3.3 Creative directions considered

| Direction | Concept | Verdict |
|---|---|---|
| **A. Reverb Chamber** | Dark acoustic room; sound becomes light that reflects and decays | **Chosen** (§4) |
| B. Anechoic | Absorbent, precise instrument; one hairline oscilloscope | Rejected: cold, and wastes the WebGL environment that is part of the brief |
| C. Afterimage | Decaying ghosts, double exposure, editorial serif | Partly adopted: the "reverb tail" decay of sung lines. The serif was rejected (harder to read at speed) |

### 3.4 Colour science findings

- Extract from a downsampled cover, dropping borders; score clusters by population × chroma
  [U, standard]. Implemented via material-color-utilities' Celebi quantiser + Score [C: npm, Apache-2.0].
- Constrain room L 0.12–0.24, accent L 0.70–0.82 with C ≤ 0.18. Gamut-map by reducing chroma.
- Interpolate in OKLab to avoid hue-wrap and the random hues near zero chroma that OKLCH hue
  interpolation produces [C: MDN `color-interpolation-method`; W3C CSS WG discussion].
- WCAG 2.2 ratios are the compliance baseline. APCA (WCAG 3 draft, not normative) is an additional
  readability target for large animated text [R: APCA introduction].

### 3.5 Typography findings

From Google Fonts metadata, fetched 2026-10-22 [C]:

| Family | Axes | Subsets | Verdict |
|---|---|---|---|
| Geologica | wght 100–900, SHRP, CRSV, slnt | latin, latin-ext, cyrillic(-ext), greek, vietnamese | **Candidate A** (M1 specimen) |
| Mona Sans | wdth 75–125, wght 200–900 | latin, latin-ext, vietnamese | **Candidate B.** Rejected in Draft 1 for lacking Cyrillic/Greek, reinstated when the owner confirmed Latin-only lyrics |
| TikTok Sans | opsz, wdth 75–150, wght 300–900, slnt | latin, cyrillic, greek, vietnamese | Rejected: brand association |
| Ubuntu Sans | wdth 75–100, wght 100–800 | latin, cyrillic, greek | Rejected: OS brand |
| Pliant | wdth 100–125, wght 100–900 | latin, cyrillic, greek | Rejected: too new (2026-06) |
| Hanken Grotesk | wght | latin, cyrillic-ext | Not needed |

History: Mona Sans was the first choice in an early draft, was replaced by Geologica after this check, and came back as a candidate once the owner confirmed that only Latin script matters. The choice is made by eye in M1 (`DESIGN_SYSTEM.md` §4.1).

---

## 4. Chosen creative direction: Reverb Chamber

The screen is a dark acoustic room. The album cover is its only light source. Sound arrives as light,
reflects and decays. Lyrics hang in the room: upcoming lines arrive from depth, the sung line peaks
under a warm "lamp", and sung lines decay like a reverb tail.

Why it wins:
- The concept is **systemic, not decorative**. Exponential decay drives sung lines (`LYRICS_EXPERIENCE.md`
  §7), wavefront rings (`VISUALIZER_SPEC.md` §4.3) and the feedback buffer (§4.4). One idea explains
  every motion.
- It gives the WebGL environment a reason to exist (transients become wavefronts) without spectrum
  bars.
- It degrades honestly: with no audio features (Spotify), the room is simply unlit by sound, which is
  Ambient mode.
- Decay is a natural intensity control, and reduced motion is "decay = 0".

---

## 5. Technical research and sources

### 5.1 Spotify

| Claim | Label | Source |
|---|---|---|
| Web Playback SDK requires Premium (mobile-only plans excluded). Supported browsers Chrome/Firefox/Safari/Edge. EME required. Iframes need `allow="encrypted-media"` | C | https://developer.spotify.com/documentation/web-playback-sdk |
| "This SDK must not be used in commercial projects without Spotify's prior written approval" | C | same |
| SDK methods/events; `WebPlaybackState` has no timestamp; `player_state_changed` fires at random intervals; no PCM/analyser API | C | https://developer.spotify.com/documentation/web-playback-sdk/reference |
| `streaming` scope for the SDK; player scopes | C | https://developer.spotify.com/documentation/web-api/concepts/scopes |
| Audio Features/Analysis, Recommendations, Related Artists, etc. restricted for new apps from 2024-11-27 | C | https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api |
| Feb 2026 Development Mode: ≤ 5 users, owner Premium, batch endpoints removed, search limit ≤ 10, `/tracks` → `/items`, `/me/library`; `external_ids` removal reverted (March 2026) | C | https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide ; https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security |
| Extended quota: organisations only, ≥ 250k MAU | C | https://developer.spotify.com/documentation/web-api/concepts/quota-modes |
| PKCE without client secret; access token 3600 s; refresh may omit a new refresh token; refresh tokens ~6 months | C | https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow ; …/refreshing-tokens |
| Redirect URIs: HTTPS except loopback; `127.0.0.1`/`[::1]`; `localhost` not allowed; dynamic port on loopback | C | https://developer.spotify.com/documentation/web-api/concepts/redirect_uri |
| Developer Policy III.5, III.6, III.7, III.13, II.4, II.5, IV | C (near-verbatim via a fetch tool; re-read before release) | https://developer.spotify.com/policy |
| Developer Terms v10 (2025-05-15): IV.2.b (no modification; resize allowed), IV.3.b (caching), VI.5 (capture) | C (same caveat) | https://developer.spotify.com/terms |
| Design guidelines: artwork unaltered; 4/8 px radius; logo ≥ 70 px; link back | C | https://developer.spotify.com/documentation/design |
| `i.scdn.co` sends `Access-Control-Allow-Origin: *` | C (live curl, 2026-10-22) | — |
| EME audio cannot be routed to Web Audio | U (inherent to EME; confirmed by the absence of any API) | — |

### 5.2 Navidrome / OpenSubsonic

| Claim | Label | Source |
|---|---|---|
| Latest release v0.64.2 (2026-09-24) | C | GitHub API |
| Auth: u+p, u+t+s, jwt; `apiKey` merged 2026-09-28 (PR #6219), unreleased; apiKey with other credentials → error 43 | C | `server/subsonic/middlewares.go`; https://github.com/navidrome/navidrome/pull/6219 ; https://opensubsonic.netlify.app/docs/extensions/apikeyauth/ |
| Extensions advertised: transcodeOffset, formPost, songLyrics v1/v2, indexBasedQueue, transcoding, playbackReport, apiKeyAuthentication, … | C | `opensubsonic.go` |
| `getLyricsBySongId` structured lyrics; `enhanced=true` adds `cueLine` word cues | C (spec) / U (Navidrome fills cues) | https://opensubsonic.netlify.app/docs/endpoints/getlyricsbysongid/ |
| CORS `AllowedOrigins: *` | C | `server/middlewares.go` |
| Raw streams support Range; live transcodes send `Accept-Ranges: none` | C | `core/stream/media_streamer.go` |
| Plays count only on `scrobble submission=true` | C | https://www.navidrome.org/docs/developers/subsonic-api/ |
| ReplayGain fields | C | OpenSubsonic responses |

### 5.3 Lyrics sources

| Claim | Label | Source |
|---|---|---|
| Spicy Lyrics API: `GET https://api.spicylyrics.org/v1/lyrics/{trackId}`, Bearer keys (`sl_sk_` server, `sl_pk_` origin-restricted), Spotify ID only, `RateLimit-*`/`Retry-After` | C | https://developers.spicylyrics.org ; /llms-full.txt |
| Spicy schema: Syllable/Line/Static, VocalGroup, Background, OppositeAligned, times in seconds | C | same |
| Spicy terms (2026-10-01): third-party apps allowed, attribution required, 30-day cache, no redistribution, no lyric rights granted | C | https://developers.spicylyrics.org/terms |
| Spicy repo AGPL-3.0 | C | https://github.com/Spikerko/spicy-lyrics |
| LRCLIB `/api/get` by metadata + duration, no auth, `syncedLyrics` LRC, `hasWordSync`/`lyricsfile` | C (API and live response) / U (data licence, rate limits) | https://github.com/tranxuanthang/lrclib |
| Musixmatch synced lyrics need commercial licensing | R | developer.musixmatch.com/plans |

### 5.4 Audio analysis libraries

| Library | Licence / status | Decision |
|---|---|---|
| Web Audio `AnalyserNode` | standard | **Used** |
| Meyda | MIT, last push 2024-07 [C] | Not needed |
| essentia.js | **AGPL-3.0**, no tagged releases [C]; commercial licence for Essentia exists [C] | Rejected |
| web-audio-beat-detector | MIT, active, offline BPM [C] | Post-MVP candidate |

### 5.5 Platform and stack

| Claim | Label | Source |
|---|---|---|
| Tauri cannot provide Widevine; depends on system webview | C | https://github.com/tauri-apps/tauri/issues/7400 |
| WebKitGTK ships ClearKey only; Widevine needs a vendor CDM | R | WebKit-WPE mailing list (2019); Igalia blog |
| castLabs ECS: Widevine component, VMP signing via EVS for production; partial Linux support | C | https://github.com/castlabs/electron-releases ; https://pypi.org/project/castlabs-evs |
| Spotify community: ECS builds get licence-server errors with Spotify | R | Spotify community thread |
| WebGPU status on Linux (Chrome on for some GPUs; Firefox Nightly) | C | https://github.com/gpuweb/gpuweb/wiki/Implementation-Status |
| three.js WebGPURenderer falls back to WebGL2 | C | https://threejs.org/manual/en/webgpurenderer.html |
| Package versions and dates (React 19.3.0, Vite 8.3.3, TS 7.0.2, three 0.186.1, …) | C | npm registry, 2026-10-22 |
| keytar archived; `@napi-rs/keyring` keytar-compatible, Secret Service on Linux, keyutils fallback non-persistent | C | GitHub API; https://github.com/Brooooooklyn/keyring-node |
| Node SEA `--build-sea`, native addon via `process.dlopen` | C | https://nodejs.org/api/single-executable-applications.html |
| SwiftShader flags for headless WebGL | C | Chromium docs |
| `mask-image` support; `text-wrap: balance`; `AudioContext.outputLatency` support | C | MDN browser-compat-data 8.1.7 |

### 5.6 Accessibility standards

| Claim | Label | Source |
|---|---|---|
| WCAG 2.3.1 flash definition and area threshold | C | https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html |
| WCAG 2.5.8 target size (24×24) | R | wcag.dock.codes |
| WCAG 2.2.2 Pause, Stop, Hide applies to auto-moving content > 5 s | U (well-known) | W3C WCAG 2.2 |
| Ofcom/ITC broadcast flash guidance | R | https://www.ofcom.org.uk/__data/assets/pdf_file/0021/16248/gn_flash.pdf |

---

## 6. Methods

### 6.1 Research delegation

Four research subagents ran in parallel, each instructed to cite sources and label claims:
(1) visual and creative direction, (2) floating lyrics and motion design (read AMLL, Spicy Lyrics and
Beautiful Lyrics source), (3) playback integrations and audio analysis (read Spotify docs, terms and
policy; Navidrome source; Spicy Lyrics API and terms; LRCLIB source), (4) architecture, security and
performance (read npm metadata, browser DRM support, keyring and testing docs). Their findings were
reconciled into this pack. Where they disagreed (e.g. Spotify loopback port rules), the primary
source was preferred and residual doubt became an [A] verification task.

### 6.2 Contrast verification

Token contrast values in `DESIGN_SYSTEM.md` §3.1 were computed with this script (WCAG 2.x relative
luminance):

```js
const L=h=>{const c=[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255)
  .map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]};
const cr=(a,b)=>{const x=L(a),y=L(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05)};
// e.g. cr('#94979C','#1C1E22') → 5.70 ; cr('#666A71','#0A0B0D') → 3.62
```

---

## 7. Open questions and decisions needed

### 7.1 Product-owner decisions (2026-10-22)

Answers to the clarifying round after Draft 1. These override earlier defaults wherever they
conflict:

| Topic | Decision | Effect |
|---|---|---|
| Q-SP-1 (gate G1): art-derived colour for Spotify | **Enabled, risk accepted** | `PLAYBACK_ARCHITECTURE.md` §4.6. Admin kill switch |
| Q-SP-2 (gate G2): synced lyrics with Spotify | **Enabled, risk accepted** | same |
| Spotify's role | Keep in MVP-β (M7) | — |
| Hardware | Server: Dell OptiPlex 7010, i7-3770 (corrected in M1), 24 GB. Clients: a normal laptop, a gaming PC, and future clients | Self-hosted architecture. Two reference clients (`ACCEPTANCE_CRITERIA.md` §0) |
| Navidrome location | Same OptiPlex | Compose network, internal URL default |
| Access | **Public internet** | Full auth, TLS, hardening (`SETTINGS_AND_SECURITY.md`) |
| HTTPS | Existing reverse proxy: **Caddy** | `TECHNICAL_ARCHITECTURE.md` §6.4 |
| Users | Mainly the owner, maybe a few others | Multi-user with invites. Spotify seats ≤ 5 |
| Login | Built-in accounts, **password + TOTP** (mandatory for admin) | `SETTINGS_AND_SECURITY.md` §4 |
| Deployment | **Docker Compose** | — |
| Clients | Browser (MVP). Desktop and mobile later | Versioned API, device tokens, signed stream URLs |
| MVP clients | Web + API ready for native clients | Native clients post-MVP |
| Spicy Lyrics key | **Owner already has one** | Spicy in scope for M6 |
| Browsers | Chrome, Chromium (Arch), Firefox, all first-class | E2E on Chromium + Firefox |
| Lyric scripts | **Latin only** | No Noto webfonts. Non-Latin is a robustness check only |
| Typeface | Decide at M1 from a specimen (Geologica vs Mona Sans). **Decided 2026-10-23: Mona Sans** | `DESIGN_SYSTEM.md` §4.1 |
| Default intensity | **Expressive** | `VISUALIZER_SPEC.md` §7.4 |
| Licence | **Open source, AGPL-3.0** | Source link in About. Spicy Lyrics code reuse becomes licence-compatible |

### 7.2 Verification tasks (resolved in the named milestone)

| ID | Question | Milestone |
|---|---|---|
| Q-DS-1 | Does the chosen face's `tnum` produce tabular digits? | M1 · **Answered:** yes, both candidate faces (`reviews/M1-type.md`) |
| Q-DS-2 | Geologica or Mona Sans? (owner chooses from the specimen) | M1 · **Answered:** Mona Sans (owner, 2026-10-23); Geologica kept in the specimen only |
| Q-SRV-1 | Do `sharp`, `better-sqlite3` and `@node-rs/argon2` prebuilt binaries run on the OptiPlex (Ivy Bridge, no AVX2)? Argon2id timing? | M1 · **Answered:** yes, all load in the production image; Argon2id 183 ms (`TECHNICAL_ARCHITECTURE.md` §2.3) |
| Q-SRV-2 | Are `node:sqlite` and `node:crypto` Argon2 stable in Node 24 LTS, so they can replace the packages? | M1 · **Answered:** `crypto.argon2` yes (adopted); `node:sqlite` no (1.2 RC), better-sqlite3 stays |
| Q-SRV-3 | Exact trusted-proxy address of the Caddy container on the compose network | M5 · **Answered at deployment:** Caddy runs on the host, so it is the gateway of ECHO's own network (`10.77.0.1`); the client address comes from `Cf-Connecting-Ip` behind the Cloudflare tunnel (`reviews/M5.md`, task 12) |
| Q-SP-3 | Do player/queue/device endpoints work unchanged for new Development Mode apps after Feb 2026? Exact `/me/library` paths? | M7 · **Answered (docs):** player endpoints unchanged; `GET /me/albums` unchanged, saving via `PUT/DELETE /me/library` (`reviews/M7.md`); live check with a Premium account pending |
| Q-SP-4 | Is `streaming` sufficient for the SDK, or are `user-read-email`/`user-read-private` required? | M7 · **Partly:** `user-read-private` is needed (Search, `product`); `user-read-email` stays until the manual check (`reviews/M7.md`) |
| Q-SP-6 | Exact CSP hosts the SDK needs | M7 · **Answered:** `sdk.scdn.co` (script and iframe), `api.spotify.com`, `i.scdn.co`; no CSP violations in the full E2E run |
| Q-SP-7 | Does Spotify offer token revocation for PKCE clients? | M8 · **Answered:** no revocation endpoint; disconnect deletes the refresh token and the user can remove the app in their Spotify account |
| Q-LI-4 | Does Navidrome fill OpenSubsonic `cueLine` from enhanced LRC/TTML files? Does it expose `isrc`? | **Answered (M6):** yes to both in v0.64.0 — cues from enhanced LRC (with `[bg:]`) and TTML; `isrc` as an array. The owner's server (0.64.0) advertises songLyrics v1+v2, not `apiKeyAuthentication` |
| Q-LI-5 | Spicy Lyrics' actual rate limits (the owner has a key; limits are unpublished) | M6 · **Open:** not measured (no key configured yet); the resolver honours `Retry-After` and backs off with a breaker |
| Q-VZ-2 | Does `audio.currentTime` advance coarsely enough in Chrome/Firefox on Linux to need the slew logic? | M5 · **Handled:** the SongClock slews small errors and snaps large ones regardless (`reviews/M3.md`); owner listening test pending |
| Q-AC-1 | Exact model of the owner's laptop (performance floor) | M9 · **Open:** the owner records it (`reviews/M9.md`) |

### 7.3 Unresolved research questions (accepted risks)

| ID | Question |
|---|---|
| Q-SP-1/2 risk | Spotify could treat colour extraction (III.13) or synced lyrics (III.6) as policy violations. Accepted by the owner. Mitigation: admin kill switches |
| Q-VZ-1 | Is capturing system audio to visualise Spotify ever permissible? (ECHO assumes no and blocks it via `Permissions-Policy`) |
| Q-LI-1 | Rights status of upstream (Apple Music/Spotify-sourced) syncs served by Spicy Lyrics |
| Q-LI-2 | Does ISRC → Spotify ID lookup for lyric matching fit "no standalone metadata service"? (Opt-in per user, default off) |
| Q-LI-3 | LRCLIB data licence and rate limits |
| Q-LI-6 | Is serving cached Spicy lyrics to several users of one private server "redistribution" under Spicy's terms §5? (ECHO's reading: no) |
| Q-LY-1 | "Sustained vocal" detection is a heuristic (word duration × mid-band energy), not source separation |
| Q-LY-3 | Sweep direction inside mixed-direction (bidi) lines follows the base direction (low priority: Latin-only) |
| Q-PL-1 | Will a future Electron ECS desktop client pass Spotify's licence server? (Reported failures) |
| Q-PL-2 | Mobile clients can only remote-control the Spotify app. Word-level lyric sync there may be too coarse (`PLAYBACK_ARCHITECTURE.md` §4.7) |
