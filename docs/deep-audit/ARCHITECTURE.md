# Architecture

Verified by reading the code at the paths given, unless a sentence says otherwise.

## 1. The parts

```mermaid
flowchart LR
  subgraph Clients
    Web["Web (React 19, Vite)<br/>src/client"]
    Win["Windows (Avalonia, .NET 10)<br/>Windows/"]
    And["Android (Kotlin, Media3)<br/>Android/"]
    Lin["Linux (Rust, GTK4)<br/>Linux/"]
    App["macOS / iOS (SwiftUI)<br/>Apple/ — never built or run"]
  end
  Caddy["Caddy (TLS, the host's)"]
  subgraph ECHO["ECHO server (Node 24, Hono 4) src/server"]
    Auth["auth/ — sessions, device tokens, TOTP, rate limits"]
    Nav["navidrome/ — Subsonic proxy, stream, covers"]
    YT["youtube/ — catalogue, yt-dlp streams"]
    Me["queue.ts, plays.ts, settings.ts, wanted.ts"]
    Lyr["lyrics/ — sources, cache"]
    DB[("SQLite<br/>better-sqlite3")]
  end
  Navidrome["Navidrome (each user's own account)"]
  Ext["LRCLIB, Spicy Lyrics,<br/>ListenBrainz, YouTube"]

  Web -- "cookie + Origin check" --> Caddy
  Win & And & Lin & App -- "Bearer device token" --> Caddy
  Caddy --> ECHO
  Nav --> Navidrome
  YT & Lyr --> Ext
  Auth & Me & Lyr --- DB
```

- One process, one SQLite file. No queue, no cache server, no second service.
- The server keeps no audio. A song is piped from Navidrome (or from YouTube through yt-dlp's
  resolved URL) to the listener.
- Each user connects their own Navidrome account; its credentials are sealed in the database
  (`src/server/crypto.ts`, AES-256-GCM under a key from a file).

## 2. Where the code is

| Path | What |
|---|---|
| `src/server/index.ts` | `createApp(deps)`: every route is mounted here |
| `src/server/http.ts` | Host check, Origin check, response headers, 64 KB body limit |
| `src/server/auth/` | Passwords (argon2id), sessions (hashed tokens), TOTP, login limits, the API budget |
| `src/server/navidrome/url.ts` | Which Navidrome URL a user may connect (the SSRF rules), address pinning |
| `src/server/navidrome/client.ts` | One user's Subsonic client: signing, timeouts |
| `src/server/navidrome/routes.ts` | The allow-listed proxy, `/stream/:id`, `/stream-url/:id`, `/cover/:id` |
| `src/server/navidrome/mock.ts` | A Subsonic server for tests, with faults (`down`, `slowMs`, `breakStreamAt`, …) |
| `src/server/youtube/` | Catalogue (youtubei.js), `ytdlp.ts` (URL cache, two at a time, prefetch) |
| `src/server/queue.ts` | The saved queue: `GET`, `PUT`, `PATCH`, compare-and-set on `updated_at` |
| `src/client/api.ts` | The web's one way to call the server |
| `src/client/connection.ts` | Whether the server can be reached; the probe loop |
| `src/client/playback/` | Queue, controller, the Navidrome provider (two `<audio>` voices), queue sync |
| `src/client/shell/fresh.ts` | `useFresh`: page data with a cache and protection against late answers |
| `Windows/App/Api/Api.cs` | The Windows client's API |
| `Windows/App/Playback/` | `Player.cs`, `ProgressiveStream.cs` (download while playing), miniaudio output |
| `docs/api/openapi.yaml` | The API; `src/server/openapi.test.ts` fails when a route is missing from it |

## 3. A JSON request

```mermaid
sequenceDiagram
  participant C as Client
  participant E as ECHO
  participant N as Navidrome
  C->>E: GET /api/v1/navidrome/rest/getAlbum?id=…
  Note over E: http.ts: Host, Origin (cookie + unsafe method only)
  Note over E: auth: session or device token → user; API budget (50 burst, 10/s)
  Note over E: method on the allow-list? stored credentials unsealed
  E->>N: GET /rest/getAlbum?id=…&u=…&t=md5(pw+salt)&s=salt (kept-alive connection)
  N-->>E: subsonic-response
  Note over E: parsed, status checked (rejected credentials → code navidrome.auth)
  E-->>C: JSON
```

## 4. A song

```mermaid
sequenceDiagram
  participant P as Player
  participant E as ECHO
  participant N as Navidrome
  alt Linux, Apple (their players take a URL, not a header)
    P->>E: GET /navidrome/stream-url/:id (Bearer)
    E-->>P: /navidrome/stream/:id?uid&exp&sig (HMAC, valid 6 h)
    P->>E: GET that URL (Range)
  else Web (same-origin cookie), Windows and Android (Bearer)
    P->>E: GET /navidrome/stream/:id (Range)
  end
  E->>N: GET /rest/stream?id=…&format=… (Range forwarded)
  N-->>E: 200/206, bytes
  E-->>P: the same status and headers, bytes piped (Readable.toWeb), nothing buffered or stored
  Note over E,N: The listener leaves → ECHO closes the upstream request (stream.test.ts)
  Note over E,N: Navidrome silent 15 s → ECHO ends it. A listener that stopped reading is not silence (client.test.ts)
```

## 5. Judgement

- **Strengths (verified):** one small server with clear seams; every dependency of a route is passed
  in (`deps`), so tests run the real app against a mock Subsonic server; a contract test ties the
  routes to the OpenAPI file; an isolation test (`src/server/isolation.test.ts`) fails when a new
  route is not shown to keep one user's data from another. It caught this audit's new route.
- **Debt:** five clients each reimplement the API client, the queue and the queue save. What one
  learns (trimming the queue to 64 KB, the position-only save, retries) reaches the others only by
  hand. The table in [ECHO-COMMUNICATION.md](ECHO-COMMUNICATION.md) §6 shows where each stands.
  A shared library is not proposed: four languages, and each client is small.
- **Not a problem, though it looks like one:** the proxy rebuilds its Subsonic client on every
  request. Measured: it costs microseconds ([PERFORMANCE.md](PERFORMANCE.md) §3).
