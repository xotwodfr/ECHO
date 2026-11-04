# ECHO for Linux

A native GTK 4 client for an ECHO server: Rust, GTK 4, GStreamer for audio and libsecret for the
device token. Server: `https://echo.folk3s.com` (the Android app's), `ECHO_URL` for another.

## What the baseline does

The same core on every native client (Android, Linux, Windows, macOS, iOS):

- **Sign in** with username, password and, with two-factor on, the authenticator code, in one
  request (`POST /api/v1/auth/device`). The device token is kept in the Secret Service (GNOME
  Keyring, KWallet). Without one it lives as long as the window. **Sign out** ends this device's
  session on the server too (Settings → Account → Sessions & devices). A token the server refuses
  (revoked, idle 60 days) brings the sign-in back.
- **Albums**, A–Z (the Subsonic proxy's `getAlbumList2`), and an album's **songs** (`getAlbum`).
- **Play**: a song from a signed stream URL (`/navidrome/stream-url/:id`, 6 h, this song only), as
  the file is (GStreamer plays every format); the album goes on, and stops after its last song.
  A bar with the song, its time, and play/pause.

## Build and run

Needs GTK ≥ 4.12, GStreamer ≥ 1.24 with its good plugins (`souphttpsrc`) and the decoders for your
files, libsecret, and Rust ≥ 1.88. On Arch: `pacman -S gtk4 gst-plugins-good gst-plugins-base
gst-libav libsecret rust`.

```sh
cargo run --release
```

| Variable | Meaning |
|---|---|
| `ECHO_URL` | Another ECHO server, e.g. `http://localhost:18797` for a test server |
| `ECHO_AUDIO_SINK` | A GStreamer sink description instead of the speakers, e.g. `"fakesink sync=true"` on a machine without a sound card |

Checked 2026-11-04 against a test server with the mock Navidrome, through GTK's Broadway backend
(`gtk4-broadwayd :7`, `GDK_BACKEND=broadway BROADWAY_DISPLAY=:7`): sign in, albums, an album, a
song playing in real time, pause, the album going on, sign out revoking the device.

## Next

Covers, search, playlists, the queue that follows you (`/me/queue`), lyrics, MPRIS (media keys and
the desktop's player controls), a `.desktop` file and an icon, libadwaita where installed.
