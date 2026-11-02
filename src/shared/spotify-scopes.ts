// The Spotify scopes ECHO asks for (PLAYBACK_ARCHITECTURE.md §4.2), shared so the browser can tell
// when a connection made before a scope was added needs a reconnect.
export const REQUIRED_SCOPES = [
  'streaming',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-library-read',
  'user-library-modify', // hearts save to Spotify
  'playlist-read-private',
  'user-follow-read', // followed artists in Your Library
  'user-follow-modify', // hearts on artists
  'user-top-read', // Home: your top tracks and artists
  'user-read-recently-played', // Home: Jump back in
  'user-read-private',
  'user-read-email', // §4.2: dropped once the manual check shows it is not needed
] as const;
