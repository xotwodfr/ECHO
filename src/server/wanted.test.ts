import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession } from './auth/sessions.ts';
import { type MockSubsonic, startMockSubsonic } from './navidrome/mock.ts';
import { call, testDeps } from './testing.ts';
import { bestMatch, wordsOf } from './wanted.ts';

// The Wanted list: one list for everyone on the server, of music to add to Navidrome. An item is
// found when a song or album in the library has every word of it in its artist and title.

describe('matching', () => {
  it('words ignore case, accents and punctuation', () => {
    expect(wordsOf('Fred again.. — Ten Days!')).toEqual(['fred', 'again', 'ten', 'days']);
    expect(wordsOf('Sigur Rós: Hoppípolla')).toEqual(['sigur', 'ros', 'hoppipolla']);
    expect(wordsOf('  ')).toEqual([]);
  });

  it('an album first, then a song, with every word in its artist and title', () => {
    const result = {
      album: [
        { id: 'al-9', name: 'Hounds of Love', artist: 'Kate Bush' },
        { id: 'al-1', name: 'The Kick Inside', artist: 'Kate Bush' },
      ],
      song: [
        {
          id: 's-1',
          title: 'Running Up That Hill',
          artist: 'Kate Bush',
          album: 'Hounds of Love',
          albumId: 'al-9',
        },
      ],
    };
    expect(bestMatch(wordsOf('kate bush running up that hill'), result)).toEqual({
      kind: 'song',
      id: 's-1',
      title: 'Running Up That Hill',
      artist: 'Kate Bush',
      albumId: 'al-9',
    });
    expect(bestMatch(wordsOf('Hounds of Love'), result)).toMatchObject({
      kind: 'album',
      id: 'al-9',
    });
    // A word that is in neither the artist nor the title: not this one.
    expect(bestMatch(wordsOf('Kate Bush Wuthering Heights'), result)).toBeNull();
    expect(bestMatch(wordsOf('anything'), {})).toBeNull();
  });
});

describe('the routes', () => {
  let mock: MockSubsonic;
  beforeAll(async () => {
    mock = await startMockSubsonic({});
  });
  afterAll(() => mock.close());

  function setup() {
    const t = testDeps();
    t.deps.navidrome.defaultUrl = mock.url;
    const db = t.deps.auth.db;
    const user = async (name: string, connect = true) => {
      const id = Number(
        db
          .prepare(
            "INSERT INTO users (username, password_hash, role, created_at) VALUES (?, 'x', 'user', 0)",
          )
          .run(name).lastInsertRowid,
      );
      const cookie = `__Host-echo_session=${createSession(db, id, 'web', t.clock.t)}`;
      if (connect) {
        const put = await call(
          t.app,
          'PUT',
          '/api/v1/me/connections/navidrome',
          { username: 'ada', password: 'navidrome-pass' },
          cookie,
        );
        expect(put.status).toBe(200);
      }
      return { id, cookie };
    };
    const add = (text: unknown, who: { cookie: string }) =>
      call(t.app, 'POST', '/api/v1/wanted', { text }, who.cookie);
    const list = async (who: { cookie: string }) =>
      (await (await call(t.app, 'GET', '/api/v1/wanted', undefined, who.cookie)).json()) as {
        id: number;
        text: string;
        addedBy: string | null;
        found: { kind: string; id: string } | null;
      }[];
    return { ...t, db, user, add, list };
  }

  it('one list for everyone: added, found in the library or not, and removed by anyone', async () => {
    const s = setup();
    const ada = await s.user('ada');
    const bo = await s.user('bo');
    const harbour = await s.add('Harbour Lights', ada);
    expect(harbour.status).toBe(201);
    expect(await harbour.json()).toMatchObject({
      text: 'Harbour Lights',
      addedBy: 'ada',
      found: { kind: 'album', id: 'al-1', title: 'Harbour Lights', artist: 'Lowfield' },
    });
    s.clock.t += 1000;
    const kate = await s.add('Kate Bush — Running Up That Hill', bo);
    expect((await kate.json()).found).toBeNull();

    // Bo sees Ada's item too, newest first.
    expect((await s.list(bo)).map((x) => [x.text, x.addedBy])).toEqual([
      ['Kate Bush — Running Up That Hill', 'bo'],
      ['Harbour Lights', 'ada'],
    ]);
    // The same words again is the same item, whoever adds it.
    const again = await s.add('  harbour LIGHTS! ', bo);
    expect(again.status).toBe(200);
    expect((await again.json()).text).toBe('Harbour Lights');
    expect(await s.list(ada)).toHaveLength(2);

    // Anyone removes anything: it is one shared list.
    const id = (await s.list(ada)).find((x) => x.addedBy === 'bo')?.id;
    expect(
      (await call(s.app, 'DELETE', `/api/v1/wanted/${id}`, undefined, ada.cookie)).status,
    ).toBe(200);
    expect((await s.list(bo)).map((x) => x.text)).toEqual(['Harbour Lights']);
    expect(
      (await call(s.app, 'DELETE', `/api/v1/wanted/${id}`, undefined, ada.cookie)).status,
    ).toBe(404);
  });

  it('a search that misses the whole text asks again by its longest word, then checks every word', async () => {
    const s = setup();
    const ada = await s.user('ada');
    // The mock's search3 looks for the whole text in names only, as some servers do.
    expect((await (await s.add('Lowfield Harbour Lights', ada)).json()).found).toMatchObject({
      kind: 'album',
      id: 'al-1',
    });
    expect((await (await s.add('Lowfield Harbour Lights 2', ada)).json()).found).toMatchObject({
      kind: 'song',
      id: 'al-1-t2',
      albumId: 'al-1',
    });
  });

  it('what is still missing is asked again when the list is opened, at most every ten minutes', async () => {
    const s = setup();
    const ada = await s.user('ada');
    const searches = () => mock.requests.filter((q) => q.has('query')).length; // search3
    const before = searches();
    await s.add('Kate Bush — Running Up That Hill', ada);
    const asked = () => searches() - before;
    const afterAdd = asked();
    await s.list(ada);
    expect(asked()).toBe(afterAdd); // just checked
    s.clock.t += 10 * 60_000 + 1;
    await s.list(ada);
    expect(asked()).toBeGreaterThan(afterAdd);
  });

  it('refuses empty, wordless and overlong text; a user without Navidrome adds without a check', async () => {
    const s = setup();
    const cy = await s.user('cy', false);
    for (const bad of ['', '   ', '!!! —', 'x'.repeat(201), 42, null])
      expect((await s.add(bad, cy)).status).toBe(400);
    const ok = await s.add('Boards of Canada', cy);
    expect(ok.status).toBe(201);
    expect((await ok.json()).found).toBeNull();
    expect((await call(s.app, 'GET', '/api/v1/wanted')).status).toBe(401);
  });

  it('only the server’s own library marks items found: not another server a user connected', async () => {
    const s = setup();
    const ada = await s.user('ada'); // connected to the default Navidrome
    // The default changes: Ada's server is now someone else's, and must not fill the shared list.
    s.deps.navidrome.defaultUrl = 'http://navidrome.invalid:4533';
    // Still allowed, so Ada keeps playing from it: only the trust is gone.
    s.db
      .prepare("INSERT INTO server_settings (key, value_json) VALUES ('navidrome.allowList', ?)")
      .run(JSON.stringify([mock.url]));
    expect((await (await s.add('Harbour Lights', ada)).json()).found).toBeNull();
    s.clock.t += 10 * 60_000 + 1;
    expect((await s.list(ada))[0]?.found).toBeNull();
  });

  it('a user adds at most 200 items', async () => {
    const s = setup();
    const ada = await s.user('ada', false);
    const insert = s.db.prepare(
      'INSERT INTO wanted (text, norm, added_by, added_at) VALUES (?, ?, ?, 0)',
    );
    for (let i = 0; i < 200; i++) insert.run(`item ${i}`, `item ${i}`, ada.id);
    expect((await s.add('one more', ada)).status).toBe(409);
    const bo = await s.user('bo', false);
    expect((await s.add('one more', bo)).status).toBe(201);
  });

  it('a deleted user’s items stay on the list, added by nobody', async () => {
    const s = setup();
    const ada = await s.user('ada');
    await s.add('Boards of Canada', ada);
    s.db.prepare('DELETE FROM users WHERE id = ?').run(ada.id);
    const bo = await s.user('bo');
    expect(await s.list(bo)).toMatchObject([{ text: 'Boards of Canada', addedBy: null }]);
  });
});
