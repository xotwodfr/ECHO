// Records the InnerTube answers the catalogue tests replay: node scripts/record-youtube-fixtures.mjs
// src/server/youtube/fixtures/innertube.json.gz (live YouTube, anonymous). The key format must match
// catalogue.test.ts keyOf.

import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { Innertube, Log } from 'youtubei.js';

Log.setLevel(Log.Level.NONE);
const keyOf = (url, body) => {
  const u = new URL(url);
  const b = body ? JSON.parse(body) : {};
  return [
    u.pathname,
    b.browseId ?? '',
    b.query ?? b.input ?? '',
    b.videoId ?? '',
    b.params ?? '',
  ].join('|');
};
const store = {};
const rec = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  const body =
    typeof init?.body === 'string'
      ? init.body
      : input instanceof Request && input.method === 'POST'
        ? await input.clone().text()
        : undefined;
  const res = await fetch(input, init);
  const text = await res.clone().text();
  const k = keyOf(url, body);
  store[k] = { status: res.status, text };
  return res;
};
const yt = await Innertube.create({
  retrieve_player: false,
  generate_session_locally: true,
  lang: 'en',
  location: 'SE',
  fetch: rec,
});
const songs = await yt.music.search('bohemian rhapsody', { type: 'song' });
await yt.music.search('bohemian rhapsody');
const s0 = songs.songs.contents[0];
await yt.music.getAlbum(s0.album.id);
await yt.music.getArtist(s0.artists[0].channel_id);
const pls = await yt.music.search('queen', { type: 'playlist' });
await yt.music.getPlaylist(pls.playlists.contents[0].id);
await yt.music.getUpNext('fJ9rUzIMcZQ', true);
await yt.music.getUpNext(s0.id, false); // meta(): a song's own details, with its album
await yt.music.getHomeFeed();
await yt.music.getExplore();
await yt.music.getLyrics('fJ9rUzIMcZQ');
await yt.music.getRelated('fJ9rUzIMcZQ');
await yt.music.getSearchSuggestions('bohem');
const out = {
  meta: {
    recordedAt: new Date().toISOString(),
    album: s0.album.id,
    artist: s0.artists[0].channel_id,
    playlist: pls.playlists.contents[0].id,
    song: s0.id,
  },
  responses: store,
};
const gz = gzipSync(JSON.stringify(out));
writeFileSync(process.argv[2], gz);
console.log(
  Object.keys(store).length,
  'responses',
  gz.length,
  'bytes gz',
  JSON.stringify(out.meta),
);
